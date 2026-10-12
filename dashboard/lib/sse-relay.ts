/**
 * Stream plumbing for the /api/calls/events SSE relay (specs/calls-dashboard.md
 * US-011). Pure over its inputs: an upstream byte stream in, a browser-facing
 * byte stream out. The route owns the fetch, the headers, and the abort wiring.
 *
 * - Upstream bytes are forwarded unchanged (frame ids, `: keepalive` lines and
 *   all), so `Last-Event-ID` semantics survive the hop.
 * - The relay writes its own `: heartbeat` comment on connect and every
 *   `heartbeatMs`, so a tunnel or proxy never sees a silent stream. A heartbeat
 *   is only written at a frame boundary, never inside a frame that arrived
 *   split across chunks.
 * - When upstream ends or errors, the relay writes an `upstream-closed` event
 *   and closes, so the browser's EventSource reconnects (and re-fetches recent
 *   calls, per the reconnect rule).
 * - When the consumer goes away (cancel) or `signal` aborts, the upstream
 *   reader is cancelled and `onEnd` runs, which the route uses to abort the
 *   upstream fetch.
 * - Safety net: a consumer that stops reading without cancelling (seen once in
 *   `next dev`, not reproduced) would otherwise hold the upstream connection
 *   open and grow the queue forever. Once more than `maxBacklog` chunks sit
 *   unread, the relay ends as if the consumer had cancelled.
 */

export const HEARTBEAT_FRAME = ': heartbeat\n\n';
export const UPSTREAM_CLOSED_FRAME = 'event: upstream-closed\ndata: {}\n\n';
export const DEFAULT_HEARTBEAT_MS = 15_000;
export const DEFAULT_MAX_BACKLOG = 64;

export type SseRelayOptions = {
  /** Interval between relay heartbeats. Default 15 s. */
  heartbeatMs?: number;
  /** Aborting ends the relay (the browser disconnected). */
  signal?: AbortSignal;
  /** Runs once when the relay ends for any reason. */
  onEnd?: () => void;
  /** Unread chunks tolerated before the consumer counts as gone. Default 64. */
  maxBacklog?: number;
};

const encoder = new TextEncoder();
const LF = 10;

export function relaySse(
  upstream: ReadableStream<Uint8Array>,
  options: SseRelayOptions = {},
): ReadableStream<Uint8Array> {
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const maxBacklog = options.maxBacklog ?? DEFAULT_MAX_BACKLOG;
  const reader = upstream.getReader();
  let timer: ReturnType<typeof setInterval> | undefined;
  let finished = false;
  // Last two forwarded bytes; a frame boundary is "\n\n".
  let tail: number[] = [LF, LF];
  let onAbort: (() => void) | undefined;

  const atBoundary = () => tail.length === 2 && tail[0] === LF && tail[1] === LF;

  const finish = () => {
    if (finished) return false;
    finished = true;
    if (timer !== undefined) clearInterval(timer);
    if (onAbort) options.signal?.removeEventListener('abort', onAbort);
    reader.cancel().catch(() => {});
    options.onEnd?.();
    return true;
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (bytes: Uint8Array) => {
        if (finished) return;
        try {
          controller.enqueue(bytes);
        } catch {
          finish();
          return;
        }
        // highWaterMark is 1 chunk, so desiredSize is 1 minus the unread count.
        if ((controller.desiredSize ?? 0) < 1 - maxBacklog && finish()) {
          controller.error(new Error('SSE consumer stopped reading'));
        }
      };

      if (options.signal?.aborted) {
        finish();
        controller.close();
        return;
      }
      onAbort = () => {
        if (finish()) {
          try {
            controller.close();
          } catch {
            // already closed or errored by the consumer
          }
        }
      };
      options.signal?.addEventListener('abort', onAbort);

      push(encoder.encode(HEARTBEAT_FRAME));
      timer = setInterval(() => {
        if (atBoundary()) push(encoder.encode(HEARTBEAT_FRAME));
      }, heartbeatMs);

      const pump = async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done || finished) break;
            if (!value || value.length === 0) continue;
            push(value);
            tail =
              value.length >= 2
                ? [value[value.length - 2], value[value.length - 1]]
                : [tail[1], value[0]];
          }
        } catch {
          // upstream errored: treat it like a close
        }
        if (finished) return;
        // A frame cut off mid-way is terminated first so the close event
        // parses on its own (the client parses frame data defensively).
        if (!atBoundary()) push(encoder.encode('\n\n'));
        push(encoder.encode(UPSTREAM_CLOSED_FRAME));
        finish();
        try {
          controller.close();
        } catch {
          // consumer already gone
        }
      };
      void pump();
    },
    cancel() {
      finish();
    },
  });
}
