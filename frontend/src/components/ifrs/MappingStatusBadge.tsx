type Props = {
  confidence?: number;
  source?: string;
  is_confirmed?: boolean;
};

export default function MappingStatusBadge({ confidence = 0, source = "ai_suggested", is_confirmed = false }: Props) {
  if (is_confirmed || source === "user_confirmed" || source === "user_overridden") {
    return <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">Manual</span>;
  }
  const pct = Math.round((confidence || 0) * 100);
  if (pct >= 85) {
    return <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">AI ✓ {pct}%</span>;
  }
  if (pct >= 60) {
    return <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">AI {pct}%</span>;
  }
  return <span className="inline-flex rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700">⚠ Review</span>;
}

