import { generateRegistrationOptions } from '@simplewebauthn/server';
import { bad, body, json, rpOf } from '../_lib.js';
import { RP_NAME, registrant } from './_passkey.js';

export async function onRequestPost({ request, env, data }) {
  const b = await body(request);
  const { user } = await registrant(env, data, b.invite);
  if (!user) return bad('אין הרשאה', 401);
  const { rpID } = rpOf(request);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: user.email,
    userDisplayName: user.name,
    userID: new TextEncoder().encode(user.id),
    attestationType: 'none',
    excludeCredentials: (user.passkeys || []).map((p) => ({ id: p.id, transports: p.transports })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  await env.DB.put(`chal:reg:${user.id}`, options.challenge, { expirationTtl: 300 });
  return json(options);
}
