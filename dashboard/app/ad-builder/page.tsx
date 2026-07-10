'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import PhotoPicker, { type PickedPhoto } from '@/components/PhotoPicker';
import type { Task } from '@/lib/types';

const PLATFORMS = [
  { key: 'landmodo', label: 'Landmodo' },
  { key: 'land_century', label: 'Land Century' },
  { key: 'landflip', label: 'Landflip.com' },
  { key: 'land_com', label: 'Land.com' },
  { key: 'land_listings', label: 'Land-listings.com' },
  { key: 'landhub', label: 'Landhub.com' },
];

const ACCESS_OPTIONS = [
  { value: '', label: '—' },
  { value: 'paved', label: 'Paved road' },
  { value: 'dirt-year-round', label: 'Dirt road, year-round' },
  { value: 'dirt-seasonal', label: 'Dirt road, seasonal' },
  { value: 'none', label: 'No legal access' },
];

const UTILITIES = [
  { key: 'power', label: 'Power' },
  { key: 'water', label: 'Water (well or city)' },
  { key: 'septic', label: 'Septic' },
  { key: 'internet', label: 'Internet' },
];

type UtilityStatus = 'yes' | 'no' | 'unknown';

const UTILITY_STATUSES: { value: UtilityStatus; label: string }[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'unknown', label: 'Unknown' },
];

const BUYER_HINTS = [
  { value: '', label: '— no hint —' },
  { value: 'out-of-state-retiree', label: 'Out-of-state retiree' },
  { value: 'off-gridder', label: 'Off-gridder / homesteader' },
  { value: 'investor', label: 'Investor / flipper' },
  { value: 'builder', label: 'Builder / spec home' },
  { value: 'hunter', label: 'Hunter / recreational' },
  { value: 'remote-worker', label: 'Remote worker / lifestyle' },
];

const inputClass =
  'w-full bg-[#2F2F2F] text-white border border-[#373737] rounded px-3 py-2 text-sm outline-none transition-colors focus:border-[#4DAB9A]';
const selectClass = inputClass + ' appearance-none pr-8';

export default function AdBuilderPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [location, setLocation] = useState('');
  const [acreage, setAcreage] = useState('');
  const [priceUsd, setPriceUsd] = useState('');
  const [access, setAccess] = useState('');
  const [utilities, setUtilities] = useState<Record<string, UtilityStatus>>(
    Object.fromEntries(UTILITIES.map(u => [u.key, 'unknown'])),
  );
  const [utilitiesNotes, setUtilitiesNotes] = useState('');
  const [terrain, setTerrain] = useState('');
  const [zoning, setZoning] = useState('');
  const [comps, setComps] = useState('');
  const [mustInclude, setMustInclude] = useState('');
  const [buyerHint, setBuyerHint] = useState('');
  const [platforms, setPlatforms] = useState<Record<string, boolean>>(
    Object.fromEntries(PLATFORMS.map(p => [p.key, true])),
  );
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  // Index into `photos` of the starred (cover) image; consumed by the upload
  // flow (US-004), which gives it the 00_ filename prefix.
  const [primaryIndex, setPrimaryIndex] = useState(-1);

  function togglePlatform(key: string) {
    setPlatforms(prev => ({ ...prev, [key]: !prev[key] }));
  }
  function setUtility(key: string, value: UtilityStatus) {
    setUtilities(prev => ({ ...prev, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!location.trim()) return setError('Location is required.');
    if (!acreage.trim() || isNaN(Number(acreage))) return setError('Acreage must be a number.');
    if (!priceUsd.trim() || isNaN(Number(priceUsd))) return setError('Price must be a number.');
    const selectedPlatforms = PLATFORMS.filter(p => platforms[p.key]).map(p => p.key);
    if (selectedPlatforms.length === 0) return setError('Pick at least one platform.');
    if (photos.length === 0) return setError('At least 1 photo is required.');

    const metadata = {
      kind: 'ad-builder',
      location: location.trim(),
      acreage: Number(acreage),
      price_usd: Number(priceUsd),
      access: access || null,
      utilities: Object.entries(utilities).filter(([, v]) => v === 'yes').map(([k]) => k),
      utilities_absent: Object.entries(utilities).filter(([, v]) => v === 'no').map(([k]) => k),
      utilities_notes: utilitiesNotes.trim() || null,
      terrain: terrain.trim() || null,
      zoning: zoning.trim() || null,
      comparable_sales: comps.trim() || null,
      must_include: mustInclude.trim() || null,
      buyer_hint: buyerHint || null,
      platforms: selectedPlatforms,
    };

    const description = renderDescription(metadata);
    const title = `Generate ad: ${metadata.acreage} ac · ${metadata.location} · $${metadata.price_usd.toLocaleString()}`;

    setSubmitting(true);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          type: 'Content',
          priority: 1,
          model: 'opus',
          slashCommand: 'generate-ad',
          tags: ['ad-builder'],
          metadata,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const task = (await res.json()) as Task;

      // Fire the worker now. Don't await — worker runs detached.
      fetch('/api/run-worker', { method: 'POST' }).catch(() => {});

      router.push(`/tasks?focus=${task.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Ad Builder</h1>
        <p className="text-sm text-[#6B6B6B] mt-1">
          Fill in the property facts. Submit to generate per-platform headline + description variants using your knowledge base, voice samples, and anti-slop rules.
        </p>
      </header>

      <form
        onSubmit={submit}
        className="bg-[#202020] border border-[#373737] rounded-lg p-5 space-y-4"
      >
        <Field label="Location (county, state)" required>
          <input
            type="text"
            value={location}
            onChange={e => setLocation(e.target.value)}
            placeholder="Apache County, AZ"
            className={inputClass}
            autoFocus
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Acreage" required>
            <input
              type="number"
              step="0.01"
              value={acreage}
              onChange={e => setAcreage(e.target.value)}
              placeholder="40"
              className={inputClass}
            />
          </Field>
          <Field label="Asking price (USD)" required>
            <input
              type="number"
              step="1"
              value={priceUsd}
              onChange={e => setPriceUsd(e.target.value)}
              placeholder="18500"
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Access">
          <select
            value={access}
            onChange={e => setAccess(e.target.value)}
            className={selectClass}
          >
            {ACCESS_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Utilities">
          <div className="text-xs text-[#6B6B6B] mb-3">
            Pick <span className="text-[#D4D4D4]">Yes</span> for utilities present on site and <span className="text-[#D4D4D4]">No</span> for ones not available. Leave on <span className="text-[#D4D4D4]">Unknown</span> if uncertain — the ad will avoid making any claim either way.
          </div>
          <div className="space-y-2">
            {UTILITIES.map(u => (
              <div
                key={u.key}
                className="flex items-center justify-between gap-3 rounded border border-[#373737] bg-[#252525] px-3 py-2"
              >
                <span className="text-sm text-[#D4D4D4]">{u.label}</span>
                <div className="flex gap-1" role="radiogroup" aria-label={u.label}>
                  {UTILITY_STATUSES.map(s => {
                    const selected = utilities[u.key] === s.value;
                    return (
                      <button
                        key={s.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setUtility(u.key, s.value)}
                        className={
                          'px-2.5 py-1 text-xs rounded border transition-colors ' +
                          (selected
                            ? 'bg-[#4DAB9A] text-[#191919] border-[#4DAB9A] font-medium'
                            : 'bg-transparent text-[#9B9B9B] border-[#373737] hover:border-[#4DAB9A] hover:text-[#D4D4D4]')
                        }
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <textarea
            value={utilitiesNotes}
            onChange={e => setUtilitiesNotes(e.target.value)}
            rows={2}
            placeholder="Optional context: nearest power pole, well depth in the area, fiber availability, etc."
            className={inputClass + ' mt-3'}
          />
        </Field>

        <Field label="Terrain & standout features">
          <textarea
            value={terrain}
            onChange={e => setTerrain(e.target.value)}
            rows={3}
            placeholder="Slope, views, vegetation, water features, neighboring BLM/forest, mineral rights, etc."
            className={inputClass}
          />
        </Field>

        <Field label="Zoning / allowed use">
          <input
            type="text"
            value={zoning}
            onChange={e => setZoning(e.target.value)}
            placeholder="Rural residential, recreational, ag, no zoning"
            className={inputClass}
          />
        </Field>

        <Field label="Comparable nearby sales (optional)">
          <textarea
            value={comps}
            onChange={e => setComps(e.target.value)}
            rows={2}
            placeholder="40 ac sold last quarter for $22k three miles away, etc."
            className={inputClass}
          />
        </Field>

        <Field label="Anything Claude MUST include (optional override)">
          <textarea
            value={mustInclude}
            onChange={e => setMustInclude(e.target.value)}
            rows={2}
            placeholder="Owner financing available. Survey complete. Etc."
            className={inputClass}
          />
        </Field>

        <Field label="Target buyer hint">
          <select
            value={buyerHint}
            onChange={e => setBuyerHint(e.target.value)}
            className={selectClass}
          >
            {BUYER_HINTS.map(b => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Platforms to generate for">
          <div className="grid grid-cols-2 gap-2">
            {PLATFORMS.map(p => (
              <label key={p.key} className="flex items-center gap-2 text-sm text-[#D4D4D4]">
                <input
                  type="checkbox"
                  checked={!!platforms[p.key]}
                  onChange={() => togglePlatform(p.key)}
                  className="accent-[#4DAB9A]"
                />
                {p.label}
              </label>
            ))}
          </div>
        </Field>

        {/* Plain div, not <Field>: a wrapping <label> would forward clicks anywhere
            in the section to the picker's buttons. */}
        <div>
          <div className="text-xs font-medium text-[#9B9B9B] mb-1">
            Photos<span className="text-[#FF4D4D] ml-1">*</span>
          </div>
          <PhotoPicker
            onChange={(next, primary) => {
              setPhotos(next);
              setPrimaryIndex(primary);
            }}
          />
        </div>

        {error && <div className="text-xs text-[#FF4D4D]">{error}</div>}

        <div className="flex items-center gap-2 pt-2">
          <button
            type="submit"
            disabled={submitting || photos.length === 0}
            className="px-4 py-2 text-sm font-medium rounded bg-[#4DAB9A] text-[#191919] hover:bg-[#5BC0AE] transition-colors disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Generate ad'}
          </button>
          <span className="text-xs text-[#6B6B6B]">
            Submission queues a task and starts the worker immediately. Results appear on the Tasks page within ~1-3 minutes.
          </span>
        </div>
      </form>
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

function renderDescription(m: {
  location: string;
  acreage: number;
  price_usd: number;
  access: string | null;
  utilities: string[];
  utilities_absent: string[];
  utilities_notes: string | null;
  terrain: string | null;
  zoning: string | null;
  comparable_sales: string | null;
  must_include: string | null;
  buyer_hint: string | null;
  platforms: string[];
}): string {
  const lines: string[] = [];
  lines.push(`Generate a real-estate ad for this property using the **generate-ad** workflow.`);
  lines.push('');
  lines.push('## Property facts');
  lines.push(`- Location: ${m.location}`);
  lines.push(`- Acreage: ${m.acreage}`);
  lines.push(`- Asking price: $${m.price_usd.toLocaleString()}`);
  if (m.access) lines.push(`- Access: ${m.access}`);
  if (m.utilities.length > 0) lines.push(`- Utilities on site: ${m.utilities.join(', ')}`);
  if (m.utilities_absent.length > 0) {
    lines.push(`- Utilities NOT available (do not imply otherwise): ${m.utilities_absent.join(', ')}`);
  }
  if (m.utilities_notes) lines.push(`- Utilities notes: ${m.utilities_notes}`);
  if (m.terrain) lines.push(`- Terrain & features: ${m.terrain}`);
  if (m.zoning) lines.push(`- Zoning: ${m.zoning}`);
  if (m.comparable_sales) lines.push(`- Comparable sales: ${m.comparable_sales}`);
  if (m.must_include) lines.push(`- Must include: ${m.must_include}`);
  if (m.buyer_hint) lines.push(`- Target buyer hint: ${m.buyer_hint}`);
  lines.push('');
  lines.push(`## Platforms to generate variants for`);
  lines.push(m.platforms.map(p => `- ${p}`).join('\n'));
  lines.push('');
  lines.push(`The structured form data is also on this task's \`metadata\` field — that is authoritative if it disagrees with the rendered text above.`);
  return lines.join('\n');
}
