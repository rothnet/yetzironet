// Creates the first owner account. Works only while there are no users, and only with SETUP_CODE.
import { bad, body, createSession, hashPassword, json, log, putUser, randomId, safeEqual , limited } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  if ((await env.DB.list({ prefix: 'user:', limit: 1 })).keys.length) return bad('כבר קיים משתמש', 403);
  if (!env.SETUP_CODE) return bad('SETUP_CODE לא הוגדר', 503);
  if (await limited(request, env, 'setup', 10, 900)) return bad('יותר מדי ניסיונות. נסו שוב בעוד רבע שעה.', 429);
  const b = await body(request);
  await new Promise((r) => setTimeout(r, 500));
  if (!safeEqual(String(b.code || ''), env.SETUP_CODE)) return bad('קוד הפעלה שגוי', 401);
  const name = String(b.name || '').trim().slice(0, 60);
  const email = String(b.email || '').trim().toLowerCase().slice(0, 120);
  if (!name || !email.includes('@')) return bad('נא למלא שם ואימייל');
  if (String(b.password || '').length < 8) return bad('סיסמה של 8 תווים לפחות');
  const { salt, hash } = await hashPassword(b.password);
  const u = { id: randomId(8), name, email, role: 'owner', salt, passHash: hash, passkeys: [], createdAt: new Date().toISOString() };
  await putUser(env, u);
  await env.DB.put(`email:${email}`, u.id);
  await log(env, u, 'הקמת לוח הבקרה');
  return json({ ok: true }, 200, { 'set-cookie': await createSession(env, u.id) });
}
