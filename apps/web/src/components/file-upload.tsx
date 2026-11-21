import { FileText, Paperclip, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { api, ApiError, fileUrl } from '@/lib/api';
import { Button } from './ui/button';

/** Uploads immediately to private storage and returns the file id. */
export function FileUpload({ value, onChange, sensitivity = 'INTERNAL', accept = 'image/jpeg,image/png,image/webp,application/pdf' }: {
  value?: string | null; onChange: (id: string | null) => void; sensitivity?: 'INTERNAL' | 'CONFIDENTIAL' | 'PERSONAL'; accept?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [name, setName] = useState<string>();
  const [busy, setBusy] = useState(false);
  const pick = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    try {
      const r = await api.upload(f, sensitivity);
      setName(r.fileName);
      onChange(r.id);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'อัปโหลดไม่สำเร็จ');
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  };
  return (
    <div className="flex items-center gap-2">
      <input ref={ref} type="file" accept={accept} hidden onChange={(e) => pick(e.target.files?.[0])} />
      <Button variant="outline" size="sm" loading={busy} onClick={() => ref.current?.click()}>
        <Paperclip /> {value ? 'เปลี่ยนไฟล์' : 'แนบไฟล์'}
      </Button>
      {value && (
        <>
          <a href={fileUrl(value)} target="_blank" rel="noreferrer" className="flex items-center gap-1 truncate text-sm text-accent hover:underline">
            <FileText className="size-4" /> {name ?? 'ดูไฟล์'}
          </a>
          <button type="button" onClick={() => onChange(null)} className="text-muted hover:text-bad" aria-label="ลบไฟล์">
            <X className="size-4" />
          </button>
        </>
      )}
      {!value && <span className="text-xs text-muted">JPG, PNG, WEBP, PDF</span>}
    </div>
  );
}

export const FileLink = ({ id, label = 'ไฟล์' }: { id?: string | null; label?: string }) =>
  id ? (
    <a href={fileUrl(id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
      <FileText className="size-3.5" /> {label}
    </a>
  ) : (
    <span className="text-muted">-</span>
  );
