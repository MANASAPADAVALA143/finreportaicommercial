export type ProductRole =
  | 'uae_client'
  | 'uae_suite'
  | 'uae_full'
  | 'india_client'
  | 'india_full'
  | 'fpa_client'
  | 'full_access';

const ALL_PRODUCT_ROLES: ProductRole[] = [
  'uae_client',
  'uae_suite',
  'uae_full',
  'india_client',
  'india_full',
  'fpa_client',
  'full_access',
];

const BLOCKED_FOR_UAE_SUITE = [
  '/fpa',
  '/india-full',
  '/o2c',
  '/consolidation',
  '/ifrs-statement',
  '/ifrs/9',
  '/ifrs/15',
  '/ca-firm',
];

/** Path prefixes each product role may access. null = unrestricted. */
const ROLE_PATH_PREFIXES: Record<ProductRole, string[] | null> = {
  uae_client: ['/ap-invoices', '/gulftax', '/ifrs/16'],
  uae_suite: ['/uae-suite', '/ap-invoices', '/gulftax', '/ifrs/16', '/uae-full/ar'],
  uae_full: ['/ap-invoices', '/gulftax', '/uae-full', '/uae-accounting', '/crm', '/o2c', '/company-setup', '/ifrs/16'],
  india_client: ['/india-full', '/fpa', '/ca-firm', '/dashboard'],
  india_full: ['/india-full', '/fpa', '/ca-firm', '/dashboard', '/ifrs-statement'],
  fpa_client: ['/fpa', '/dashboard'],
  full_access: null,
};

const SETUP_PATHS = ['/company-setup', '/workspaces'];

export function normalizeProductRole(value: string | null | undefined): ProductRole {
  if (value && ALL_PRODUCT_ROLES.includes(value as ProductRole)) {
    return value as ProductRole;
  }
  return 'full_access';
}

export function loginRedirectFor(productRole: ProductRole): string {
  switch (productRole) {
    case 'uae_client':
      return '/gulftax';
    case 'uae_suite':
      return '/uae-suite';
    case 'uae_full':
      return '/uae-full';
    case 'india_client':
      return '/dashboard';
    case 'india_full':
      return '/dashboard';
    case 'fpa_client':
      return '/fpa';
    default:
      return '/dashboard';
  }
}

export function visibleSuiteIds(productRole: ProductRole): Array<'india' | 'uae' | 'fpa'> {
  switch (productRole) {
    case 'uae_client':
    case 'uae_suite':
    case 'uae_full':
      return ['uae'];
    case 'india_client':
      return ['india', 'fpa'];
    case 'india_full':
      return ['india', 'fpa'];
    case 'fpa_client':
      return ['fpa'];
    default:
      return ['india', 'uae', 'fpa'];
  }
}

export function isUaeFinanceSuiteOnly(productRole: ProductRole): boolean {
  return productRole === 'uae_client';
}

export function isUaeSuite(productRole: ProductRole): boolean {
  return productRole === 'uae_suite';
}

export function canAccessPath(
  productRole: ProductRole,
  pathname: string,
  internalRole?: string | null,
): boolean {
  if (pathname === '/unauthorized') return true;
  if (internalRole === 'super_admin') return true;
  if (productRole === 'full_access') return true;

  if (pathname.startsWith('/users') || pathname.startsWith('/workspaces')) {
    return internalRole === 'super_admin';
  }

  if (SETUP_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return true;
  }

  if (productRole === 'uae_suite') {
    if (BLOCKED_FOR_UAE_SUITE.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      return false;
    }
    if (pathname.startsWith('/uae-full/') && !pathname.startsWith('/uae-full/ar')) {
      return false;
    }
  }

  const prefixes = ROLE_PATH_PREFIXES[productRole];
  if (!prefixes) return true;

  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function homePathForRole(productRole: ProductRole, internalRole?: string | null): string {
  if (internalRole === 'super_admin') return '/dashboard';
  return loginRedirectFor(productRole);
}

/** Filter sidebar nav entries by role — keeps sections with at least one visible item. */
export function filterNavByRole<T extends { path?: string; items?: Array<{ path: string }> }>(
  entries: T[],
  productRole: ProductRole,
  internalRole?: string | null,
): T[] {
  return entries
    .map((entry) => {
      if ('items' in entry && entry.items) {
        const items = entry.items.filter((item) => canAccessPath(productRole, item.path, internalRole));
        return items.length ? { ...entry, items } : null;
      }
      if ('path' in entry && entry.path) {
        return canAccessPath(productRole, entry.path, internalRole) ? entry : null;
      }
      return entry;
    })
    .filter((e): e is T => e !== null);
}
