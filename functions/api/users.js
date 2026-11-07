import { bad, body, getUser, hashPassword, json, listUsers, log, publicUser, putUser, randomId } from './_lib.js';

const ownerOnly = (u) => u?.role === 'owner';

export async function onRequestGet({ env, data }) {
  const users = await listUsers(env);
  return json({ me: data.user.id, users: users.map(publicUser) });
}

// Invite a new user
export async function onRequestPost({ request, env, data }) {
  if (!ownerOnly(data.user)) return bad('רק בעל האתר יכול להוסיף משתמשים', 403);
  const b = await body(request);
  const name = String(b.name || '').trim().slice(0, 60);
  const email = String(b.email || '').trim().toLowerCase().slice(0, 120);
  if (!name || !email.includes('@')) return bad('נא למלא שם ואימייל');
  if (await env.DB.get(`email:${email}`)) return bad('כבר יש משתמש עם האימייל הזה');
  const u = { id: randomId(8), name, email, role: b.role === 'owner' ? 'owner' : 'editor', passkeys: [], pending: true, createdAt: new Date().toISOString() };
  await putUser(env, u);
  await env.DB.put(`email:${email}`, u.id);
  const code = randomId(16);
  await env.DB.put(`invite:${code}`, JSON.stringify({ userId: u.id }), { expirationTtl: 60 * 60 * 24 * 7 });
  await log(env, data.user, 'הזמנת משתמש', `${name} (${email})`);
  return json({ ok: true, code });
}

// Update: own password / remove own passkey / (owner) change role
export async function onRequestPatch({ request, env, data }) {
  const b = await body(request);
  const target = b.id && b.id !== data.user.id ? await getUser(env, b.id) : data.user;
  if (!target) return bad('לא נמצא', 404);
  const self = target.id === data.user.id;
  if (!self && !ownerOnly(data.user)) return bad('אין הרשאה', 403);
  if (b.password !== undefined) {
    if (!self) return bad('אפשר לשנות רק את הסיסמה שלך');
    if (String(b.password).length < 8) return bad('סיסמה של 8 תווים לפחות');
    const { salt, hash } = await hashPassword(b.password);
    target.salt = salt; target.passHash = hash;
    await log(env, data.user, 'שינוי סיסמה');
  }
  if (b.removePasskey) {
    target.passkeys = (target.passkeys || []).filter((p) => p.id !== b.removePasskey);
    await env.DB.delete(`cred:${b.removePasskey}`);
    await log(env, data.user, 'הסרת טביעת אצבע', target.name);
  }
  if (b.role && !self && ownerOnly(data.user)) target.role = b.role === 'owner' ? 'owner' : 'editor';
  await putUser(env, target);
  return json({ ok: true, user: publicUser(target) });
}

export async function onRequestDelete({ request, env, data }) {
  if (!ownerOnly(data.user)) return bad('אין הרשאה', 403);
  const b = await body(request);
  if (b.id === data.user.id) return bad('אי אפשר למחוק את עצמך');
  const u = await getUser(env, b.id);
  if (!u) return bad('לא נמצא', 404);
  for (const p of u.passkeys || []) await env.DB.delete(`cred:${p.id}`);
  await env.DB.delete(`email:${u.email}`);
  await env.DB.delete(`user:${u.id}`);
  await log(env, data.user, 'מחיקת משתמש', u.name);
  return json({ ok: true });
}

// new invite link for a pending user
export async function onRequestPut({ request, env, data }) {
  if (!ownerOnly(data.user)) return bad('אין הרשאה', 403);
  const b = await body(request);
  const u = await getUser(env, b.id);
  if (!u) return bad('לא נמצא', 404);
  const code = randomId(16);
  await env.DB.put(`invite:${code}`, JSON.stringify({ userId: u.id }), { expirationTtl: 60 * 60 * 24 * 7 });
  return json({ ok: true, code });
}
