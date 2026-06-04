import { format, parse, isValid } from 'date-fns';

const FORMATS = [
  'yyyy-MM-dd',
  'dd-MM-yyyy',
  'MM/dd/yyyy',
  'dd/MM/yyyy',
  'dd.MM.yyyy',
  'yyyy/MM/dd',
  'dd MMM yyyy',
  'MMM dd, yyyy',
  'd MMMM yyyy',
] as const;

export function parseAnyDate(dateStr: string): Date | null {
  if (!dateStr || String(dateStr).trim() === '') return null;
  const s = String(dateStr).trim();

  for (const fmt of FORMATS) {
    try {
      const parsed = parse(s, fmt, new Date());
      if (isValid(parsed)) return parsed;
    } catch {
      continue;
    }
  }

  const iso = new Date(s);
  if (isValid(iso) && !Number.isNaN(iso.getTime())) return iso;

  return null;
}

/** Map company UI format tokens to date-fns pattern */
function toFnsFormat(displayFormat: string): string {
  return displayFormat
    .replace(/YYYY/g, 'yyyy')
    .replace(/DD/g, 'dd')
    .replace(/\./g, '.')
    .replace(/\//g, '/');
}

export function displayDate(dateStr: string, displayFormat: string = 'DD-MM-YYYY'): string {
  const date = parseAnyDate(dateStr);
  if (!date) return dateStr;
  try {
    const fnsFormat = toFnsFormat(displayFormat);
    return format(date, fnsFormat);
  } catch {
    return dateStr;
  }
}

export function toStorageFormat(dateStr: string): string {
  const date = parseAnyDate(dateStr);
  if (!date) return dateStr;
  return format(date, 'yyyy-MM-dd');
}

export function relativeDate(dateStr: string): string {
  const date = parseAnyDate(dateStr);
  if (!date) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const days = Math.ceil((d.getTime() - today.getTime()) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 0 && days <= 30) return `In ${days} days`;
  if (days < 0) return `${Math.abs(days)} days overdue`;
  return displayDate(dateStr);
}

