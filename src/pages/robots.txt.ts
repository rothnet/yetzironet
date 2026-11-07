export function GET() {
  return new Response('User-agent: *\nDisallow: /api/\n\nSitemap: https://yetzironet.co.il/sitemap.xml\n', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
