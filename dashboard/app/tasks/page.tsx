'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import PostingFailureBanner from '@/components/PostingFailureBanner';
import TaskCard from '@/components/TaskCard';
import TaskForm from '@/components/TaskForm';
import { useAgentLiveness } from '@/lib/agent-liveness';
import type { Task, TaskStatus } from '@/lib/types';

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
  const agent = useAgentLiveness();

  const load = useCallback(async () => {
    const res = await fetch('/api/tasks', { cache: 'no-store' });
    const data = (await res.json()) as Task[];
    setTasks(data);
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

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: tasks.length };
    for (const t of tasks) c[t.status] = (c[t.status] ?? 0) + 1;
    return c;
  }, [tasks]);

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
      ) : filtered.length === 0 ? (
        <div className="text-sm text-[#6B6B6B] py-12 text-center">
          {filter === 'all'
            ? 'No tasks yet. Create one to get started.'
            : `No ${filter.replace('_', ' ')} tasks.`}
        </div>
      ) : (
        <div className="border-t border-[#2F2F2F]">
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
