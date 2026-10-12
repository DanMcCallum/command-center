'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { CallsErrorBody, FallbackClose, NoteOutcome, NoteStatus, OutboxStatus } from '@/lib/calls-types';

const inputClass =
  'w-full bg-[#2F2F2F] text-white border border-[#373737] rounded px-3 py-2 text-sm outline-none transition-colors focus:border-[#4DAB9A]';

const STATUSES: NoteStatus[] = ['Not Started', 'Working', 'Completed'];

const FALLBACK_TEXT: Record<FallbackClose, string> = {
  queued: "The redundant 'call not logged' fallback task is being closed.",
  not_delivered_yet: "A fallback task exists but hasn't delivered yet; it may need manual cleanup.",
  unreadable: 'Fallback task id unreadable; close it manually in the Tasks view.',
};

const POLL_MS = 3000;
const POLL_LIMIT_MS = 60_000;

function newClientUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

interface Props {
  callId?: string;
  contactId?: number | string | null;
  propertyId?: number | string | null;
  caller?: string;
  onClose?: () => void;
}

type Delivery =
  | { state: 'polling' }
  | { state: 'done'; taskId: number | null }
  | { state: 'dead_letter'; error: string }
  | { state: 'timeout' };

/**
 * The shared note-entry form. Posts to `/api/calls/notes` with a client_uuid
 * fixed at mount (a double submit is one outbox row), then polls the outbox
 * row until ID has the task.
 */
export default function CallNoteForm({ callId, contactId, propertyId, caller, onClose }: Props) {
  const [clientUuid] = useState(newClientUuid);
  const [contact, setContact] = useState(contactId != null ? String(contactId) : '');
  const [property, setProperty] = useState(propertyId != null ? String(propertyId) : '');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<NoteStatus>('Completed');
  const [followUp, setFollowUp] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<NoteOutcome | null>(null);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (pollRef.current) clearTimeout(pollRef.current);
  }, []);

  const poll = (outboxId: number, startedAt: number) => {
    fetch(`/api/calls/outbox/${outboxId}`, { cache: 'no-store' })
      .then(r => (r.ok ? (r.json() as Promise<OutboxStatus>) : null))
      .catch(() => null)
      .then(row => {
        if (row?.status === 'done') return setDelivery({ state: 'done', taskId: row.task_id });
        if (row?.status === 'dead_letter') {
          return setDelivery({ state: 'dead_letter', error: row.last_error || 'dead-lettered' });
        }
        if (Date.now() - startedAt >= POLL_LIMIT_MS) return setDelivery({ state: 'timeout' });
        pollRef.current = setTimeout(() => poll(outboxId, startedAt), POLL_MS);
      });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || !note.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch('/api/calls/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          note,
          client_uuid: clientUuid,
          call_id: callId || undefined,
          status,
          follow_up: followUp || undefined,
          caller: caller || undefined,
          contact_id: contact.trim() || null,
          property_id: property.trim() || null,
        }),
      });
      const body = (await r.json().catch(() => null)) as NoteOutcome | CallsErrorBody | null;
      if (!r.ok || !body || !('outbox_id' in body)) {
        setError((body as CallsErrorBody | null)?.error ?? `HTTP ${r.status}`);
        return;
      }
      setOutcome(body);
      if (pollRef.current) clearTimeout(pollRef.current);
      setDelivery({ state: 'polling' });
      poll(body.outbox_id, Date.now());
    } catch {
      setError('call service unreachable');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-2 border-t border-[#2F2F2F] pt-3"
      data-testid="call-note-form"
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-[#9B9B9B] space-y-1">
          <span>Contact id</span>
          <input name="contact_id" value={contact} onChange={e => setContact(e.target.value)} className={inputClass} />
        </label>
        <label className="text-xs text-[#9B9B9B] space-y-1">
          <span>Property id</span>
          <input name="property_id" value={property} onChange={e => setProperty(e.target.value)} className={inputClass} />
        </label>
      </div>
      <textarea
        name="note"
        required
        rows={3}
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="Call note / outcome"
        className={inputClass}
      />
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-[#9B9B9B] space-y-1">
          <span>Status</span>
          <select name="status" value={status} onChange={e => setStatus(e.target.value as NoteStatus)} className={inputClass}>
            {STATUSES.map(s => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[#9B9B9B] space-y-1">
          <span>Follow-up date</span>
          <input name="follow_up" type="date" value={followUp} onChange={e => setFollowUp(e.target.value)} className={inputClass} />
        </label>
      </div>
      {callId && <div className="text-xs font-mono text-[#6B6B6B]">call {callId}</div>}

      {error && <div className="text-xs text-[#FF4D4D]">{error}</div>}
      {outcome && (
        <div className="text-xs text-[#D4D4D4] space-y-1" data-testid="call-note-outcome" data-outbox-id={outcome.outbox_id}>
          <div>
            {outcome.enqueued ? 'Logged' : 'Duplicate submit, already logged'} (outbox {outcome.outbox_id}).
            {outcome.fallback_close && ` ${FALLBACK_TEXT[outcome.fallback_close]}`}
          </div>
          {delivery?.state === 'polling' && <div className="text-[#6B6B6B]">waiting for Investment Dominator…</div>}
          {delivery?.state === 'done' && (
            <div className="text-[#4DAB9A]" data-testid="call-note-task">
              ID task {delivery.taskId ?? '(id not reported)'}
            </div>
          )}
          {delivery?.state === 'dead_letter' && (
            <div className="text-[#FF4D4D]">
              Not delivered: {delivery.error}.{' '}
              <Link href="/calls/ops" className="underline">
                ops
              </Link>
            </div>
          )}
          {delivery?.state === 'timeout' && (
            <div className="text-[#D4A04D]">
              Still queued after a minute; check{' '}
              <Link href="/calls/ops" className="underline">
                ops
              </Link>
              .
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={submitting || !note.trim()}
          className="px-4 py-2 text-sm font-medium rounded bg-[#4DAB9A] text-[#191919] hover:bg-[#5BC0AE] transition-colors disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Save note'}
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded bg-[#2F2F2F] text-[#9B9B9B] hover:bg-[#373737] hover:text-white transition-colors"
          >
            Close
          </button>
        )}
      </div>
    </form>
  );
}
