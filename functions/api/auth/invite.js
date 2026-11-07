// A new user opens their invite link: shows who they are, lets them set a password (optional).
import { bad, body, getUser, hashPassword, json, putUser , limited } from '../_lib.js';

async function load(env, code) {
  const inv = JSON.parse((await env.DB.get(`invite:${code}`)) || 'null');
  return inv && (await getUser(env, inv.userId));
}

export async function onRequestGet({ request, env }) {
  const u = await load(env, new URL(request.url).searchParams.get('code') || '');
  if (!u) return bad('ההזמנה לא נמצאה או שפג תוקפה', 404);
  return json({ name: u.name, email: u.email });
}

export async function onRequestPost({ request, env }) {
  if (await limited(request, env, 'invite', 10, 900)) return bad('יותר מדי ניסיונות. נסו שוב בעוד רבע שעה.', 429);
  const b = await body(request);
  const u = await load(env, b.code || '');
  if (!u) return bad('ההזמנה לא נמצאה או שפג תוקפה', 404);
  if (String(b.password || '').length < 8) return bad('סיסמה של 8 תווים לפחות');
  const { salt, hash } = await hashPassword(b.password);
  u.salt = salt; u.passHash = hash;
  await putUser(env, u);
  return json({ ok: true });
}
