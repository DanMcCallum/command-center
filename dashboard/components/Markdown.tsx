'use client';

import { useMemo } from 'react';

/**
 * The dashboard's small markdown renderer (headings, rules, bullet lists,
 * paragraphs, **bold**, `code`). Moved out of the Roadmap page so front
 * files render the same way.
 */
export default function Markdown({ src }: { src: string }) {
  const rendered = useMemo(() => renderMarkdown(src), [src]);
  return <>{rendered}</>;
}

export function renderMarkdown(src: string): React.ReactNode {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    const h1 = /^#\s+(.+)$/.exec(line);
    if (h1) {
      out.push(
        <h3 key={key++} className="text-xl font-semibold text-white mt-1 mb-3">
          {inline(h1[1])}
        </h3>,
      );
      i++;
      continue;
    }

    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) {
      out.push(
        <h4
          key={key++}
          className="text-sm font-semibold uppercase tracking-wide text-[#4DAB9A] mt-6 mb-2"
        >
          {inline(h2[1])}
        </h4>,
      );
      i++;
      continue;
    }

    const h3 = /^###\s+(.+)$/.exec(line);
    if (h3) {
      out.push(
        <h5
          key={key++}
          className="text-xs font-semibold uppercase tracking-wide text-[#6B6B6B] mt-4 mb-1"
        >
          {inline(h3[1])}
        </h5>,
      );
      i++;
      continue;
    }

    if (/^---\s*$/.test(line)) {
      out.push(<hr key={key++} className="my-5 border-[#2F2F2F]" />);
      i++;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ''));
        i++;
      }
      out.push(
        <ul
          key={key++}
          className="list-disc list-outside pl-5 space-y-1.5 my-3 text-sm text-[#D4D4D4]"
        >
          {items.map((it, j) => (
            <li key={j}>{inline(it)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#|---|[-*]\s)/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push(
      <p
        key={key++}
        className="text-sm text-[#D4D4D4] leading-relaxed my-3"
      >
        {inline(para.join(' '))}
      </p>,
    );
  }

  return out;
}

function inline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith('**')) {
      parts.push(
        <strong key={key++} className="font-semibold text-white">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      parts.push(
        <code
          key={key++}
          className="font-mono text-xs px-1.5 py-0.5 rounded bg-[#202020] text-[#4DAB9A]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    }
    last = m.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
