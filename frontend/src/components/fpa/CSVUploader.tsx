import { useRef } from 'react';
import { Upload } from 'lucide-react';
import Papa from 'papaparse';

type Props = {
  label?: string;
  onRows: (rows: Record<string, string>[]) => void;
};

/** Small CSV → row[] helper (Papa Parse). Matches FP&A “upload then map columns” pattern. */
export function CSVUploader({ label = 'Upload CSV', onRows }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          Papa.parse<Record<string, string>>(f, {
            header: true,
            skipEmptyLines: true,
            complete: (res) => {
              onRows((res.data || []).filter(Boolean));
              e.target.value = '';
            },
            error: () => {
              e.target.value = '';
            },
          });
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 hover:bg-slate-700"
      >
        <Upload className="h-4 w-4" />
        {label}
      </button>
    </>
  );
}
