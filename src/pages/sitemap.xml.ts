import { creations } from '../lib/data';
import media from '../data/media.json';

const SITE = 'https://yetzironet.co.il';
const u = (p: string) => SITE + encodeURI(p);
const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const alt = (p: string) => (media as Record<string, { alt?: string }>)[p]?.alt || '';

export function GET() {
  const img = (p: string | null) => (p ? `<image:image><image:loc>${x(u(p))}</image:loc>${alt(p) ? `<image:title>${x(alt(p))}</image:title>` : ''}</image:image>` : '');
  const pages = [
    `<url><loc>${u('/')}</loc><priority>1.0</priority></url>`,
    `<url><loc>${u('/השראות-ויצירות/')}</loc><priority>0.8</priority></url>`,
    ...creations.filter((c) => !c.seo?.noindex).map((c) => `<url><loc>${u(`/${c.slug}/`)}</loc>${img(c.cover)}${c.steps.map((s) => img(s.image)).join('')}</url>`),
  ];
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${pages.join('')}</urlset>`, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
}
