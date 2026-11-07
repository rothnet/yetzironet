import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { getUser } from '../_lib.js';

export const RP_NAME = 'יצירונט — לוח בקרה';
export const toB64 = (u8) => isoBase64URL.fromBuffer(u8);
export const fromB64 = (s) => isoBase64URL.toBuffer(s);

// Who is registering: the signed-in user, or a pending user holding a valid invite.
export async function registrant(env, data, invite) {
  if (data.user) return { user: data.user, invite: null };
  if (!invite) return { user: null };
  const inv = JSON.parse((await env.DB.get(`invite:${invite}`)) || 'null');
  if (!inv) return { user: null };
  return { user: await getUser(env, inv.userId), invite };
}
