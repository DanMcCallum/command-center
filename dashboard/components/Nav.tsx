'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/ad-builder', label: 'Ad Builder' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/roadmap', label: 'Roadmap' },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <nav className="border-b border-[#2F2F2F]">
      <div className="max-w-5xl mx-auto px-6 py-3 flex items-center gap-6">
        <Link
          href="/tasks"
          className="text-sm font-semibold tracking-wide uppercase text-white"
        >
          Command Center
        </Link>
        <div className="flex items-center gap-4 ml-2">
          {ITEMS.map(item => {
            const active = pathname === item.href || pathname?.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  'text-sm transition-colors ' +
                  (active
                    ? 'text-white font-medium'
                    : 'text-[#6B6B6B] hover:text-white')
                }
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
