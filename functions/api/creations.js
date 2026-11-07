import { DATA_PATH, bad, body, checkFiles, commit, json, log, readJsonFile } from './_lib.js';

export async function onRequestGet({ env }) {
  try {
    const { sha, data } = await readJsonFile(env, DATA_PATH);
    return json({ sha, creations: data });
  } catch (e) {
    return bad(e.message, 502);
  }
}

function validate(creations) {
  if (!Array.isArray(creations)) return 'creations must be an array';
  const slugs = new Set();
  for (const c of creations) {
    if (!c || typeof c.title !== 'string' || !c.title.trim()) return 'כל יצירה צריכה כותרת';
    if (typeof c.slug !== 'string' || !/^[\p{L}\p{N}-]+$/u.test(c.slug)) return `כתובת לא תקינה: ${c.slug}`;
    if (slugs.has(c.slug)) return `הכתובת ${c.slug} קיימת פעמיים`;
    slugs.add(c.slug);
    if (!Array.isArray(c.steps) || !Array.isArray(c.materials) || !Array.isArray(c.intro)) return 'מבנה יצירה לא תקין';
  }
  return null;
}

export async function onRequestPut({ request, env, data }) {
  const { creations, files = [], baseSha, message, logAction, logDetail } = await body(request);
  const err = validate(creations) || checkFiles(files);
  if (err) return bad(err);
  try {
    const current = await readJsonFile(env, DATA_PATH);
    if (baseSha && current.sha !== baseSha) return bad('התוכן השתנה בינתיים (אולי ממכשיר אחר). רעננו את הדף ונסו שוב.', 409);
    const res = await commit(env, [...files, { path: DATA_PATH, text: JSON.stringify(creations, null, 1) + '\n' }], message || 'עדכון יצירות');
    await log(env, data.user, logAction || 'עדכון יצירות', logDetail || '');
    return json({ ok: true, sha: res.shas[DATA_PATH] });
  } catch (e) {
    return bad(e.message, 502);
  }
}
