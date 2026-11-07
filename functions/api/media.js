// Media library: everything under public/media in the repo.
import { bad, body, checkFiles, commit, gh, json, log } from './_lib.js';

export async function onRequestGet({ env }) {
  try {
    const { call, branch } = gh(env);
    const ref = await call(`/git/ref/heads/${branch}`);
    const tree = await call(`/git/trees/${ref.object.sha}?recursive=1`);
    const files = tree.tree
      .filter((t) => t.type === 'blob' && t.path.startsWith('public/media/'))
      .map((t) => ({ path: t.path.slice('public'.length), size: t.size }));
    return json({ files, truncated: tree.truncated });
  } catch (e) {
    return bad(e.message, 502);
  }
}

export async function onRequestPost({ request, env, data }) {
  const { files = [] } = await body(request);
  if (!files.length) return bad('לא נבחרו קבצים');
  const err = checkFiles(files);
  if (err) return bad(err);
  try {
    await commit(env, files, `ספריית מדיה: העלאת ${files.length} קבצים`);
    await log(env, data.user, 'העלאה לספריית המדיה', `${files.length} קבצים`);
    return json({ ok: true });
  } catch (e) {
    return bad(e.message, 502);
  }
}

export async function onRequestDelete({ request, env, data }) {
  const { paths = [] } = await body(request);
  const clean = paths.filter((p) => typeof p === 'string' && p.startsWith('/media/') && !p.includes('..'));
  if (!clean.length) return bad('לא נבחרו קבצים');
  try {
    await commit(env, clean.map((p) => ({ path: `public${p}`, delete: true })), `ספריית מדיה: מחיקת ${clean.length} קבצים`);
    await log(env, data.user, 'מחיקה מספריית המדיה', clean.map((p) => p.split('/').pop()).join(', '));
    return json({ ok: true });
  } catch (e) {
    return bad(e.message, 502);
  }
}
