'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import PhotoPicker, { type PickedPhoto } from '@/components/PhotoPicker';
import { suggestItemPrice } from '@/lib/item-pricing';
import type { BuywanderPurchase } from '@/lib/buywander-types';
import type { Task } from '@/lib/types';

// Keys match config/posting-platforms.json (manual entries) and the
// generate-item-ad command's per-platform outputs (<key>.md).
const PLATFORMS: { key: string; label: string }[] = [
  { key: 'ebay_item', label: 'eBay' },
  { key: 'fb_item', label: 'Facebook Marketplace' },
  { key: 'ksl', label: 'KSL Classifieds' },
];

const CONDITIONS = [
  { value: 'New', label: 'New' },
  { value: 'Appears new / open box', label: 'Appears new / open box' },
  { value: 'Used, good', label: 'Used, good' },
  { value: 'Used, fair', label: 'Used, fair' },
  { value: 'For parts', label: 'For parts' },
];

const SHIPPING_OPTIONS = [
  { value: 'Buyer pays calculated shipping', label: 'Buyer pays calculated shipping' },
  { value: 'Free shipping', label: 'Free shipping' },
  { value: 'Local pickup only', label: 'Local pickup only' },
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

/** Shape of GET /api/buywander/lot/<auctionId> (server-side fetch of the lot). */
interface BuywanderLot {
  auction_id: string;
  title: string;
  description: string | null;
  bwsku: string | null;
  condition: string | null;
  category: string | null;
  size_description: string | null;
  retail_value: number | null;
  final_amount: number | null;
  end_date: string | null;
  ended: boolean;
  images: string[];
}

/** Result of POST /api/tasks/<id>/photos/import, kept across retries. */
interface ImportState {
  saved: { url: string; filename: string; bytes: number }[];
  failed: { url: string; error: string }[];
  primaryPhoto: string | null;
  nextIndex: number;
}

/** The first BuyWander-hosted photo (the lot's own shot of the item) if any, else the first image. */
function defaultBuywanderPrimary(images: string[]): number {
  const own = images.findIndex(u => u.includes('cdn.buywander.com'));
  return own >= 0 ? own : 0;
}

/** Short label for a remote image url (last path segment). */
function urlBasename(u: string): string {
  try {
    const path = new URL(u).pathname;
    return decodeURIComponent(path.split('/').pop() || u);
  } catch {
    return u.split('/').pop() || u;
  }
}

/** BuyWander condition codes to the form's condition values. */
function conditionFromBuywander(code: string | undefined): string {
  const c = (code ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (!c) return 'Used, good';
  if (c === 'new' || c === 'brandnew' || c === 'sealed') return 'New';
  if (c.includes('appearsnew') || c.includes('openbox') || c.includes('likenew')) return 'Appears new / open box';
  if (c.includes('parts') || c.includes('salvage') || c.includes('damaged') || c.includes('notworking')) return 'For parts';
  if (c.includes('fair') || c.includes('poor') || c.includes('heavy')) return 'Used, fair';
  return 'Used, good';
}

export default function ItemAdBuilderPage() {
  // useSearchParams needs a Suspense boundary for the static shell.
  return (
    <Suspense fallback={<div className="text-sm text-[#6B6B6B]">Loading…</div>}>
      <ItemAdBuilderForm />
    </Suspense>
  );
}

function ItemAdBuilderForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const auctionIdParam = searchParams.get('auction_id')?.trim() || null;

  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [purchase, setPurchase] = useState<BuywanderPurchase | null>(null);
  const [purchaseState, setPurchaseState] = useState<'idle' | 'loading' | 'loaded' | 'missing' | 'error'>(
    auctionIdParam ? 'loading' : 'idle',
  );
  // The lot itself (title, retailer description, photos), fetched alongside
  // the purchase record; works for ended lots and lots never bought.
  const [lot, setLot] = useState<BuywanderLot | null>(null);
  const [lotState, setLotState] = useState<'idle' | 'loading' | 'loaded' | 'error'>(
    auctionIdParam ? 'loading' : 'idle',
  );
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  // One flag per lot image (checked = import it) and the index of the cover.
  const [bwSelected, setBwSelected] = useState<boolean[]>([]);
  const [bwPrimary, setBwPrimary] = useState(0);
  // Server-side import of the selected lot photos; null until attempted.
  const [importState, setImportState] = useState<ImportState | null>(null);
  // First free NN prefix for the operator's own uploads (0 without imports).
  const [nextIndex, setNextIndex] = useState(0);

  const [itemTitle, setItemTitle] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [category, setCategory] = useState('');
  const [condition, setCondition] = useState('Used, good');
  const [conditionNotes, setConditionNotes] = useState('');
  const [included, setIncluded] = useState('');
  const [defects, setDefects] = useState('');
  const [dimensions, setDimensions] = useState('');
  const [retailValue, setRetailValue] = useState('');
  const [paidUsd, setPaidUsd] = useState('');
  // The operator typed a price; stop overwriting it with the suggestion.
  const [priceTouched, setPriceTouched] = useState(false);
  const [priceUsd, setPriceUsd] = useState('');
  // Fast-turnover suggestion from the eBay comps, condition and price paid.
  const pricing = useMemo(
    () =>
      suggestItemPrice({
        median: purchase?.ebay?.median_sold ?? null,
        compCount: purchase?.ebay?.comp_count ?? null,
        match: purchase?.ebay?.match ?? null,
        paidUsd: paidUsd.trim() ? Number(paidUsd) : null,
      }),
    [purchase, paidUsd],
  );
  useEffect(() => {
    if (priceTouched) return;
    if (pricing.listPrice !== null) setPriceUsd(String(pricing.listPrice));
  }, [pricing.listPrice, priceTouched]);
  const [acceptOffers, setAcceptOffers] = useState(true);
  const [localPickup, setLocalPickup] = useState(true);
  const [pickupArea, setPickupArea] = useState('Salt Lake City area');
  const [shipping, setShipping] = useState('Buyer pays calculated shipping');
  const [mustInclude, setMustInclude] = useState('');
  const [platforms, setPlatforms] = useState<Record<string, boolean>>(
    Object.fromEntries(PLATFORMS.map(p => [p.key, true])),
  );
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  // Index into `photos` of the starred (cover) image; the upload flow gives it
  // the 00_ filename prefix.
  const [primaryIndex, setPrimaryIndex] = useState(-1);
  // Set once the task is created; a retry after upload failures reuses it
  // instead of creating a duplicate task.
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskMetadata, setTaskMetadata] = useState<AdMetadata | null>(null);
  const [uploadPlan, setUploadPlan] = useState<UploadEntry[] | null>(null);

  // Prefill from the BuyWander purchase when ?auction_id= is present.
  useEffect(() => {
    if (!auctionIdParam) return;
    let cancelled = false;
    setPurchaseState('loading');
    (async () => {
      try {
        const res = await fetch(
          `/api/buywander/purchases?auction_id=${encodeURIComponent(auctionIdParam)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { purchases?: BuywanderPurchase[] };
        const found =
          (data.purchases ?? []).find(p => p.auction_id === auctionIdParam) ??
          (data.purchases ?? [])[0] ??
          null;
        if (cancelled) return;
        if (!found) {
          setPurchaseState('missing');
          return;
        }
        setPurchase(found);
        setPurchaseState('loaded');
        // The purchase record wins over the lot fetch (it is the operator's
        // own record), but an empty purchase field never blanks a lot value.
        if (found.title) setItemTitle(found.title);
        if (found.category) setCategory(found.category);
        if (found.condition) setCondition(conditionFromBuywander(found.condition));
        if (found.size_description) setDimensions(found.size_description);
        if (typeof found.retail_value === 'number' && Number.isFinite(found.retail_value)) {
          setRetailValue(String(found.retail_value));
        }
        if (typeof found.paid_usd === 'number') setPaidUsd(String(found.paid_usd));
      } catch {
        if (!cancelled) setPurchaseState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auctionIdParam]);

  // Fetch the lot for its photos and the retailer's description. Fields are
  // filled only when still empty so a purchase record loaded first stays.
  useEffect(() => {
    if (!auctionIdParam) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/buywander/lot/${encodeURIComponent(auctionIdParam)}`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { lot?: BuywanderLot };
        if (cancelled) return;
        if (!data.lot) throw new Error('No lot in response');
        const l = data.lot;
        const images = Array.isArray(l.images) ? l.images.filter(u => typeof u === 'string' && u) : [];
        setLot({ ...l, images });
        setLotState('loaded');
        setBwSelected(images.map(() => true));
        setBwPrimary(defaultBuywanderPrimary(images));
        if (l.title) setItemTitle(prev => prev || l.title);
        if (l.category) setCategory(prev => prev || l.category || '');
        if (l.condition) setCondition(conditionFromBuywander(l.condition));
        if (l.size_description) setDimensions(prev => prev || l.size_description || '');
        if (typeof l.retail_value === 'number' && Number.isFinite(l.retail_value)) {
          setRetailValue(prev => prev || String(l.retail_value));
        }
        if (typeof l.final_amount === 'number' && Number.isFinite(l.final_amount)) {
          setPaidUsd(prev => prev || String(l.final_amount));
        }
      } catch {
        if (!cancelled) setLotState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auctionIdParam]);

  // Selected lot images in grid order, and the cover's index within that list.
  const lotImages = lot?.images ?? [];
  const selectedUrls = lotImages.filter((_, i) => bwSelected[i]);
  const selectedPrimaryIndex = (() => {
    if (selectedUrls.length === 0) return -1;
    if (bwSelected[bwPrimary]) return selectedUrls.indexOf(lotImages[bwPrimary]);
    return 0;
  })();
  const bwInUse = selectedUrls.length > 0;

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
  const importFailed = importState?.failed ?? [];
  const importedCount = importState?.saved.length ?? 0;
  const anyFailed = failedEntries.length > 0 || importFailed.length > 0;
  const showUploadPanel =
    !submitting &&
    taskId !== null &&
    (activePlan !== null || importState !== null) &&
    (anyFailed || uploadedCount > 0 || importedCount > 0);

  function togglePlatform(key: string) {
    setPlatforms(prev => ({ ...prev, [key]: !prev[key] }));
  }

  // Primary first (00_), then the rest in gallery order (01_, 02_, …); the
  // photos are listed by filename everywhere, so the prefix IS the order.
  // When BuyWander photos were imported first, the operator's files continue
  // the numbering from `start` in gallery order and the picker's star is
  // ignored (the cover is one of the imported photos).
  function buildFreshPlan(start: number): UploadEntry[] {
    if (photos.length === 0) return [];
    const pi = start === 0 && primaryIndex >= 0 && primaryIndex < photos.length ? primaryIndex : 0;
    const ordered = start === 0 ? [photos[pi], ...photos.filter((_, i) => i !== pi)] : photos;
    return ordered.map((p, i) => ({
      photoId: p.id,
      file: p.file,
      filename: `${String(start + i).padStart(2, '0')}_${sanitizeBasename(p.file.name)}`,
      status: 'queued' as const,
    }));
  }

  // After a partial failure the uploaded filenames are already on disk, so the
  // plan is frozen: keep uploaded entries, drop failed/queued entries whose
  // photo was removed from the picker, and append any photos added since with
  // the next order prefixes.
  function reconcilePlan(start: number): UploadEntry[] {
    const kept = (uploadPlan ?? []).filter(
      en => en.status === 'uploaded' || photos.some(p => p.id === en.photoId),
    );
    if (kept.length === 0) return buildFreshPlan(start);
    let next = Math.max(start, ...kept.map(en => parseInt(en.filename.slice(0, 2), 10) + 1));
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
  // entry and moves on; the remaining photos still attempt.
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

  async function finalize(id: string, entries: UploadEntry[], imp: ImportState | null) {
    const uploaded = entries
      .filter(en => en.status === 'uploaded')
      .map(en => en.filename)
      .sort();
    const imported = (imp?.saved ?? []).map(sv => sv.filename).sort();
    const photoCount = uploaded.length + imported.length;
    // Cover: the imported primary, else the first uploaded file (00_ when no
    // lot photos were imported), else the lowest-numbered imported file.
    const primaryPhoto = imp?.primaryPhoto ?? uploaded[0] ?? imported[0];
    // The counts stamped at create time were provisional (imports had not run
    // and failed photos may have been dropped), so restate them. Read the
    // task back from the API: the React state set a moment ago is not visible
    // inside this closure yet, and the resume path may hold stale values.
    const current =
      (await fetch(`/api/tasks/${id}`)
        .then(r => (r.ok ? (r.json() as Promise<Task>) : null))
        .catch(() => null)) ?? null;
    const currentMeta = (current?.metadata ?? taskMetadata ?? null) as AdMetadata | null;
    if (
      currentMeta &&
      (currentMeta.photoCount !== photoCount || currentMeta.primaryPhoto !== primaryPhoto)
    ) {
      await fetch(`/api/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metadata: { ...currentMeta, photoCount, primaryPhoto },
        }),
      }).catch(() => {});
    }
    // Link the purchase to its task so the Deals page can show it. Best effort:
    // the task is already queued whether or not the store accepts the link.
    if (auctionIdParam) {
      await fetch(`/api/buywander/purchases/${encodeURIComponent(auctionIdParam)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: id }),
      }).catch(() => {});
    }
    // Fire the worker now. Not awaited: the worker runs detached.
    fetch('/api/run-worker', { method: 'POST' }).catch(() => {});
    router.push(`/tasks?focus=${id}`);
  }

  // POST the given lot photo urls to the server-side importer, which downloads
  // and re-encodes them as NN_bw-<k>.jpg from `start`. Merges into the kept
  // import state so retries only add; never throws.
  async function runImport(
    id: string,
    urls: string[],
    primaryIdx: number | undefined,
    start: number,
    prior: ImportState | null,
  ): Promise<ImportState> {
    setUploadProgress(`Importing ${urls.length} BuyWander photo${urls.length === 1 ? '' : 's'}…`);
    let result: ImportState;
    try {
      const res = await fetch(`/api/tasks/${id}/photos/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls,
          ...(primaryIdx !== undefined && primaryIdx >= 0 ? { primaryIndex: primaryIdx } : {}),
          startIndex: start,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as Partial<ImportState>;
        result = {
          saved: Array.isArray(data.saved) ? data.saved : [],
          failed: Array.isArray(data.failed) ? data.failed : [],
          primaryPhoto: typeof data.primaryPhoto === 'string' ? data.primaryPhoto : null,
          nextIndex: typeof data.nextIndex === 'number' ? data.nextIndex : start + urls.length,
        };
      } else {
        const data = await res.json().catch(() => ({}) as { error?: string });
        const msg = data.error ?? `HTTP ${res.status}`;
        result = { saved: [], failed: urls.map(url => ({ url, error: msg })), primaryPhoto: null, nextIndex: start };
      }
    } catch {
      result = { saved: [], failed: urls.map(url => ({ url, error: 'Network error' })), primaryPhoto: null, nextIndex: start };
    }
    const merged: ImportState = {
      saved: [...(prior?.saved ?? []), ...result.saved],
      failed: result.failed,
      primaryPhoto: prior?.primaryPhoto ?? result.primaryPhoto,
      nextIndex: Math.max(prior?.nextIndex ?? 0, result.nextIndex),
    };
    setImportState(merged);
    setNextIndex(n => Math.max(n, merged.nextIndex));
    setUploadProgress(null);
    return merged;
  }

  // Worker trigger + redirect happen only when nothing failed and at least one
  // photo is on disk; otherwise the failure panel takes over.
  async function uploadAndFinish(id: string, plan: UploadEntry[], imp: ImportState | null) {
    setUploadPlan(plan);
    if (plan.length > 0) {
      const last = Math.max(...plan.map(en => parseInt(en.filename.slice(0, 2), 10))) + 1;
      setNextIndex(n => Math.max(n, last));
    }
    const result = await runUploads(id, plan);
    if (result.some(en => en.status === 'failed')) return;
    if ((imp?.failed.length ?? 0) > 0) return;
    if (!result.some(en => en.status === 'uploaded') && (imp?.saved.length ?? 0) === 0) {
      setError('At least 1 photo must import or upload successfully.');
      return;
    }
    await finalize(id, result, imp);
  }

  // Resume after a failure on an existing task. `retryImports` re-POSTs the
  // failed lot urls (numbered from the next free prefix); otherwise they are
  // dropped and the task continues with what landed.
  async function resume(retryImports: boolean) {
    if (!taskId) return;
    setError(null);
    setSubmitting(true);
    try {
      let imp = importState;
      if (imp && imp.failed.length > 0) {
        if (retryImports) {
          const urls = imp.failed.map(f => f.url);
          const primaryUrl = bwInUse ? lotImages[bwPrimary] : null;
          const pIdx = imp.primaryPhoto === null && primaryUrl ? urls.indexOf(primaryUrl) : -1;
          imp = await runImport(taskId, urls, pIdx >= 0 ? pIdx : undefined, nextIndex, imp);
        } else {
          imp = { ...imp, failed: [] };
          setImportState(imp);
        }
      }
      await uploadAndFinish(taskId, reconcilePlan(Math.max(nextIndex, imp?.nextIndex ?? 0)), imp);
    } finally {
      setSubmitting(false);
      setUploadProgress(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!itemTitle.trim()) return setError('Item title is required.');
    if (!priceUsd.trim() || isNaN(Number(priceUsd)) || Number(priceUsd) <= 0) {
      return setError('Asking price must be a number above 0.');
    }
    if (retailValue.trim() && isNaN(Number(retailValue))) return setError('Retail value must be a number.');
    if (paidUsd.trim() && isNaN(Number(paidUsd))) return setError('Price paid must be a number.');
    if (localPickup && !pickupArea.trim()) return setError('Pickup area is required when local pickup is on.');
    const selectedPlatforms = PLATFORMS.filter(p => platforms[p.key]).map(p => p.key);
    if (selectedPlatforms.length === 0) return setError('Pick at least one platform.');
    if (photos.length === 0 && selectedUrls.length === 0) {
      return setError('At least 1 photo is required (a BuyWander photo or your own).');
    }

    setSubmitting(true);
    try {
      if (taskId) {
        // The task already exists from a failed attempt: resume.
        setSubmitting(false);
        await resume(true);
        return;
      }

      const asking = Number(priceUsd);
      // Provisional photo fields: the import has not run yet, so the cover
      // name is a guess that finalize() restates from the real results.
      const provisionalPlan = buildFreshPlan(0);
      const provisionalPrimary =
        selectedUrls.length > 0
          ? `00_bw-${selectedPrimaryIndex}.jpg`
          : provisionalPlan[0]?.filename ?? '';
      const metadata = {
        kind: 'item-ad-builder',
        auction_id: purchase?.auction_id ?? lot?.auction_id ?? auctionIdParam,
        bwsku: purchase?.bwsku ?? lot?.bwsku ?? null,
        source_url:
          purchase?.url ?? (auctionIdParam ? `https://buywander.com/auctions?auctionId=${auctionIdParam}` : null),
        source_description: lot?.description ?? null,
        source_images: selectedUrls,
        item_title: itemTitle.trim(),
        brand: brand.trim() || null,
        model: model.trim() || null,
        category: category.trim() || null,
        condition,
        condition_notes: conditionNotes.trim() || null,
        included: included.trim() || null,
        defects: defects.trim() || null,
        dimensions: dimensions.trim() || null,
        retail_value: retailValue.trim() ? Number(retailValue) : null,
        paid_usd: paidUsd.trim() ? Number(paidUsd) : null,
        price_usd: asking,
        accept_offers: acceptOffers,
        local_pickup: localPickup,
        pickup_area: localPickup ? pickupArea.trim() : null,
        shipping,
        ebay_median_sold: purchase?.ebay?.median_sold ?? null,
        ebay_search_url: purchase?.ebay?.search_url ?? null,
        ebay_comp_note: purchase?.ebay?.note ?? null,
        pricing: {
          list_price: pricing.listPrice,
          expected_ebay_net: pricing.expectedEbayNet,
          expected_ebay_profit: pricing.expectedEbayProfit,
          expected_ebay_margin: pricing.expectedEbayMargin,
          confidence: pricing.confidence,
          basis: pricing.basis,
          warnings: pricing.warnings,
          rule: 'the eBay sold median the nightly BuyWander scan recommended on, rounded to a shelf price; one price on every platform',
        },
        must_include: mustInclude.trim() || null,
        platforms: selectedPlatforms,
        photoCount: selectedUrls.length + photos.length,
        primaryPhoto: provisionalPrimary,
      };

      const description = renderDescription({ ...metadata, uploaded_count: photos.length });
      const shortTitle = metadata.item_title.length > 60
        ? metadata.item_title.slice(0, 60).trimEnd()
        : metadata.item_title;
      const title = `Item ad: ${shortTitle} · $${asking.toLocaleString()}`;

      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          type: 'Content',
          priority: 1,
          model: 'opus',
          slashCommand: 'generate-item-ad',
          tags: ['item-ad-builder'],
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
      // Lot photos first (00_ onward), then the operator's own files continue
      // the numbering; without lot photos the picker's star takes 00_.
      let imp: ImportState | null = null;
      let start = 0;
      if (selectedUrls.length > 0) {
        imp = await runImport(task.id, selectedUrls, selectedPrimaryIndex, 0, null);
        start = imp.nextIndex;
      }
      await uploadAndFinish(task.id, buildFreshPlan(start), imp);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
      setUploadProgress(null);
    }
  }

  const conditionLabel = CONDITIONS.find(c => c.value === condition)?.label ?? condition;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Item Ad Builder</h1>
        <p className="text-sm text-[#6B6B6B] mt-1">
          Fill in the facts about an item you bought (a BuyWander lot or anything else). Submit to generate eBay, Facebook Marketplace and KSL copy from the item knowledge base and anti-slop rules. Every item platform is posted by hand from the task card.
        </p>
      </header>

      {auctionIdParam && (
        <div className="bg-[#202020] border border-[#373737] rounded-lg px-5 py-3 text-sm space-y-1">
          <div className="text-xs font-medium text-[#6B6B6B] uppercase tracking-wide">BuyWander purchase</div>
          {purchaseState === 'loading' && <div className="text-[#9B9B9B]">Loading purchase {auctionIdParam}…</div>}
          {purchaseState === 'missing' && (
            <div className="text-[#D4A04D]">
              No purchase recorded for auction {auctionIdParam}. Fill the form by hand; the auction id is still stored on the task.
            </div>
          )}
          {purchaseState === 'error' && (
            <div className="text-[#D4A04D]">
              Could not load purchase {auctionIdParam}. Fill the form by hand; the auction id is still stored on the task.
            </div>
          )}
          {purchase && (
            <div className="space-y-1 text-[#D4D4D4]">
              <div>
                <a href={purchase.url} target="_blank" rel="noreferrer" className="text-[#4DAB9A] hover:underline">
                  Lot {purchase.auction_id} on BuyWander
                </a>
                {purchase.bwsku && <span className="text-[#6B6B6B]"> · SKU {purchase.bwsku}</span>}
                {purchase.purchased_at && (
                  <span className="text-[#6B6B6B]"> · bought {purchase.purchased_at.slice(0, 10)}</span>
                )}
              </div>
              <div>
                eBay sold median:{' '}
                {typeof purchase.ebay?.median_sold === 'number' ? (
                  <>
                    <span className="text-white">${Math.round(purchase.ebay.median_sold).toLocaleString()}</span>
                    <span className="text-[#6B6B6B]">
                      {' '}from {purchase.ebay.comp_count} comp{purchase.ebay.comp_count === 1 ? '' : 's'}
                      {purchase.ebay.match === 'loose' ? ' (loose match)' : ''}
                    </span>
                  </>
                ) : (
                  <span className="text-[#6B6B6B]">none</span>
                )}
                {purchase.ebay?.search_url && (
                  <>
                    {' · '}
                    <a href={purchase.ebay.search_url} target="_blank" rel="noreferrer" className="text-[#4DAB9A] hover:underline">
                      sold comps search
                    </a>
                  </>
                )}
              </div>
              {purchase.ebay?.note && <div className="text-xs text-[#9B9B9B]">{purchase.ebay.note}</div>}
              {purchase.task_id && (
                <div className="text-xs text-[#D4A04D]">
                  This purchase already has an ad task ({purchase.task_id}). Submitting creates another one.
                </div>
              )}
            </div>
          )}
          {lotState === 'loading' && <div className="text-xs text-[#6B6B6B]">Loading the lot&apos;s photos and description…</div>}
          {lotState === 'error' && (
            <div className="text-xs text-[#6B6B6B]">
              Could not load the lot itself (photos and retailer description); add photos by hand below.
            </div>
          )}
          {lot && (
            <div className="text-xs text-[#9B9B9B]">
              Lot loaded: {lot.images.length} photo{lot.images.length === 1 ? '' : 's'}
              {lot.ended ? ', ended' : ', still live'}
              {typeof lot.final_amount === 'number' ? `, final $${lot.final_amount.toLocaleString()}` : ''}
              {!purchase && (
                <>
                  {' · '}
                  <a
                    href={`https://buywander.com/auctions?auctionId=${encodeURIComponent(lot.auction_id)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#4DAB9A] hover:underline"
                  >
                    open on BuyWander
                  </a>
                </>
              )}
            </div>
          )}
          {lot?.description && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setDescriptionOpen(o => !o)}
                aria-expanded={descriptionOpen}
                className="text-xs text-[#4DAB9A] hover:underline"
              >
                {descriptionOpen ? 'Hide' : 'Show'} BuyWander description ({lot.description.length.toLocaleString()} chars)
              </button>
              {descriptionOpen && (
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded border border-[#373737] bg-[#252525] px-3 py-2 text-xs text-[#D4D4D4] font-sans">
                  {lot.description}
                </pre>
              )}
              <div className="text-[11px] text-[#6B6B6B] mt-1">
                Retailer copy, read-only. Stored on the task as <code>source_description</code>; the ad writer uses it for specs only, never its marketing lines.
              </div>
            </div>
          )}
        </div>
      )}

      <form
        onSubmit={submit}
        className="bg-[#202020] border border-[#373737] rounded-lg p-5 space-y-4"
      >
        <Field label="Item title" required>
          <input
            type="text"
            value={itemTitle}
            onChange={e => setItemTitle(e.target.value)}
            placeholder="DeWalt 20V MAX cordless drill kit DCD771C2"
            className={inputClass}
            autoFocus
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Brand">
            <input
              type="text"
              value={brand}
              onChange={e => setBrand(e.target.value)}
              placeholder="DeWalt"
              className={inputClass}
            />
          </Field>
          <Field label="Model">
            <input
              type="text"
              value={model}
              onChange={e => setModel(e.target.value)}
              placeholder="DCD771C2"
              className={inputClass}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <input
              type="text"
              value={category}
              onChange={e => setCategory(e.target.value)}
              placeholder="Tools, Home, Electronics…"
              className={inputClass}
            />
          </Field>
          <Field label="Condition" required>
            <select
              value={condition}
              onChange={e => setCondition(e.target.value)}
              className={selectClass}
            >
              {CONDITIONS.map(c => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Condition notes">
          <textarea
            value={conditionNotes}
            onChange={e => setConditionNotes(e.target.value)}
            rows={2}
            placeholder="Tested and works, light scuffs on the case, retail box opened but complete."
            className={inputClass}
          />
        </Field>

        <Field label="What is included">
          <textarea
            value={included}
            onChange={e => setIncluded(e.target.value)}
            rows={2}
            placeholder="Drill, two batteries, charger, belt clip, carry bag."
            className={inputClass}
          />
        </Field>

        <Field label="Defects or missing parts">
          <textarea
            value={defects}
            onChange={e => setDefects(e.target.value)}
            rows={2}
            placeholder="Missing the manual. Small crack in the bag handle. Leave blank if none."
            className={inputClass}
          />
        </Field>

        <Field label="Dimensions or weight">
          <input
            type="text"
            value={dimensions}
            onChange={e => setDimensions(e.target.value)}
            placeholder="L: 40 cm x W: 30 cm x H: 12 cm, Weight: 3.2 kg"
            className={inputClass}
          />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Retail value (USD)">
            <input
              type="number"
              step="0.01"
              value={retailValue}
              onChange={e => setRetailValue(e.target.value)}
              placeholder="199"
              className={inputClass}
            />
          </Field>
          <Field label="Price paid (USD)">
            <input
              type="number"
              step="0.01"
              value={paidUsd}
              onChange={e => setPaidUsd(e.target.value)}
              placeholder="42"
              className={inputClass}
            />
          </Field>
          <Field label="Asking price (USD)" required>
            <input
              type="number"
              step="1"
              value={priceUsd}
              onChange={e => {
                setPriceTouched(true);
                setPriceUsd(e.target.value);
              }}
              placeholder="95"
              className={inputClass}
            />
          </Field>
        </div>
        <div className="-mt-1 rounded border border-[#373737] bg-[#202020] px-3 py-2 text-xs text-[#9B9B9B] space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium text-[#D4D4D4]">Sale price from the nightly scan</span>
            {pricing.listPrice !== null ? (
              <>
                <span>
                  <span className="text-white">${pricing.listPrice}</span> on every platform
                  {pricing.expectedEbayProfit !== null && pricing.expectedEbayMargin !== null && (
                    <>
                      {' '}(eBay: about ${pricing.expectedEbayProfit.toFixed(0)} profit, {Math.round(pricing.expectedEbayMargin * 100)}% margin after fees
                      {pricing.expectedLocalProfit !== null && <>; local cash: about ${pricing.expectedLocalProfit.toFixed(0)}</>})
                    </>
                  )}
                </span>
                <span className="text-[#6B6B6B]">confidence {pricing.confidence}</span>
                {priceTouched && String(pricing.listPrice) !== priceUsd && (
                  <button
                    type="button"
                    onClick={() => {
                      setPriceTouched(false);
                      setPriceUsd(String(pricing.listPrice));
                    }}
                    className="px-2 py-0.5 rounded bg-[#2F2F2F] text-[#4DAB9A] hover:bg-[#373737]"
                  >
                    Use ${pricing.listPrice}
                  </button>
                )}
              </>
            ) : (
              <span>No price to carry over: the purchase record has no eBay sold comps from the nightly scan.</span>
            )}
          </div>
          {pricing.basis.map((line, i) => (
            <div key={i} className="text-[#6B6B6B]">{line}</div>
          ))}
          {pricing.warnings.map((line, i) => (
            <div key={`w${i}`} className="text-[#D4A04D]">{line}</div>
          ))}
          <div className="text-[#6B6B6B]">
            The asking price follows the scan&apos;s value until you edit it. Price paid and retail value are for the ad writer&apos;s context only; the ads never print what you paid.
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-sm text-[#D4D4D4] rounded border border-[#373737] bg-[#252525] px-3 py-2">
            <input
              type="checkbox"
              checked={acceptOffers}
              onChange={e => setAcceptOffers(e.target.checked)}
              className="accent-[#4DAB9A]"
            />
            Accept offers
          </label>
          <label className="flex items-center gap-2 text-sm text-[#D4D4D4] rounded border border-[#373737] bg-[#252525] px-3 py-2">
            <input
              type="checkbox"
              checked={localPickup}
              onChange={e => setLocalPickup(e.target.checked)}
              className="accent-[#4DAB9A]"
            />
            Local pickup
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Pickup area" required={localPickup}>
            <input
              type="text"
              value={pickupArea}
              onChange={e => setPickupArea(e.target.value)}
              placeholder="Salt Lake City area"
              className={inputClass}
              disabled={!localPickup}
            />
          </Field>
          <Field label="Shipping">
            <select
              value={shipping}
              onChange={e => setShipping(e.target.value)}
              className={selectClass}
            >
              {SHIPPING_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Anything Claude MUST include (optional override)">
          <textarea
            value={mustInclude}
            onChange={e => setMustInclude(e.target.value)}
            rows={2}
            placeholder="Cash or Venmo at pickup. Serial number on request. Etc."
            className={inputClass}
          />
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

          {lotImages.length > 0 && (
            <div className="mb-4 space-y-2" data-testid="bw-photos">
              <div className="flex items-baseline justify-between">
                <div className="text-xs text-[#D4D4D4]">
                  Photos from BuyWander{' '}
                  <span className="text-[#6B6B6B]">
                    ({selectedUrls.length} of {lotImages.length} selected)
                  </span>
                </div>
                <div className="flex gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() => setBwSelected(lotImages.map(() => true))}
                    className="text-[#4DAB9A] hover:underline"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() => setBwSelected(lotImages.map(() => false))}
                    className="text-[#4DAB9A] hover:underline"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {lotImages.map((u, i) => {
                  const checked = !!bwSelected[i];
                  const isPrimary = checked && i === bwPrimary && bwInUse;
                  const own = u.includes('cdn.buywander.com');
                  return (
                    <div
                      key={u + i}
                      data-testid="bw-photo"
                      className={
                        'relative rounded border bg-[#252525] overflow-hidden ' +
                        (isPrimary ? 'border-[#4DAB9A]' : checked ? 'border-[#373737]' : 'border-[#2A2A2A] opacity-50')
                      }
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={u}
                        alt={urlBasename(u)}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="w-full h-24 object-cover"
                      />
                      <label className="absolute top-1 right-1 flex items-center justify-center w-5 h-5 rounded bg-[#191919]/80 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          aria-label={`Use BuyWander photo ${i + 1}`}
                          onChange={e =>
                            setBwSelected(prev => prev.map((v, j) => (j === i ? e.target.checked : v)))
                          }
                          className="w-3.5 h-3.5 shrink-0 accent-[#4DAB9A]"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setBwPrimary(i);
                          setBwSelected(prev => prev.map((v, j) => (j === i ? true : v)));
                        }}
                        aria-label={isPrimary ? `BuyWander photo ${i + 1} is the primary photo` : `Make BuyWander photo ${i + 1} the primary photo`}
                        aria-pressed={isPrimary}
                        title={isPrimary ? 'Primary photo' : 'Make primary'}
                        className={
                          'absolute top-1 left-1 w-5 h-5 flex items-center justify-center rounded bg-[#191919]/80 text-xs leading-none ' +
                          (isPrimary ? 'text-[#4DAB9A]' : 'text-[#9B9B9B] hover:text-[#D4D4D4]')
                        }
                      >
                        {isPrimary ? '★' : '☆'}
                      </button>
                      <div className="px-1 py-0.5 text-[10px] text-[#6B6B6B] truncate" title={u}>
                        {own ? 'BuyWander photo' : 'Stock photo'}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="text-xs text-[#6B6B6B]">
                BuyWander&apos;s own photos show the actual item; the rest are the retailer&apos;s stock shots.
                Uncheck any stock shot you do not want in the ad. The starred photo is the listing cover
                {bwInUse ? '' : ' (none selected, so the star in your own photos below applies)'}.
              </div>
            </div>
          )}

          {lotImages.length > 0 && (
            <div className="text-xs text-[#9B9B9B] mb-1">Add your own photos</div>
          )}
          <PhotoPicker
            uploadErrors={uploadErrors}
            onChange={(next, primary) => {
              setPhotos(next);
              setPrimaryIndex(primary);
            }}
          />
          {bwInUse && photos.length > 0 && (
            <div className="text-xs text-[#6B6B6B] mt-1">
              Your photos post after the BuyWander ones; their star is ignored while a BuyWander photo is the cover.
            </div>
          )}
        </div>

        {uploadProgress && <div className="text-xs text-[#9B9B9B]">{uploadProgress}</div>}
        {error && <div className="text-xs text-[#FF4D4D]">{error}</div>}

        {showUploadPanel && (
          <div className="rounded border border-[#373737] bg-[#252525] px-3 py-2.5 space-y-2">
            {anyFailed ? (
              <>
                {importFailed.length > 0 && (
                  <div className="text-xs text-[#FF4D4D]">
                    {importFailed.length} of {importFailed.length + importedCount} BuyWander photos failed to import.
                    <ul className="mt-1 space-y-0.5 text-[#D4A04D]">
                      {importFailed.map(f => (
                        <li key={f.url} className="truncate" title={f.url}>
                          {urlBasename(f.url)}: {f.error}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {failedEntries.length > 0 && activePlan && (
                  <div className="text-xs text-[#FF4D4D]">
                    {failedEntries.length} of {activePlan.length} of your own photos failed to upload.
                  </div>
                )}
                <div className="text-xs text-[#6B6B6B]">
                  The worker starts only once the photo set is settled. Retry the failed ones,
                  {importFailed.length > 0 ? ' continue without the failed BuyWander photos,' : ''} or
                  remove failed photos of your own above to continue without them.
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => resume(true)}
                    className="px-3 py-1.5 text-sm font-medium rounded bg-[#4DAB9A] text-[#191919] hover:bg-[#5BC0AE] transition-colors"
                  >
                    Retry failed
                  </button>
                  {importFailed.length > 0 && failedEntries.length === 0 && (
                    <button
                      type="button"
                      onClick={() => resume(false)}
                      className="px-3 py-1.5 text-sm font-medium rounded border border-[#373737] text-[#D4D4D4] hover:border-[#4DAB9A] transition-colors"
                    >
                      Continue without them
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="text-xs text-[#9B9B9B]">
                  {importedCount + uploadedCount} photo{importedCount + uploadedCount === 1 ? '' : 's'} in
                  ({importedCount} from BuyWander, {uploadedCount} uploaded). Continue to start the worker
                  with what made it.
                </div>
                <button
                  type="button"
                  onClick={() => resume(false)}
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
              disabled={submitting || (photos.length === 0 && selectedUrls.length === 0)}
              className="px-4 py-2 text-sm font-medium rounded bg-[#4DAB9A] text-[#191919] hover:bg-[#5BC0AE] transition-colors disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : 'Generate item ad'}
            </button>
            <span className="text-xs text-[#6B6B6B]">
              Queues a task ({conditionLabel.toLowerCase()}, {PLATFORMS.filter(p => platforms[p.key]).length} platform{PLATFORMS.filter(p => platforms[p.key]).length === 1 ? '' : 's'}) and starts the worker immediately. Results appear on the Tasks page within a few minutes.
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
  auction_id: string | null;
  bwsku: string | null;
  source_url: string | null;
  source_description: string | null;
  source_images: string[];
  item_title: string;
  brand: string | null;
  model: string | null;
  category: string | null;
  condition: string;
  condition_notes: string | null;
  included: string | null;
  defects: string | null;
  dimensions: string | null;
  retail_value: number | null;
  paid_usd: number | null;
  price_usd: number;
  accept_offers: boolean;
  local_pickup: boolean;
  pickup_area: string | null;
  shipping: string;
  ebay_median_sold: number | null;
  ebay_search_url: string | null;
  ebay_comp_note: string | null;
  must_include: string | null;
  platforms: string[];
  uploaded_count: number;
}): string {
  const conditionLabel = CONDITIONS.find(c => c.value === m.condition)?.label ?? m.condition;
  const shippingLabel = SHIPPING_OPTIONS.find(o => o.value === m.shipping)?.label ?? m.shipping;
  const lines: string[] = [];
  lines.push(`Generate resale ads for this item using the **generate-item-ad** workflow.`);
  lines.push('');
  lines.push('## Item facts');
  lines.push(`- Title: ${m.item_title}`);
  if (m.brand) lines.push(`- Brand: ${m.brand}`);
  if (m.model) lines.push(`- Model: ${m.model}`);
  if (m.category) lines.push(`- Category: ${m.category}`);
  lines.push(`- Condition: ${conditionLabel}`);
  if (m.condition_notes) lines.push(`- Condition notes: ${m.condition_notes}`);
  if (m.included) lines.push(`- Included: ${m.included}`);
  if (m.defects) lines.push(`- Defects or missing parts: ${m.defects}`);
  if (m.dimensions) lines.push(`- Dimensions or weight: ${m.dimensions}`);
  if (m.retail_value !== null) lines.push(`- Retail value: $${m.retail_value.toLocaleString()}`);
  if (m.paid_usd !== null) lines.push(`- Price paid (context only, never in the ad): $${m.paid_usd.toLocaleString()}`);
  lines.push(`- Asking price: $${m.price_usd.toLocaleString()}`);
  lines.push(`- Offers: ${m.accept_offers ? 'accepted' : 'firm price'}`);
  lines.push(`- Local pickup: ${m.local_pickup ? `yes, ${m.pickup_area ?? 'area not given'}` : 'no'}`);
  lines.push(`- Shipping: ${shippingLabel}`);
  if (m.must_include) lines.push(`- Must include: ${m.must_include}`);
  lines.push('');
  lines.push('## Source and comps');
  if (m.auction_id) lines.push(`- BuyWander auction: ${m.auction_id}${m.bwsku ? ` (SKU ${m.bwsku})` : ''}`);
  if (m.source_url) lines.push(`- Source URL: ${m.source_url}`);
  if (m.ebay_median_sold !== null) lines.push(`- eBay sold median: $${Math.round(m.ebay_median_sold).toLocaleString()}`);
  if (m.ebay_search_url) lines.push(`- eBay sold comps search: ${m.ebay_search_url}`);
  if (m.ebay_comp_note) lines.push(`- Comp note: ${m.ebay_comp_note}`);
  if (!m.auction_id && !m.source_url && m.ebay_median_sold === null) lines.push('- Hand-entered item, no BuyWander purchase record.');
  if (m.source_description) {
    lines.push(
      `- Source description (retailer copy): ${m.source_description.length.toLocaleString()} chars, full text in \`metadata.source_description\`. Specs only; never its marketing lines, never over the operator's condition.`,
    );
  }
  lines.push(`- Photos: ${m.source_images.length} from BuyWander (\`NN_bw-<k>.jpg\`, some may be stock shots), ${m.uploaded_count} uploaded.`);
  lines.push('');
  lines.push(`## Platforms to generate variants for`);
  lines.push(m.platforms.map(p => `- ${p}`).join('\n'));
  lines.push('');
  lines.push(`The structured form data is also on this task's \`metadata\` field; that is authoritative if it disagrees with the rendered text above.`);
  return lines.join('\n');
}
