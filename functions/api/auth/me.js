import { json, publicUser } from '../_lib.js';

export async function onRequestGet({ env, data }) {
  const anyUser = (await env.DB.list({ prefix: 'user:', limit: 1 })).keys.length > 0;
  return json({
    user: publicUser(data.user),
    needsSetup: !anyUser,
    githubReady: Boolean(env.GITHUB_TOKEN),
  });
}
