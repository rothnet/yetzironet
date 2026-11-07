// Visitors sign up to receive a creation's file. Stored in KV; listed in the admin.
import { bad, body, json, limited, listPrefix, log, randomId } from './_lib.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestPost({ request, env }) {
  const b = await body(request);
  if (b.website) return json({ ok: true }); // honeypot
  if (await limited(request, env, 'lead', 8, 3600)) return bad('יותר מדי פניות, נסו מאוחר יותר', 429);
  const name = String(b.name || '').trim().slice(0, 80);
  const email = String(b.email || '').trim().slice(0, 120);
  const phone = String(b.phone || '').trim().slice(0, 30);
  const slug = String(b.slug || '').slice(0, 120);
  if (!name || !EMAIL.test(email)) return bad('נא למלא שם ואימייל תקין');
  const res = await env.ASSETS.fetch(new URL('/downloads.json', request.url));
  const downloads = res.ok ? await res.json() : {};
  const file = downloads[slug];
  if (!file) return bad('לא נמצא קובץ', 404);
  const at = new Date().toISOString();
  await env.DB.put(`lead:${at}:${randomId(4)}`, JSON.stringify({ at, name, email, phone, slug, updates: Boolean(b.updates) }));
  await log(env, null, 'הרשמה לקבלת קובץ', `${name} — ${slug}`);
  return json({ ok: true, file });
}

export async function onRequestGet({ env }) {
  return json({ leads: await listPrefix(env, 'lead:', 2000) });
}

export async function onRequestDelete({ request, env, data }) {
  const { key } = await body(request);
  if (!String(key).startsWith('lead:')) return bad('לא תקין');
  await env.DB.delete(key);
  await log(env, data.user, 'מחיקת נרשם');
  return json({ ok: true });
}
