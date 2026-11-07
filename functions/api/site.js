import { SITE_PATH, bad, mediaMetaChange, body, checkFiles, commit, json, log, readJsonFile } from './_lib.js';

export async function onRequestGet({ env }) {
  try {
    const { sha, data } = await readJsonFile(env, SITE_PATH);
    return json({ sha, site: data });
  } catch (e) {
    return bad(e.message, 502);
  }
}

export async function onRequestPut({ request, env, data }) {
  const { site, baseSha, files = [], section, mediaMeta } = await body(request);
  if (!site || typeof site !== 'object') return bad('נתונים חסרים');
  const err = checkFiles(files);
  if (err) return bad(err);
  try {
    const current = await readJsonFile(env, SITE_PATH);
    if (baseSha && current.sha !== baseSha) return bad('ההגדרות השתנו בינתיים. רעננו ונסו שוב.', 409);
    if (data.user.role !== 'owner') site.tracking = current.data.tracking;
    const mm = await mediaMetaChange(env, mediaMeta);
    const res = await commit(env, [...files, ...(mm ? [mm] : []), { path: SITE_PATH, text: JSON.stringify(site, null, 1) + '\n' }], `עדכון ${section || 'הגדרות האתר'}`);
    await log(env, data.user, `עדכון ${section || 'הגדרות האתר'}`);
    return json({ ok: true, sha: res.shas[SITE_PATH] });
  } catch (e) {
    return bad(e.message, 502);
  }
}
