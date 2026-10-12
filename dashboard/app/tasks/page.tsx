'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import FrontSuggestionCard from '@/components/FrontSuggestionCard';
import FrontsStrip from '@/components/FrontsStrip';
import PostingFailureBanner from '@/components/PostingFailureBanner';
import TaskCard from '@/components/TaskCard';
import TaskForm from '@/components/TaskForm';
import { useAgentLiveness } from '@/lib/agent-liveness';
import type { FrontSuggestion, FrontSummary, Task, TaskStatus } from '@/lib/types';

type Filter = 'all' | TaskStatus;

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'needs_review', label: 'Needs review' },
  { value: 'completed', label: 'Completed' },
];

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [showForm, setShowForm] = useState(false);
  const [fronts, setFronts] = useState<FrontSummary[]>([]);
  const [frontItems, setFrontItems] = useState<FrontSuggestion[]>([]);
  const agent = useAgentLiveness();

  const load = useCallback(async () => {
    const [tr, fr, sr] = await Promise.all([
      fetch('/api/tasks', { cache: 'no-store' }),
      fetch('/api/fronts', { cache: 'no-store' }).catch(() => null),
      fetch('/api/fronts/suggestions?status=open', { cache: 'no-store' }).catch(() => null),
    ]);
    const data = (await tr.json()) as Task[];
    setTasks(data);
    if (fr?.ok) setFronts((await fr.json()) as FrontSummary[]);
    if (sr?.ok) setFrontItems((await sr.json()) as FrontSuggestion[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === 'all') return tasks;
    return tasks.filter(t => t.status === filter);
  }, [tasks, filter]);

  const titleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tasks) map.set(t.id, t.title);
    return map;
  }, [tasks]);

  const frontNameBySlug = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of fronts) map.set(f.slug, f.name);
    return map;
  }, [fronts]);

  // Open front suggestions and questions count toward Needs review (they are
  // not tasks, so "All" leaves them out).
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: tasks.length };
    for (const t of tasks) c[t.status] = (c[t.status] ?? 0) + 1;
    c.needs_review = (c.needs_review ?? 0) + frontItems.length;
    return c;
  }, [tasks, frontItems]);

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold">Tasks</h1>
          {agent.online !== null && (
            <span
              className="inline-flex items-center gap-1.5 text-xs text-[#6B6B6B]"
              title={
                agent.lastSeenAt
                  ? `Agent last seen ${new Date(agent.lastSeenAt).toLocaleString()}`
                  : 'Agent has never checked in'
              }
            >
              <span
                className={
                  'w-2 h-2 rounded-full ' +
                  (agent.online ? 'bg-[#4DAB9A]' : 'bg-[#D4A04D]')
                }
              />
              Poster agent {agent.online ? 'online' : 'offline'}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowForm(v => !v)}
          className="px-4 py-2 text-sm font-medium rounded bg-[#4DAB9A] text-[#191919] hover:bg-[#5BC0AE] transition-colors"
        >
          {showForm ? 'Close' : '+ New task'}
        </button>
      </header>

      <PostingFailureBanner tasks={tasks} />
      <FrontsStrip fronts={fronts} />

      {showForm && (
        <TaskForm
          tasks={tasks}
          onCancel={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      <div className="flex items-center gap-1 border-b border-[#2F2F2F] pb-2">
        {FILTERS.map(f => {
          const active = filter === f.value;
          const count = counts[f.value] ?? 0;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={
                'px-3 py-1.5 text-xs font-medium rounded transition-colors ' +
                (active
                  ? 'bg-[#2F2F2F] text-white'
                  : 'text-[#6B6B6B] hover:text-white hover:bg-[#202020]')
              }
            >
              {f.label}
              <span className="ml-1.5 text-[#6B6B6B] font-mono">{count}</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="text-sm text-[#6B6B6B]">Loading…</div>
      ) : filtered.length === 0 && !(filter === 'needs_review' && frontItems.length > 0) ? (
        <div className="text-sm text-[#6B6B6B] py-12 text-center">
          {filter === 'all'
            ? 'No tasks yet. Create one to get started.'
            : `No ${filter.replace('_', ' ')} tasks.`}
        </div>
      ) : (
        <div className="border-t border-[#2F2F2F]">
          {filter === 'needs_review' &&
            frontItems.map(s => (
              <FrontSuggestionCard
                key={s.id}
                suggestion={s}
                frontName={frontNameBySlug.get(s.frontSlug)}
                onChanged={load}
              />
            ))}
          {filtered.map(t => (
            <TaskCard
              key={t.id}
              task={t}
              parentTitle={
                t.parentTaskId ? titleById.get(t.parentTaskId) : undefined
              }
              onChange={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}
