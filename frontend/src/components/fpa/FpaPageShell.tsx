import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const shell = {
  bg: '#0F172A',
  card: '#1E293B',
  border: '#334155',
  text: '#F8FAFC',
  muted: '#94A3B8',
};

export function FpaPageShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen" style={{ background: shell.bg, color: shell.text }}>
      <div className="border-b px-6 py-4" style={{ borderColor: shell.border }}>
        <div className="mx-auto flex max-w-6xl items-center gap-4">
          <button
            type="button"
            onClick={() => navigate('/fpa')}
            className="rounded-lg p-2 hover:bg-white/5"
            aria-label="Back to FP&A Suite"
          >
            <ArrowLeft className="h-5 w-5" style={{ color: shell.muted }} />
          </button>
          <div>
            <h1 className="text-2xl font-bold">{title}</h1>
            {subtitle ? (
              <p className="mt-1 text-sm" style={{ color: shell.muted }}>
                {subtitle}
              </p>
            ) : null}
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-6 py-6">{children}</div>
    </div>
  );
}
