// Admin panel for יצירונט — plain TypeScript, no framework.
// API: Cloudflare Pages Functions under /api. Content saves are commits to GitHub,
// which Cloudflare Pages rebuilds and publishes in ~1–2 minutes.
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';

type Step = { image: string | null; text: string };
type Download = { label: string; file: string; gated?: boolean } | null;
type Creation = {
  id: number; slug: string; oldSlug?: string; title: string; intro: string[]; materialsTitle: string;
  materials: string[]; cover: string; steps: Step[]; download: Download; order: number; published?: boolean;
};
type User = { id: string; name: string; email: string; role: 'owner' | 'editor'; createdAt: string; pending?: boolean; hasPassword?: boolean; passkeys: { id: string; name: string; createdAt: string; lastUsed?: string }[] };
type Site = Record<string, Record<string, any>>;

const app = document.getElementById('app')!;
const toastEl = document.getElementById('toast')!;

let me: User | null = null;
let route = 'dashboard';
let data: Creation[] = [];
let dataSha = '';
let site: Site = {};
let siteSha = '';
let draft: Creation | null = null;
let draftIsNew = false;
let dirty = false;
let busy = false;
const pending = new Map<string, { base64: string; url: string }>(); // public path -> file

// ---------- helpers ----------
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const $ = <T extends Element = HTMLElement>(sel: string) => app.querySelector(sel) as T | null;
const imgSrc = (p: string | null) => (p && pending.get(p)?.url) || p || '';
const sorted = () => data.slice().sort((a, b) => a.order - b.order);
const fmtDate = (s: string) => new Date(s).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const slugify = (s: string) => s.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80);

const svg = (d: string) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = {
  up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  down: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16v4z"/>'),
  eye: svg('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  home: svg('<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
  brush: svg('<path d="M14 4l6 6-9 9H5v-6z"/><path d="M12 6l6 6"/>'),
  image: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>'),
  text: svg('<path d="M4 6h16M4 12h10M4 18h16"/>'),
  inbox: svg('<path d="M4 4h16v12H15l-3 3-3-3H4z"/>'),
  file: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>'),
  users: svg('<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><circle cx="17" cy="9" r="2"/><path d="M16 15c3 0 5 2 5 4"/>'),
  code: svg('<path d="M8 8l-5 4 5 4M16 8l5 4-5 4M14 4l-4 16"/>'),
  key: svg('<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>'),
  finger: svg('<path d="M12 11v4M8 9a4 4 0 0 1 8 0v5c0 2-1 4-2 5M6 13v-2a6 6 0 0 1 12 0M9 19c1-1 1-3 1-5v-3"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  log: svg('<path d="M8 4h11v16H8"/><path d="M5 8h6M5 12h6M5 16h6"/>'),
  out: svg('<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>'),
  ext: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  draft: svg('<path d="M5 4h10l4 4v12H5z"/><path d="M9 12h6M9 16h4"/>'),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'),
};

function toast(msg: string, err = false, ms = 3500) {
  toastEl.textContent = msg;
  toastEl.className = err ? 'err' : '';
  toastEl.hidden = false;
  clearTimeout((toast as any).t);
  (toast as any).t = setTimeout(() => (toastEl.hidden = true), ms);
}

async function api(path: string, init: RequestInit & { json?: unknown } = {}) {
  const { json: payload, ...rest } = init;
  const r = await fetch(path, {
    ...rest,
    body: payload !== undefined ? JSON.stringify(payload) : rest.body,
    headers: { 'content-type': 'application/json', ...(rest.headers || {}) },
    credentials: 'same-origin',
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && !path.startsWith('/api/auth/')) { me = null; renderLogin('פג תוקף ההתחברות, התחברו שוב'); throw new Error('נדרשת התחברות'); }
  if (!r.ok) throw new Error(j.error || `שגיאה ${r.status}`);
  return j;
}

function fileToBase64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

async function resizeImage(file: File, max = 1600): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(b!), 'image/jpeg', 0.86));
}

let seq = 0;
async function prepareFile(file: File, folder: string): Promise<{ path: string; base64: string; url: string }> {
  if (file.type === 'image/svg+xml') throw new Error('קבצי SVG לא נתמכים מטעמי אבטחה — השתמשו ב-PNG או JPG');
  const keep = file.type === 'application/pdf' || file.type === 'image/gif';
  const blob = keep ? file : await resizeImage(file);
  const ext = file.type === 'application/pdf' ? 'pdf' : file.type === 'image/gif' ? 'gif' : 'jpg';
  const name = `${Date.now().toString(36)}${(seq++).toString(36)}.${ext}`;
  return { path: `/media/uploads/${folder || 'misc'}/${name}`, base64: await fileToBase64(blob), url: URL.createObjectURL(blob) };
}
async function addUpload(file: File, folder: string) {
  const f = await prepareFile(file, folder);
  pending.set(f.path, { base64: f.base64, url: f.url });
  return f.path;
}

function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((res) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.multiple = multiple;
    inp.onchange = () => res([...(inp.files || [])]);
    inp.click();
  });
}

const deviceName = () => {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'אייפון';
  if (/iPad/.test(ua)) return 'אייפד';
  if (/Android/.test(ua)) return 'אנדרואיד';
  if (/Mac/.test(ua)) return 'מק';
  if (/Windows/.test(ua)) return 'מחשב Windows';
  return 'מכשיר';
};

const isPhone = /Android|iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
const canPk = () => isPhone && browserSupportsWebAuthn();
const initial = (n?: string) => esc((n || '?').trim().charAt(0));
const greeting = () => { const h = new Date().getHours(); return h < 5 ? 'לילה טוב' : h < 12 ? 'בוקר טוב' : h < 17 ? 'צהריים טובים' : h < 21 ? 'ערב טוב' : 'לילה טוב'; };

// ---------- shell ----------
const NAV: [string, [string, string, string][]][] = [
  ['', [
    ['dashboard', 'לוח בקרה', I.home],
    ['activity', 'יומן פעילות', I.log],
    ['messages', 'פניות', I.inbox],
    ['leads', 'נרשמים', I.file],
  ]],
  ['תוכן האתר', [
    ['creations', 'יצירות', I.brush],
    ['media', 'ספריית מדיה', I.image],
    ['content', 'טקסטים ועמודים', I.text],
  ]],
  ['הגדרות', [
    ['users', 'משתמשים', I.users],
    ['tracking', 'קודי מעקב', I.code],
    ['account', 'החשבון שלי', I.key],
  ]],
];

function shell(inner: string) {
  const active = route.startsWith('creation') ? 'creations' : route;
  app.innerHTML = `
  <div class="layout">
    <aside class="side" aria-label="תפריט ניהול">
      <a class="brand" href="#dashboard"><img src="/logo-wordmark-light.png" alt="יצירונט" width="583" height="248" /><small>ניהול האתר</small></a>
      <nav>${NAV.map(([g, items]) => `${g ? `<div class="grp">${g}</div>` : ''}${items.map(([r, label, icon]) => `<a href="#${r}" ${active === r ? 'aria-current="page"' : ''}>${icon}<span>${label}</span></a>`).join('')}`).join('')}</nav>
      <div class="side-foot">
        <a href="/" target="_blank" rel="noopener">${I.ext}<span>לאתר</span></a>
        <div class="who"><span class="av">${initial(me?.name)}</span><div><b>${esc(me?.name)}</b><small>${me?.role === 'owner' ? 'מנהל ראשי' : 'עורך/ת'}</small></div>
          <button class="out" data-a="logout" aria-label="יציאה" title="יציאה">${I.out}</button></div>
      </div>
    </aside>
    <div class="scrim" data-a="menu"></div>
    <div class="main">
      <header class="mbar"><button class="btn icon" data-a="menu" aria-label="תפריט">${I.menu}</button><img src="/logo-wordmark.png" alt="יצירונט" width="583" height="248" /><span class="sp"></span><a class="btn icon" href="/" target="_blank" rel="noopener" aria-label="לאתר">${I.ext}</a></header>
      <main class="wrap">${inner}</main>
    </div>
  </div>`;
}

function go(r: string) {
  dirty = false;
  pending.clear();
  route = r;
  if (location.hash !== `#${r}`) history.pushState(null, '', `#${r}`);
  render();
}

async function render() {
  document.body.classList.remove('nav-open');
  const r = route;
  try {
    if (r === 'dashboard') return await renderDashboard();
    if (r === 'activity') return await renderActivity();
    if (r === 'creations') return await renderCreations();
    if (r.startsWith('creation:')) return await renderEditor(r.slice(9));
    if (r === 'media') return await renderMedia();
    if (r === 'content') return await renderContent();
    if (r === 'messages') return await renderMessages();
    if (r === 'leads') return await renderLeads();
    if (r === 'users') return await renderUsers();
    if (r === 'tracking') return await renderTracking();
    if (r === 'account') return await renderAccount();
    route = 'dashboard';
    return renderDashboard();
  } catch (e) {
    if ((e as Error).message !== 'נדרשת התחברות') shell(`<p class="empty">${esc((e as Error).message)}</p>`);
  }
}

const loading = (title: string) => shell(`<div class="head"><h1>${title}</h1></div><p class="boot">טוען…</p>`);

async function loadCreations(force = false) {
  if (data.length && !force) return;
  const j = await api('/api/creations');
  data = j.creations;
  dataSha = j.sha;
}
async function loadSite(force = false) {
  if (siteSha && !force) return;
  const j = await api('/api/site');
  site = j.site;
  siteSha = j.sha;
}

// ---------- auth screens ----------
function authShell(inner: string) {
  app.innerHTML = `<main class="login"><img src="/logo-wordmark.png" alt="יצירונט" width="583" height="248" />${inner}</main>`;
}

function renderLogin(msg = '') {
  const pk = canPk();
  authShell(`
    <h1>כניסה ללוח הבקרה</h1>
    ${pk ? `<button class="btn pink big" data-a="pk-login">${I.finger} כניסה עם טביעת אצבע</button><div class="or">או</div>` : ''}
    <form id="pw-login" class="stack">
      <input class="input ltr" type="email" name="email" placeholder="אימייל" autocomplete="username" required aria-label="אימייל" />
      <input class="input ltr" type="password" name="password" placeholder="סיסמה" autocomplete="current-password" required aria-label="סיסמה" />
      <button class="btn ${pk ? 'ghost' : 'pink'}" type="submit">${pk ? 'כניסה עם סיסמה' : 'כניסה'}</button>
    </form>
    <p role="alert" class="err-msg">${esc(msg)}</p>`);
  const f = document.getElementById('pw-login') as HTMLFormElement;
  f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/auth/login', { method: 'POST', json: Object.fromEntries(new FormData(f)) });
      await afterLogin();
    } catch (err) { renderLogin((err as Error).message); }
  };
}

async function passkeyLogin() {
  try {
    const { options, cid } = await api('/api/auth/passkey-login-options', { method: 'POST', json: {} });
    const response = await startAuthentication({ optionsJSON: options });
    await api('/api/auth/passkey-login', { method: 'POST', json: { cid, response } });
    await afterLogin();
  } catch (e) {
    renderLogin((e as Error).name === 'NotAllowedError' ? 'הכניסה בוטלה' : (e as Error).message);
  }
}

async function registerPasskey(invite?: string) {
  const options = await api('/api/auth/passkey-register-options', { method: 'POST', json: { invite } });
  const response = await startRegistration({ optionsJSON: options });
  await api('/api/auth/passkey-register', { method: 'POST', json: { response, invite, name: deviceName() } });
}

function renderSetup(msg = '') {
  authShell(`
    <h1>הקמת לוח הבקרה</h1>
    <p class="muted">פעם ראשונה: יוצרים את המשתמש הראשי עם קוד ההפעלה.</p>
    <form id="setup" class="stack">
      <input class="input ltr" name="code" placeholder="קוד הפעלה" required aria-label="קוד הפעלה" autocomplete="off" />
      <input class="input" name="name" placeholder="השם שלך" required aria-label="שם" autocomplete="name" />
      <input class="input ltr" type="email" name="email" placeholder="אימייל" required aria-label="אימייל" autocomplete="username" />
      <input class="input ltr" type="password" name="password" placeholder="סיסמה (8 תווים לפחות)" minlength="8" required aria-label="סיסמה" autocomplete="new-password" />
      <button class="btn pink" type="submit">יצירת המשתמש</button>
    </form>
    <p role="alert" class="err-msg">${esc(msg)}</p>`);
  const f = document.getElementById('setup') as HTMLFormElement;
  f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/auth/setup', { method: 'POST', json: Object.fromEntries(new FormData(f)) });
      await afterLogin(true);
    } catch (err) { renderSetup((err as Error).message); }
  };
}

async function renderInvite(code: string) {
  let info: { name: string; email: string };
  try { info = await api(`/api/auth/invite?code=${encodeURIComponent(code)}`); }
  catch (e) { authShell(`<h1>ההזמנה לא תקפה</h1><p class="muted">${esc((e as Error).message)}</p>`); return; }
  authShell(`
    <h1>שלום ${esc(info.name)}!</h1>
    ${canPk() ? `<p class="muted">הוזמנת לנהל את יצירונט. רשמו טביעת אצבע בטלפון — ככה תיכנסו מעכשיו.</p>
    <button class="btn pink big" data-a="invite-pk">${I.finger} רישום טביעת אצבע</button>
    <details class="pw-alt"><summary>להגדיר גם סיסמה לכניסה מהמחשב</summary>${'%FORM%'}</details>` : `<p class="muted">הוזמנת לנהל את יצירונט. בחרו סיסמה לכניסה מהמחשב. טביעת אצבע נרשמת אחר כך מהטלפון.</p>${'%FORM%'}`}`.replaceAll('%FORM%', `<form id="inv-pw" class="stack"><input class="input ltr" type="password" name="password" minlength="8" placeholder="סיסמה (8 תווים לפחות)" autocomplete="new-password" aria-label="סיסמה" />
      <button class="btn ${canPk() ? 'ghost' : 'pink'}" type="submit">שמירת סיסמה</button></form>`));
  (app as any).dataset.invite = code;
  const f = document.getElementById('inv-pw') as HTMLFormElement;
  f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/auth/invite', { method: 'POST', json: { code, password: (f.elements.namedItem('password') as HTMLInputElement).value } });
      if (canPk()) toast('הסיסמה נשמרה. עכשיו רשמו טביעת אצבע.');
      else { history.replaceState(null, '', location.pathname); toast('הסיסמה נשמרה — אפשר להיכנס'); renderLogin(); }
    }
    catch (err) { toast((err as Error).message, true); }
  };
}

async function afterLogin(offerPasskey = false) {
  const j = await api('/api/auth/me');
  me = j.user;
  if (!me) return renderLogin();
  route = offerPasskey && canPk() ? 'account' : location.hash.slice(1) || 'dashboard';
  history.replaceState(null, '', `#${route}`);
  render();
}

// ---------- dashboard ----------
const statCard = (href: string, tone: string, icon: string, n: number, label: string) =>
  `<a class="stat ${tone}" href="${href}"><span class="ic">${icon}</span><span class="lbl">${label}</span><b>${n}</b></a>`;
const actRow = (l: any) => `<li><span class="dot"></span><div><b>${esc(l.user)}</b> · ${esc(l.action)}${l.detail ? `<span class="muted"> — ${esc(l.detail)}</span>` : ''}</div><time>${fmtDate(l.at)}</time></li>`;

async function renderDashboard() {
  loading('לוח בקרה');
  const [, msgs, leads, act] = await Promise.all([
    loadCreations(), api('/api/contact').catch(() => ({ messages: [] })),
    api('/api/lead').catch(() => ({ leads: [] })), api('/api/activity').catch(() => ({ log: [] })),
  ]);
  const unread = msgs.messages.filter((m: any) => !m.read).length;
  const drafts = data.filter((c) => c.published === false).length;
  const today = new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
  shell(`
    <div class="head"><div><h1>${greeting()}, ${esc(me?.name?.split(' ')[0])}</h1><p class="sub">${today}</p></div>
      <div class="row3"><a class="btn ghost" href="/" target="_blank" rel="noopener">${I.ext} צפייה באתר</a><a class="btn pink" href="#creation:new">${I.plus} יצירה חדשה</a></div></div>
    ${isPhone && me && !me.passkeys.length ? `<a class="notice" href="#account">${I.finger} עוד לא רשמת טביעת אצבע בטלפון — לחצו כאן לרישום</a>` : ''}
    <div class="stats">
      ${statCard('#messages', 'pink', I.mail, unread, 'פניות שלא נקראו')}
      ${statCard('#creations', 'teal', I.brush, data.length - drafts, 'יצירות באתר')}
      ${statCard('#creations', 'yellow', I.draft, drafts, 'טיוטות')}
      ${statCard('#leads', 'violet', I.file, leads.leads.length, 'נרשמים לקבצים')}
    </div>
    <div class="cols">
      <section class="card"><h2>פניות אחרונות <a class="link" href="#messages">לכל הפניות ←</a></h2>
        ${msgs.messages.length ? `<ul class="rows">${msgs.messages.slice(0, 6).map((m: any) => `<li class="${m.read ? '' : 'new'}"><span class="av sm">${initial(m.name)}</span><div><b>${esc(m.name)}</b><p>${esc(m.message.slice(0, 110))}</p></div><time>${fmtDate(m.at)}</time></li>`).join('')}</ul>` : `<div class="blank">${I.inbox}<p>אין עדיין פניות</p></div>`}
      </section>
      <section class="card"><h2>יומן פעילות <a class="link" href="#activity">הכל ←</a></h2>
        ${act.log.length ? `<ul class="timeline">${act.log.slice(0, 7).map(actRow).join('')}</ul>` : `<div class="blank">${I.log}<p>אין עדיין פעילות</p></div>`}
      </section>
    </div>`);
}

async function renderActivity() {
  loading('יומן פעילות');
  const act = await api('/api/activity');
  shell(`<div class="head"><div><h1>יומן פעילות</h1><p class="sub">כל מה שנעשה בלוח הבקרה — מי, מה ומתי</p></div></div>
    <section class="card">${act.log.length ? `<ul class="timeline">${act.log.map(actRow).join('')}</ul>` : `<div class="blank">${I.log}<p>אין עדיין פעילות</p></div>`}</section>`);
}

// ---------- creations ----------
async function renderCreations() {
  loading('יצירות');
  await loadCreations(true);
  const list = sorted();
  shell(`
    <div class="head"><h1>יצירות</h1><a class="btn pink" href="#creation:new">+ יצירה חדשה</a></div>
    <div class="items">${list.length ? list.map((c, i) => `
      <div class="item">
        ${c.cover ? `<img src="${esc(c.cover)}" alt="" loading="lazy" />` : '<div class="noimg"></div>'}
        <div>
          <h2>${esc(c.title)}</h2>
          <div class="meta"><span class="badge ${c.published === false ? 'off' : 'on'}">${c.published === false ? 'טיוטה' : 'מפורסם'}</span><span>${c.steps.length} שלבים</span></div>
        </div>
        <div class="acts">
          <button class="btn icon" data-a="move" data-id="${c.id}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="הזזה למעלה">${I.up}</button>
          <button class="btn icon" data-a="move" data-id="${c.id}" data-d="1" ${i === list.length - 1 ? 'disabled' : ''} aria-label="הזזה למטה">${I.down}</button>
          <a class="btn small" href="#creation:${c.id}">${I.edit} עריכה</a>
        </div>
      </div>`).join('') : '<p class="empty">אין עדיין יצירות</p>'}
    </div>`);
}

async function saveCreations(next: Creation[], files: { path: string; base64: string }[], message: string, logAction: string, logDetail: string) {
  busy = true;
  try {
    const j = await api('/api/creations', { method: 'PUT', json: { creations: next, files, baseSha: dataSha, message, logAction, logDetail } });
    data = next;
    dataSha = j.sha;
    return true;
  } catch (e) {
    toast((e as Error).message, true, 6000);
    return false;
  } finally { busy = false; }
}

async function move(id: number, d: number) {
  if (busy) return;
  const list = sorted();
  const i = list.findIndex((c) => c.id === id);
  const j = i + d;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  const next = list.map((c, k) => ({ ...c, order: k }));
  if (await saveCreations(next, [], `שינוי סדר: ${list[j].title}`, 'שינוי סדר יצירות', list[j].title)) { renderCreations(); toast('הסדר נשמר — יתעדכן באתר תוך כ-2 דקות'); }
}

const newCreation = (): Creation => ({ id: Date.now(), slug: '', title: '', intro: [], materialsTitle: 'מה דרוש לנו?', materials: [''], cover: '', steps: [{ image: null, text: '' }], download: null, order: -1, published: false });
const folderOf = (c: Creation) => c.slug || slugify(c.title) || 'new';

async function renderEditor(id: string) {
  if (!draft || String(draft.id) !== id) {
    loading('עריכת יצירה');
    await loadCreations();
    const c = id === 'new' ? null : data.find((x) => String(x.id) === id);
    if (id !== 'new' && !c) { toast('היצירה לא נמצאה', true); return go('creations'); }
    draftIsNew = !c;
    draft = c ? structuredClone(c) : newCreation();
    if (draftIsNew) { route = `creation:${draft.id}`; history.replaceState(null, '', `#${route}`); }
  }
  const c = draft;
  shell(`
    <div class="head"><a class="btn ghost small" href="#creations">→ כל היצירות</a>
      ${!draftIsNew && c.published !== false ? `<a class="btn ghost small" href="/${esc(c.slug)}/" target="_blank" rel="noopener">${I.eye} צפייה באתר</a>` : ''}</div>
    <section class="card">
      <h2>פרטי היצירה <label class="switch"><input type="checkbox" data-f="published" ${c.published !== false ? 'checked' : ''} /> מפורסם באתר</label></h2>
      <label class="field"><span>כותרת</span><input class="input" data-f="title" value="${esc(c.title)}" placeholder="למשל: שעון ממקשי מקלדת" /></label>
      <label class="field"><span>כתובת הדף</span><input class="input" data-f="slug" value="${esc(c.slug)}" />
        <small>yetzironet.co.il/<b data-slug-preview>${esc(c.slug)}</b>/ ${draftIsNew ? '— נוצרת אוטומטית מהכותרת' : '— שינוי הכתובת ישבור קישורים ישנים'}</small></label>
      <label class="field"><span>פתיח</span><textarea class="input" data-f="intro" rows="5" placeholder="כמה מילים על היצירה. שורה ריקה = פסקה חדשה">${esc(c.intro.join('\n\n'))}</textarea></label>
      <div class="field"><span>תמונה ראשית</span>
        <div class="photo cover" data-a="cover" role="button" tabindex="0" aria-label="בחירת תמונה ראשית">
          ${c.cover ? `<img src="${esc(imgSrc(c.cover))}" alt="" /><span class="chg">החלפה</span>` : 'לחצו להעלאת תמונה'}
        </div></div>
    </section>
    <section class="card">
      <h2>חומרים</h2>
      <label class="field"><span>כותרת הרשימה</span><input class="input" data-f="materialsTitle" value="${esc(c.materialsTitle)}" /></label>
      ${c.materials.map((m, i) => `<div class="mat"><input class="input" data-mat="${i}" value="${esc(m)}" placeholder="חומר" aria-label="חומר ${i + 1}" />
        <button class="btn icon danger" data-a="mat-del" data-i="${i}" aria-label="מחיקת חומר">${I.trash}</button></div>`).join('')}
      <button class="btn ghost small" data-a="mat-add">+ הוספת חומר</button>
    </section>
    <section class="card">
      <h2>שלבי הכנה <span class="muted small">${c.steps.length} שלבים</span></h2>
      <div class="steps">${c.steps.map((s, i) => `
        <div class="step">
          <div class="photo" data-a="step-img" data-i="${i}" role="button" tabindex="0" aria-label="תמונה לשלב ${i + 1}">
            ${s.image ? `<img src="${esc(imgSrc(s.image))}" alt="" /><span class="chg">החלפה</span>` : 'לחצו להוספת תמונה'}
          </div>
          <div>
            <div class="top"><span class="num">${i + 1}</span><span class="sp"></span>
              <button class="btn icon" data-a="step-move" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="הזזת שלב למעלה">${I.up}</button>
              <button class="btn icon" data-a="step-move" data-i="${i}" data-d="1" ${i === c.steps.length - 1 ? 'disabled' : ''} aria-label="הזזת שלב למטה">${I.down}</button>
              ${s.image ? `<button class="btn icon" data-a="step-noimg" data-i="${i}" aria-label="הסרת התמונה">×</button>` : ''}
              <button class="btn icon danger" data-a="step-del" data-i="${i}" aria-label="מחיקת שלב">${I.trash}</button>
            </div>
            <textarea class="input" data-step="${i}" placeholder="מה עושים בשלב הזה?" aria-label="טקסט שלב ${i + 1}">${esc(s.text)}</textarea>
          </div>
        </div>`).join('')}</div>
      <div class="addrow"><button class="btn teal" data-a="step-add">+ הוספת שלב</button>
        <button class="btn ghost" data-a="steps-from-photos">+ כמה שלבים מתמונות</button></div>
    </section>
    <section class="card">
      <h2>קובץ להורדה <span class="muted small">לא חובה</span></h2>
      ${c.download ? `
        <div class="field"><span class="file-pill">${I.file} ${esc(c.download.file.split('/').pop())}</span></div>
        <label class="field"><span>טקסט הכפתור</span><input class="input" data-f="dl-label" value="${esc(c.download.label)}" /></label>
        <label class="switch"><input type="checkbox" data-f="dl-gated" ${c.download.gated ? 'checked' : ''} /> לקבל את הקובץ רק אחרי הרשמה (שם ואימייל)</label>
        <div style="margin-top:14px"><button class="btn danger small" data-a="dl-del">הסרת הקובץ</button></div>`
      : `<button class="btn ghost" data-a="dl-add">+ צירוף קובץ PDF</button>`}
    </section>
    ${!draftIsNew ? `<button class="btn danger" data-a="delete">${I.trash} מחיקת היצירה</button>` : ''}
    <div class="savebar"><div class="in"><span class="st" data-st>${dirty ? 'יש שינויים שלא נשמרו' : 'הכל שמור'}</span>
      <button class="btn pink" data-a="save">שמירה ופרסום</button></div></div>`);
}

function markDirty() {
  dirty = true;
  const st = $('[data-st]');
  if (st) st.textContent = 'יש שינויים שלא נשמרו';
}

async function saveDraft() {
  if (busy || !draft) return;
  const c = draft;
  c.title = c.title.trim();
  if (!c.title) return toast('חסרה כותרת', true);
  if (!c.slug) c.slug = slugify(c.title);
  if (!c.slug) return toast('חסרה כתובת לדף', true);
  if (data.some((x) => x.slug === c.slug && x.id !== c.id)) return toast('כבר יש יצירה עם הכתובת הזאת', true);
  c.materials = c.materials.map((m) => m.trim()).filter(Boolean);
  c.steps = c.steps.filter((s) => s.image || s.text.trim()).map((s) => ({ image: s.image, text: s.text.trim() }));
  if (!c.cover) c.cover = c.steps.find((s) => s.image)?.image || '';
  let next = data.filter((x) => x.id !== c.id);
  next.push(draftIsNew ? { ...c, order: -1 } : c);
  next = next.sort((a, b) => a.order - b.order).map((x, k) => ({ ...x, order: k }));
  const used = new Set([c.cover, c.download?.file, ...c.steps.map((s) => s.image)].filter(Boolean) as string[]);
  const files = [...pending].filter(([p]) => used.has(p)).map(([p, f]) => ({ path: `public${p}`, base64: f.base64 }));
  const btn = $<HTMLButtonElement>('[data-a="save"]')!;
  btn.disabled = true;
  const st = $('[data-st]')!;
  st.textContent = files.length ? `שומר ומעלה ${files.length} קבצים…` : 'שומר…';
  const ok = await saveCreations(next, files, `${draftIsNew ? 'יצירה חדשה' : 'עדכון'}: ${c.title}`, draftIsNew ? 'יצירה חדשה' : 'עדכון יצירה', c.title);
  btn.disabled = false;
  if (!ok) { st.textContent = 'השמירה נכשלה'; return; }
  pending.clear();
  dirty = false;
  draftIsNew = false;
  draft = structuredClone(next.find((x) => x.id === c.id)!);
  renderEditor(String(draft.id));
  toast(c.published === false ? 'נשמר כטיוטה' : 'נשמר! יתעדכן באתר תוך כ-2 דקות', false, 5000);
}

// ---------- media library ----------
let mediaFilter = 'all';
async function renderMedia() {
  loading('ספריית מדיה');
  const [{ files }] = await Promise.all([api('/api/media'), loadCreations(), loadSite()]);
  const usedIn = new Map<string, string>();
  for (const c of data) for (const p of [c.cover, c.download?.file, ...c.steps.map((s) => s.image)]) if (p) usedIn.set(p, c.title);
  for (const sec of Object.values(site)) for (const v of Object.values(sec || {})) if (typeof v === 'string' && v.startsWith('/media/')) usedIn.set(v, 'תוכן האתר');
  const all = files as { path: string; size: number }[];
  const list = all
    .filter((f) => mediaFilter === 'all' || (mediaFilter === 'unused' ? !usedIn.has(f.path) : f.path.endsWith('.pdf')))
    .sort((a, b) => (a.path < b.path ? 1 : -1));
  shell(`
    <div class="head"><h1>ספריית מדיה</h1><button class="btn pink" data-a="media-upload">+ העלאת קבצים</button></div>
    <div class="filters">
      ${[['all', `הכל (${all.length})`], ['unused', 'לא בשימוש'], ['pdf', 'קבצי PDF']].map(([k, l]) => `<button class="chip" data-a="media-filter" data-k="${k}" aria-pressed="${mediaFilter === k}">${l}</button>`).join('')}
    </div>
    <div class="media">${list.map((f) => `
      <figure class="mfile">
        ${/\.pdf$/i.test(f.path) ? `<div class="pdf">PDF</div>` : `<img src="${esc(f.path)}" alt="" loading="lazy" />`}
        <figcaption><span title="${esc(f.path)}">${esc(f.path.split('/').pop())}</span>
          <small>${usedIn.has(f.path) ? `בשימוש: ${esc(usedIn.get(f.path))}` : `${Math.round(f.size / 1024)}KB`}</small></figcaption>
        <div class="macts">
          <button class="btn icon" data-a="media-copy" data-p="${esc(f.path)}" aria-label="העתקת קישור">${I.copy}</button>
          <button class="btn icon danger" data-a="media-del" data-p="${esc(f.path)}" ${usedIn.has(f.path) ? 'disabled title="בשימוש"' : ''} aria-label="מחיקה">${I.trash}</button>
        </div>
      </figure>`).join('') || '<p class="empty">אין קבצים</p>'}
    </div>`);
}

// ---------- site content ----------
type FieldDef = [string, string, 'text' | 'area' | 'image'];
const CONTENT: [string, string, FieldDef[]][] = [
  ['home', 'דף הבית', [
    ['heroTitle1', 'כותרת ראשית — שורה 1', 'text'], ['heroTitle2', 'כותרת ראשית — שורה 2 (מודגשת)', 'text'],
    ['heroText', 'טקסט מתחת לכותרת', 'area'], ['heroButton', 'טקסט הכפתור', 'text'], ['heroImage', 'תמונה ראשית', 'image'],
    ['welcomeTitle1', '"ברוכים הבאים" — חלק 1', 'text'], ['welcomeTitle2', '"ברוכים הבאים" — חלק 2 (צבעוני)', 'text'], ['welcomeText', 'טקסט ברוכים הבאים', 'area'],
    ['featuredTitle', 'כותרת היצירות הנבחרות', 'text'], ['moreTitle', 'כותרת "עוד יצירות"', 'text'], ['storyTitle', 'כותרת היצירה המומלצת', 'text'],
  ]],
  ['gallery', 'דף השראות ויצירות', [['title', 'כותרת', 'text'], ['text', 'טקסט מתחת לכותרת', 'text']]],
  ['creationPage', 'עמוד יצירה', [['closingTitle', 'כותרת הסיום', 'text'], ['closingText', 'טקסט הסיום', 'area'], ['closingButton', 'כפתור וואטסאפ', 'text']]],
  ['footer', 'פוטר', [['tagline', 'משפט מתחת ללוגו', 'area'], ['phone', 'טלפון להצגה', 'text'], ['formTitle', 'כותרת הטופס', 'text'], ['rights', 'זכויות', 'text'], ['note', 'הערה', 'text']]],
  ['contact', 'טופס "יש לכם רעיון ליצירה"', [['whatsapp', 'מספר הוואטסאפ שמקבל את הפניות (בפורמט 9725XXXXXXXX)', 'text']]],
  ['seo', 'גוגל ושיתוף', [['title', 'כותרת האתר בגוגל', 'text'], ['description', 'תיאור האתר בגוגל', 'area']]],
];

async function renderContent() {
  loading('תוכן האתר');
  await Promise.all([loadSite(!dirty), loadCreations()]);
  const v = (sec: string, k: string) => site[sec]?.[k] ?? '';
  shell(`
    <div class="head"><h1>תוכן האתר</h1></div>
    ${CONTENT.map(([sec, title, fields]) => `
      <section class="card"><h2>${title}</h2>
        ${fields.map(([k, label, type]) => type === 'image' ? `
          <div class="field"><span>${label}</span><div class="photo cover" data-a="site-img" data-sec="${sec}" data-k="${k}" role="button" tabindex="0" aria-label="${label}">
            <img src="${esc(imgSrc(v(sec, k)))}" alt="" /><span class="chg">החלפה</span></div></div>`
        : `<label class="field"><span>${label}</span>${type === 'area'
          ? `<textarea class="input" data-sec="${sec}" data-k="${k}" rows="4">${esc(v(sec, k))}</textarea>`
          : `<input class="input ${k === 'whatsapp' || k === 'phone' ? 'ltr' : ''}" data-sec="${sec}" data-k="${k}" value="${esc(v(sec, k))}" />`}</label>`).join('')}
        ${sec === 'home' ? `<label class="field"><span>היצירה המומלצת בדף הבית</span><select class="input" data-sec="home" data-k="storySlug">
          ${sorted().map((c) => `<option value="${esc(c.slug)}" ${c.slug === v('home', 'storySlug') ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}</select></label>` : ''}
        ${sec === 'contact' ? `<label class="switch"><input type="checkbox" data-sec="contact" data-k="saveCopy" ${site.contact?.saveCopy ? 'checked' : ''} /> לשמור עותק של כל פנייה גם כאן בלוח הבקרה</label>` : ''}
      </section>`).join('')}
    <div class="savebar"><div class="in"><span class="st" data-st>${dirty ? 'יש שינויים שלא נשמרו' : 'הכל שמור'}</span>
      <button class="btn pink" data-a="site-save" data-section="תוכן האתר">שמירה ופרסום</button></div></div>`);
}

async function saveSite(section: string) {
  if (busy) return;
  busy = true;
  const used = new Set(Object.values(site).flatMap((o) => Object.values(o || {})).filter((x) => typeof x === 'string'));
  const files = [...pending].filter(([p]) => used.has(p)).map(([p, f]) => ({ path: `public${p}`, base64: f.base64 }));
  const st = $('[data-st]');
  if (st) st.textContent = 'שומר…';
  try {
    const j = await api('/api/site', { method: 'PUT', json: { site, baseSha: siteSha, files, section } });
    siteSha = j.sha;
    dirty = false;
    pending.clear();
    if (st) st.textContent = 'הכל שמור';
    toast('נשמר! יתעדכן באתר תוך כ-2 דקות', false, 5000);
  } catch (e) {
    toast((e as Error).message, true, 6000);
    if (st) st.textContent = 'השמירה נכשלה';
  } finally { busy = false; }
}

// ---------- tracking ----------
async function renderTracking() {
  loading('קודי מעקב');
  await loadSite(!dirty);
  const t = site.tracking || {};
  shell(`
    <div class="head"><h1>קודי מעקב</h1></div>
    <section class="card"><h2>Google</h2>
      <label class="field"><span>Google Analytics 4 — Measurement ID</span><input class="input ltr" data-sec="tracking" data-k="ga4" value="${esc(t.ga4)}" placeholder="G-XXXXXXXXXX" /></label>
      <label class="field"><span>Google Tag Manager — Container ID</span><input class="input ltr" data-sec="tracking" data-k="gtm" value="${esc(t.gtm)}" placeholder="GTM-XXXXXXX" />
        <small>אם משתמשים ב-Tag Manager, עדיף להגדיר את Analytics בתוכו ולהשאיר את השדה הראשון ריק.</small></label>
    </section>
    <section class="card"><h2>קוד חופשי</h2>
      <label class="field"><span>קוד בתוך &lt;head&gt;</span><textarea class="input ltr code" data-sec="tracking" data-k="headCode" rows="6" placeholder="&lt;script&gt;…&lt;/script&gt;">${esc(t.headCode)}</textarea>
        <small>למשל: פיקסל של פייסבוק או אימות Search Console. הקוד רץ בכל עמודי האתר — הדביקו רק קוד ממקור שאתם סומכים עליו.</small></label>
      <label class="field"><span>קוד בסוף &lt;body&gt;</span><textarea class="input ltr code" data-sec="tracking" data-k="bodyCode" rows="5">${esc(t.bodyCode)}</textarea></label>
    </section>
    <div class="savebar"><div class="in"><span class="st" data-st>${dirty ? 'יש שינויים שלא נשמרו' : 'הכל שמור'}</span>
      <button class="btn pink" data-a="site-save" data-section="קודי מעקב">שמירה ופרסום</button></div></div>`);
}

// ---------- messages ----------
async function renderMessages() {
  loading('פניות');
  const [{ messages }] = await Promise.all([api('/api/contact'), loadSite()]);
  shell(`
    <div class="head"><h1>פניות מהאתר</h1><a class="btn ghost small" href="#content">הגדרות הטופס</a></div>
    <p class="muted">הטופס "יש לכם רעיון ליצירה?" שולח את הפנייה לוואטסאפ <span class="ltr-inline">${esc(site.contact?.whatsapp || '')}</span>${site.contact?.saveCopy ? ' ושומר כאן עותק.' : '. שמירת עותק כאן כבויה.'}</p>
    <div class="items">${messages.length ? messages.map((m: any) => `
      <div class="msg ${m.read ? '' : 'new'}">
        <div class="mhead"><b>${esc(m.name)}</b>${m.phone ? ` · <a href="tel:${esc(m.phone)}">${esc(m.phone)}</a>` : ''}<span class="sp"></span><small>${fmtDate(m.at)}</small></div>
        <p>${esc(m.message)}</p>
        <div class="acts">
          ${m.phone ? `<a class="btn small teal" href="https://wa.me/${esc(m.phone.replace(/\D/g, '').replace(/^0/, '972'))}" target="_blank" rel="noopener">מענה בוואטסאפ</a>` : ''}
          <button class="btn ghost small" data-a="msg-read" data-k="${esc(m.key)}" data-v="${m.read ? '' : '1'}">${m.read ? 'סימון כלא נקרא' : 'סימון כנקרא'}</button>
          <button class="btn icon danger" data-a="msg-del" data-k="${esc(m.key)}" aria-label="מחיקה">${I.trash}</button>
        </div>
      </div>`).join('') : '<p class="empty">אין עדיין פניות</p>'}</div>`);
}

// ---------- leads ----------
let leadsCache: any[] = [];
async function renderLeads() {
  loading('נרשמים');
  const [{ leads }] = await Promise.all([api('/api/lead'), loadCreations()]);
  leadsCache = leads;
  const title = (slug: string) => data.find((c) => c.slug === slug)?.title || slug;
  shell(`
    <div class="head"><h1>נרשמים לקבצים</h1>${leads.length ? '<button class="btn ghost small" data-a="csv">הורדה לאקסל</button>' : ''}</div>
    ${leads.length ? `<div class="tablewrap"><table class="leads"><thead><tr><th>שם</th><th>אימייל</th><th>טלפון</th><th>יצירה</th><th>עדכונים</th><th>תאריך</th><th></th></tr></thead><tbody>
      ${leads.map((l: any) => `<tr><td>${esc(l.name)}</td><td><a href="mailto:${esc(l.email)}">${esc(l.email)}</a></td><td>${esc(l.phone)}</td>
        <td>${esc(title(l.slug))}</td><td>${l.updates ? 'כן' : 'לא'}</td><td>${fmtDate(l.at)}</td>
        <td><button class="btn icon danger" data-a="lead-del" data-k="${esc(l.key)}" aria-label="מחיקה">${I.trash}</button></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="empty">עדיין אין נרשמים</p>'}`);
}

function downloadCsv() {
  const rows = [['שם', 'אימייל', 'טלפון', 'יצירה', 'מעוניין בעדכונים', 'תאריך'], ...leadsCache.map((l) => [l.name, l.email, l.phone, l.slug, l.updates ? 'כן' : 'לא', l.at])];
  const csv = '﻿' + rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'nirshamim.csv';
  a.click();
}

// ---------- users ----------
async function renderUsers() {
  loading('משתמשים');
  const { users } = await api('/api/users');
  const owner = me?.role === 'owner';
  shell(`
    <div class="head"><h1>משתמשים</h1></div>
    <div class="items">${(users as User[]).map((u) => `
      <div class="item user">
        <div class="avatar">${esc(u.name.slice(0, 1))}</div>
        <div><h2>${esc(u.name)} ${u.id === me?.id ? '<span class="muted small">(את/ה)</span>' : ''}</h2>
          <div class="meta"><span>${esc(u.email)}</span><span class="badge ${u.pending ? 'off' : 'on'}">${u.pending ? 'ממתין להצטרפות' : u.role === 'owner' ? 'בעלים' : 'עורך/ת'}</span>
          <span>${u.passkeys.length} טביעות אצבע</span></div></div>
        <div class="acts">${owner && u.id !== me?.id ? `
          ${u.pending ? `<button class="btn ghost small" data-a="user-link" data-id="${u.id}">קישור הזמנה</button>` : ''}
          <button class="btn icon danger" data-a="user-del" data-id="${u.id}" data-n="${esc(u.name)}" aria-label="מחיקת משתמש">${I.trash}</button>` : ''}</div>
      </div>`).join('')}</div>
    ${owner ? `<section class="card" style="margin-top:20px"><h2>הוספת משתמש</h2>
      <form id="invite" class="row3">
        <input class="input" name="name" placeholder="שם" required aria-label="שם" />
        <input class="input ltr" type="email" name="email" placeholder="אימייל" required aria-label="אימייל" />
        <select class="input" name="role" aria-label="הרשאה"><option value="editor">עורך/ת — תוכן בלבד</option><option value="owner">בעלים — הכל כולל משתמשים</option></select>
        <button class="btn pink" type="submit">יצירת הזמנה</button>
      </form>
      <div id="invite-out"></div></section>` : ''}`);
  const f = document.getElementById('invite') as HTMLFormElement | null;
  if (f) f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const j = await api('/api/users', { method: 'POST', json: Object.fromEntries(new FormData(f)) });
      await renderUsers();
      showInvite(j.code);
    } catch (err) { toast((err as Error).message, true); }
  };
}

function showInvite(code: string) {
  const link = `${location.origin}${location.pathname}?invite=${code}`;
  const out = document.getElementById('invite-out');
  if (!out) return;
  out.innerHTML = `<div class="invite-box"><p><b>שלחו את הקישור הזה למשתמש החדש</b> (בתוקף 7 ימים). בפתיחה הוא ירשום טביעת אצבע במכשיר שלו.</p>
    <input class="input ltr" readonly value="${esc(link)}" aria-label="קישור הזמנה" />
    <div class="acts"><button class="btn small" data-a="copy" data-v="${esc(link)}">${I.copy} העתקה</button>
    <a class="btn small teal" href="https://wa.me/?text=${encodeURIComponent(`הזמנה לניהול האתר יצירונט: ${link}`)}" target="_blank" rel="noopener">שליחה בוואטסאפ</a></div></div>`;
  out.scrollIntoView({ block: 'center' });
}

// ---------- account ----------
async function renderAccount() {
  const j = await api('/api/auth/me');
  me = j.user;
  const pk = canPk();
  shell(`
    <div class="head"><h1>החשבון שלי</h1></div>
    <section class="card"><h2>טביעת אצבע בטלפון</h2>
      <p class="muted">בטלפון נכנסים עם טביעת אצבע, ובמחשב עם סיסמה. כניסה בטביעת אצבע בטוחה יותר מסיסמה ואי אפשר לגנוב אותה.</p>
      ${me!.passkeys.length ? `<ul class="plist">${me!.passkeys.map((p) => `<li>${I.finger}<div><b>${esc(p.name)}</b><small>נרשם ${fmtDate(p.createdAt)}${p.lastUsed ? ` · שימוש אחרון ${fmtDate(p.lastUsed)}` : ''}</small></div>
        <button class="btn icon danger" data-a="pk-del" data-id="${esc(p.id)}" aria-label="הסרה">${I.trash}</button></li>`).join('')}</ul>` : '<p class="warn">עדיין לא נרשמה טביעת אצבע.</p>'}
      ${pk ? `<button class="btn pink" data-a="pk-add">${I.finger} רישום טביעת אצבע בטלפון הזה</button>` : (isPhone ? '<p class="muted">הדפדפן הזה לא תומך בטביעת אצבע.</p>' : '<p class="muted">כדי לרשום טביעת אצבע, פתחו את הכתובת הזו בטלפון, היכנסו עם הסיסמה ולחצו כאן על "רישום טביעת אצבע".</p>')}
    </section>
    <section class="card"><h2>סיסמה (לכניסה מהמחשב)</h2>
      <form id="chpw" class="row3"><input class="input ltr" type="password" name="password" minlength="8" placeholder="סיסמה חדשה (8 תווים לפחות)" autocomplete="new-password" aria-label="סיסמה חדשה" />
      <button class="btn ghost" type="submit">${me!.hasPassword ? 'שינוי סיסמה' : 'הגדרת סיסמה'}</button></form>
    </section>`);
  const f = document.getElementById('chpw') as HTMLFormElement;
  f.onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/users', { method: 'PATCH', json: { password: (f.elements.namedItem('password') as HTMLInputElement).value } }); f.reset(); toast('הסיסמה עודכנה'); }
    catch (err) { toast((err as Error).message, true); }
  };
}

// ---------- events ----------
function bind() {
  window.addEventListener('hashchange', () => {
    const r = location.hash.slice(1) || 'dashboard';
    if (r === route || !me) return;
    if (dirty && !confirm('יש שינויים שלא נשמרו. לצאת בלי לשמור?')) { history.replaceState(null, '', `#${route}`); return; }
    dirty = false;
    pending.clear();
    if (!r.startsWith('creation:')) draft = null;
    route = r;
    render();
  });

  app.addEventListener('click', async (e) => {
    const t = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
    if (!t) return;
    const a = t.dataset.a!;
    const i = Number(t.dataset.i);
    const c = draft;
    try {
      switch (a) {
        case 'menu': document.body.classList.toggle('nav-open'); break;
        case 'logout': await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); me = null; renderLogin(); break;
        case 'pk-login': passkeyLogin(); break;
        case 'invite-pk': {
          const code = (app as any).dataset.invite;
          try { await registerPasskey(code); history.replaceState(null, '', location.pathname); await afterLogin(); toast('נרשם בהצלחה — ברוכים הבאים!'); }
          catch (err) { toast((err as Error).name === 'NotAllowedError' ? 'הרישום בוטל' : (err as Error).message, true); }
          break;
        }
        case 'pk-add':
          try { await registerPasskey(); toast('טביעת האצבע נרשמה. מעכשיו אפשר להיכנס איתה.'); renderAccount(); }
          catch (err) { toast((err as Error).name === 'NotAllowedError' ? 'הרישום בוטל' : (err as Error).message, true); }
          break;
        case 'pk-del':
          if (!confirm('להסיר את טביעת האצבע הזו?')) return;
          await api('/api/users', { method: 'PATCH', json: { removePasskey: t.dataset.id } }); renderAccount(); break;
        case 'move': move(Number(t.dataset.id), Number(t.dataset.d)); break;
        case 'save': saveDraft(); break;
        case 'delete': {
          if (!c || !confirm(`למחוק את "${c.title}"? אי אפשר לבטל את זה מכאן.`)) return;
          const next = data.filter((x) => x.id !== c.id).map((x, k) => ({ ...x, order: k }));
          if (await saveCreations(next, [], `מחיקה: ${c.title}`, 'מחיקת יצירה', c.title)) { draft = null; go('creations'); toast('היצירה נמחקה'); }
          break;
        }
        case 'cover': { const [f] = await pickFiles('image/*', false); if (!f || !c) return; c.cover = await addUpload(f, folderOf(c)); markDirty(); renderEditor(String(c.id)); break; }
        case 'step-img': { const [f] = await pickFiles('image/*', false); if (!f || !c) return; c.steps[i].image = await addUpload(f, folderOf(c)); markDirty(); renderEditor(String(c.id)); break; }
        case 'step-noimg': c!.steps[i].image = null; markDirty(); renderEditor(String(c!.id)); break;
        case 'step-add': c!.steps.push({ image: null, text: '' }); markDirty(); renderEditor(String(c!.id));
          $<HTMLElement>(`[data-step="${c!.steps.length - 1}"]`)?.focus(); break;
        case 'steps-from-photos': {
          const files = await pickFiles('image/*', true);
          if (!files.length || !c) return;
          toast(`מעבד ${files.length} תמונות…`);
          if (c.steps.length === 1 && !c.steps[0].image && !c.steps[0].text) c.steps = [];
          for (const f of files) c.steps.push({ image: await addUpload(f, folderOf(c)), text: '' });
          markDirty(); renderEditor(String(c.id)); toast(`נוספו ${files.length} שלבים — עכשיו כתבו טקסט לכל שלב`); break;
        }
        case 'step-del': if (!confirm(`למחוק את שלב ${i + 1}?`)) return; c!.steps.splice(i, 1); markDirty(); renderEditor(String(c!.id)); break;
        case 'step-move': { const j = i + Number(t.dataset.d); [c!.steps[i], c!.steps[j]] = [c!.steps[j], c!.steps[i]]; markDirty(); renderEditor(String(c!.id)); break; }
        case 'mat-add': c!.materials.push(''); markDirty(); renderEditor(String(c!.id)); $<HTMLInputElement>(`[data-mat="${c!.materials.length - 1}"]`)?.focus(); break;
        case 'mat-del': c!.materials.splice(i, 1); markDirty(); renderEditor(String(c!.id)); break;
        case 'dl-add': { const [f] = await pickFiles('application/pdf', false); if (!f || !c) return; c.download = { label: 'להורדת הקובץ', file: await addUpload(f, folderOf(c)), gated: false }; markDirty(); renderEditor(String(c.id)); break; }
        case 'dl-del': c!.download = null; markDirty(); renderEditor(String(c!.id)); break;
        case 'media-filter': mediaFilter = t.dataset.k!; renderMedia(); break;
        case 'media-copy': case 'copy': {
          const v = t.dataset.p ? location.origin + t.dataset.p : t.dataset.v!;
          await navigator.clipboard.writeText(v).then(() => toast('הקישור הועתק'), () => toast(v));
          break;
        }
        case 'media-upload': {
          const files = await pickFiles('image/*,application/pdf', true);
          if (!files.length) return;
          toast(`מעלה ${files.length} קבצים…`, false, 20000);
          const prepared = await Promise.all(files.map((f) => prepareFile(f, 'library')));
          await api('/api/media', { method: 'POST', json: { files: prepared.map((p) => ({ path: `public${p.path}`, base64: p.base64 })) } });
          toast('הקבצים הועלו. יופיעו באתר תוך כ-2 דקות'); renderMedia(); break;
        }
        case 'media-del':
          if (!confirm('למחוק את הקובץ לצמיתות?')) return;
          await api('/api/media', { method: 'DELETE', json: { paths: [t.dataset.p] } }); toast('הקובץ נמחק'); renderMedia(); break;
        case 'site-img': {
          const [f] = await pickFiles('image/*', false);
          if (!f) return;
          site[t.dataset.sec!][t.dataset.k!] = await addUpload(f, 'site');
          markDirty(); renderContent(); break;
        }
        case 'site-save': saveSite(t.dataset.section || 'הגדרות האתר'); break;
        case 'msg-read': await api('/api/contact', { method: 'PATCH', json: { key: t.dataset.k, read: Boolean(t.dataset.v) } }); renderMessages(); break;
        case 'msg-del': if (!confirm('למחוק את הפנייה?')) return; await api('/api/contact', { method: 'DELETE', json: { key: t.dataset.k } }); renderMessages(); break;
        case 'lead-del': if (!confirm('למחוק את הנרשם?')) return; await api('/api/lead', { method: 'DELETE', json: { key: t.dataset.k } }); renderLeads(); break;
        case 'csv': downloadCsv(); break;
        case 'user-del': if (!confirm(`למחוק את המשתמש ${t.dataset.n}?`)) return; await api('/api/users', { method: 'DELETE', json: { id: t.dataset.id } }); renderUsers(); break;
        case 'user-link': { const j = await api('/api/users', { method: 'PUT', json: { id: t.dataset.id } }); showInvite(j.code); break; }
      }
    } catch (err) {
      if ((err as Error).message !== 'נדרשת התחברות') toast((err as Error).message, true, 6000);
    }
  });

  app.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if ((e.key === 'Enter' || e.key === ' ') && t.classList.contains('photo')) { e.preventDefault(); t.click(); }
  });

  app.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.sec && t.dataset.k) {
      site[t.dataset.sec] = site[t.dataset.sec] || {};
      site[t.dataset.sec][t.dataset.k] = t.type === 'checkbox' ? t.checked : t.value;
      return markDirty();
    }
    const c = draft;
    if (!c || !route.startsWith('creation:')) return;
    if (t.dataset.step !== undefined) c.steps[Number(t.dataset.step)].text = t.value;
    else if (t.dataset.mat !== undefined) c.materials[Number(t.dataset.mat)] = t.value;
    else switch (t.dataset.f) {
      case 'title':
        c.title = t.value;
        if (draftIsNew) { c.slug = slugify(t.value); $<HTMLInputElement>('[data-f="slug"]')!.value = c.slug; $('[data-slug-preview]')!.textContent = c.slug; }
        break;
      case 'slug': c.slug = slugify(t.value); $('[data-slug-preview]')!.textContent = c.slug; break;
      case 'intro': c.intro = t.value.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean); break;
      case 'materialsTitle': c.materialsTitle = t.value; break;
      case 'published': c.published = t.checked; break;
      case 'dl-label': if (c.download) c.download.label = t.value; break;
      case 'dl-gated': if (c.download) c.download.gated = t.checked; break;
      default: return;
    }
    markDirty();
  });

  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
}

export async function start() {
  bind();
  const invite = new URLSearchParams(location.search).get('invite');
  try {
    if (invite) return renderInvite(invite);
    const j = await api('/api/auth/me');
    if (j.needsSetup) return renderSetup();
    me = j.user;
    if (!me) return renderLogin();
    route = location.hash.slice(1) || 'dashboard';
    render();
  } catch (e) {
    app.innerHTML = `<p class="boot">${esc((e as Error).message)}</p>`;
  }
}
