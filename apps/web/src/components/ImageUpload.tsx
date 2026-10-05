import { useRef, useState } from 'react';
import { IMAGE_MAX_BYTES, IMAGE_TYPES, type ImageUpload as ImageUploadBody } from '@clinic/shared';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';

/** Reads a chosen PNG/JPEG into the base64 body the API expects. */
function toUpload(file: File): Promise<ImageUploadBody> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        contentType: file.type as ImageUploadBody['contentType'],
        data: String(reader.result).split(',')[1] ?? '',
      });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function ImageUpload({
  hasImage,
  previewUrl,
  disabled,
  onUpload,
  onRemove,
}: {
  hasImage: boolean;
  previewUrl?: string | null;
  disabled?: boolean;
  onUpload: (body: ImageUploadBody) => void;
  onRemove: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      {previewUrl && hasImage && (
        <img
          src={previewUrl}
          alt=""
          className="h-14 w-auto rounded border border-border bg-white p-1"
        />
      )}
      <input
        ref={input}
        type="file"
        accept={IMAGE_TYPES.join(',')}
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          if (!(IMAGE_TYPES as readonly string[]).includes(file.type))
            return setError(t.images.wrongType);
          if (file.size > IMAGE_MAX_BYTES) return setError(t.images.tooBig);
          setError(null);
          onUpload(await toUpload(file));
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        {hasImage ? t.images.replace : t.images.upload}
      </Button>
      {hasImage && (
        <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onRemove}>
          {t.images.remove}
        </Button>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
