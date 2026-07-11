'use client';

import { useEffect, useState } from 'react';

interface PostingAuthStatus {
  platform: string;
  displayName: string;
  hasSession: boolean;
  savedAt: string | null;
}

type CaptureMode = 'live-view' | 'cli';

type Capture =
  | { phase: 'idle' }
  | { phase: 'connecting'; platform: string }
  | { phase: 'active'; platform: string; sessionId: string; liveViewUrl: string }
  | { phase: 'error'; platform: string; message: string };

const POLL_INTERVAL_MS = 3_000;
const LOGIN_TIMEOUT_MINUTES = 5;
const LOGIN_TIMEOUT_MS = LOGIN_TIMEOUT_MINUTES * 60_000;

const CHIP_CLASS =
  'inline-flex items-center px-2 py-0.5 text-xs rounded-full whitespace-nowrap';

export default function PostingAuthPanel() {
  const [statuses, setStatuses] = useState<PostingAuthStatus[] | null>(null);
  const [modes, setModes] = useState<Record<string, CaptureMode>>({});
  const [error, setError] = useState<string | null>(null);
  const [capture, setCapture] = useState<Capture>({ phase: 'idle' });

  async function load() {
    try {
      const [authRes, platRes] = await Promise.all([
        fetch('/api/posting-auth', { cache: 'no-store' }),
        fetch('/api/posting-platforms', { cache: 'no-store' }),
      ]);
      const authData = await authRes.json();
      if (!authRes.ok) throw new Error(authData.error ?? `HTTP ${authRes.status}`);
      const platData = await platRes.json();
      if (!platRes.ok) throw new Error(platData.error ?? `HTTP ${platRes.status}`);
      const nextModes: Record<string, CaptureMode> = {};
      for (const [key, cfg] of Object.entries(
        platData.platforms as Record<string, { capture?: string }>,
      )) {
        nextModes[key] = cfg.capture === 'live-view' ? 'live-view' : 'cli';
      }
      setStatuses(authData.platforms as PostingAuthStatus[]);
      setModes(nextModes);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  // While a capture is active, poll login status until success, error, or timeout.
  useEffect(() => {
    if (capture.phase !== 'active') return;
    const { sessionId, platform } = capture;
    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    let stopped = false;
    const t = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/posting-auth/status?sessionId=${encodeURIComponent(sessionId)}&platform=${encodeURIComponent(platform)}`,
          { cache: 'no-store' },
        );
        const data = await res.json().catch(() => null);
        if (stopped) return;
        if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
        if (data?.loggedIn === true) {
          setCapture({ phase: 'idle' });
          load();
        } else if (Date.now() > deadline) {
          setCapture({
            phase: 'error',
            platform,
            message: `Login not detected within ${LOGIN_TIMEOUT_MINUTES} minutes`,
          });
        }
      } catch (err) {
        if (!stopped) {
          setCapture({ phase: 'error', platform, message: (err as Error).message });
        }
      }
    }, POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [capture]);

  async function connect(platform: string) {
    setCapture({ phase: 'connecting', platform });
    try {
      const res = await fetch('/api/posting-auth/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.liveViewUrl || !data?.sessionId) {
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      setCapture({
        phase: 'active',
        platform,
        sessionId: data.sessionId,
        liveViewUrl: data.liveViewUrl,
      });
    } catch (err) {
      setCapture({ phase: 'error', platform, message: (err as Error).message });
    }
  }

  const busy = capture.phase === 'connecting' || capture.phase === 'active';
  const activeName =
    capture.phase === 'active'
      ? (statuses?.find(s => s.platform === capture.platform)?.displayName ??
        capture.platform)
      : null;

  return (
    <div className="bg-[#202020] border border-[#373737] rounded-lg p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold">Marketplace logins</h2>
        <p className="text-xs text-[#6B6B6B] mt-1">
          Saved browser sessions used by the ad poster. Connect opens the
          marketplace login here in the dashboard; when a session expires,
          re-connect (or re-run capture-login for CLI platforms).
        </p>
      </div>

      {error && <div className="text-xs text-[#FF4D4D]">{error}</div>}

      {!statuses && !error && (
        <div className="text-sm text-[#6B6B6B]">Loading auth status…</div>
      )}

      {statuses?.map(s => {
        const liveView = modes[s.platform] === 'live-view';
        return (
          <div
            key={s.platform}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span className="text-white">{s.displayName}</span>
            <span className="flex items-center gap-2 min-w-0">
              {s.hasSession ? (
                <span className="text-[#4DAB9A] whitespace-nowrap">
                  Session saved ({new Date(s.savedAt!).toLocaleDateString()})
                </span>
              ) : liveView ? (
                <span className="text-[#E5A54B] whitespace-nowrap">No session</span>
              ) : (
                <span className="text-[#E5A54B]">
                  No session — run{' '}
                  <code className="font-mono text-xs bg-[#2F2F2F] px-1 py-0.5 rounded">
                    npm run capture-login -- {s.platform}
                  </code>
                </span>
              )}
              {capture.phase === 'error' && capture.platform === s.platform && (
                <span
                  className={`${CHIP_CLASS} max-w-72 truncate`}
                  style={{ backgroundColor: '#FF4D4D20', color: '#FF4D4D' }}
                  title={capture.message}
                >
                  {capture.message}
                </span>
              )}
              {capture.phase === 'connecting' &&
                capture.platform === s.platform && (
                  <span
                    className={CHIP_CLASS}
                    style={{ backgroundColor: '#4DA3D420', color: '#4DA3D4' }}
                  >
                    Connecting…
                  </span>
                )}
              {liveView && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => connect(s.platform)}
                  className="px-2 py-0.5 text-xs font-medium rounded bg-[#2F2F2F] text-[#9B9B9B] hover:bg-[#373737] hover:text-white transition-colors disabled:opacity-50"
                >
                  {s.hasSession ? 'Re-connect' : 'Connect'}
                </button>
              )}
            </span>
          </div>
        );
      })}

      {capture.phase === 'active' && (
        <div className="space-y-2 pt-1">
          <span
            className={CHIP_CLASS}
            style={{ backgroundColor: '#4DA3D420', color: '#4DA3D4' }}
          >
            Log in to {activeName} below — waiting for login…
          </span>
          <iframe
            src={capture.liveViewUrl}
            sandbox="allow-same-origin allow-scripts"
            title={`Live login for ${capture.platform}`}
            className="w-full h-[600px] rounded border border-[#2F2F2F] bg-black"
          />
        </div>
      )}
    </div>
  );
}
