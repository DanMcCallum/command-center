'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Task } from '@/lib/types';

interface Props {
  task: Task;
  onClose: () => void;
}

interface ListingPayload {
  headline: string;
  headlineMax: number;
  itemSpecifics: { key: string; value: string }[];
  html: string;
  previewHtml: string;
  images: { file: string; url: string }[];
  areaImages: { file: string; url: string }[];
  areaSlug: string | null;
  imageBaseUrl: string | null;
  hosting: { configured: boolean; ok: boolean; status: number | null; url: string | null; error?: string };
}

const EBAY_SELL_URL = 'https://www.ebay.com/sl/sell';

/**
 * Copies `text` as plain text and, when the browser supports it, also as
 * text/html so a paste into a rich editor keeps the formatting. eBay's
 * description editor takes the plain-text source in its HTML view, which is
 * the documented path; the text/html flavor is a convenience for other
 * editors.
 */
async function copyHtml(html: string): Promise<void> {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([html], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ]);
      return;
    } catch {
      /* fall through to plain text */
    }
  }
  await navigator.clipboard.writeText(html);
}

export default function EbayListingModal({ task, onClose }: Props) {
  const [data, setData] = useState<ListingPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tasks/${task.id}/ebay-listing`, { cache: 'no-store' });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
        setData(body as ListingPayload);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [task.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const flash = useCallback((what: string) => {
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  }, []);

  const copyText = useCallback(
    async (what: string, text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        flash(what);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [flash],
  );

  const copyListingHtml = useCallback(async () => {
    if (!data) return;
    try {
      await copyHtml(data.html);
      flash('html');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [data, flash]);

  const specificsText = data
    ? data.itemSpecifics.map(s => `${s.key}: ${s.value}`).join('\n')
    : '';

  const btn =
    'px-3 py-1.5 text-xs font-medium rounded transition-colors disabled:opacity-50 ';
  const btnPrimary = btn + 'bg-[#4DAB9A] text-[#191919] hover:bg-[#5BC0AE]';
  const btnMuted = btn + 'bg-[#2F2F2F] text-[#9B9B9B] hover:bg-[#373737] hover:text-white';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#191919] border border-[#2F2F2F] rounded-lg shadow-xl w-full max-w-6xl h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#2F2F2F]">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-white truncate">eBay listing HTML</div>
            <div className="text-[10px] uppercase tracking-wide text-[#6B6B6B] truncate">
              {task.workspacePath}/ebay.md
            </div>
          </div>
          <a
            href={EBAY_SELL_URL}
            target="_blank"
            rel="noreferrer"
            className={btnMuted}
          >
            Open eBay sell form
          </a>
          <button type="button" onClick={onClose} className={btnMuted}>
            Close
          </button>
        </div>

        {error && (
          <div className="px-4 py-2 text-xs text-[#FF4D4D] border-b border-[#2F2F2F]">{error}</div>
        )}

        {!data && !error && (
          <div className="p-6 text-xs text-[#6B6B6B]">Rendering listing and resizing photos…</div>
        )}

        {data && (
          <div className="flex-1 min-h-0 flex">
            <div className="w-80 shrink-0 border-r border-[#2F2F2F] p-4 space-y-4 overflow-y-auto text-xs">
              <Field label={`1. Title (${data.headline.length}/${data.headlineMax})`}>
                <div className="font-mono text-[#D4D4D4] break-words">{data.headline}</div>
                <button
                  type="button"
                  className={btnMuted + ' mt-2'}
                  onClick={() => copyText('title', data.headline)}
                >
                  {copied === 'title' ? 'Copied' : 'Copy title'}
                </button>
              </Field>

              <Field label="2. Item specifics">
                <ul className="space-y-0.5 text-[#D4D4D4]">
                  {data.itemSpecifics.map(s => (
                    <li key={s.key}>
                      <span className="text-[#6B6B6B]">{s.key}:</span> {s.value}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className={btnMuted + ' mt-2'}
                  onClick={() => copyText('specifics', specificsText)}
                >
                  {copied === 'specifics' ? 'Copied' : 'Copy specifics'}
                </button>
              </Field>

              <Field label="3. Description">
                <p className="text-[#9B9B9B] leading-relaxed">
                  In the eBay description editor click the HTML toggle
                  (<span className="font-mono">&lt;/&gt;</span>), paste, then switch back to
                  Standard to check it. {data.html.length.toLocaleString()} characters.
                </p>
                <button type="button" className={btnPrimary + ' mt-2'} onClick={copyListingHtml}>
                  {copied === 'html' ? 'Copied' : 'Copy description HTML'}
                </button>
              </Field>

              <Field label="4. Photos">
                <p className="text-[#9B9B9B] leading-relaxed">
                  Upload the originals from <span className="font-mono">photos/</span> to eBay&apos;s
                  gallery (up to 24). The description embeds {data.images.length} web-size
                  copies
                  {data.areaImages.length > 0 && (
                    <> plus {data.areaImages.length} area photos ({data.areaSlug})</>
                  )}{' '}
                  from <span className="font-mono">ebay-images/</span>.
                </p>
                <HostingStatus hosting={data.hosting} baseUrl={data.imageBaseUrl} />
              </Field>
            </div>

            <div className="flex-1 min-w-0 bg-white">
              <iframe
                title="eBay listing preview"
                srcDoc={`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#fff;">${data.previewHtml}</body></html>`}
                sandbox=""
                className="w-full h-full border-0"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function HostingStatus({
  hosting,
  baseUrl,
}: {
  hosting: ListingPayload['hosting'];
  baseUrl: string | null;
}) {
  if (!hosting.configured) {
    return (
      <div className="mt-2 text-[#FFB020]">
        No image_base_url in config/ad-platforms.json (ebay). The pasted HTML has no
        usable image URLs until it is set.
      </div>
    );
  }
  if (hosting.ok) {
    return (
      <div className="mt-2 text-[#4DAB9A]">
        Image host reachable: <span className="font-mono break-all">{baseUrl}</span>
      </div>
    );
  }
  return (
    <div className="mt-2 text-[#FFB020]">
      Image host not reachable yet ({hosting.status ?? hosting.error ?? 'no response'}).
      eBay will show broken images until <span className="font-mono break-all">{baseUrl}</span> serves
      this task&apos;s <span className="font-mono">ebay-images/</span> folder publicly. The
      preview on the right uses dashboard-local copies, so it still renders.
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-medium text-[#6B6B6B] uppercase tracking-wide mb-1">
        {label}
      </div>
      {children}
    </div>
  );
}
