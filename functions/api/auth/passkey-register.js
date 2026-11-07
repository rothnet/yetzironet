import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { bad, body, createSession, json, log, putUser, rpOf } from '../_lib.js';
import { registrant, toB64 } from './_passkey.js';

export async function onRequestPost({ request, env, data }) {
  const b = await body(request);
  const { user, invite } = await registrant(env, data, b.invite);
  if (!user) return bad('אין הרשאה', 401);
  const expectedChallenge = await env.DB.get(`chal:reg:${user.id}`);
  if (!expectedChallenge) return bad('פג תוקף, נסו שוב');
  await env.DB.delete(`chal:reg:${user.id}`);
  const { rpID, origin } = rpOf(request);
  let v;
  try {
    v = await verifyRegistrationResponse({ response: b.response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
  } catch (e) {
    return bad(`הרישום נכשל: ${e.message}`);
  }
  if (!v.verified || !v.registrationInfo) return bad('הרישום נכשל');
  const { credential } = v.registrationInfo;
  const pk = {
    id: credential.id,
    publicKey: toB64(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports || [],
    name: String(b.name || 'מכשיר').slice(0, 40),
    createdAt: new Date().toISOString(),
  };
  user.passkeys = [...(user.passkeys || []), pk];
  const headers = {};
  if (invite) {
    delete user.pending;
    await env.DB.delete(`invite:${invite}`);
    headers['set-cookie'] = await createSession(env, user.id);
  }
  await putUser(env, user);
  await env.DB.put(`cred:${pk.id}`, user.id);
  await log(env, user, 'רישום טביעת אצבע', pk.name);
  return json({ ok: true }, 200, headers);
}
