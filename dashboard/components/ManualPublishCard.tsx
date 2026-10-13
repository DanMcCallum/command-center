'use client';

import { useEffect, useState } from 'react';
import type { AdPosting, Task } from '@/lib/types';

/**
 * Post-by-hand card for platforms that have no poster on purpose
 * (`manual: true` in config/posting-platforms.json, e.g. Facebook
 * Marketplace: no seller API and automated posting is against Meta's terms).
 * Shows the generated copy with copy buttons, the photos in upload order,
 * a link to the site's create form, and a box to record the live URL as a
 * posting like the automated ones.
 */

interface ManualPlatform {
  key: string;
  name: string;
  createUrl: string;
  photoCap: number | null;
  steps: string[];
}

interface Props {
  task: Task;
  onChange: () => void;
}

interface AdSections {
  headline: string;
  description: string;
}

let platformsPromise: Promise<ManualPlatform[]> | null = null;

function loadManualPlatforms(): Promise<ManualPlatform[]> {
  if (!platformsPromise) {
    platformsPromise = fetch('/api/posting-platforms', { cache: 'no-store' })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(
        (data: {
          platforms: Record<
            string,
            {
              display_name?: string;
              manual?: boolean;
              new_listing_url?: string;
              manual_photo_cap?: number;
              manual_steps?: string[];
            }
          >;
        }) =>
          Object.entries(data.platforms)
            .filter(([, cfg]) => cfg.manual === true)
            .map(([key, cfg]) => ({
              key,
              name: cfg.display_name ?? key,
              createUrl: cfg.new_listing_url ?? '',
              photoCap: typeof cfg.manual_photo_cap === 'number' ? cfg.manual_photo_cap : null,
              steps: Array.isArray(cfg.manual_steps) ? cfg.manual_steps : [],
            })),
      )
      .catch(() => {
        platformsPromise = null;
        return [];
      });
  }
  return platformsPromise;
}

/** Pulls the HEADLINE and DESCRIPTION sections out of a <platform>.md file. */
export function parseAdSections(markdown: string): AdSections | null {
  const section = (name: string): string | null => {
    const re = new RegExp(`^## ${name}\\b[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm');
    const m = markdown.match(re);
    return m ? m[1].trim() : null;
  };
  const headline = section('HEADLINE');
  const description = section('DESCRIPTION');
  if (headline === null || description === null) return null;
  return { headline, description };
}

const PHOTO_EXT = /\.(jpe?g|png|webp|gif)$/i;

/** Photos in upload order: the primary first, then the rest by name. */
export function orderPhotos(names: string[], primary: string | undefined): string[] {
  const photos = names.filter(n => PHOTO_EXT.test(n)).sort((a, b) => a.localeCompare(b));
  if (!primary) return photos;
  const idx = photos.indexOf(primary);
  if (idx <= 0) return photos;
  return [photos[idx], ...photos.slice(0, idx), ...photos.slice(idx + 1)];
}

export default function ManualPublishCard({ task, onChange }: Props) {
  const [platforms, setPlatforms] = useState<ManualPlatform[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadManualPlatforms().then(p => {
      if (!cancelled) setPlatforms(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const wanted = Array.isArray(task.metadata?.platforms)
    ? (task.metadata!.platforms as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const shown = platforms.filter(
    p => wanted.includes(p.key) || task.postings?.some(x => x.platform === p.key),
  );
  if (shown.length === 0) return null;

  return (
    <div>
      <div className="text-xs font-medium text-[#6B6B6B] uppercase tracking-wide mb-1">
        Post by hand
      </div>
      <div className="space-y-2">
        {shown.map(p => (
          <ManualPlatformPanel key={p.key} platform={p} task={task} onChange={onChange} />
        ))}
      </div>
    </div>
  );
}

function ManualPlatformPanel({
  platform,
  task,
  onChange,
}: {
  platform: ManualPlatform;
  task: Task;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [ad, setAd] = useState<AdSections | null>(null);
  const [adError, setAdError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const posting = task.postings?.find(x => x.platform === platform.key);
  const workspace = task.workspacePath;

  useEffect(() => {
    if (!open || !workspace) return;
    let cancelled = false;
    setAdError(null);
    (async () => {
      try {
        const res = await fetch(`/api/files/${encodeURI(`${workspace}/${platform.key}.md`)}`, {
          cache: 'no-store',
        });
        if (res.status === 404) {
          if (!cancelled) setAdError(`No ${platform.name} ad in this task's outputs yet (${platform.key}.md). Request a revision with the platform selected.`);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const parsed = parseAdSections(text);
        if (cancelled) return;
        if (!parsed) setAdError(`${platform.key}.md has no HEADLINE / DESCRIPTION sections.`);
        else setAd(parsed);
      } catch (e) {
        if (!cancelled) setAdError(e instanceof Error ? e.message : String(e));
      }
    })();
    (async () => {
      try {
        const res = await fetch(`/api/files/${encodeURI(`${workspace}/photos`)}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { type?: string; entries?: { name: string; type: string }[] };
        if (cancelled || data.type !== 'directory') return;
        const primary = typeof task.metadata?.primaryPhoto === 'string' ? task.metadata.primaryPhoto : undefined;
        setPhotos(orderPhotos((data.entries ?? []).filter(e => e.type === 'file').map(e => e.name), primary));
      } catch {
        /* photos are optional on the card */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, workspace, platform.key, platform.name, task.metadata?.primaryPhoto]);

  const price = typeof task.metadata?.price_usd === 'number' ? String(Math.round(task.metadata.price_usd)) : '';
  const photoList = platform.photoCap ? photos.slice(0, platform.photoCap) : photos;

  async function markPosted() {
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      setSaveError('Paste the live listing URL first (it starts with https://).');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const now = new Date().toISOString();
      const others = (task.postings ?? []).filter(x => x.platform !== platform.key);
      const record: AdPosting = {
        platform: platform.key,
        status: 'posted',
        attempts: (posting?.attempts ?? 0) + 1,
        queuedAt: posting?.queuedAt ?? now,
        postedAt: now,
        listingUrl: trimmed,
      };
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postings: [...others, record] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setUrl('');
      setOpen(false);
      onChange();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded border border-[#2F2F2F] bg-[#202020]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
        <span className="text-xs text-[#9B9B9B]">{platform.name}</span>
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="px-2.5 py-1 text-xs font-medium rounded bg-[#2F2F2F] text-[#4DAB9A] hover:bg-[#373737] transition-colors"
        >
          {open ? 'Close' : posting?.status === 'posted' ? 'Post again by hand' : 'Post by hand'}
        </button>
        {posting?.status === 'posted' && posting.listingUrl && (
          <a href={posting.listingUrl} target="_blank" rel="noreferrer" className="text-xs text-[#4DAB9A] hover:underline">
            Live listing
          </a>
        )}
      </div>
      {open && (
        <div className="px-3 pb-3 space-y-3 text-sm">
          {platform.steps.length > 0 && (
            <ol className="list-decimal pl-5 space-y-0.5 text-xs text-[#D4D4D4]">
              {platform.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          )}
          {platform.createUrl && (
            <a
              href={platform.createUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block px-2.5 py-1 text-xs font-medium rounded bg-[#4DAB9A] text-[#191919] hover:bg-[#5BC0AE] transition-colors"
            >
              Open the {platform.name} create form
            </a>
          )}
          {adError && <div className="text-xs text-[#D4A04D]">{adError}</div>}
          {ad && (
            <div className="space-y-2">
              <CopyField label="Title" value={ad.headline} />
              {price && <CopyField label="Price" value={price} />}
              <CopyField label="Description" value={ad.description} multiline />
            </div>
          )}
          {photoList.length > 0 && workspace && (
            <div>
              <div className="text-xs font-medium text-[#6B6B6B] uppercase tracking-wide mb-1">
                Photos in order{platform.photoCap && photos.length > platform.photoCap ? ` (first ${platform.photoCap} of ${photos.length})` : ''}
              </div>
              <div className="flex flex-wrap gap-2">
                {photoList.map((name, i) => (
                  <a
                    key={name}
                    href={`/api/files/${encodeURI(`${workspace}/photos/${name}`)}`}
                    target="_blank"
                    rel="noreferrer"
                    title={name}
                    className="relative block w-20 h-14 rounded overflow-hidden bg-[#2F2F2F]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/files/${encodeURI(`${workspace}/photos/${name}`)}`}
                      alt={name}
                      className="w-full h-full object-cover"
                    />
                    <span className="absolute left-1 top-1 px-1 rounded bg-black/70 text-[10px] text-white">{i + 1}</span>
                  </a>
                ))}
              </div>
              <div className="text-xs text-[#6B6B6B] mt-1">
                Photos live on this server under {workspace}/photos. Open each one and save it, or pull the folder with scp, then drag them onto the form in this order.
              </div>
            </div>
          )}
          <div className="space-y-1">
            <div className="text-xs font-medium text-[#6B6B6B] uppercase tracking-wide">
              Record the live listing
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="url"
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://www.facebook.com/marketplace/item/..."
                className="flex-1 min-w-[16rem] bg-[#2F2F2F] text-white border border-[#373737] rounded px-2 py-1 text-xs outline-none focus:border-[#4DAB9A]"
              />
              <button
                type="button"
                disabled={saving}
                onClick={markPosted}
                className="px-2.5 py-1 text-xs font-medium rounded bg-[#2F2F2F] text-[#4DAB9A] hover:bg-[#373737] transition-colors disabled:opacity-50"
              >
                Mark as posted
              </button>
            </div>
            {saveError && <div className="text-xs text-[#FF4D4D]">{saveError}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function CopyField({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* the text is selectable below as a fallback */
    }
  }
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium text-[#6B6B6B] uppercase tracking-wide">{label}</span>
        <span className="text-xs text-[#6B6B6B]">{value.length} chars</span>
        <button
          type="button"
          onClick={copy}
          className="px-2 py-0.5 text-xs font-medium rounded bg-[#2F2F2F] text-[#9B9B9B] hover:bg-[#373737] hover:text-white transition-colors"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {multiline ? (
        <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap font-sans text-xs text-[#D4D4D4] bg-[#191919] rounded p-2">
          {value}
        </pre>
      ) : (
        <div className="text-xs text-[#D4D4D4] bg-[#191919] rounded p-2 select-all">{value}</div>
      )}
    </div>
  );
}
