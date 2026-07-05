import type { TaskPriority } from '@/lib/types';

export const PRIORITY_COLORS: Record<TaskPriority, string> = {
  1: '#FF4D4D',
  2: '#FF8C4D',
  3: '#FFD04D',
  4: '#4DA3D4',
  5: '#6B6B6B',
};

export default function PriorityIndicator({ priority }: { priority: TaskPriority }) {
  const color = PRIORITY_COLORS[priority];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[#9B9B9B]">
      <span
        className="rounded-full"
        style={{ width: 8, height: 8, backgroundColor: color }}
      />
      <span className="font-mono">P{priority}</span>
    </span>
  );
}
