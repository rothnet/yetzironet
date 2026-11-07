// Shared helpers for the admin API (Cloudflare Pages Functions).
//
// Bindings / variables (Pages → Settings):
//   DB             – KV namespace: users, passkeys, sessions, activity log, inquiries, signups
//   GITHUB_TOKEN   – fine-grained token, "Contents: read & write" on rothnet/yetzironet (secret)
//   SETUP_CODE     – one-time code that lets the first owner create their account (secret)
//   GITHUB_REPO    – optional, default rothnet/yetzironet
//   GITHUB_BRANCH  – optional, default main

export const DATA_PATH = 'src/data/creations.json';
export const SITE_PATH = 'src/data/site.json';
const COOKIE = 'yz_s';
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days

const enc = new TextEncoder();

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export const bad = (msg, status = 400) => json({ error: msg }, status);

export async function body(request) {
  try { return await request.json(); } catch { return {}; }
}

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const randomId = (bytes = 16) => hex(crypto.getRandomValues(new Uint8Array(bytes)));

// ---------- passwords (PBKDF2-SHA256) ----------
export async function hashPassword(password, salt = randomId(16)) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 }, key, 256);
  return { salt, hash: hex(bits) };
}
export async function checkPassword(password, user) {
  if (!user?.passHash) return false;
  const { hash } = await hashPassword(password, user.salt);
  return safeEqual(hash, user.passHash);
}

// ---------- users ----------
export const getUser = async (env, id) => JSON.parse((await env.DB.get(`user:${id}`)) || 'null');
export const putUser = (env, u) => env.DB.put(`user:${u.id}`, JSON.stringify(u));
export async function userByEmail(env, email) {
  const id = await env.DB.get(`email:${String(email).trim().toLowerCase()}`);
  return id ? getUser(env, id) : null;
}
export async function listUsers(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.DB.list({ prefix: 'user:', cursor });
    for (const k of page.keys) {
      const u = JSON.parse((await env.DB.get(k.name)) || 'null');
      if (u) out.push(u);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}
export const publicUser = (u) => u && ({ id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt, passkeys: (u.passkeys || []).map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt, lastUsed: p.lastUsed })), hasPassword: Boolean(u.passHash), pending: Boolean(u.pending) });

// ---------- sessions ----------
export async function createSession(env, userId) {
  const token = randomId(32);
  await env.DB.put(`sess:${token}`, JSON.stringify({ userId, at: Date.now() }), { expirationTtl: SESSION_TTL });
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL}`;
}
export const clearCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
const tokenOf = (request) => (request.headers.get('cookie') || '').match(new RegExp(`(?:^|; )${COOKIE}=([0-9a-f]{64})`))?.[1];
export async function currentUser(request, env) {
  const t = tokenOf(request);
  if (!t) return null;
  const s = JSON.parse((await env.DB.get(`sess:${t}`)) || 'null');
  if (!s) return null;
  const u = await getUser(env, s.userId);
  return u && !u.pending ? u : null;
}
export async function endSession(request, env) {
  const t = tokenOf(request);
  if (t) await env.DB.delete(`sess:${t}`);
}

// ---------- activity log ----------
export async function log(env, user, action, detail = '') {
  const at = new Date().toISOString();
  await env.DB.put(`log:${at}:${randomId(4)}`, JSON.stringify({ at, user: user?.name || 'מערכת', action, detail: String(detail).slice(0, 200) }), { expirationTtl: 60 * 60 * 24 * 365 });
}

export async function listPrefix(env, prefix, limit = 500) {
  const out = [];
  let cursor;
  do {
    const page = await env.DB.list({ prefix, cursor });
    for (const k of page.keys) {
      const v = await env.DB.get(k.name);
      if (v) out.push({ key: k.name, ...JSON.parse(v) });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && out.length < limit);
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}

// ---------- GitHub ----------
export function gh(env) {
  const repo = env.GITHUB_REPO || 'rothnet/yetzironet';
  const branch = env.GITHUB_BRANCH || 'main';
  const base = `https://api.github.com/repos/${repo}`;
  async function call(path, init = {}) {
    const res = await fetch(base + path, {
      ...init,
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'yetzironet-admin',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
    });
    if (!res.ok) {
      const t = await res.text();
      const err = new Error(`GitHub ${res.status}: ${t.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }
  return { call, branch };
}

const b64ToUtf8 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

export async function readJsonFile(env, path) {
  const { call, branch } = gh(env);
  const f = await call(`/contents/${encPath(path)}?ref=${branch}`);
  return { sha: f.sha, data: JSON.parse(b64ToUtf8(f.content)) };
}

// One commit. changes: [{ path, base64 } | { path, text } | { path, delete: true }]
export async function commit(env, changes, message) {
  const { call, branch } = gh(env);
  const ref = await call(`/git/ref/heads/${branch}`);
  const headSha = ref.object.sha;
  const head = await call(`/git/commits/${headSha}`);
  const tree = [];
  const shas = {};
  for (const ch of changes) {
    if (ch.delete) { tree.push({ path: ch.path, mode: '100644', type: 'blob', sha: null }); continue; }
    const blob = await call('/git/blobs', {
      method: 'POST',
      body: JSON.stringify(ch.base64 !== undefined ? { content: ch.base64, encoding: 'base64' } : { content: ch.text, encoding: 'utf-8' }),
    });
    shas[ch.path] = blob.sha;
    tree.push({ path: ch.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const newTree = await call('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: head.tree.sha, tree }) });
  const c = await call('/git/commits', { method: 'POST', body: JSON.stringify({ message: String(message).slice(0, 120), tree: newTree.sha, parents: [headSha] }) });
  await call(`/git/refs/heads/${branch}`, { method: 'PATCH', body: JSON.stringify({ sha: c.sha }) });
  return { commit: c.sha, shas };
}

// ---------- uploads ----------
export const UPLOAD_PATH = /^public\/media\/[^\\]+\.(jpg|jpeg|png|webp|gif|pdf)$/i; // no SVG: it can carry scripts
const MAX_FILE = 10 * 1024 * 1024;
export function checkFiles(files) {
  for (const f of files || []) {
    if (!UPLOAD_PATH.test(f.path || '') || f.path.includes('..')) return `נתיב קובץ לא תקין: ${f.path}`;
    if (typeof f.base64 !== 'string' || f.base64.length * 0.75 > MAX_FILE) return 'קובץ גדול מדי (עד 10MB)';
  }
  return null;
}

export function rpOf(request) {
  const u = new URL(request.url);
  return { rpID: u.hostname, origin: u.origin };
}

// Simple per-IP rate limit stored in KV. Returns true when the caller is over the limit.
export async function limited(request, env, name, max, windowSec) {
  const ip = request.headers.get('cf-connecting-ip') || 'x';
  const key = `rl:${name}:${ip}`;
  const n = Number((await env.DB.get(key)) || 0);
  if (n >= max) return true;
  await env.DB.put(key, String(n + 1), { expirationTtl: Math.max(60, windowSec) });
  return false;
}
