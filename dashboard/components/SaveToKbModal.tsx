'use client';

import { useEffect, useState } from 'react';
import type { Task } from '@/lib/types';

interface Props {
  task: Task;
  onClose: () => void;
  onSaved: () => void;
}

const inputClass =
  'w-full bg-[#2F2F2F] text-white border border-[#373737] rounded px-3 py-2 text-sm outline-none transition-colors focus:border-[#4DAB9A]';
const selectClass = inputClass + ' appearance-none pr-8';

const PLATFORMS = [
  'Facebook Marketplace',
  'Craigslist',
  'LandWatch',
  'Lands of America',
  'LandSearch',
  'Landmodo',
  'Land.com',
  'Zillow',
  'Realtor.com',
  'Redfin',
  'Other',
];

function pickFromMetadata<T = string>(
  metadata: Record<string, unknown> | null,
  key: string,
): T | null {
  if (!metadata) return null;
  const v = metadata[key];
  return (v === null || v === undefined ? null : v) as T | null;
}

export default function SaveToKbModal({ task, onClose, onSaved }: Props) {
  const meta = task.metadata ?? null;

  const [location, setLocation] = useState(pickFromMetadata<string>(meta, 'location') ?? '');
  const [acreage, setAcreage] = useState(
    String(pickFromMetadata<number>(meta, 'acreage') ?? ''),
  );
  const [priceUsd, setPriceUsd] = useState(
    String(pickFromMetadata<number>(meta, 'price_usd') ?? ''),
  );
  const [soldOn, setSoldOn] = useState(new Date().toISOString().slice(0, 10));
  const [daysToSale, setDaysToSale] = useState('');
  const [platformSold, setPlatformSold] = useState(PLATFORMS[0]);
  const [buyerType, setBuyerType] = useState(
    pickFromMetadata<string>(meta, 'buyer_hint') ?? '',
  );
  const [features, setFeatures] = useState('');
  const [zoning, setZoning] = useState(pickFromMetadata<string>(meta, 'zoning') ?? '');
  const [access, setAccess] = useState(pickFromMetadata<string>(meta, 'access') ?? '');
  const [notes, setNotes] = useState('');
  const [headline, setHeadline] = useState('');
  const [description, setDescription] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ slug: string; path: string } | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!location.trim()) return setError('Location is required.');
    if (!acreage.trim() || isNaN(Number(acreage))) return setError('Acreage must be a number.');
    if (!priceUsd.trim() || isNaN(Number(priceUsd))) return setError('Price must be a number.');
    if (!soldOn) return setError('Sold-on date is required.');
    if (!headline.trim()) return setError('Headline is required.');
    if (!description.trim()) return setError('Description is required.');

    const utilities = (pickFromMetadata<string[]>(meta, 'utilities') ?? []) as string[];

    const payload = {
      location: location.trim(),
      acreage: Number(acreage),
      price_usd: Number(priceUsd),
      sold_on: soldOn,
      days_to_sale: daysToSale ? Number(daysToSale) : null,
      platform_sold_on: platformSold,
      features: features
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
      buyer_type: buyerType || null,
      access: access || null,
      utilities,
      zoning: zoning || null,
      notes: notes.trim() || null,
      headline: headline.trim(),
      description: description.trim(),
    };

    setSubmitting(true);
    try {
      const res = await fetch('/api/kb/ads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSaved({ slug: data.slug, path: data.path });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#191919] border border-[#2F2F2F] rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#2F2F2F]">
          <div>
            <h2 className="text-base font-semibold">Save sold ad to knowledge base</h2>
            <p className="text-xs text-[#6B6B6B] mt-0.5">
              Future generations will learn from this ad's facts, voice, and angle.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-[#6B6B6B] hover:text-white"
          >
            Close
          </button>
        </div>

        <form onSubmit={submit} className="overflow-y-auto p-5 space-y-3">
          {saved ? (
            <div className="text-sm text-[#4DAB9A] space-y-2">
              <div>Saved to <code className="font-mono">{saved.path}</code>.</div>
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-xs font-medium rounded bg-[#2F2F2F] text-white hover:bg-[#373737]"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              <Field label="Location" required>
                <input
                  type="text"
                  value={location}
                  onChange={e => setLocation(e.target.value)}
                  className={inputClass}
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Acreage" required>
                  <input
                    type="number"
                    step="0.01"
                    value={acreage}
                    onChange={e => setAcreage(e.target.value)}
                    className={inputClass}
                  />
                </Field>
                <Field label="Final sale price (USD)" required>
                  <input
                    type="number"
                    step="1"
                    value={priceUsd}
                    onChange={e => setPriceUsd(e.target.value)}
                    className={inputClass}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <Field label="Sold on" required>
                  <input
                    type="date"
                    value={soldOn}
                    onChange={e => setSoldOn(e.target.value)}
                    className={inputClass}
                  />
                </Field>
                <Field label="Days to sale">
                  <input
                    type="number"
                    value={daysToSale}
                    onChange={e => setDaysToSale(e.target.value)}
                    className={inputClass}
                  />
                </Field>
                <Field label="Sold on platform">
                  <select
                    value={platformSold}
                    onChange={e => setPlatformSold(e.target.value)}
                    className={selectClass}
                  >
                    {PLATFORMS.map(p => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field label="Features (comma-separated tags)">
                <input
                  type="text"
                  value={features}
                  onChange={e => setFeatures(e.target.value)}
                  placeholder="off-grid, borders-blm, year-round-access"
                  className={inputClass}
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Buyer type">
                  <input
                    type="text"
                    value={buyerType}
                    onChange={e => setBuyerType(e.target.value)}
                    placeholder="out-of-state-retiree"
                    className={inputClass}
                  />
                </Field>
                <Field label="Zoning">
                  <input
                    type="text"
                    value={zoning}
                    onChange={e => setZoning(e.target.value)}
                    className={inputClass}
                  />
                </Field>
              </div>

              <Field label="Notes (optional)">
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Why this one closed — referral, owner financing, urgency, etc."
                  className={inputClass}
                />
              </Field>

              <div className="border-t border-[#2F2F2F] pt-3 mt-3 space-y-3">
                <p className="text-xs text-[#9B9B9B]">
                  Paste the AS-POSTED headline and description (after any human edits to the generated draft). These are the gold-standard examples future ads learn from.
                </p>
                <Field label="Headline (as posted)" required>
                  <input
                    type="text"
                    value={headline}
                    onChange={e => setHeadline(e.target.value)}
                    className={inputClass}
                  />
                </Field>
                <Field label="Description (as posted)" required>
                  <textarea
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    rows={10}
                    className={inputClass}
                  />
                </Field>
              </div>

              {error && <div className="text-xs text-[#FF4D4D]">{error}</div>}

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-sm font-medium rounded bg-[#4DAB9A] text-[#191919] hover:bg-[#5BC0AE] transition-colors disabled:opacity-50"
                >
                  {submitting ? 'Saving…' : 'Save to knowledge base'}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 text-xs font-medium rounded text-[#9B9B9B] hover:bg-[#2F2F2F] hover:text-white transition-colors"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-[#9B9B9B] mb-1">
        {label}
        {required && <span className="text-[#FF4D4D] ml-1">*</span>}
      </div>
      {children}
    </label>
  );
}
