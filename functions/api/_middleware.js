import { currentUser, json } from './_lib.js';

// Public: auth endpoints, visitor sign-ups and the contact form. Everything else needs a session.
const isPublic = (path, method) =>
  path.startsWith('/api/auth/') ||
  (method === 'POST' && (path === '/api/lead' || path === '/api/contact'));

export async function onRequest(ctx) {
  const { request, env, next, data } = ctx;
  const url = new URL(request.url);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) return json({ error: 'bad origin' }, 403);
  }
  if (!env.DB) return json({ error: 'KV binding DB is missing' }, 503);
  data.user = await currentUser(request, env);
  if (isPublic(url.pathname, request.method)) return next();
  if (!data.user) return json({ error: 'unauthorized' }, 401);
  return next();
}
