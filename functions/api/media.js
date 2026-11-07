// Media library: files under public/media in the repo + their details in src/data/media.json.
import { MEDIA_PATH, bad, body, checkFiles, cleanMediaMeta as cleanMeta, commit, gh, json, log, readMediaMeta as readMeta } from './_lib.js';

const metaText = (m) => JSON.stringify(m, null, 1) + '\n';
const okPath = (p) => typeof p === 'string' && /^\/media\/[^\\]+$/.test(p) && !p.includes('..');

export async function onRequestGet({ env }) {
  try {
    const { call, branch } = gh(env);
    const ref = await call(`/git/ref/heads/${branch}`);
    const [tree, meta] = await Promise.all([call(`/git/trees/${ref.object.sha}?recursive=1`), readMeta(env)]);
    const files = tree.tree
      .filter((t) => t.type === 'blob' && t.path.startsWith('public/media/'))
      .map((t) => ({ path: t.path.slice('public'.length), size: t.size }));
    return json({ files, meta, truncated: tree.truncated });
  } catch (e) {
    return bad(e.message, 502);
  }
}

// Upload new files, or replace existing ones (edited / optimized). meta: { path: {...} }
export async function onRequestPost({ request, env, data }) {
  const { files = [], meta = {}, action } = await body(request);
  if (!files.length) return bad('לא נבחרו קבצים');
  const err = checkFiles(files);
  if (err) return bad(err);
  try {
    const all = await readMeta(env);
    for (const f of files) {
      const p = f.path.slice('public'.length);
      all[p] = cleanMeta({ ...all[p], ...(meta[p] || {}), uploaded: all[p]?.uploaded || meta[p]?.uploaded });
    }
    const label = action === 'optimize' ? 'אופטימיזציה' : action === 'edit' ? 'עריכת תמונה' : 'העלאה';
    await commit(env, [...files, { path: MEDIA_PATH, text: metaText(all) }], `ספריית מדיה: ${label} (${files.length})`);
    await log(env, data.user, `${label} בספריית המדיה`, files.length === 1 ? files[0].path.split('/').pop() : `${files.length} קבצים`);
    return json({ ok: true, meta: all });
  } catch (e) {
    return bad(e.message, 502);
  }
}

// Update details. patch: { path: {...} }
export async function onRequestPut({ request, env, data }) {
  const { patch = {} } = await body(request);
  const paths = Object.keys(patch).filter(okPath);
  if (!paths.length) return bad('אין מה לשמור');
  try {
    const all = await readMeta(env);
    for (const p of paths) all[p] = cleanMeta({ ...all[p], ...patch[p], uploaded: all[p]?.uploaded });
    await commit(env, [{ path: MEDIA_PATH, text: metaText(all) }], `ספריית מדיה: עדכון פרטים (${paths.length})`);
    await log(env, data.user, 'עדכון פרטי מדיה', paths.length === 1 ? all[paths[0]].title || paths[0].split('/').pop() : `${paths.length} קבצים`);
    return json({ ok: true, meta: all });
  } catch (e) {
    return bad(e.message, 502);
  }
}

export async function onRequestDelete({ request, env, data }) {
  const { paths = [] } = await body(request);
  const clean = paths.filter(okPath);
  if (!clean.length) return bad('לא נבחרו קבצים');
  try {
    const all = await readMeta(env);
    for (const p of clean) delete all[p];
    await commit(env, [...clean.map((p) => ({ path: `public${p}`, delete: true })), { path: MEDIA_PATH, text: metaText(all) }], `ספריית מדיה: מחיקת ${clean.length} קבצים`);
    await log(env, data.user, 'מחיקה מספריית המדיה', clean.map((p) => p.split('/').pop()).join(', '));
    return json({ ok: true, meta: all });
  } catch (e) {
    return bad(e.message, 502);
  }
}
