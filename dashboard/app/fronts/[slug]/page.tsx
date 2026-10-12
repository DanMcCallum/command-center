'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import FrontFileEditor from '@/components/FrontFileEditor';
import FrontSuggestionCard from '@/components/FrontSuggestionCard';
import Markdown from '@/components/Markdown';
import type { FrontDetail, FrontMemoryEntry, FrontSuggestion } from '@/lib/types';
import { formatRelative } from '@/lib/utils';

type Params = { params: Promise<{ slug: string }> };

export default function FrontPage({ params }: Params) {
  const { slug } = use(params);
  const [front, setFront] = useState<FrontDetail | null>(null);
  const [suggestions, setSuggestions] = useState<FrontSuggestion[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState<'north-star' | 'now' | null>(null);
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshBaseline = useRef<string | null>(null);

  const load = useCallback(async () => {
    const [fr, sr] = await Promise.all([
      fetch(`/api/fronts/${slug}`, { cache: 'no-store' }),
      fetch(`/api/fronts/suggestions?front=${slug}&status=open`, { cache: 'no-store' }),
    ]);
    if (fr.status === 404) {
      setNotFound(true);
      return;
    }
    const detail = (await fr.json()) as FrontDetail;
    setFront(detail);
    setSuggestions(sr.ok ? ((await sr.json()) as FrontSuggestion[]) : []);
    return detail;
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  // Refresh: spawn what's-next, poll until now.md's mtime changes (or 10 min).
  useEffect(() => {
    if (!refreshing) return;
    const started = Date.now();
    const t = setInterval(async () => {
      const detail = await load();
      if (
        (detail && detail.nowUpdatedAt !== refreshBaseline.current) ||
        Date.now() - started > 10 * 60_000
      ) {
        setRefreshing(false);
      }
    }, 5000);
    return () => clearInterval(t);
  }, [refreshing, load]);

  async function refresh() {
    if (!front) return;
    refreshBaseline.current = front.nowUpdatedAt;
    const res = await fetch(`/api/fronts/${slug}/refresh`, { method: 'POST' });
    if (res.ok) setRefreshing(true);
  }

  async function copyAtPaths() {
    const text = `@fronts/${slug}/north-star.md @fronts/${slug}/now.md`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copy these paths', text);
    }
  }

  if (notFound) {
    return (
      <div className="text-sm text-[#6B6B6B]">
        Unknown front. <Link href="/fronts" className="underline">Back to fronts</Link>
      </div>
    );
  }
  if (!front) return <div className="text-sm text-[#6B6B6B]">Loading…</div>;

  const tasks = suggestions.filter(s => s.kind === 'task');
  const questions = suggestions.filter(s => s.kind === 'question');

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="text-xs text-[#6B6B6B]">
          <Link href="/fronts" className="hover:text-white transition-colors">Fronts</Link> / {front.slug}
        </div>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-3xl font-bold">{front.name}</h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={copyAtPaths}
              className="px-3 py-1.5 text-xs font-medium rounded border border-[#2F2F2F] text-[#D4D4D4] hover:text-white hover:border-[#4DAB9A] transition-colors"
              title="Paste into a new Claude session to inject both files"
            >
              {copied ? 'Copied' : 'Copy @ paths'}
            </button>
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              className="px-3 py-1.5 text-xs font-medium rounded bg-[#4DAB9A] text-[#191919] hover:bg-[#5BC0AE] disabled:opacity-50 transition-colors"
            >
              {refreshing ? 'Running what’s next…' : 'Refresh what’s next'}
            </button>
          </div>
        </div>
        <p className="text-sm text-[#6B6B6B] max-w-2xl">{front.description}</p>
      </header>

      {(tasks.length > 0 || questions.length > 0) && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[#4DAB9A]">
            Waiting on you
            <span className="ml-2 font-mono text-[#6B6B6B]">
              {tasks.length} suggestion{tasks.length === 1 ? '' : 's'}, {questions.length} question{questions.length === 1 ? '' : 's'}
            </span>
          </h2>
          <div className="border-t border-[#2F2F2F]">
            {questions.map(s => (
              <FrontSuggestionCard key={s.id} suggestion={s} onChanged={load} />
            ))}
            {tasks.map(s => (
              <FrontSuggestionCard key={s.id} suggestion={s} onChanged={load} />
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <FilePanel
          title="now.md"
          subtitle={front.nowUpdatedAt ? `updated ${formatRelative(front.nowUpdatedAt)}` : 'not written yet'}
          text={front.now}
          onEdit={() => setEditing('now')}
          empty="The what's-next pass writes this after each routed session."
        />
        <FilePanel
          title="north-star.md"
          subtitle={
            front.northStarIsTodo
              ? 'TODO: hand-write this'
              : front.northStarUpdatedAt
                ? `edited ${formatRelative(front.northStarUpdatedAt)}`
                : ''
          }
          warn={front.northStarIsTodo}
          text={front.northStar}
          onEdit={() => setEditing('north-star')}
          empty="Write the north star by hand: what this is, what good looks like, references, boundaries."
        />
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#6B6B6B]">Recent sessions</h2>
        {front.recentSessions.length === 0 ? (
          <div className="text-sm text-[#6B6B6B]">No sessions routed here yet.</div>
        ) : (
          <div className="border border-[#2F2F2F] rounded-lg divide-y divide-[#2F2F2F] bg-[#1A1A1A]">
            {front.recentSessions.map(e => (
              <SessionRow key={e.file} entry={e} />
            ))}
          </div>
        )}
      </section>

      {editing && (
        <FrontFileEditor
          title={`${front.name}: ${editing}.md`}
          text={editing === 'now' ? front.now : front.northStar}
          saveUrl={`/api/fronts/${slug}/${editing}`}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function FilePanel({
  title,
  subtitle,
  text,
  onEdit,
  empty,
  warn,
}: {
  title: string;
  subtitle: string;
  text: string;
  onEdit: () => void;
  empty: string;
  warn?: boolean;
}) {
  return (
    <section className="border border-[#2F2F2F] rounded-lg bg-[#1A1A1A] overflow-hidden">
      <header className="px-5 py-3 flex items-center justify-between gap-3 border-b border-[#2F2F2F]">
        <div className="min-w-0">
          <div className="text-sm font-medium text-white font-mono">{title}</div>
          <div className="text-xs" style={{ color: warn ? '#D4A04D' : '#6B6B6B' }}>{subtitle}</div>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="text-xs font-medium text-[#6B6B6B] hover:text-white transition-colors px-2 py-1 rounded hover:bg-[#202020]"
        >
          Edit
        </button>
      </header>
      <div className="px-5 py-4 prose-roadmap">
        {text.trim() ? <Markdown src={text} /> : <p className="text-sm text-[#6B6B6B]">{empty}</p>}
      </div>
    </section>
  );
}

function SessionRow({ entry }: { entry: FrontMemoryEntry }) {
  const [open, setOpen] = useState(false);
  const firstLine = entry.summary.split('\n').find(l => l.trim() && !l.startsWith('#')) ?? '';
  const when = entry.endedAt ?? entry.startedAt;
  return (
    <div className="px-5 py-3">
      <button type="button" onClick={() => setOpen(v => !v)} className="w-full text-left space-y-1">
        <div className="flex items-center gap-3 text-xs text-[#6B6B6B] font-mono">
          <span>{when ? formatRelative(when) : entry.file}</span>
          {entry.cwd && <span className="truncate">{entry.cwd.split('/').pop()}</span>}
          {entry.fronts.length > 1 && <span>also: {entry.fronts.filter(f => f !== entry.file).join(', ')}</span>}
        </div>
        <div className="text-sm text-[#D4D4D4]">{open ? '' : firstLine}</div>
      </button>
      {open && (
        <div className="mt-2 prose-roadmap">
          <Markdown src={entry.summary} />
          <div className="text-xs text-[#6B6B6B] font-mono mt-2">fronts/memory/{entry.file}</div>
        </div>
      )}
    </div>
  );
}
