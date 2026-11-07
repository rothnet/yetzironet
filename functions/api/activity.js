import { json, listPrefix } from './_lib.js';

export async function onRequestGet({ env }) {
  return json({ log: (await listPrefix(env, 'log:', 300)).slice(0, 300) });
}
