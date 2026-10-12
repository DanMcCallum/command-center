'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import CallsPageHeader, { CallsLoadStatus } from '@/components/CallsPageHeader';
import { useCallsGet } from '@/lib/use-calls-get';
import type { AgentRow, AgentsResponse, AgentUpsertRequest, CallsErrorBody } from '@/lib/calls-types';

const inputClass =
  'block bg-[#191919] border border-[#2F2F2F] rounded px-3 py-1.5 text-sm outline-none transition-colors focus:border-[#4DAB9A]';
const linkClass = 'text-[#4DAB9A] hover:text-[#5BC0AE] transition-colors';

const EMPTY_FORM: Required<AgentUpsertRequest> = { dialpad_user_id: '', name: '', id_user_id: '', sms_number: '' };

/** POST one agent write; returns null on success, else the error line. */
async function postAgents(url: string, body: unknown): Promise<string | null> {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) return null;
    const data = (await r.json().catch(() => null)) as CallsErrorBody | null;
    return data?.error ?? `HTTP ${r.status}`;
  } catch {
    return 'call service unreachable';
  }
}

function AgentsTable({
  data,
  busy,
  onDelete,
}: {
  data: AgentsResponse;
  busy: boolean;
  onDelete: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);

  if (data.agents.length === 0)
    return (
      <div className="text-sm text-[#6B6B6B]" data-testid="calls-agents-empty">
        None configured. SMS and task assignment are skipped (visibly) until a row exists.
      </div>
    );

  return (
    <table className="w-full text-sm" data-testid="calls-agents">
      <thead>
        <tr className="text-left text-xs text-[#6B6B6B] border-b border-[#2F2F2F]">
          <th className="py-2 pr-3 font-medium">DialPad user</th>
          <th className="py-2 pr-3 font-medium">Name</th>
          <th className="py-2 pr-3 font-medium">ID user</th>
          <th className="py-2 pr-3 font-medium">SMS number</th>
          <th className="py-2 font-medium" />
        </tr>
      </thead>
      <tbody>
        {data.agents.map((a: AgentRow) => (
          <tr key={a.dialpad_user_id} className="border-b border-[#202020]" data-agent-id={a.dialpad_user_id}>
            <td className="py-2 pr-3 font-mono text-xs">
              {a.dialpad_user_id}
              {a.is_default && (
                <span className="ml-2 font-sans font-semibold text-[#D4A04D]" data-testid="calls-agent-default">
                  (default)
                </span>
              )}
            </td>
            <td className="py-2 pr-3">{a.name}</td>
            <td className="py-2 pr-3 text-[#9B9B9B]">{a.id_user_id}</td>
            <td className="py-2 pr-3 text-[#9B9B9B]">{a.sms_number}</td>
            <td className="py-2 whitespace-nowrap text-xs space-x-3">
              <Link
                href={`/calls/agents?edit=${encodeURIComponent(a.dialpad_user_id)}`}
                className={linkClass}
                data-testid="calls-agent-edit"
              >
                edit
              </Link>
              {confirming === a.dialpad_user_id ? (
                <span data-testid="calls-agent-confirm">
                  <span className="text-[#FF4D4D]">Delete {a.dialpad_user_id}?</span>{' '}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setConfirming(null);
                      onDelete(a.dialpad_user_id);
                    }}
                    className="text-[#FF4D4D] hover:text-white transition-colors disabled:opacity-50"
                    data-testid="calls-agent-confirm-yes"
                  >
                    yes, delete
                  </button>{' '}
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="text-[#9B9B9B] hover:text-white transition-colors"
                  >
                    cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(a.dialpad_user_id)}
                  className="text-[#9B9B9B] hover:text-[#FF4D4D] transition-colors"
                  data-testid="calls-agent-delete"
                >
                  delete
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DialpadUsers({ data }: { data: AgentsResponse }) {
  if (data.dialpad_error)
    return (
      <p className="text-xs text-[#FF4D4D]" data-testid="calls-dialpad-error">
        Couldn&apos;t list DialPad users: {data.dialpad_error}
      </p>
    );
  if (data.dialpad_users === null) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">DialPad users on this account (for the ids above)</h2>
      {data.dialpad_users.length === 0 ? (
        <div className="text-sm text-[#6B6B6B]">None returned.</div>
      ) : (
        <table className="w-full text-sm" data-testid="calls-dialpad-users">
          <thead>
            <tr className="text-left text-xs text-[#6B6B6B] border-b border-[#2F2F2F]">
              <th className="py-2 pr-3 font-medium">Id</th>
              <th className="py-2 pr-3 font-medium">Name</th>
              <th className="py-2 font-medium">Number</th>
            </tr>
          </thead>
          <tbody>
            {data.dialpad_users.map(u => (
              <tr key={String(u.id)} className="border-b border-[#202020]">
                <td className="py-2 pr-3 font-mono text-xs">{u.id}</td>
                <td className="py-2 pr-3">{u.name}</td>
                <td className="py-2 text-[#9B9B9B]">{u.number}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function AgentsView() {
  const router = useRouter();
  const edit = useSearchParams().get('edit')?.trim() ?? '';
  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallsGet<AgentsResponse>('/api/calls/agents', reloadKey);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const inFlightRef = useRef(false);

  const agents = load.state === 'ok' ? load.data.agents : null;
  const editing = edit && agents ? agents.find(a => a.dialpad_user_id === edit) ?? null : null;

  // Prefill from the row being edited (or just its id when there is no such
  // row yet), once the list is in; a cleared `?edit=` empties the form.
  useEffect(() => {
    if (!edit) return setForm(EMPTY_FORM);
    if (agents === null) return;
    const row = agents.find(a => a.dialpad_user_id === edit);
    setForm(
      row
        ? { dialpad_user_id: row.dialpad_user_id, name: row.name, id_user_id: row.id_user_id, sms_number: row.sms_number }
        : { ...EMPTY_FORM, dialpad_user_id: edit },
    );
    // Only on a new edit target or a fresh list.
  }, [edit, agents]);

  async function write(url: string, body: unknown, done: string) {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy(true);
    setMessage(null);
    const error = await postAgents(url, body);
    inFlightRef.current = false;
    setBusy(false);
    if (error) return setMessage({ ok: false, text: `Not saved: ${error}` });
    setMessage({ ok: true, text: done });
    setReloadKey(k => k + 1);
    if (edit) router.replace('/calls/agents');
    else setForm(EMPTY_FORM);
  }

  function save() {
    const body: AgentUpsertRequest = {
      dialpad_user_id: form.dialpad_user_id.trim(),
      name: form.name.trim(),
      id_user_id: form.id_user_id.trim(),
      sms_number: form.sms_number.trim(),
    };
    void write('/api/calls/agents', body, `Saved ${body.dialpad_user_id}.`);
  }

  const field = (key: keyof AgentUpsertRequest, label: string, width: string, required = false) => (
    <label className="block text-xs text-[#9B9B9B] space-y-1">
      <span>{label}</span>
      <input
        name={key}
        required={required}
        value={form[key]}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        className={`${inputClass} ${width}`}
      />
    </label>
  );

  return (
    <section className="space-y-6">
      <p className="text-sm text-[#9B9B9B]">
        Maps the DialPad user who answers or dials to the ID user tasks get assigned to (<code>t_assigned_to</code>)
        and the number attribution texts go to.
      </p>

      <CallsLoadStatus load={load} />
      {load.state === 'ok' && (
        <AgentsTable
          data={load.data}
          busy={busy}
          onDelete={id => void write('/api/calls/agents/delete', { dialpad_user_id: id }, `Deleted ${id}.`)}
        />
      )}

      {message && (
        <div
          className={`text-sm ${message.ok ? 'text-[#4DAB9A]' : 'text-[#FF4D4D]'}`}
          data-testid="calls-agents-message"
          data-ok={message.ok ? 'true' : 'false'}
        >
          {message.text}
        </div>
      )}

      <form
        className="space-y-3"
        data-testid="calls-agent-form"
        data-mode={editing ? 'edit' : 'add'}
        onSubmit={e => {
          e.preventDefault();
          save();
        }}
      >
        <h2 className="text-lg font-semibold">{editing ? `Edit mapping ${editing.dialpad_user_id}` : 'Add or update mapping'}</h2>
        <div className="flex flex-wrap gap-3 items-end">
          {field('dialpad_user_id', 'DialPad user id', 'w-40', true)}
          {field('name', 'Name', 'w-48')}
          {field('id_user_id', 'ID user id (t_assigned_to)', 'w-32')}
          {field('sms_number', 'SMS number', 'w-40')}
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 text-sm font-medium rounded bg-[#4DAB9A] text-[#191919] hover:bg-[#5BC0AE] transition-colors disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          {edit && (
            <Link href="/calls/agents" className="text-xs text-[#9B9B9B] hover:text-white transition-colors py-2">
              cancel edit
            </Link>
          )}
        </div>
        <p className="text-xs text-[#6B6B6B]" data-testid="calls-agents-default-help">
          Use <b>{load.state === 'ok' ? load.data.default_key : '*'}</b>{' '}
          as the DialPad user id for the shared default
          row: it answers for every unmapped agent (and for events with no target). The sender of attribution texts is
          the API key&apos;s own user.
        </p>
      </form>

      {load.state === 'ok' && <DialpadUsers data={load.data} />}
    </section>
  );
}

export default function CallsAgentsPage() {
  return (
    <div className="space-y-8">
      <CallsPageHeader title="Agent mapping" />
      <Suspense fallback={<div className="text-sm text-[#6B6B6B]">Loading…</div>}>
        <AgentsView />
      </Suspense>
    </div>
  );
}
