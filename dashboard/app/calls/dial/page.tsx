'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import CallsPageHeader from '@/components/CallsPageHeader';
import { useCallsGet } from '@/lib/use-calls-get';
import type { CallsErrorBody, DialOutcome, DialRequest, PropertyNickname } from '@/lib/calls-types';

const inputClass =
  'block bg-[#191919] border border-[#2F2F2F] rounded px-3 py-1.5 text-sm outline-none transition-colors focus:border-[#4DAB9A]';

/** The "mention the nickname" line for the property id in the form, if it is a whole number. */
function NicknamePrompt({ propertyId }: { propertyId: string }) {
  const id = /^\d+$/.test(propertyId) ? propertyId : null;
  const load = useCallsGet<PropertyNickname>(id ? `/api/calls/nicknames/property/${id}` : null);
  if (!id || load.state === 'idle' || load.state === 'loading') return null;
  if (load.state === 'ok')
    return (
      <p className="text-sm" data-testid="calls-dial-nickname">
        Mention during the call: <b>&ldquo;{load.data.nickname}&rdquo;</b>. It is the caller&apos;s handle for
        this property if they ring back from another number.
      </p>
    );
  if (load.status === 404)
    return (
      <p className="text-xs text-[#6B6B6B]" data-testid="calls-dial-no-nickname">
        No nickname on file for property {id} yet.
      </p>
    );
  return (
    <p className="text-xs text-[#FF4D4D]" data-testid="calls-list-error">
      {load.error}
    </p>
  );
}

function DialView() {
  const params = useSearchParams();
  const propertyParam = params.get('property_id')?.trim() ?? '';
  const phoneParam = params.get('phone')?.trim() ?? '';
  const [phone, setPhone] = useState(phoneParam);
  const [propertyId, setPropertyId] = useState(propertyParam);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<DialOutcome | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => setPhone(phoneParam), [phoneParam]);
  useEffect(() => setPropertyId(propertyParam), [propertyParam]);

  async function submit() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setSubmitting(true);
    setError(null);
    setDone(null);
    const body: DialRequest = { phone: phone.trim(), property_id: propertyId.trim() };
    try {
      const r = await fetch('/api/calls/dial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await r.json().catch(() => null)) as DialOutcome | CallsErrorBody | null;
      if (r.ok && data && 'intent_id' in data) setDone(data);
      else setError(`Not recorded: ${(data as CallsErrorBody | null)?.error ?? `HTTP ${r.status}`}`);
    } catch {
      setError('Not recorded: call service unreachable');
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <section className="space-y-6">
      <NicknamePrompt propertyId={propertyId.trim()} />

      <form
        className="space-y-3 max-w-md"
        onSubmit={e => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="block text-xs text-[#9B9B9B] space-y-1">
          <span>Number to dial</span>
          <input
            name="phone"
            required
            value={phone}
            onChange={e => setPhone(e.target.value)}
            className={`${inputClass} w-full`}
          />
        </label>
        <label className="block text-xs text-[#9B9B9B] space-y-1">
          <span>Property id</span>
          <input
            name="property_id"
            required
            inputMode="numeric"
            value={propertyId}
            onChange={e => setPropertyId(e.target.value)}
            className={`${inputClass} w-32`}
          />
        </label>
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 text-sm font-medium rounded bg-[#4DAB9A] text-[#191919] hover:bg-[#5BC0AE] transition-colors disabled:opacity-50"
        >
          {submitting ? 'Recording…' : 'Record intent'}
        </button>
      </form>

      {error && (
        <div className="text-sm text-[#FF4D4D]" data-testid="calls-dial-error">
          {error}
        </div>
      )}

      {done && (
        <div className="text-sm space-y-2" data-testid="calls-dial-done" data-intent-id={done.intent_id}>
          <p>
            Intent recorded. Now dial <b>{done.phone}</b> in DialPad. The next connected call to that number within{' '}
            {done.window_minutes} minutes gets attributed to property{' '}
            <Link
              href={`/calls/record/property/${done.property_id}`}
              className="text-[#4DAB9A] hover:text-[#5BC0AE] transition-colors"
            >
              {done.property_id}
            </Link>
            .
          </p>
          {done.nickname && (
            <p data-testid="calls-dial-done-nickname">
              Say the nickname during the call: <b>&ldquo;{done.nickname}&rdquo;</b>
            </p>
          )}
        </div>
      )}

      <p className="text-xs text-[#6B6B6B]">
        Recording the intent BEFORE dialing is what attributes the call. Then place the call in DialPad as usual.
      </p>
    </section>
  );
}

export default function CallsDialPage() {
  return (
    <div className="space-y-8">
      <CallsPageHeader title="Outbound dial" />
      <Suspense fallback={<div className="text-sm text-[#6B6B6B]">Loading…</div>}>
        <DialView />
      </Suspense>
    </div>
  );
}
