'use client';

import { useEffect, useState } from 'react';
import type { Task } from '@/lib/types';
import { formatRelative } from '@/lib/utils';
import FileEditorModal from './FileEditorModal';
import PostingChips from './PostingChips';
import PublishButtons from './PublishButtons';
import PriorityIndicator from './PriorityIndicator';
import SaveToKbModal from './SaveToKbModal';
import StatusBadge from './StatusBadge';

interface Props {
  task: Task;
  parentTitle?: string;
  onChange: () => void;
}

interface WorkspaceEntry {
  name: string;
  type: 'file' | 'directory';
}

function sortEntries(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  const score = (e: WorkspaceEntry): number => {
    if (e.type === 'directory') return 3;
    const lower = e.name.toLowerCase();
    if (lower === 'readme.md') return 0;
    if (lower.endsWith('.md')) return 1;
    return 2;
  };
  return [...entries].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    if (sa !== sb) return sa - sb;
    return a.name.localeCompare(b.name);
  });
}

export default function TaskCard({ task, parentTitle, onChange }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [savingToKb, setSavingToKb] = useState(false);
  const [entries, setEntries] = useState<WorkspaceEntry[] | null>(null);
  const [entriesError, setEntriesError] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded || !task.workspacePath) return;
    let cancelled = false;
    setEntriesError(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/files/${encodeURI(task.workspacePath!)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.type === 'directory') {
          setEntries(sortEntries(data.entries ?? []));
        } else {
          setEntries(null);
        }
      } catch (e) {
        if (cancelled) return;
        setEntriesError(e instanceof Error ? e.message : String(e));
        setEntries(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded, task.workspacePath, task.updatedAt]);

  const isAdBuilderTask =
    task.slashCommand === 'generate-ad' || task.tags.includes('ad-builder');

  async function patch(updates: Partial<Task>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    await patch({
      status: 'completed',
      completedAt: new Date().toISOString(),
    });
  }

  async function requestRevision() {
    const note = window.prompt('Revision feedback for Claude:');
    if (!note) return;
    await patch({
      status: 'pending',
      claudeNotes: `[REVISION REQUESTED] ${note}`,
      captainNotes: note,
    });
  }

  async function reopen() {
    await patch({ status: 'pending', completedAt: null });
  }

  async function destroy() {
    if (!window.confirm(`Delete task "${task.title}"?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-b border-[#2F2F2F]">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full text-left flex items-center gap-4 px-3 py-3 hover:bg-[#202020] transition-colors"
      >
        <PriorityIndicator priority={task.priority} />
        <StatusBadge status={task.status} />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-white truncate">{task.title}</div>
          <div className="text-xs text-[#6B6B6B] truncate">
            {task.type}
            {task.tags.length > 0 && ` · ${task.tags.join(', ')}`}
            {parentTitle && ` · child of "${parentTitle}"`}
          </div>
        </div>
        <div className="text-xs text-[#6B6B6B] font-mono">
          {formatRelative(task.updatedAt)}
        </div>
        <ChevronIcon rotated={expanded} />
      </button>

      {task.postings && task.postings.length > 0 && (
        <div className="px-3 pb-3 -mt-1">
          <PostingChips task={task} onChange={onChange} />
        </div>
      )}

      {expanded && (
        <div className="px-3 pb-4 pt-1 space-y-3 text-sm">
          {task.description && (
            <Section label="Description">
              <pre className="whitespace-pre-wrap font-sans text-[#D4D4D4]">
                {task.description}
              </pre>
            </Section>
          )}

          {task.acceptanceCriteria.length > 0 && (
            <Section label="Acceptance criteria">
              <ul className="list-disc pl-5 text-[#D4D4D4] space-y-0.5">
                {task.acceptanceCriteria.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </Section>
          )}

          {task.slashCommand && (
            <Section label="Workflow">
              <code className="text-xs font-mono text-[#9B9B9B]">
                {task.slashCommand}
              </code>
            </Section>
          )}

          {task.claudeNotes && (
            <Section label="Claude notes">
              <pre className="whitespace-pre-wrap font-sans text-[#D4D4D4]">
                {task.claudeNotes}
              </pre>
            </Section>
          )}

          {task.captainNotes && (
            <Section label="Captain notes">
              <pre className="whitespace-pre-wrap font-sans text-[#D4D4D4]">
                {task.captainNotes}
              </pre>
            </Section>
          )}

          {(entries && entries.length > 0) || task.completionFile ? (
            <Section label="Outputs">
              {entries && entries.length > 0 ? (
                <ul className="space-y-1">
                  {entries.map(e => {
                    const fullPath = `${task.workspacePath}/${e.name}`;
                    const isPrimary =
                      task.completionFile &&
                      task.completionFile.endsWith(`/${e.name}`);
                    if (e.type === 'directory') {
                      return (
                        <li
                          key={e.name}
                          className="text-xs font-mono text-[#6B6B6B]"
                        >
                          {e.name}/
                        </li>
                      );
                    }
                    return (
                      <li key={e.name}>
                        <button
                          type="button"
                          onClick={() => setEditingFile(fullPath)}
                          className="text-xs font-mono text-[#4DAB9A] hover:underline text-left"
                        >
                          {e.name}
                          {isPrimary && (
                            <span className="ml-2 text-[10px] uppercase tracking-wide text-[#6B6B6B] font-sans">
                              primary
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : task.completionFile ? (
                <button
                  type="button"
                  onClick={() => setEditingFile(task.completionFile!)}
                  className="text-xs font-mono text-[#4DAB9A] hover:underline text-left"
                >
                  {task.completionFile}
                </button>
              ) : null}
              {entriesError && (
                <div className="text-xs text-[#FF4D4D] mt-2">
                  Couldn&apos;t list workspace: {entriesError}
                </div>
              )}
            </Section>
          ) : null}

          {isAdBuilderTask && (
            <PublishButtons task={task} onChange={onChange} />
          )}

          <div className="flex items-center gap-2 pt-2">
            {task.status === 'needs_review' && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={approve}
                  className="px-3 py-1.5 text-xs font-medium rounded bg-[#4DAB9A] text-[#191919] hover:bg-[#5BC0AE] transition-colors disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={requestRevision}
                  className="px-3 py-1.5 text-xs font-medium rounded bg-[#2F2F2F] text-[#9B9B9B] hover:bg-[#373737] hover:text-white transition-colors disabled:opacity-50"
                >
                  Request revision
                </button>
              </>
            )}
            {isAdBuilderTask &&
              (task.status === 'needs_review' || task.status === 'completed') && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setSavingToKb(true)}
                  className="px-3 py-1.5 text-xs font-medium rounded bg-[#2F2F2F] text-[#4DAB9A] hover:bg-[#373737] transition-colors disabled:opacity-50"
                  title="Save the as-posted version of this ad to the knowledge base for future generations to learn from."
                >
                  Save to KB
                </button>
              )}
            {task.status === 'completed' && (
              <button
                type="button"
                disabled={busy}
                onClick={reopen}
                className="px-3 py-1.5 text-xs font-medium rounded bg-[#2F2F2F] text-[#9B9B9B] hover:bg-[#373737] hover:text-white transition-colors disabled:opacity-50"
              >
                Reopen
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={destroy}
              className="px-3 py-1.5 text-xs font-medium rounded text-[#9B9B9B] hover:bg-[#FF4D4D20] hover:text-[#FF4D4D] transition-colors disabled:opacity-50 ml-auto"
            >
              Delete
            </button>
          </div>

          <div className="text-xs font-mono text-[#6B6B6B] pt-1">
            id: {task.id} · created {formatRelative(task.createdAt)}
            {task.startedAt && ` · started ${formatRelative(task.startedAt)}`}
            {task.completedAt && ` · completed ${formatRelative(task.completedAt)}`}
          </div>
        </div>
      )}

      {editingFile && (
        <FileEditorModal
          filePath={editingFile}
          onClose={() => setEditingFile(null)}
        />
      )}

      {savingToKb && (
        <SaveToKbModal
          task={task}
          onClose={() => setSavingToKb(false)}
          onSaved={onChange}
        />
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium text-[#6B6B6B] uppercase tracking-wide mb-1">
        {label}
      </div>
      {children}
    </div>
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
        'w-4 h-4 text-[#6B6B6B] transition-transform ' +
        (rotated ? 'rotate-180' : '')
      }
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}
