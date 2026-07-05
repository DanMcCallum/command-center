'use client';

import { useEffect, useState } from 'react';
import { SUPPORTED_INTERVALS, type CronConfig } from '@/lib/types';
import { formatRelative } from '@/lib/utils';

const INTERVAL_OPTIONS = SUPPORTED_INTERVALS;

interface WorkerStatus extends CronConfig {
  crontabInstalled: boolean;
}

export default function CronConfigPanel() {
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [interval, setIntervalMin] = useState<number>(10);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const res = await fetch('/api/worker-status', { cache: 'no-store' });
    const data = (await res.json()) as WorkerStatus;
    setStatus(data);
    setEnabled(data.enabled);
    setIntervalMin(data.intervalMinutes);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/cron-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, intervalMinutes: interval }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setMessage('Saved.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!status) {
    return (
      <div className="text-sm text-[#6B6B6B]">Loading worker status…</div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-[#202020] border border-[#373737] rounded-lg p-5 space-y-4">
        <div>
          <h2 className="text-base font-semibold">Worker schedule</h2>
          <p className="text-xs text-[#6B6B6B] mt-1">
            Cron triggers the worker on this interval. Disable to stop running tasks.
          </p>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm">Enabled</div>
            <div className="text-xs text-[#6B6B6B]">
              {status.crontabInstalled
                ? 'Crontab entry installed.'
                : 'Crontab entry not installed.'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setEnabled(v => !v)}
            aria-pressed={enabled}
            className={
              'w-10 h-6 rounded-full transition-colors relative ' +
              (enabled ? 'bg-[#4DAB9A]' : 'bg-[#373737]')
            }
          >
            <span
              className={
                'block w-4 h-4 rounded-full bg-white absolute top-1 transition-all ' +
                (enabled ? 'left-5' : 'left-1')
              }
            />
          </button>
        </div>

        <div>
          <div className="text-xs font-medium text-[#9B9B9B] mb-1">Interval</div>
          <select
            value={interval}
            onChange={e => setIntervalMin(Number(e.target.value))}
            className="w-full bg-[#2F2F2F] text-white border border-[#373737] rounded px-3 py-2 text-sm outline-none transition-colors focus:border-[#4DAB9A] appearance-none pr-8"
          >
            {INTERVAL_OPTIONS.map(min => (
              <option key={min} value={min}>
                Every {min < 60 ? `${min} min` : `${min / 60} hr`}
              </option>
            ))}
          </select>
        </div>

        {error && <div className="text-xs text-[#FF4D4D]">{error}</div>}
        {message && <div className="text-xs text-[#4DAB9A]">{message}</div>}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium rounded bg-[#4DAB9A] text-[#191919] hover:bg-[#5BC0AE] transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="bg-[#202020] border border-[#373737] rounded-lg p-5 space-y-2">
        <h2 className="text-base font-semibold">Status</h2>
        <Row label="Last run" value={formatRelative(status.lastRun)} />
        <Row
          label="Last task"
          value={
            status.lastTaskId ? (
              <span className="font-mono text-xs">{status.lastTaskId}</span>
            ) : (
              '—'
            )
          }
        />
        <Row
          label="Crontab"
          value={status.crontabInstalled ? 'installed' : 'not installed'}
        />
      </div>
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-[#9B9B9B]">{label}</span>
      <span className="text-white">{value}</span>
    </div>
  );
}
