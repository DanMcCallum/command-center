'use client';

import { useState } from 'react';
import {
  TASK_TYPES,
  type ClaudeModel,
  type Task,
  type TaskPriority,
} from '@/lib/types';

const PRIORITIES: TaskPriority[] = [1, 2, 3, 4, 5];
const MODELS: ClaudeModel[] = ['sonnet', 'opus', 'haiku'];

export const SLASH_COMMANDS: { value: string; label: string }[] = [
  { value: '', label: 'None' },
  { value: 'worker/generate-report', label: 'worker/generate-report' },
  { value: 'worker/summarize-doc', label: 'worker/summarize-doc' },
];

const inputClass =
  'w-full bg-[#2F2F2F] text-white border border-[#373737] rounded px-3 py-2 text-sm outline-none transition-colors focus:border-[#4DAB9A]';

const selectClass = inputClass + ' appearance-none pr-8';

interface Props {
  tasks: Task[];
  onCreated: (task: Task) => void;
  onCancel: () => void;
}

export default function TaskForm({ tasks, onCreated, onCancel }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<string>(TASK_TYPES[0]);
  const [priority, setPriority] = useState<TaskPriority>(3);
  const [model, setModel] = useState<ClaudeModel>('sonnet');
  const [tags, setTags] = useState('');
  const [criteriaText, setCriteriaText] = useState('');
  const [slashCommand, setSlashCommand] = useState('');
  const [parentTaskId, setParentTaskId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    setSubmitting(true);
    setError(null);
    const body = {
      title: title.trim(),
      description,
      type,
      priority,
      model,
      tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      acceptanceCriteria: criteriaText
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean),
      slashCommand: slashCommand || null,
      parentTaskId: parentTaskId || null,
    };
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const task = (await res.json()) as Task;
      onCreated(task);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="bg-[#202020] border border-[#373737] rounded-lg p-5 space-y-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">New task</h2>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-[#6B6B6B] hover:text-white transition-colors"
        >
          Cancel
        </button>
      </div>

      <Field label="Title">
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          className={inputClass}
          autoFocus
        />
      </Field>

      <Field label="Description">
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={4}
          className={inputClass}
          placeholder="What needs to happen. Markdown supported."
        />
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Type">
          <select
            value={type}
            onChange={e => setType(e.target.value)}
            className={selectClass}
          >
            {TASK_TYPES.map(t => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Priority">
          <select
            value={priority}
            onChange={e => setPriority(Number(e.target.value) as TaskPriority)}
            className={selectClass}
          >
            {PRIORITIES.map(p => (
              <option key={p} value={p}>
                P{p}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Model">
          <select
            value={model}
            onChange={e => setModel(e.target.value as ClaudeModel)}
            className={selectClass}
          >
            {MODELS.map(m => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Tags (comma-separated)">
        <input
          type="text"
          value={tags}
          onChange={e => setTags(e.target.value)}
          className={inputClass}
          placeholder="research, q3, needs-review"
        />
      </Field>

      <Field label="Acceptance criteria (one per line)">
        <textarea
          value={criteriaText}
          onChange={e => setCriteriaText(e.target.value)}
          rows={3}
          className={inputClass}
          placeholder={'Has 3 sections\nIncludes citations\nUnder 800 words'}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Slash command (workflow)">
          <select
            value={slashCommand}
            onChange={e => setSlashCommand(e.target.value)}
            className={selectClass}
          >
            {SLASH_COMMANDS.map(s => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Parent task (optional)">
          <select
            value={parentTaskId}
            onChange={e => setParentTaskId(e.target.value)}
            className={selectClass}
          >
            <option value="">None</option>
            {tasks.map(t => (
              <option key={t.id} value={t.id}>
                P{t.priority} · {t.title}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {error && <div className="text-xs text-[#FF4D4D]">{error}</div>}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 text-sm font-medium rounded bg-[#4DAB9A] text-[#191919] hover:bg-[#5BC0AE] transition-colors disabled:opacity-50"
        >
          {submitting ? 'Creating…' : 'Create task'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-xs font-medium rounded bg-[#2F2F2F] text-[#9B9B9B] hover:bg-[#373737] hover:text-white transition-colors"
        >
          Discard
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-[#9B9B9B] mb-1">{label}</div>
      {children}
    </label>
  );
}
