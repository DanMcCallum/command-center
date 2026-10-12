'use client';

import { useEffect, useState } from 'react';
import Markdown from '@/components/Markdown';
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
        <div className="px-5 py-5 prose-roadmap"><Markdown src={todo.body} /></div>
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
