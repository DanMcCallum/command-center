'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import CallsPageHeader, { CallsLoadStatus } from '@/components/CallsPageHeader';
import CallNoteForm from '@/components/CallNoteForm';
import { useCallsGet } from '@/lib/use-calls-get';
import type { AttributeOutcome, AttributeRequest, CallsErrorBody, NicknameSearchResponse } from '@/lib/calls-types';

const inputClass =
  'bg-[#191919] border border-[#2F2F2F] rounded px-3 py-1.5 text-sm outline-none transition-colors focus:border-[#4DAB9A]';
const linkClass = 'text-[#4DAB9A] hover:text-[#5BC0AE] transition-colors';

interface AttributeError {
  status: number;
  error: string;
  hint?: string;
}

interface FormProps {
  slug: string;
  label: string;
  callId: string;
  number: string;
  onDone: (outcome: AttributeOutcome, number: string) => void;
}

/**
 * One attribute form (caller first and last name). The write creates a
 * contact in ID with no idempotency key, so a double click must send one POST.
 */
function AttributeForm({ slug, label, callId, number, onDone }: FormProps) {
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<AttributeError | null>(null);
  const inFlightRef = useRef(false);

  async function submit() {
    if (inFlightRef.current) return;
    if (!number.trim()) return setError({ status: 400, error: 'Enter the caller number above first.' });
    if (!first.trim()) return setError({ status: 400, error: 'First name is required.' });
    inFlightRef.current = true;
    setSubmitting(true);
    setError(null);
    const body: AttributeRequest = {
      number: number.trim(),
      caller_fname: first.trim(),
      caller_lname: last.trim(),
      slug,
      call_id: callId,
    };
    try {
      const r = await fetch('/api/calls/attribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await r.json().catch(() => null)) as AttributeOutcome | CallsErrorBody | null;
      if (r.ok && data && 'contact_id' in data) return onDone(data, body.number);
      const err = data as CallsErrorBody | null;
      setError({ status: r.status, error: err?.error ?? `HTTP ${r.status}`, hint: err?.hint });
    } catch {
      setError({ status: 502, error: 'call service unreachable' });
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form
      className="space-y-2"
      data-testid="calls-attribute-form"
      data-slug={slug}
      onSubmit={e => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-wrap gap-2 items-center">
        <input
          name="caller_fname"
          required
          value={first}
          onChange={e => setFirst(e.target.value)}
          placeholder="First name (required)"
          className={inputClass}
        />
        <input
          name="caller_lname"
          value={last}
          onChange={e => setLast(e.target.value)}
          placeholder="Last name"
          className={inputClass}
        />
        <button
          type="submit"
          disabled={submitting}
          className="px-3 py-1.5 rounded bg-[#2F2F2F] hover:bg-[#3F3F3F] text-sm transition-colors disabled:opacity-50"
        >
          {submitting ? 'Creating…' : label}
        </button>
      </div>
      {error && (
        <div className="text-sm text-[#FF4D4D]" data-testid="calls-attribute-error" data-status={error.status}>
          {error.status === 404 && slug ? `Unknown nickname slug ${slug}.` : error.error}
          {error.status === 409 && (
            <>
              {' '}
              ({error.hint ?? 'the contact may exist in ID without being indexed'}). Look in{' '}
              <Link href="/calls/contacts" className="underline">
                Contacts
              </Link>{' '}
              before retrying: a retry would create a duplicate contact.
            </>
          )}
          {error.status === 502 && error.error !== 'call service unreachable' && '. Retry when ready.'}
        </div>
      )}
    </form>
  );
}

function Confirmation({
  outcome,
  number,
  callId,
}: {
  outcome: AttributeOutcome;
  number: string;
  callId: string;
}) {
  return (
    <section className="space-y-4" data-testid="calls-attribute-done">
      <p className="text-sm">
        Buyer contact{' '}
        <Link
          href={`/calls/record/contact/${outcome.contact_id}`}
          className={linkClass}
          data-testid="calls-attribute-contact"
        >
          {outcome.contact_id}
        </Link>{' '}
        created and <b>{outcome.indexed_number}</b> indexed to it; the next call from this number resolves
        automatically.
        {outcome.property_id != null && (
          <>
            {' '}
            Property:{' '}
            <Link
              href={`/calls/record/property/${outcome.property_id}`}
              className={linkClass}
              data-testid="calls-attribute-property"
            >
              {outcome.property_id}
            </Link>
            .
          </>
        )}
      </p>
      {outcome.unresolved_slug && (
        <p className="text-sm text-[#D4A04D]" data-testid="calls-attribute-unresolved">
          The nickname {outcome.slug} is not resolved to an ID property yet, so the note will link the contact
          only. Resolve the slug through the sync job, or enter the property id in the note form below.
        </p>
      )}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#9B9B9B]">Log the call note</h2>
        <div className="max-w-xl">
          <CallNoteForm
            callId={callId || undefined}
            contactId={outcome.contact_id}
            propertyId={outcome.property_id}
            caller={number}
          />
        </div>
      </div>
    </section>
  );
}

function AttributeView() {
  const router = useRouter();
  const params = useSearchParams();
  const callId = params.get('call_id')?.trim() ?? '';
  const numberParam = params.get('number')?.trim() ?? '';
  const q = params.get('q')?.trim() ?? '';
  const [number, setNumber] = useState(numberParam);
  const [input, setInput] = useState(q);
  const [done, setDone] = useState<{ outcome: AttributeOutcome; number: string } | null>(null);
  const load = useCallsGet<NicknameSearchResponse>(
    q ? `/api/calls/nicknames/search?${new URLSearchParams({ q })}` : null,
  );

  useEffect(() => setInput(q), [q]);
  useEffect(() => setNumber(numberParam), [numberParam]);

  if (done) return <Confirmation outcome={done.outcome} number={done.number} callId={callId} />;

  const onDone = (outcome: AttributeOutcome, n: string) => setDone({ outcome, number: n });

  return (
    <section className="space-y-6">
      <p className="text-sm" data-testid="calls-attribute-prompt">
        Call <code className="font-mono text-xs">{callId || 'none'}</code> from{' '}
        <b>{numberParam || 'unknown number'}</b>. Ask: <i>&ldquo;What&apos;s the property name from the ad?&rdquo;</i>
      </p>

      {!numberParam && (
        <label className="block text-xs text-[#9B9B9B] space-y-1">
          <span>Caller number</span>
          <input
            name="number"
            value={number}
            onChange={e => setNumber(e.target.value)}
            placeholder="+15305550000"
            className={`${inputClass} block`}
          />
        </label>
      )}

      <form
        className="flex gap-3"
        onSubmit={e => {
          e.preventDefault();
          const next = new URLSearchParams();
          if (callId) next.set('call_id', callId);
          if (number.trim()) next.set('number', number.trim());
          if (input.trim()) next.set('q', input.trim());
          router.push(`/calls/attribute?${next}`);
        }}
      >
        <input
          name="q"
          autoFocus
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Spoken nickname"
          className={`${inputClass} flex-1 max-w-md`}
        />
        <button
          type="submit"
          className="px-3 py-1.5 rounded bg-[#2F2F2F] hover:bg-[#3F3F3F] text-sm transition-colors"
        >
          Search nicknames
        </button>
      </form>

      <CallsLoadStatus load={load} />

      {load.state === 'ok' && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[#9B9B9B]">Nickname matches</h2>
          {load.data.matches.length === 0 ? (
            <div className="text-sm text-[#6B6B6B]" data-testid="calls-attribute-no-matches">
              No nickname matches. Try fewer or other words, or create the contact below.
            </div>
          ) : (
            <ul className="space-y-4" data-testid="calls-attribute-matches">
              {load.data.matches.map(m => (
                <li key={m.slug} className="space-y-2">
                  <div className="text-sm">
                    <span className="font-semibold">{m.nickname}</span>{' '}
                    <span className="text-xs text-[#6B6B6B]">score {m.score.toFixed(2)}</span>{' '}
                    {m.property_id != null ? (
                      <Link href={`/calls/record/property/${m.property_id}`} className={linkClass}>
                        property {m.property_id}
                      </Link>
                    ) : (
                      <span className="text-[#D4A04D]">unresolved slug {m.slug}</span>
                    )}
                  </div>
                  <AttributeForm
                    slug={m.slug}
                    label="Attribute caller to this property"
                    callId={callId}
                    number={number}
                    onDone={onDone}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#9B9B9B]">
          No property named, or not an ad response?
        </h2>
        <p className="text-xs text-[#6B6B6B]">
          Create the buyer contact anyway. Their number gets indexed, so the next call from it resolves
          automatically.
        </p>
        <AttributeForm slug="" label="Create contact (no property)" callId={callId} number={number} onDone={onDone} />
      </div>
    </section>
  );
}

export default function CallsAttributePage() {
  return (
    <div className="space-y-8">
      <CallsPageHeader title="Attribute caller" />
      <Suspense fallback={<div className="text-sm text-[#6B6B6B]">Loading…</div>}>
        <AttributeView />
      </Suspense>
    </div>
  );
}
