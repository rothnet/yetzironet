import raw from '../data/creations.json';

export interface Step { image: string | null; text: string }
export interface Creation {
  id: number; slug: string; oldSlug: string; title: string; intro: string[];
  materialsTitle: string; materials: string[]; cover: string; steps: Step[];
  download: { label: string; file: string } | null; order: number;
}

export const creations: Creation[] = (raw as Creation[]).slice().sort((a, b) => a.order - b.order);

export const href = (c: Creation) => `/${c.slug}/`;

export function teaser(c: Creation, max = 95): string {
  const t = c.intro.join(' ');
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ')) + '…';
}
