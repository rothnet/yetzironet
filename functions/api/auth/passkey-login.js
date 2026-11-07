import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { bad, body, createSession, getUser, json, log, putUser, rpOf } from '../_lib.js';
import { fromB64 } from './_passkey.js';

export async function onRequestPost({ request, env }) {
  const b = await body(request);
  const expectedChallenge = await env.DB.get(`chal:auth:${b.cid}`);
  if (!expectedChallenge) return bad('פג תוקף, נסו שוב');
  await env.DB.delete(`chal:auth:${b.cid}`);
  const userId = await env.DB.get(`cred:${b.response?.id}`);
  const user = userId && (await getUser(env, userId));
  const pk = user?.passkeys?.find((p) => p.id === b.response.id);
  if (!user || !pk || user.pending) return bad('טביעת האצבע לא מוכרת. התחברו עם סיסמה ורשמו את המכשיר מחדש.', 401);
  const { rpID, origin } = rpOf(request);
  let v;
  try {
    v = await verifyAuthenticationResponse({
      response: b.response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
      credential: { id: pk.id, publicKey: fromB64(pk.publicKey), counter: pk.counter, transports: pk.transports },
    });
  } catch (e) {
    return bad(`הכניסה נכשלה: ${e.message}`, 401);
  }
  if (!v.verified) return bad('הכניסה נכשלה', 401);
  pk.counter = v.authenticationInfo.newCounter;
  pk.lastUsed = new Date().toISOString();
  await putUser(env, user);
  await log(env, user, 'כניסה עם טביעת אצבע', pk.name);
  return json({ ok: true }, 200, { 'set-cookie': await createSession(env, user.id) });
}
