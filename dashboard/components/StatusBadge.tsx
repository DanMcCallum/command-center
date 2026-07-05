import type { TaskStatus } from '@/lib/types';

export const STATUS_COLORS: Record<TaskStatus, { color: string; label: string }> = {
  pending: { color: '#6B6B6B', label: 'Pending' },
  in_progress: { color: '#4DA3D4', label: 'In progress' },
  needs_review: { color: '#D4A04D', label: 'Needs review' },
  completed: { color: '#4DAB9A', label: 'Completed' },
};

export default function StatusBadge({ status }: { status: TaskStatus }) {
  const { color, label } = STATUS_COLORS[status];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 text-xs rounded-full"
      style={{ backgroundColor: `${color}20`, color }}
    >
      {label}
    </span>
  );
}
