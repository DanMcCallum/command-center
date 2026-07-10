'use client';

import { useEffect, useRef, useState } from 'react';

export interface PickedPhoto {
  id: string;
  file: File;
  url: string;
}

const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
const MAX_SIZE_BYTES = 15 * 1024 * 1024;

export default function PhotoPicker({
  onChange,
}: {
  onChange: (photos: PickedPhoto[]) => void;
}) {
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [rejections, setRejections] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);

  const photosRef = useRef(photos);
  photosRef.current = photos;
  useEffect(
    () => () => {
      photosRef.current.forEach(p => URL.revokeObjectURL(p.url));
    },
    [],
  );

  function update(next: PickedPhoto[]) {
    setPhotos(next);
    onChange(next);
  }

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const errors: string[] = [];
    const added: PickedPhoto[] = [];
    for (const file of Array.from(list)) {
      const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        errors.push(`${file.name}: unsupported file type (allowed: jpg, jpeg, png, webp, gif)`);
        continue;
      }
      if (file.size > MAX_SIZE_BYTES) {
        errors.push(`${file.name}: larger than 15 MB`);
        continue;
      }
      added.push({
        id: `photo-${nextId.current++}`,
        file,
        url: URL.createObjectURL(file),
      });
    }
    setRejections(errors);
    if (added.length > 0) update([...photos, ...added]);
    // Reset so picking the same file again re-fires onChange.
    if (inputRef.current) inputRef.current.value = '';
  }

  function remove(id: string) {
    const target = photos.find(p => p.id === id);
    if (target) URL.revokeObjectURL(target.url);
    update(photos.filter(p => p.id !== id));
  }

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        className="hidden"
        onChange={e => addFiles(e.target.files)}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="px-3 py-1.5 text-sm rounded border border-[#373737] bg-transparent text-[#D4D4D4] hover:border-[#4DAB9A] transition-colors"
      >
        Add photos
      </button>

      {rejections.length > 0 && (
        <div className="space-y-1">
          {rejections.map((msg, i) => (
            <div key={i} className="text-xs text-[#FF4D4D]">
              {msg}
            </div>
          ))}
        </div>
      )}

      {photos.length > 0 ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
          {photos.map(p => (
            <div
              key={p.id}
              className="relative rounded border border-[#373737] bg-[#252525] overflow-hidden"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={p.file.name} className="w-full aspect-square object-cover" />
              <button
                type="button"
                onClick={() => remove(p.id)}
                aria-label={`Remove ${p.file.name}`}
                className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded bg-[#191919]/80 text-[#D4D4D4] text-xs leading-none hover:text-white"
              >
                ×
              </button>
              <div className="px-1.5 py-1 text-xs text-[#9B9B9B] truncate" title={p.file.name}>
                {p.file.name}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-[#D4A04D]">At least 1 photo is required.</div>
      )}
    </div>
  );
}
