/** Default property when invoice.property_ref is blank — keyed by GL code. */
const GL_PROPERTY_MAP: Record<string, string> = {
  '6800': 'Emaar Business Bay Office',
  '6400': 'All Properties',
  '6200': 'Head Office',
  '6600': 'Operations',
  '6500': 'Corporate',
  '6300': 'Head Office',
  '6100': 'Corporate',
  '1500': 'IT Infrastructure',
  '1510': 'IT Infrastructure',
};

export function propertyFromGlCode(glCode: string | null | undefined): string | null {
  const digits = String(glCode || '').replace(/\D/g, '');
  if (!digits) return null;
  if (GL_PROPERTY_MAP[digits]) return GL_PROPERTY_MAP[digits];
  if (digits.length >= 4 && GL_PROPERTY_MAP[digits.slice(0, 4)]) {
    return GL_PROPERTY_MAP[digits.slice(0, 4)];
  }
  return null;
}

export function effectivePropertyRef(
  propertyRef: string | null | undefined,
  glCode: string | null | undefined,
): string {
  const fromGl = propertyFromGlCode(glCode);
  if (fromGl) return fromGl;
  return String(propertyRef || '').trim();
}
