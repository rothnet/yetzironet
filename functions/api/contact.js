// The footer form opens WhatsApp in the visitor's browser; this keeps a copy in the admin.
import { bad, body, json, limited, listPrefix, log, randomId } from './_lib.js';

export async function onRequestPost({ request, env }) {
  const b = await body(request);
  if (b.website) return json({ ok: true });
  if (await limited(request, env, 'contact', 8, 3600)) return bad('יותר מדי פניות, נסו מאוחר יותר', 429);
  const name = String(b.name || '').trim().slice(0, 80);
  const phone = String(b.phone || '').trim().slice(0, 30);
  const message = String(b.message || '').trim().slice(0, 2000);
  if (!name || !message) return bad('חסרים פרטים');
  const at = new Date().toISOString();
  await env.DB.put(`msg:${at}:${randomId(4)}`, JSON.stringify({ at, name, phone, message, page: String(b.page || '').slice(0, 200), read: false }));
  await log(env, null, 'פנייה חדשה מהאתר', name);
  return json({ ok: true });
}

export async function onRequestGet({ env }) {
  return json({ messages: await listPrefix(env, 'msg:', 1000) });
}

export async function onRequestPatch({ request, env }) {
  const { key, read } = await body(request);
  if (!String(key).startsWith('msg:')) return bad('לא תקין');
  const v = JSON.parse((await env.DB.get(key)) || 'null');
  if (!v) return bad('לא נמצא', 404);
  v.read = Boolean(read);
  await env.DB.put(key, JSON.stringify(v));
  return json({ ok: true });
}

export async function onRequestDelete({ request, env, data }) {
  const { key } = await body(request);
  if (!String(key).startsWith('msg:')) return bad('לא תקין');
  await env.DB.delete(key);
  await log(env, data.user, 'מחיקת פנייה');
  return json({ ok: true });
}
