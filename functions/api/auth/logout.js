import { clearCookie, endSession, json } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  await endSession(request, env);
  return json({ ok: true }, 200, { 'set-cookie': clearCookie });
}
