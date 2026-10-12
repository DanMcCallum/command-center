'use client';

import Link from 'next/link';
import CallsOpsStrip from '@/components/CallsOpsStrip';
import type { CallsLoad } from '@/lib/use-calls-get';

const SUBPAGES = [
  { href: '/calls/search', label: 'Search' },
  { href: '/calls/contacts', label: 'Contacts' },
  { href: '/calls/properties', label: 'Properties' },
  { href: '/calls/tasks', label: 'Tasks' },
];

/** Links to the `/calls` sub-pages, optionally led by a link back to `/calls`. */
export function CallsSubnav({ home = false }: { home?: boolean }) {
  return (
    <div className="text-xs text-[#6B6B6B] space-x-3">
      {[...(home ? [{ href: '/calls', label: 'Calls' }] : []), ...SUBPAGES].map(p => (
        <Link key={p.href} href={p.href} className="hover:text-white transition-colors">
          {p.label}
        </Link>
      ))}
    </div>
  );
}

/** Breadcrumb, title, sub-page links and the ops strip for a `/calls/*` list page. */
export default function CallsPageHeader({ title }: { title: string }) {
  return (
    <header className="space-y-3">
      <CallsSubnav home />
      <h1 className="text-3xl font-bold">{title}</h1>
      <CallsOpsStrip />
    </header>
  );
}

/** Loading and error lines for a `useCallsGet` result; renders nothing once loaded. */
export function CallsLoadStatus({ load }: { load: CallsLoad<unknown> }) {
  if (load.state === 'loading') return <div className="text-sm text-[#6B6B6B]">Loading…</div>;
  if (load.state === 'error')
    return (
      <div className="text-sm text-[#FF4D4D]" data-testid="calls-list-error">
        {load.error}
      </div>
    );
  return null;
}
