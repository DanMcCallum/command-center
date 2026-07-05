'use client';

import { useEffect, useState } from 'react';

interface PostingAuthStatus {
  platform: string;
  displayName: string;
  hasSession: boolean;
  savedAt: string | null;
}

export default function PostingAuthPanel() {
  const [statuses, setStatuses] = useState<PostingAuthStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch('/api/posting-auth', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setStatuses(data.platforms as PostingAuthStatus[]);
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

  return (
    <div className="bg-[#202020] border border-[#373737] rounded-lg p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold">Marketplace logins</h2>
        <p className="text-xs text-[#6B6B6B] mt-1">
          Saved browser sessions used by the ad poster. Re-run capture-login
          when a session expires.
        </p>
      </div>

      {error && <div className="text-xs text-[#FF4D4D]">{error}</div>}

      {!statuses && !error && (
        <div className="text-sm text-[#6B6B6B]">Loading auth status…</div>
      )}

      {statuses?.map(s => (
        <div
          key={s.platform}
          className="flex items-center justify-between text-sm"
        >
          <span className="text-white">{s.displayName}</span>
          {s.hasSession ? (
            <span className="text-[#4DAB9A]">
              Session saved ({new Date(s.savedAt!).toLocaleDateString()})
            </span>
          ) : (
            <span className="text-[#E5A54B]">
              No session — run{' '}
              <code className="font-mono text-xs bg-[#2F2F2F] px-1 py-0.5 rounded">
                npm run capture-login -- {s.platform}
              </code>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
