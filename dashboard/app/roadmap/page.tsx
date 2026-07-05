'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Todo } from '@/lib/types';
import { formatRelative } from '@/lib/utils';

export default function RoadmapPage() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/todos', { cache: 'no-store' })
      .then(r => r.json())
      .then((data: Todo[]) => {
        setTodos(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-3xl font-bold">Roadmap</h1>
          {!loading && (
            <span className="text-sm font-mono text-[#6B6B6B]">
              {todos.length} {todos.length === 1 ? 'item' : 'items'}
            </span>
          )}
        </div>
        <p className="text-sm text-[#6B6B6B] max-w-2xl">
          Future ideas and feature work for the command center. Each item is a
          ready-to-run prompt — open one to read the full brief, or copy it
          into a new task when you&apos;re ready to build.
        </p>
      </header>

      {loading ? (
        <div className="text-sm text-[#6B6B6B]">Loading…</div>
      ) : todos.length === 0 ? (
        <div className="border border-dashed border-[#2F2F2F] rounded-lg py-16 text-center">
          <div className="text-sm text-[#6B6B6B]">
            No roadmap items yet. Add one to{' '}
            <code className="font-mono text-[#D4D4D4]">data/todos.json</code>.
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {todos.map(todo => (
            <RoadmapCard key={todo.id} todo={todo} />
          ))}
        </div>
      )}
    </div>
  );
}

function RoadmapCard({ todo }: { todo: Todo }) {
  const [expanded, setExpanded] = useState(true);
  const rendered = useMemo(() => renderMarkdown(todo.body), [todo.body]);

  return (
    <article className="border border-[#2F2F2F] rounded-lg overflow-hidden bg-[#1A1A1A]">
      <header className="px-5 py-4 flex items-start justify-between gap-4 border-b border-[#2F2F2F]">
        <div className="min-w-0 space-y-1">
          <h2 className="text-lg font-semibold text-white truncate">
            {todo.title}
          </h2>
          <div className="text-xs text-[#6B6B6B] font-mono">
            added {formatRelative(todo.createdAt)}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1.5 text-xs font-medium text-[#6B6B6B] hover:text-white transition-colors flex-shrink-0 px-2 py-1 rounded hover:bg-[#202020]"
        >
          {expanded ? 'Collapse' : 'Expand'}
          <ChevronIcon rotated={expanded} />
        </button>
      </header>

      {expanded && (
        <div className="px-5 py-5 prose-roadmap">{rendered}</div>
      )}
    </article>
  );
}

function ChevronIcon({ rotated }: { rotated: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className={
        'w-3.5 h-3.5 transition-transform flex-shrink-0 ' +
        (rotated ? 'rotate-180' : '')
      }
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function renderMarkdown(src: string): React.ReactNode {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    const h1 = /^#\s+(.+)$/.exec(line);
    if (h1) {
      out.push(
        <h3 key={key++} className="text-xl font-semibold text-white mt-1 mb-3">
          {inline(h1[1])}
        </h3>,
      );
      i++;
      continue;
    }

    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) {
      out.push(
        <h4
          key={key++}
          className="text-sm font-semibold uppercase tracking-wide text-[#4DAB9A] mt-6 mb-2"
        >
          {inline(h2[1])}
        </h4>,
      );
      i++;
      continue;
    }

    const h3 = /^###\s+(.+)$/.exec(line);
    if (h3) {
      out.push(
        <h5
          key={key++}
          className="text-xs font-semibold uppercase tracking-wide text-[#6B6B6B] mt-4 mb-1"
        >
          {inline(h3[1])}
        </h5>,
      );
      i++;
      continue;
    }

    if (/^---\s*$/.test(line)) {
      out.push(<hr key={key++} className="my-5 border-[#2F2F2F]" />);
      i++;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ''));
        i++;
      }
      out.push(
        <ul
          key={key++}
          className="list-disc list-outside pl-5 space-y-1.5 my-3 text-sm text-[#D4D4D4]"
        >
          {items.map((it, j) => (
            <li key={j}>{inline(it)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#|---|[-*]\s)/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push(
      <p
        key={key++}
        className="text-sm text-[#D4D4D4] leading-relaxed my-3"
      >
        {inline(para.join(' '))}
      </p>,
    );
  }

  return out;
}

function inline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith('**')) {
      parts.push(
        <strong key={key++} className="font-semibold text-white">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      parts.push(
        <code
          key={key++}
          className="font-mono text-xs px-1.5 py-0.5 rounded bg-[#202020] text-[#4DAB9A]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    }
    last = m.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
