import { joinApiUrl } from '@/utils/backendOrigin';

export type DemoProperty = {
  id: string;
  property_name: string;
  location?: string | null;
  property_type?: string | null;
};

export function formatPropertyLabel(p: Pick<DemoProperty, 'property_name' | 'location'>): string {
  const name = (p.property_name || '').trim();
  const loc = (p.location || '').trim();
  if (name && loc) return `${name} (${loc})`;
  return name || loc || '';
}

export async function listDemoProperties(): Promise<DemoProperty[]> {
  const res = await fetch(joinApiUrl('/api/ap/properties'));
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Failed to load properties (${res.status})`);
  }
  const data = (await res.json()) as { properties?: DemoProperty[] };
  return Array.isArray(data.properties) ? data.properties : [];
}
