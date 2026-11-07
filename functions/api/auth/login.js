import { bad, body, checkPassword, createSession, json, log, userByEmail } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  const b = await body(request);
  const ip = request.headers.get('cf-connecting-ip') || 'x';
  const key = `rl:${ip}`;
  const tries = Number((await env.DB.get(key)) || 0);
  if (tries >= 10) return bad('יותר מדי ניסיונות. נסו שוב בעוד רבע שעה.', 429);
  await new Promise((r) => setTimeout(r, 500));
  const u = await userByEmail(env, b.email || '');
  if (!u || u.pending || !(await checkPassword(String(b.password || ''), u))) {
    await env.DB.put(key, String(tries + 1), { expirationTtl: 900 });
    return bad('אימייל או סיסמה שגויים', 401);
  }
  await log(env, u, 'כניסה עם סיסמה');
  return json({ ok: true }, 200, { 'set-cookie': await createSession(env, u.id) });
}
