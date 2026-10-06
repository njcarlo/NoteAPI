import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

export interface FileBody<T extends string> {
  fileName: string;
  contentType: T;
  data: string;
}

/** A button that reads one chosen file into the base64 JSON body the API expects. */
export function FileUpload<T extends string>({
  accept,
  maxBytes,
  label,
  tooBig,
  wrongType,
  disabled,
  onFile,
}: {
  accept: readonly T[];
  maxBytes: number;
  label: string;
  tooBig: string;
  wrongType: string;
  disabled?: boolean;
  onFile: (body: FileBody<T>) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={accept.join(',')}
        className="hidden"
        data-testid="file-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          if (!(accept as readonly string[]).includes(file.type)) return setError(wrongType);
          if (file.size > maxBytes) return setError(tooBig);
          setError(null);
          const reader = new FileReader();
          reader.onload = () =>
            onFile({
              fileName: file.name,
              contentType: file.type as T,
              data: String(reader.result).split(',')[1] ?? '',
            });
          reader.readAsDataURL(file);
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <Upload />
        {label}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </>
  );
}
