import raw from '../data/creations.json';

export interface Step { image: string | null; text: string }
export interface Creation {
  id: number; slug: string; oldSlug: string; title: string; intro: string[];
  materialsTitle: string; materials: string[]; cover: string; steps: Step[];
  download: { label: string; file: string; gated?: boolean } | null; order: number; published?: boolean;
  seo?: { title?: string; description?: string; image?: string; noindex?: boolean };
}

export const creations: Creation[] = (raw as Creation[]).filter((c) => c.published !== false).slice().sort((a, b) => a.order - b.order);

export const href = (c: Creation) => `/${c.slug}/`;

export function teaser(c: Creation, max = 95): string {
  const t = c.intro.join(' ');
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ')) + '…';
}

import siteRaw from '../data/site.json';
import mediaRaw from '../data/media.json';
type MediaMeta = { alt?: string; title?: string; caption?: string; description?: string; width?: number; height?: number };
export const media = mediaRaw as Record<string, MediaMeta>;
/** alt text from the media library, else the fallback */
export const altOf = (path: string | null | undefined, fallback = '') => (path && media[path]?.alt?.trim()) || fallback;
export const dims = (path: string | null | undefined) => (path && media[path]) || {};
export const site = siteRaw;
export const waLink = (text = '') => `https://wa.me/${site.contact.whatsapp}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
// "השראות ויצירות" -> ["השראות", "ויצירות"]: the last word is shown bold
export function splitTitle(t: string): [string, string] {
  const w = t.trim().split(/\s+/);
  return w.length > 1 ? [w.slice(0, -1).join(' '), w[w.length - 1]] : ['', w[0] || ''];
}
