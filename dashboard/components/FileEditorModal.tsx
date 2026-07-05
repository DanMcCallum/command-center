'use client';

import { useCallback, useEffect, useState } from 'react';

interface Props {
  filePath: string;
  onClose: () => void;
}

function toApiPath(filePath: string): string {
  const rel = filePath.match(/workers\/.+/)?.[0] ?? filePath.replace(/^\/+/, '');
  return `/api/files/${encodeURI(rel)}`;
}

export default function FileEditorModal({ filePath, onClose }: Props) {
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const apiPath = toApiPath(filePath);
  const dirty = content !== original;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiPath, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (cancelled) return;
        setContent(text);
        setOriginal(text);
        setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiPath]);

  const save = useCallback(async () => {
    if (status === 'saving') return;
    setStatus('saving');
    setError(null);
    try {
      const res = await fetch(apiPath, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: content,
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => `HTTP ${res.status}`);
        throw new Error(msg);
      }
      setOriginal(content);
      setStatus('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }, [apiPath, content, status]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [content]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      } else if (e.key === 'Escape') {
        if (dirty && !window.confirm('Discard unsaved changes?')) return;
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, onClose, dirty]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={() => {
        if (dirty && !window.confirm('Discard unsaved changes?')) return;
        onClose();
      }}
    >
      <div
        className="bg-[#191919] border border-[#2F2F2F] rounded-lg shadow-xl w-full max-w-4xl h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#2F2F2F]">
          <div className="flex-1 min-w-0">
            <div className="text-xs font-mono text-[#9B9B9B] truncate">{filePath}</div>
            <div className="text-[10px] uppercase tracking-wide text-[#6B6B6B]">
              {status === 'loading' && 'Loading…'}
              {status === 'saving' && 'Saving…'}
              {status === 'ready' && (dirty ? 'Unsaved changes · Ctrl+S to save' : 'Saved')}
              {status === 'error' && (error ?? 'Error')}
            </div>
          </div>
          <button
            type="button"
            onClick={copy}
            disabled={status === 'loading'}
            className="px-3 py-1.5 text-xs font-medium rounded bg-[#2F2F2F] text-[#9B9B9B] hover:bg-[#373737] hover:text-white transition-colors disabled:opacity-50"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={status !== 'ready' || !dirty}
            className="px-3 py-1.5 text-xs font-medium rounded bg-[#4DAB9A] text-[#191919] hover:bg-[#5BC0AE] transition-colors disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              if (dirty && !window.confirm('Discard unsaved changes?')) return;
              onClose();
            }}
            className="px-3 py-1.5 text-xs font-medium rounded text-[#9B9B9B] hover:bg-[#2F2F2F] hover:text-white transition-colors"
          >
            Close
          </button>
        </div>
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          spellCheck={false}
          disabled={status === 'loading'}
          className="flex-1 w-full resize-none bg-[#191919] text-[#D4D4D4] font-mono text-sm p-4 outline-none border-0"
        />
      </div>
    </div>
  );
}
