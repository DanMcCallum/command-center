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

// One entry per photo the submission promised to upload. The filename is fixed
// the moment the plan is built (it encodes order on disk), so retries re-send
// the exact same name and never reshuffle files that already landed.
interface UploadEntry {
  photoId: string;
  file: File;
  filename: string;
  status: 'queued' | 'uploaded' | 'failed';
  error?: string;
}

type AdMetadata = Record<string, unknown> & { photoCount: number; primaryPhoto: string };

export default function AdBuilderPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
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
  // Set once the task is created; a retry after upload failures reuses it
  // instead of creating a duplicate task.
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskMetadata, setTaskMetadata] = useState<AdMetadata | null>(null);
  const [uploadPlan, setUploadPlan] = useState<UploadEntry[] | null>(null);

  // Failed/queued entries only count while their photo is still in the picker
  // (removing a failed photo drops it from the retry set); uploaded entries are
  // on disk regardless of what the picker shows.
  const activePlan =
    uploadPlan === null
      ? null
      : uploadPlan.filter(
          en => en.status === 'uploaded' || photos.some(p => p.id === en.photoId),
        );
  const failedEntries = activePlan?.filter(en => en.status === 'failed') ?? [];
  const uploadedCount = activePlan?.filter(en => en.status === 'uploaded').length ?? 0;
  const uploadErrors = Object.fromEntries(
    failedEntries.map(en => [en.photoId, en.error ?? 'Upload failed']),
  );
  const showUploadPanel =
    !submitting && activePlan !== null && (failedEntries.length > 0 || uploadedCount > 0);

  function togglePlatform(key: string) {
    setPlatforms(prev => ({ ...prev, [key]: !prev[key] }));
  }
  function setUtility(key: string, value: UtilityStatus) {
    setUtilities(prev => ({ ...prev, [key]: value }));
  }

  // Primary first (00_), then the rest in gallery order (01_, 02_, …) —
  // listPhotos() in the poster sorts by filename, so the prefix IS the order.
  function buildFreshPlan(): UploadEntry[] {
    const pi = primaryIndex >= 0 && primaryIndex < photos.length ? primaryIndex : 0;
    const ordered = [photos[pi], ...photos.filter((_, i) => i !== pi)];
    return ordered.map((p, i) => ({
      photoId: p.id,
      file: p.file,
      filename: `${String(i).padStart(2, '0')}_${sanitizeBasename(p.file.name)}`,
      status: 'queued' as const,
    }));
  }

  // After a partial failure the uploaded filenames are already on disk, so the
  // plan is frozen: keep uploaded entries, drop failed/queued entries whose
  // photo was removed from the picker, and append any photos added since with
  // the next order prefixes.
  function reconcilePlan(): UploadEntry[] {
    const kept = (uploadPlan ?? []).filter(
      en => en.status === 'uploaded' || photos.some(p => p.id === en.photoId),
    );
    if (kept.length === 0) return buildFreshPlan();
    let next = Math.max(...kept.map(en => parseInt(en.filename.slice(0, 2), 10))) + 1;
    const known = new Set(kept.map(en => en.photoId));
    const additions = photos
      .filter(p => !known.has(p.id))
      .map(p => ({
        photoId: p.id,
        file: p.file,
        filename: `${String(next++).padStart(2, '0')}_${sanitizeBasename(p.file.name)}`,
        status: 'queued' as const,
      }));
    return [...kept, ...additions];
  }

  // Sequential upload of everything not yet uploaded. A failure marks that
  // entry and moves on — remaining photos still attempt.
  async function runUploads(id: string, plan: UploadEntry[]): Promise<UploadEntry[]> {
    const entries = plan.map(en => ({ ...en }));
    const todo = entries.filter(en => en.status !== 'uploaded');
    for (let i = 0; i < todo.length; i++) {
      const entry = todo[i];
      setUploadProgress(`Uploading photo ${i + 1} of ${todo.length}…`);
      try {
        const fd = new FormData();
        fd.append('file', entry.file);
        fd.append('filename', entry.filename);
        const up = await fetch(`/api/tasks/${id}/photos`, { method: 'POST', body: fd });
        if (up.ok) {
          entry.status = 'uploaded';
          delete entry.error;
        } else {
          const data = await up.json().catch(() => ({}) as { error?: string });
          entry.status = 'failed';
          entry.error = data.error ?? `HTTP ${up.status}`;
        }
      } catch {
        entry.status = 'failed';
        entry.error = 'Network error';
      }
      setUploadPlan(entries.map(en => ({ ...en })));
    }
    setUploadProgress(null);
    return entries;
  }

  async function finalize(id: string, entries: UploadEntry[]) {
    const uploaded = entries
      .filter(en => en.status === 'uploaded')
      .map(en => en.filename)
      .sort();
    // If failed photos were dropped, the counts stamped at create time are stale.
    if (
      taskMetadata &&
      (taskMetadata.photoCount !== uploaded.length || taskMetadata.primaryPhoto !== uploaded[0])
    ) {
      await fetch(`/api/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metadata: { ...taskMetadata, photoCount: uploaded.length, primaryPhoto: uploaded[0] },
        }),
      }).catch(() => {});
    }
    // Fire the worker now. Don't await — worker runs detached.
    fetch('/api/run-worker', { method: 'POST' }).catch(() => {});
    router.push(`/tasks?focus=${id}`);
  }

  // Worker trigger + redirect happen only when nothing failed and at least one
  // photo is on disk; otherwise the failure panel takes over.
  async function uploadAndFinish(id: string, plan: UploadEntry[]) {
    setUploadPlan(plan);
    const result = await runUploads(id, plan);
    if (result.some(en => en.status === 'failed')) return;
    if (!result.some(en => en.status === 'uploaded')) {
      setError('At least 1 photo must upload successfully.');
      return;
    }
    await finalize(id, result);
  }

  async function retryUploads() {
    if (!taskId) return;
    setError(null);
    setSubmitting(true);
    try {
      await uploadAndFinish(taskId, reconcilePlan());
    } finally {
      setSubmitting(false);
      setUploadProgress(null);
    }
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

    setSubmitting(true);
    try {
      if (taskId) {
        // The task already exists from a failed attempt — resume the uploads.
        await uploadAndFinish(taskId, reconcilePlan());
        return;
      }

      const plan = buildFreshPlan();
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
        photoCount: plan.length,
        primaryPhoto: plan[0].filename,
      };

      const description = renderDescription(metadata);
      const title = `Generate ad: ${metadata.acreage} ac · ${metadata.location} · $${metadata.price_usd.toLocaleString()}`;

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
        // No uploads are attempted when task creation fails.
        const data = await res.json().catch(() => ({}));
        setError(`Task creation failed: ${data.error ?? `HTTP ${res.status}`}`);
        return;
      }
      const task = (await res.json()) as Task;
      setTaskId(task.id);
      setTaskMetadata(metadata);
      await uploadAndFinish(task.id, plan);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
      setUploadProgress(null);
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
            uploadErrors={uploadErrors}
            onChange={(next, primary) => {
              setPhotos(next);
              setPrimaryIndex(primary);
            }}
          />
        </div>

        {uploadProgress && <div className="text-xs text-[#9B9B9B]">{uploadProgress}</div>}
        {error && <div className="text-xs text-[#FF4D4D]">{error}</div>}

        {activePlan !== null && showUploadPanel && (
          <div className="rounded border border-[#373737] bg-[#252525] px-3 py-2.5 space-y-2">
            {failedEntries.length > 0 ? (
              <>
                <div className="text-xs text-[#FF4D4D]">
                  {failedEntries.length} of {activePlan.length} photos failed to upload.
                </div>
                <div className="text-xs text-[#6B6B6B]">
                  The worker starts only once every photo is in. Retry the failed uploads, or
                  remove the failed photos above to continue without them.
                </div>
                <button
                  type="button"
                  onClick={retryUploads}
                  className="px-3 py-1.5 text-sm font-medium rounded bg-[#4DAB9A] text-[#191919] hover:bg-[#5BC0AE] transition-colors"
                >
                  Retry failed uploads
                </button>
              </>
            ) : (
              <>
                <div className="text-xs text-[#9B9B9B]">
                  {uploadedCount} photo{uploadedCount === 1 ? '' : 's'} uploaded. Continue to
                  start the worker with what made it.
                </div>
                <button
                  type="button"
                  onClick={retryUploads}
                  className="px-3 py-1.5 text-sm font-medium rounded bg-[#4DAB9A] text-[#191919] hover:bg-[#5BC0AE] transition-colors"
                >
                  Continue
                </button>
              </>
            )}
          </div>
        )}

        {!showUploadPanel && (
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
        )}
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

// The upload API only accepts /^[0-9]{2}_[\w.-]+$/ with no '..' anywhere; the
// picker already guarantees an allowed extension, so keep it and neutralize
// everything else.
function sanitizeBasename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? '';
  const safe = base.replace(/[^\w.-]/g, '_').replace(/\.{2,}/g, '.');
  return /[\w-]/.test(safe) ? safe : `photo${safe}`;
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
