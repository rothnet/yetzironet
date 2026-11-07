import { creations } from '../lib/data';

// Map of creation slug -> downloadable file, read by /api/lead after a signup.
export function GET() {
  const map: Record<string, string> = {};
  for (const c of creations) if (c.download?.file) map[c.slug] = c.download.file;
  return new Response(JSON.stringify(map), { headers: { 'content-type': 'application/json' } });
}
