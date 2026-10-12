'use client';

import { useCallback, useEffect, useState } from 'react';

interface Props {
  title: string;
  /** Initial text; the modal is a plain textarea over PUT `saveUrl` {text}. */
  text: string;
  saveUrl: string;
  onClose: () => void;
  onSaved: () => void;
}

/** Minimal editor for a front's two markdown files. Separate from
 * FileEditorModal, which is bound to the workers/ files API. */
export default function FrontFileEditor({ title, text, saveUrl, onClose, onSaved }: Props) {
  const [content, setContent] = useState(text);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = content !== text;

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(saveUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: content }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [content, saveUrl, saving, onSaved]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void save();
      } else if (e.key === 'Escape' && !dirty) {
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, onClose, dirty]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="w-full max-w-3xl h-[80vh] flex flex-col rounded-lg border border-[#2F2F2F] bg-[#1A1A1A]">
        <header className="flex items-center justify-between px-5 py-3 border-b border-[#2F2F2F]">
          <div className="text-sm font-medium text-white">{title}</div>
          <div className="flex items-center gap-2">
            {error && <span className="text-xs text-[#D4A04D]">{error}</span>}
            <button
              type="button"
              onClick={save}
              disabled={!dirty || saving}
              className="px-3 py-1.5 text-xs font-medium rounded bg-[#4DAB9A] text-[#191919] hover:bg-[#5BC0AE] disabled:opacity-40 transition-colors"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => {
                if (dirty && !window.confirm('Discard unsaved changes?')) return;
                onClose();
              }}
              className="px-3 py-1.5 text-xs text-[#6B6B6B] hover:text-white transition-colors"
            >
              Close
            </button>
          </div>
        </header>
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          spellCheck={false}
          className="flex-1 w-full resize-none bg-[#191919] text-sm font-mono text-[#D4D4D4] p-5 outline-none"
        />
      </div>
    </div>
  );
}
