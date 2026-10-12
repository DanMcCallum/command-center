'use client';

import CallsPageHeader, { CallsLoadStatus } from '@/components/CallsPageHeader';
import { useCallsGet } from '@/lib/use-calls-get';
import type { TasksResponse } from '@/lib/calls-types';

function fmtDate(ts: number | null): string {
  return ts == null ? '' : new Date(ts * 1000).toLocaleDateString();
}

export default function CallsTasksPage() {
  const load = useCallsGet<TasksResponse>('/api/calls/tasks');

  return (
    <div className="space-y-8">
      <CallsPageHeader title="Open tasks" />
      <section className="space-y-3">
        <p className="text-xs text-[#6B6B6B]">
          Not Started and Working tasks from the local task index, refreshed by the sync walk. Overdue rows are tinted.
        </p>
        <CallsLoadStatus load={load} />
        {load.state === 'ok' &&
          (load.data.tasks.length === 0 ? (
            <div className="text-sm text-[#6B6B6B]" data-testid="calls-list-empty">
              No open tasks.
            </div>
          ) : (
            <table className="w-full text-sm" data-testid="calls-tasks">
              <thead>
                <tr className="text-left text-xs text-[#6B6B6B] border-b border-[#2F2F2F]">
                  <th className="py-2 pr-3 font-medium">Task</th>
                  <th className="py-2 pr-3 font-medium">Title</th>
                  <th className="py-2 pr-3 font-medium">Type</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 font-medium">Due</th>
                </tr>
              </thead>
              <tbody>
                {load.data.tasks.map(t => (
                  <tr
                    key={t.task_id}
                    className={`border-b border-[#202020] ${t.overdue ? 'bg-[#FF4D4D]/10' : ''}`}
                    data-overdue={t.overdue ? 'true' : 'false'}
                  >
                    <td className="py-2 pr-3 font-mono text-xs">{t.task_id}</td>
                    <td className="py-2 pr-3">{t.title}</td>
                    <td className="py-2 pr-3 text-[#9B9B9B]">{t.task_type}</td>
                    <td className="py-2 pr-3 text-[#9B9B9B]">{t.status}</td>
                    <td className={`py-2 whitespace-nowrap ${t.overdue ? 'text-[#FF4D4D]' : 'text-[#9B9B9B]'}`}>
                      {fmtDate(t.start_ts)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
      </section>
    </div>
  );
}
