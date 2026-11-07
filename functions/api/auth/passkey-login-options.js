import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { json, randomId, rpOf } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  const { rpID } = rpOf(request);
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'required', allowCredentials: [] });
  const cid = randomId(12);
  await env.DB.put(`chal:auth:${cid}`, options.challenge, { expirationTtl: 300 });
  return json({ options, cid });
}
