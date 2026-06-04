export const COUNTRIES = [
  { code: 'IN', name: 'India', currency: 'INR', standard: 'IND_AS', dateFormat: 'DD-MM-YYYY' },
  { code: 'US', name: 'United States', currency: 'USD', standard: 'US_GAAP', dateFormat: 'MM-DD-YYYY' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', standard: 'IFRS', dateFormat: 'DD-MM-YYYY' },
  { code: 'AE', name: 'UAE', currency: 'AED', standard: 'IFRS', dateFormat: 'DD-MM-YYYY' },
  { code: 'SG', name: 'Singapore', currency: 'SGD', standard: 'IFRS', dateFormat: 'DD-MM-YYYY' },
  { code: 'AU', name: 'Australia', currency: 'AUD', standard: 'IFRS', dateFormat: 'DD-MM-YYYY' },
  { code: 'CA', name: 'Canada', currency: 'CAD', standard: 'IFRS', dateFormat: 'YYYY-MM-DD' },
  { code: 'DE', name: 'Germany', currency: 'EUR', standard: 'IFRS', dateFormat: 'DD.MM.YYYY' },
  { code: 'FR', name: 'France', currency: 'EUR', standard: 'IFRS', dateFormat: 'DD/MM/YYYY' },
  { code: 'JP', name: 'Japan', currency: 'JPY', standard: 'J_GAAP', dateFormat: 'YYYY/MM/DD' },
  { code: 'SA', name: 'Saudi Arabia', currency: 'SAR', standard: 'IFRS', dateFormat: 'DD-MM-YYYY' },
  { code: 'MY', name: 'Malaysia', currency: 'MYR', standard: 'MFRS', dateFormat: 'DD-MM-YYYY' },
  { code: 'ZA', name: 'South Africa', currency: 'ZAR', standard: 'IFRS', dateFormat: 'YYYY-MM-DD' },
  { code: 'NG', name: 'Nigeria', currency: 'NGN', standard: 'IFRS', dateFormat: 'DD-MM-YYYY' },
  { code: 'KE', name: 'Kenya', currency: 'KES', standard: 'IFRS', dateFormat: 'DD-MM-YYYY' },
  { code: 'NZ', name: 'New Zealand', currency: 'NZD', standard: 'IFRS', dateFormat: 'DD-MM-YYYY' },
  { code: 'CH', name: 'Switzerland', currency: 'CHF', standard: 'IFRS', dateFormat: 'DD.MM.YYYY' },
  { code: 'BR', name: 'Brazil', currency: 'BRL', standard: 'IFRS', dateFormat: 'DD/MM/YYYY' },
  { code: 'MX', name: 'Mexico', currency: 'MXN', standard: 'IFRS', dateFormat: 'DD/MM/YYYY' },
  { code: 'PH', name: 'Philippines', currency: 'PHP', standard: 'PFRS', dateFormat: 'MM/DD/YYYY' },
] as const;

export const STANDARDS = [
  { code: 'IFRS', label: 'IFRS (International)', description: 'Used in 140+ countries' },
  { code: 'IND_AS', label: 'Ind AS (India)', description: 'Indian Accounting Standards' },
  { code: 'US_GAAP', label: 'US GAAP', description: 'United States' },
  { code: 'IGAAP', label: 'IGAAP (Indian GAAP)', description: 'Companies Act, SMEs' },
  { code: 'CASH_BASIS', label: 'Cash basis', description: 'Simple cash in / out' },
  { code: 'CUSTOM', label: 'Custom only', description: 'Your chart only, no standard fallback' },
  { code: 'J_GAAP', label: 'J-GAAP (Japan)', description: 'Japanese standards' },
  { code: 'MFRS', label: 'MFRS (Malaysia)', description: 'Malaysian standards' },
  { code: 'PFRS', label: 'PFRS (Philippines)', description: 'Philippine standards' },
] as const;

export const FY_OPTIONS = [
  { value: '01-01', label: 'Jan 1 — Dec 31 (Calendar year)' },
  { value: '04-01', label: 'Apr 1 — Mar 31 (India / UK)' },
  { value: '07-01', label: 'Jul 1 — Jun 30 (Australia)' },
  { value: '10-01', label: 'Oct 1 — Sep 30' },
] as const;

export const TIMEZONE_OPTIONS = [
  { value: 'UTC', label: 'UTC' },
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata (India)' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai (UAE)' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore' },
  { value: 'America/New_York', label: 'US Eastern' },
  { value: 'America/Chicago', label: 'US Central' },
  { value: 'America/Denver', label: 'US Mountain' },
  { value: 'America/Los_Angeles', label: 'US Pacific' },
  { value: 'Europe/London', label: 'London' },
  { value: 'Europe/Paris', label: 'Paris' },
  { value: 'Europe/Berlin', label: 'Berlin' },
  { value: 'Asia/Tokyo', label: 'Tokyo' },
  { value: 'Australia/Sydney', label: 'Sydney' },
] as const;
