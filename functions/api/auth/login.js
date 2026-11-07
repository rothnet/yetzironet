import { bad, body, checkPassword, createSession, json, log, userByEmail } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  const b = await body(request);
  const email = String(b.email || '').trim().toLowerCase().slice(0, 120);
  const ip = request.headers.get('cf-connecting-ip') || 'x';
  const ipKey = `rl:${ip}`;
  const acctKey = `rl:acct:${email}`;
  const [ipTries, acctTries] = (await Promise.all([env.DB.get(ipKey), env.DB.get(acctKey)])).map((v) => Number(v || 0));
  if (ipTries >= 10 || acctTries >= 20) return bad('יותר מדי ניסיונות. נסו שוב מאוחר יותר.', 429);
  await new Promise((r) => setTimeout(r, 500));
  const u = await userByEmail(env, email);
  if (!u || u.pending || !(await checkPassword(String(b.password || ''), u))) {
    await Promise.all([
      env.DB.put(ipKey, String(ipTries + 1), { expirationTtl: 900 }),
      env.DB.put(acctKey, String(acctTries + 1), { expirationTtl: 3600 }),
    ]);
    if (u) await log(env, null, 'ניסיון כניסה שנכשל', `${u.name} · ${request.headers.get('cf-ipcountry') || ''}`);
    return bad('אימייל או סיסמה שגויים', 401);
  }
  await env.DB.delete(acctKey);
  await log(env, u, 'כניסה עם סיסמה');
  return json({ ok: true }, 200, { 'set-cookie': await createSession(env, u.id) });
}
