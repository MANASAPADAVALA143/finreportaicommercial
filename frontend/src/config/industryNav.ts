/**
 * Apply industry-aware labels and feature flags to suite navigation.
 * Additive — does not remove unrelated nav items.
 */
import type { IndustryConfig } from '../services/industryConfig.service';
import { isSection, type NavEntry, type NavLeaf } from './suiteNavigation';

function sidebarApLabel(cfg: IndustryConfig): string {
  if (cfg.industry === 'ca_firm') return 'Client AP Management';
  return cfg.ap_label || 'AP InvoiceFlow';
}

function sidebarArLabel(cfg: IndustryConfig): string {
  if (cfg.industry === 'real_estate') return 'Sales & Rent Invoices';
  return cfg.ar_label || 'AR';
}

function costControlLabel(cfg: IndustryConfig): string | null {
  switch (cfg.industry) {
    case 'construction':
      return 'Site Cost Control';
    case 'manufacturing':
      return 'Plant Cost Control';
    case 'real_estate':
      return 'Cash Position';
    default:
      return null;
  }
}

function remapLeaf(item: NavLeaf, cfg: IndustryConfig): NavLeaf | null {
  const path = item.path;

  // Feature-flag IFRS / RERA-related leaves
  if (!cfg.show_ifrs15 && (path.startsWith('/r2r/rev-rec') || path.startsWith('/ifrs/15') || /IFRS\s*15/i.test(item.label))) {
    return null;
  }
  if (!cfg.show_ifrs16 && (path.startsWith('/ifrs/16') || /IFRS\s*16|Lease/i.test(item.label))) {
    return null;
  }
  if (!cfg.show_rera && /RERA/i.test(item.label)) {
    return null;
  }
  if (!cfg.show_ejari && /EJARI/i.test(item.label)) {
    return null;
  }

  if (path === '/ap-invoices' || path.startsWith('/ap-invoices')) {
    if (path === '/ap-invoices') {
      return { ...item, label: sidebarApLabel(cfg) };
    }
  }
  if (path === '/uae-full/ar' || path === '/uae-full/invoices') {
    return { ...item, label: sidebarArLabel(cfg) };
  }
  if (path === '/uae-full/bank-recon' && cfg.industry === 'real_estate' && item.label === 'Bank Recon') {
    return { ...item, label: 'Cash Position' };
  }
  if ((path === '/uae-full/management' || path === '/ap-invoices/aging') && costControlLabel(cfg)) {
    // Keep original paths; only remapped when label matches cost-control intent in finance section
  }

  // Compliance label polish
  if (cfg.show_ifrs15 && (path.startsWith('/r2r/rev-rec') || path === '/ifrs/15')) {
    if (cfg.industry === 'ca_firm') return { ...item, label: 'IFRS 15 Recognition' };
    if (cfg.industry === 'real_estate') return { ...item, label: 'Revenue Recognition' };
  }
  if (cfg.show_ifrs16 && path.startsWith('/ifrs/16')) {
    if (cfg.industry === 'ca_firm') return { ...item, label: 'IFRS 16 Leases' };
    if (cfg.industry === 'real_estate') return { ...item, label: 'Lease Accounting' };
  }

  return item;
}

function remapSection(section: string, cfg: IndustryConfig): string {
  if (/IFRS\s*15/i.test(section) && cfg.industry === 'real_estate') return 'COMPLIANCE';
  if (/UAE Compliance/i.test(section)) return 'COMPLIANCE';
  return section;
}

/** Remap labels + filter by industry feature flags. */
export function withIndustryNavLabels(nav: NavEntry[], cfg: IndustryConfig): NavEntry[] {
  const out: NavEntry[] = [];

  for (const entry of nav) {
    if (isSection(entry)) {
      const items = entry.items
        .map((leaf) => remapLeaf(leaf, cfg))
        .filter((x): x is NavLeaf => x != null);
      if (items.length === 0) continue;
      out.push({ section: remapSection(entry.section, cfg), items });
    } else {
      const leaf = remapLeaf(entry, cfg);
      if (leaf) out.push(leaf);
    }
  }

  // Inject RERA compliance link for real estate when enabled
  if (cfg.show_rera) {
    const hasRera = out.some(
      (e) =>
        (isSection(e) && e.items.some((i) => /RERA/i.test(i.label))) ||
        (!isSection(e) && /RERA/i.test(e.label)),
    );
    if (!hasRera) {
      out.push({
        section: 'COMPLIANCE',
        items: [
          { label: 'VAT Return', path: '/gulftax/vat-return', icon: 'percent' },
          { label: 'RERA Compliance', path: '/real-estate', icon: 'shield', badge: 'RERA' },
        ],
      });
    }
  }

  // Settings — industry + cost centers (additive)
  const plural =
    cfg.industry === 'real_estate'
      ? 'Properties'
      : cfg.industry === 'construction'
        ? 'Sites & Projects'
        : cfg.industry === 'manufacturing'
          ? 'Plants & Divisions'
          : cfg.industry === 'healthcare'
            ? 'Branches & Clinics'
            : cfg.industry === 'retail'
              ? 'Stores & Outlets'
              : cfg.industry === 'ca_firm'
                ? 'Clients'
                : `${cfg.cost_center_label}s`;

  const hasSettings = out.some(
    (e) =>
      (isSection(e) && e.section.toUpperCase() === 'SETTINGS') ||
      (!isSection(e) && e.path === '/settings/industry'),
  );
  if (!hasSettings) {
    out.push({
      section: 'SETTINGS',
      items: [
        { label: 'Industry & Workspace', path: '/ap-invoices/industry', icon: 'sliders' },
        { label: plural, path: '/ap-invoices/settings/cost-centers', icon: 'building-2' },
      ],
    });
  }

  return out;
}

export function spendByCostCenterTitle(costCenterLabel: string): string {
  const short = costCenterLabel.split('/')[0].trim();
  return `Spend by ${short}`;
}
