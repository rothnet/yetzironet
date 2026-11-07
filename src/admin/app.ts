// Admin panel for יצירונט — plain TypeScript, no framework.
// API: Cloudflare Pages Functions under /api. Content saves are commits to GitHub,
// which Cloudflare Pages rebuilds and publishes in ~1–2 minutes.
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';

type Step = { image: string | null; text: string };
type Download = { label: string; file: string; gated?: boolean } | null;
type Creation = {
  id: number; slug: string; oldSlug?: string; title: string; intro: string[]; materialsTitle: string;
  materials: string[]; cover: string; steps: Step[]; download: Download; order: number; published?: boolean;
  seo?: { title?: string; description?: string; image?: string; noindex?: boolean };
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
let pendingMeta: Record<string, Record<string, unknown>> = {}; // details for pending uploads
let altEdits: Record<string, string> = {}; // alt texts changed in the creation editor

// ---------- helpers ----------
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const $ = <T extends Element = HTMLElement>(sel: string) => app.querySelector(sel) as T | null;
const imgSrc = (p: string | null | undefined) => (p && (pending.get(p)?.url || M.local.get(p))) || p || '';
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
  bolt: svg('<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>'),
  upload: svg('<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>'),
  download: svg('<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'),
  grid: svg('<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>'),
  list: svg('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'),
  check: svg('<path d="M5 12l5 5 9-10"/>'),
  next: svg('<path d="M9 6l6 6-6 6"/>'),
  prev: svg('<path d="M15 6l-6 6 6 6"/>'),
  crop: svg('<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>'),
  rotl: svg('<path d="M3 4v6h6"/><path d="M3.5 10A9 9 0 1 1 6 16.5"/>'),
  rotr: svg('<path d="M21 4v6h-6"/><path d="M20.5 10A9 9 0 1 0 18 16.5"/>'),
  flip: svg('<path d="M12 3v18M8 7L3 12l5 5M16 7l5 5-5 5"/>'),
  more: svg('<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'),
  seo: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M8 11h6M11 8v6"/>'),
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

let lastDims = { width: 0, height: 0 };
async function resizeImage(file: File, max = 1600): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  lastDims = { width: c.width, height: c.height };
  return new Promise((res) => c.toBlob((b) => res(b!), 'image/jpeg', 0.86));
}

let seq = 0;
async function prepareFile(file: File, folder: string): Promise<{ path: string; base64: string; url: string; width?: number; height?: number }> {
  if (file.type === 'image/svg+xml') throw new Error('קבצי SVG לא נתמכים מטעמי אבטחה — השתמשו ב-PNG או JPG');
  const keep = file.type === 'application/pdf' || file.type === 'image/gif';
  const blob = keep ? file : await resizeImage(file);
  const ext = file.type === 'application/pdf' ? 'pdf' : file.type === 'image/gif' ? 'gif' : 'jpg';
  const name = `${Date.now().toString(36)}${(seq++).toString(36)}.${ext}`;
  const dims = keep ? {} : { ...lastDims };
  return { path: `/media/uploads/${folder || 'misc'}/${name}`, base64: await fileToBase64(blob), url: URL.createObjectURL(blob), ...dims };
}
async function addUpload(file: File, folder: string) {
  const f = await prepareFile(file, folder);
  pending.set(f.path, { base64: f.base64, url: f.url });
  pendingMeta[f.path] = { title: file.name.replace(/\.[^.]+$/, ''), uploaded: new Date().toISOString(), width: f.width, height: f.height };
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

const NAV_ALL = NAV.flatMap(([, items]) => items);
const TABS = ['dashboard', 'creations', 'messages', 'media'];
const SHORT: Record<string, string> = { dashboard: 'ראשי', media: 'מדיה' };

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
      <header class="mbar"><img src="/logo-wordmark.png" alt="יצירונט" width="583" height="248" /><span class="sp"></span><a class="btn icon" href="/" target="_blank" rel="noopener" aria-label="לאתר">${I.ext}</a></header>
      <main class="wrap">${inner}</main>
    </div>
  </div>
  <nav class="tabbar" aria-label="תפריט ניהול">
    ${TABS.map((r) => { const it = NAV_ALL.find((x) => x[0] === r)!; return `<a href="#${r}" ${active === r ? 'aria-current="page"' : ''}>${it[2]}<span>${SHORT[r] || it[1]}</span></a>`; }).join('')}
    <button data-a="more" class="${TABS.includes(active) ? '' : 'cur'}" aria-expanded="false">${I.more}<span>עוד</span></button>
  </nav>
  <div class="more-scrim" data-a="more"></div>
  <div class="more-sheet" role="dialog" aria-label="עוד">
    <div class="grab"></div>
    <div class="more-grid">
      ${NAV_ALL.filter((x) => !TABS.includes(x[0])).map(([r, label, icon]) => `<a href="#${r}" ${active === r ? 'aria-current="page"' : ''}>${icon}<span>${label}</span></a>`).join('')}
      <a href="/" target="_blank" rel="noopener">${I.ext}<span>לאתר</span></a>
      <button data-a="logout">${I.out}<span>יציאה</span></button>
    </div>
    <div class="more-who"><span class="av">${initial(me?.name)}</span><div><b>${esc(me?.name)}</b><small>${me?.role === 'owner' ? 'מנהל ראשי' : 'עורך/ת'}</small></div></div>
  </div>`;
}

function go(r: string) {
  dirty = false;
  pending.clear(); pendingMeta = {}; altEdits = {};
  route = r;
  if (location.hash !== `#${r}`) history.pushState(null, '', `#${r}`);
  render();
}

async function render() {
  document.body.classList.remove('nav-open', 'more-open');
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

async function saveCreations(next: Creation[], files: { path: string; base64: string }[], message: string, logAction: string, logDetail: string, mediaMeta?: Record<string, unknown>) {
  busy = true;
  try {
    const j = await api('/api/creations', { method: 'PUT', json: { creations: next, files, baseSha: dataSha, message, logAction, logDetail, mediaMeta } });
    if (mediaMeta) for (const [p, m] of Object.entries(mediaMeta)) M.meta[p] = { ...M.meta[p], ...(m as MMeta) };
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
    await Promise.all([loadCreations(), loadMedia().catch(() => {})]);
    const c = id === 'new' ? null : data.find((x) => String(x.id) === id);
    if (id !== 'new' && !c) { toast('היצירה לא נמצאה', true); return go('creations'); }
    draftIsNew = !c;
    draft = c ? structuredClone(c) : newCreation();
    if (draftIsNew) { route = `creation:${draft.id}`; history.replaceState(null, '', `#${route}`); }
  }
  const c = draft;
  const altVal = (p: string | null | undefined) => (p ? altEdits[p] ?? M.meta[p]?.alt ?? '' : '');
  const altField = (p: string | null | undefined, ph: string) => p ? `<input class="input alt-in" data-alt="${esc(p)}" value="${esc(altVal(p))}" placeholder="טקסט חלופי (alt): ${esc(ph)}" aria-label="טקסט חלופי לתמונה" />` : '';
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
          ${c.cover ? `<img src="${esc(imgSrc(c.cover))}" alt="" /><span class="chg">החלפה</span>` : 'לחצו לבחירת תמונה'}
        </div>${altField(c.cover, c.title)}</div>
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
          ${altField(s.image, `${c.title} — שלב ${i + 1}`)}
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
    ${seoCard(c)}
    ${!draftIsNew ? `<button class="btn danger" data-a="delete">${I.trash} מחיקת היצירה</button>` : ''}
    <div class="savebar"><div class="in"><span class="st" data-st>${dirty ? 'יש שינויים שלא נשמרו' : 'הכל שמור'}</span>
      <button class="btn pink" data-a="save">שמירה ופרסום</button></div></div>`);
  updateSeoPreview();
}

// ---------- SEO ----------
const plain = (c: Creation) => c.intro.join(' ');
const autoDesc = (c: Creation) => { const t = plain(c); return t.length <= 155 ? t : t.slice(0, 155).replace(/\s+\S*$/, '') + '…'; };
function seoChecks(c: Creation) {
  const title = c.seo?.title || c.title;
  const desc = c.seo?.description || autoDesc(c);
  const alt = (p: string | null | undefined) => (p ? (altEdits[p] ?? M.meta[p]?.alt ?? '').trim() : 'x');
  const stepsNoAlt = c.steps.filter((s) => s.image && !alt(s.image)).length;
  const emptySteps = c.steps.filter((s) => !s.text.trim()).length;
  return [
    [title.length >= 15 && title.length <= 60, `כותרת לגוגל: ${title.length} תווים`, 'מומלץ 15–60 תווים'],
    [desc.length >= 70 && desc.length <= 160, `תיאור לגוגל: ${desc.length} תווים`, 'מומלץ 70–160 תווים'],
    [Boolean(c.cover) && Boolean(alt(c.cover)), 'לתמונה הראשית יש טקסט חלופי', 'הוסיפו טקסט חלופי לתמונה הראשית'],
    [stepsNoAlt === 0, stepsNoAlt ? `${stepsNoAlt} תמונות שלבים בלי טקסט חלופי` : 'לכל תמונות השלבים יש טקסט חלופי', 'כתבו מה רואים בכל תמונה'],
    [emptySteps === 0, emptySteps ? `${emptySteps} שלבים בלי הסבר` : 'לכל השלבים יש הסבר', 'טקסט בכל שלב עוזר לדירוג'],
    [plain(c).length >= 120, `פתיח: ${plain(c).length} תווים`, 'פתיח של 120 תווים ומעלה'],
  ] as [boolean, string, string][];
}
function seoCard(c: Creation) {
  const checks = seoChecks(c);
  const score = Math.round((checks.filter((x) => x[0]).length / checks.length) * 100);
  return `<section class="card" id="seo-card">
    <h2>${I.seo} SEO — איך זה ייראה בגוגל <span class="score ${score >= 80 ? 'good' : score >= 50 ? 'mid' : 'low'}" data-seo-score>${score}</span></h2>
    <div class="gpreview" data-seo-preview>${seoPreviewHtml(c)}</div>
    <label class="field"><span>כותרת לגוגל <small data-count="title"></small></span><input class="input" data-seo="title" value="${esc(c.seo?.title || '')}" placeholder="${esc(c.title)}" maxlength="90" /></label>
    <label class="field"><span>תיאור לגוגל <small data-count="description"></small></span><textarea class="input" data-seo="description" rows="3" maxlength="300" placeholder="${esc(autoDesc(c))}">${esc(c.seo?.description || '')}</textarea>
      <small>אם משאירים ריק — נלקח אוטומטית מהפתיח.</small></label>
    <div class="field"><span>תמונה לשיתוף (וואטסאפ / פייסבוק)</span>
      <div class="row3" style="align-items:center">
        <div class="photo og" data-a="seo-img" role="button" tabindex="0" aria-label="בחירת תמונת שיתוף">${c.seo?.image || c.cover ? `<img src="${esc(imgSrc(c.seo?.image || c.cover))}" alt="" /><span class="chg">${c.seo?.image ? 'החלפה' : 'ברירת מחדל: התמונה הראשית'}</span>` : 'בחירה'}</div>
        ${c.seo?.image ? `<button class="btn ghost small" data-a="seo-img-clear">חזרה לתמונה הראשית</button>` : ''}
      </div></div>
    <label class="switch"><input type="checkbox" data-seo="noindex" ${c.seo?.noindex ? 'checked' : ''} /> להסתיר את הדף מגוגל</label>
    <ul class="checks" data-seo-checks>${checksHtml(checks)}</ul>
  </section>`;
}
const checksHtml = (checks: [boolean, string, string][]) => checks.map(([ok, t, tip]) => `<li class="${ok ? 'ok' : 'no'}"><span>${ok ? I.check : '!'}</span>${esc(t)}${ok ? '' : ` <small>— ${esc(tip)}</small>`}</li>`).join('');
function seoPreviewHtml(c: Creation) {
  const title = c.seo?.title || c.title;
  return `<div class="g-url">yetzironet.co.il › ${esc(c.slug || '')}</div><div class="g-title">${esc(title)} | יצירונט</div><div class="g-desc">${esc(c.seo?.description || autoDesc(c))}</div>`;
}
function updateSeoPreview() {
  if (!draft) return;
  const pv = $('[data-seo-preview]'); if (pv) pv.innerHTML = seoPreviewHtml(draft);
  const checks = seoChecks(draft);
  const ul = $('[data-seo-checks]'); if (ul) ul.innerHTML = checksHtml(checks);
  const sc = $('[data-seo-score]');
  if (sc) { const score = Math.round((checks.filter((x) => x[0]).length / checks.length) * 100); sc.textContent = String(score); sc.className = `score ${score >= 80 ? 'good' : score >= 50 ? 'mid' : 'low'}`; }
  for (const k of ['title', 'description']) { const el = $(`[data-count="${k}"]`); const v = (draft.seo as any)?.[k] || (k === 'title' ? draft.title : autoDesc(draft)); if (el) el.textContent = `(${v.length})`; }
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
  const mediaMeta: Record<string, Record<string, unknown>> = {};
  for (const f of files) { const p = f.path.slice(6); mediaMeta[p] = { ...pendingMeta[p], creation: c.id }; }
  c.steps.forEach((s, k) => { if (s.image && pending.has(s.image) && !altEdits[s.image]) mediaMeta[s.image].alt = `${c.title} — שלב ${k + 1}`; });
  if (c.cover && pending.has(c.cover) && !altEdits[c.cover]) mediaMeta[c.cover].alt = c.title;
  for (const [p, alt] of Object.entries(altEdits)) mediaMeta[p] = { ...(M.meta[p] || {}), ...mediaMeta[p], alt };
  const ok = await saveCreations(next, files, `${draftIsNew ? 'יצירה חדשה' : 'עדכון'}: ${c.title}`, draftIsNew ? 'יצירה חדשה' : 'עדכון יצירה', c.title, Object.keys(mediaMeta).length ? mediaMeta : undefined);
  btn.disabled = false;
  if (!ok) { st.textContent = 'השמירה נכשלה'; return; }
  pending.clear(); pendingMeta = {}; altEdits = {};
  dirty = false;
  draftIsNew = false;
  draft = structuredClone(next.find((x) => x.id === c.id)!);
  renderEditor(String(draft.id));
  toast(c.published === false ? 'נשמר כטיוטה' : 'נשמר! יתעדכן באתר תוך כ-2 דקות', false, 5000);
}

// ---------- media library ----------
type MFile = { path: string; size: number };
type MMeta = { title?: string; alt?: string; caption?: string; description?: string; creation?: number | null; uploaded?: string; width?: number; height?: number };
const M = {
  files: [] as MFile[], meta: {} as Record<string, MMeta>, loaded: false,
  view: 'grid' as 'grid' | 'list', q: '', type: 'all', creation: 'all', month: 'all',
  selecting: false, selected: new Set<string>(), open: '' as string,
  local: new Map<string, string>(), // path -> blob url for files not deployed yet
};
try { M.view = (localStorage.getItem('yz-media-view') as 'grid' | 'list') || 'grid'; } catch {}

const isImg = (p: string) => /\.(jpe?g|png|webp|gif|svg)$/i.test(p);
const editable = (p: string) => /\.(jpe?g|png|webp)$/i.test(p);
const isPdf = (p: string) => /\.pdf$/i.test(p);
const extOf = (p: string) => (p.split('.').pop() || '').toUpperCase();
const fileName = (p: string) => decodeURIComponent(p.split('/').pop() || p);
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
const mUrl = (p: string) => M.local.get(p) || p;
const monthOf = (p: string) => (M.meta[p]?.uploaded || '').slice(0, 7);
const monthLabel = (ym: string) => new Date(`${ym}-01T12:00:00Z`).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
const creationTitle = (id?: number | null) => (id == null ? '' : data.find((c) => c.id === id)?.title || '');

async function loadMedia(force = false) {
  if (M.loaded && !force) return;
  const j = await api('/api/media');
  M.files = j.files; M.meta = j.meta || {}; M.loaded = true;
}

function usageMap() {
  const used = new Map<string, { label: string; href: string }[]>();
  const add = (p: string | null | undefined, label: string, href: string) => { if (p) used.set(p, [...(used.get(p) || []), { label, href }]); };
  for (const c of data) {
    add(c.cover, `${c.title} — תמונה ראשית`, `#creation:${c.id}`);
    c.steps.forEach((s, i) => add(s.image, `${c.title} — שלב ${i + 1}`, `#creation:${c.id}`));
    add(c.download?.file, `${c.title} — קובץ להורדה`, `#creation:${c.id}`);
    add(c.seo?.image, `${c.title} — תמונת שיתוף`, `#creation:${c.id}`);
  }
  for (const [sec, o] of Object.entries(site)) for (const v of Object.values(o || {})) if (typeof v === 'string' && v.startsWith('/media/')) add(v, `תוכן האתר (${sec})`, '#content');
  return used;
}

function filtered(used: Map<string, unknown>) {
  const q = M.q.trim().toLowerCase();
  return M.files.filter((f) => {
    const m = M.meta[f.path] || {};
    if (M.type === 'image' && !isImg(f.path)) return false;
    if (M.type === 'pdf' && !isPdf(f.path)) return false;
    if (M.type === 'unused' && used.has(f.path)) return false;
    if (M.type === 'noalt' && (!isImg(f.path) || (m.alt || '').trim())) return false;
    if (M.creation === 'none' && m.creation != null) return false;
    if (M.creation !== 'all' && M.creation !== 'none' && String(m.creation) !== M.creation) return false;
    if (M.month !== 'all' && monthOf(f.path) !== M.month) return false;
    if (q && !`${fileName(f.path)} ${m.title || ''} ${m.alt || ''}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => (M.meta[b.path]?.uploaded || '').localeCompare(M.meta[a.path]?.uploaded || '') || (a.path < b.path ? 1 : -1));
}

async function renderMedia() {
  if (!M.loaded) loading('ספריית מדיה');
  await Promise.all([loadMedia(), loadCreations(), loadSite()]);
  const months = [...new Set(M.files.map((f) => monthOf(f.path)).filter(Boolean))].sort().reverse();
  const totalSize = M.files.reduce((s, f) => s + f.size, 0);
  shell(`
    <div class="head"><div><h1>ספריית מדיה</h1><p class="sub">${M.files.length} קבצים · ${kb(totalSize)}</p></div>
      <div class="row3"><button class="btn ghost" data-a="m-optimize-all">${I.bolt} אופטימיזציה לכל הספרייה</button><button class="btn pink" data-a="m-upload">${I.upload} העלאת קבצים</button></div></div>
    <div class="mtools card">
      <div class="search">${I.search}<input class="input" type="search" data-m="q" value="${esc(M.q)}" placeholder="חיפוש לפי שם קובץ או כותרת" aria-label="חיפוש" /></div>
      <select class="input" data-m="type" aria-label="סוג">
        ${[['all', 'כל הסוגים'], ['image', 'תמונות'], ['pdf', 'קבצי PDF'], ['unused', 'לא בשימוש באתר'], ['noalt', 'תמונות בלי טקסט חלופי']].map(([k, l]) => `<option value="${k}" ${M.type === k ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <select class="input" data-m="creation" aria-label="יצירה">
        <option value="all">כל היצירות</option><option value="none" ${M.creation === 'none' ? 'selected' : ''}>לא משויך ליצירה</option>
        ${sorted().map((c) => `<option value="${c.id}" ${M.creation === String(c.id) ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}
      </select>
      <select class="input" data-m="month" aria-label="תאריך">
        <option value="all">כל התאריכים</option>${months.map((m) => `<option value="${m}" ${M.month === m ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}
      </select>
      <div class="seg" role="group" aria-label="תצוגה">
        <button data-a="m-view" data-v="grid" aria-pressed="${M.view === 'grid'}" aria-label="קוביות">${I.grid}</button>
        <button data-a="m-view" data-v="list" aria-pressed="${M.view === 'list'}" aria-label="שורות">${I.list}</button>
      </div>
      <button class="btn ${M.selecting ? '' : 'ghost'} small" data-a="m-select">${M.selecting ? 'סיום בחירה' : 'בחירה'}</button>
    </div>
    <div id="mbulk"></div>
    <div id="mlist"></div>
    <div class="dropzone" id="dropzone"><div>${I.upload}<b>שחררו כאן להעלאה</b></div></div>`);
  drawMediaList();
}

function drawMediaList() {
  const used = usageMap();
  const list = filtered(used);
  const box = document.getElementById('mlist');
  if (!box) return;
  const sel = (p: string) => M.selected.has(p);
  const check = (p: string) => `<span class="mcheck ${sel(p) ? 'on' : ''}" aria-hidden="true">${I.check}</span>`;
  const thumb = (p: string) => isImg(p) ? `<img src="${esc(mUrl(p))}" alt="" loading="lazy" />` : `<span class="ftype">${I.file}<b>${extOf(p)}</b></span>`;
  box.innerHTML = !list.length ? `<div class="blank card">${I.image}<p>לא נמצאו קבצים</p></div>` : M.view === 'grid'
    ? `<div class="mgrid ${M.selecting ? 'selecting' : ''}">${list.map((f) => `
      <button class="mtile ${sel(f.path) ? 'sel' : ''}" data-a="m-open" data-p="${esc(f.path)}" title="${esc(fileName(f.path))}">
        ${check(f.path)}${thumb(f.path)}${used.has(f.path) ? '' : '<span class="tag-unused">לא בשימוש</span>'}
      </button>`).join('')}</div>`
    : `<div class="card mtable-wrap"><table class="mtable"><thead><tr><th class="c"></th><th>קובץ</th><th class="hide-sm">יצירה</th><th class="hide-sm">גודל</th><th class="hide-sm">מידות</th><th class="hide-sm">תאריך</th><th>שימוש</th></tr></thead><tbody>
      ${list.map((f) => { const m = M.meta[f.path] || {}; return `<tr class="${sel(f.path) ? 'sel' : ''}" data-a="m-open" data-p="${esc(f.path)}">
        <td class="c"><span class="th">${check(f.path)}${thumb(f.path)}</span></td>
        <td><b>${esc(m.title || fileName(f.path))}</b><small class="ltr-inline">${esc(fileName(f.path))}</small></td>
        <td class="hide-sm">${esc(creationTitle(m.creation)) || '<span class="muted">—</span>'}</td>
        <td class="hide-sm">${kb(f.size)}</td><td class="hide-sm">${m.width ? `${m.width}×${m.height}` : '—'}</td>
        <td class="hide-sm">${m.uploaded ? new Date(m.uploaded).toLocaleDateString('he-IL') : '—'}</td>
        <td>${used.has(f.path) ? `<span class="badge on">${used.get(f.path)!.length}</span>` : '<span class="badge off">לא בשימוש</span>'}</td></tr>`; }).join('')}
      </tbody></table></div>`;
  const bulk = document.getElementById('mbulk')!;
  const n = M.selected.size;
  bulk.innerHTML = M.selecting ? `<div class="bulkbar"><b>${n ? `נבחרו ${n}` : 'לחצו על קבצים כדי לבחור'}</b>
    <button class="btn ghost small" data-a="m-sel-all">בחירת כל ${list.length} המוצגים</button>
    ${n ? `<button class="btn ghost small" data-a="m-sel-none">ניקוי</button><span class="sp"></span>
    <select class="input small-sel" data-m="assign" aria-label="שיוך ליצירה"><option value="">שיוך ליצירה…</option><option value="none">ללא יצירה</option>${sorted().map((c) => `<option value="${c.id}">${esc(c.title)}</option>`).join('')}</select>
    <button class="btn ghost small" data-a="m-optimize-sel">${I.bolt} אופטימיזציה</button>
    <button class="btn danger small" data-a="m-del-sel">${I.trash} מחיקה</button>` : ''}</div>` : '';
}

function openDetails(path: string) {
  M.open = path;
  const used = usageMap();
  const list = filtered(used);
  const idx = list.findIndex((f) => f.path === path);
  const f = M.files.find((x) => x.path === path);
  if (!f) return;
  const m = M.meta[path] || {};
  const uses = used.get(path) || [];
  const url = location.origin + path;
  const ov = document.getElementById('modal') || Object.assign(document.createElement('div'), { id: 'modal' });
  document.body.append(ov);
  ov.className = 'modal';
  ov.innerHTML = `<div class="sheet mdetail" role="dialog" aria-modal="true" aria-label="פרטי הקובץ">
    <header><b>פרטי הקובץ</b><span class="sp"></span>
      <button class="btn icon" data-a="m-nav" data-d="-1" ${idx <= 0 ? 'disabled' : ''} aria-label="הקודם">${I.next}</button>
      <button class="btn icon" data-a="m-nav" data-d="1" ${idx < 0 || idx >= list.length - 1 ? 'disabled' : ''} aria-label="הבא">${I.prev}</button>
      <button class="btn icon" data-a="m-close" aria-label="סגירה">×</button></header>
    <div class="mbody">
      <div class="mpreview">${isImg(path) ? `<img src="${esc(mUrl(path))}" alt="" />` : `<span class="ftype big">${I.file}<b>${extOf(path)}</b><a class="btn ghost small" href="${esc(path)}" target="_blank" rel="noopener">פתיחת הקובץ</a></span>`}</div>
      <form class="minfo" id="mform">
        ${isImg(path) ? `<label class="field"><span>טקסט חלופי (alt)</span><textarea class="input" name="alt" rows="2" placeholder="תארו מה רואים בתמונה — חשוב לגוגל ולנגישות">${esc(m.alt || '')}</textarea></label>` : ''}
        <label class="field"><span>כותרת</span><input class="input" name="title" value="${esc(m.title || '')}" /></label>
        <label class="field"><span>כיתוב</span><textarea class="input" name="caption" rows="2">${esc(m.caption || '')}</textarea></label>
        <label class="field"><span>תיאור</span><textarea class="input" name="description" rows="3">${esc(m.description || '')}</textarea></label>
        <label class="field"><span>שיוך ליצירה</span><select class="input" name="creation"><option value="">ללא</option>${sorted().map((c) => `<option value="${c.id}" ${m.creation === c.id ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}</select></label>
        <button class="btn pink" type="submit">שמירת הפרטים</button>
        <div class="field" style="margin-top:18px"><span>כתובת הקובץ</span><div class="copyrow"><input class="input ltr" readonly value="${esc(url)}" aria-label="כתובת הקובץ" /><button class="btn ghost small" type="button" data-a="copy" data-v="${esc(url)}">${I.copy} העתקה</button></div></div>
        <div class="field"><span>בשימוש באתר</span>${uses.length ? `<ul class="uses">${uses.map((u) => `<li><a href="${u.href}" data-a="m-close-go">${esc(u.label)}</a></li>`).join('')}</ul>` : '<p class="muted small" style="margin:0">הקובץ לא מופיע באף עמוד</p>'}</div>
        <dl class="fdata">
          <dt>שם הקובץ</dt><dd class="ltr-inline">${esc(fileName(path))}</dd>
          <dt>סוג</dt><dd>${extOf(path)}</dd><dt>גודל</dt><dd>${kb(f.size)}</dd>
          ${m.width ? `<dt>מידות</dt><dd>${m.width} × ${m.height} פיקסלים</dd>` : ''}
          <dt>הועלה</dt><dd>${m.uploaded ? new Date(m.uploaded).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}</dd>
        </dl>
        <div class="macts2">
          ${editable(path) ? `<button class="btn ghost small" type="button" data-a="m-edit">${I.crop} עריכת תמונה</button><button class="btn ghost small" type="button" data-a="m-optimize-one">${I.bolt} אופטימיזציה</button>` : ''}
          <a class="btn ghost small" href="${esc(path)}" download="${esc(fileName(path))}">${I.download} הורדת המקור</a>
          <button class="btn danger small" type="button" data-a="m-del-one">${I.trash} מחיקה</button>
        </div>
      </form>
    </div></div>`;
  const form = ov.querySelector('#mform') as HTMLFormElement;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form)) as Record<string, string>;
    const patch = { [path]: { ...m, ...fd, creation: fd.creation ? Number(fd.creation) : null } };
    try { const j = await api('/api/media', { method: 'PUT', json: { patch } }); M.meta = j.meta; toast('הפרטים נשמרו'); drawMediaList(); }
    catch (err) { toast((err as Error).message, true); }
  };
}
const closeModal = () => { document.getElementById('modal')?.remove(); M.open = ''; };

// --- image processing ---
async function blobOf(path: string) { const r = await fetch(mUrl(path), { cache: 'no-store' }); if (!r.ok) throw new Error('לא הצלחתי לטעון את הקובץ'); return r.blob(); }
const mimeOf = (p: string) => (/\.png$/i.test(p) ? 'image/png' : /\.webp$/i.test(p) ? 'image/webp' : 'image/jpeg');
const canvasBlob = (c: HTMLCanvasElement, type: string, q = 0.85): Promise<Blob> => new Promise((res) => c.toBlob((b) => res(b!), type, q));

async function optimizeBlob(path: string, src: Blob, max = 1600) {
  const bmp = await createImageBitmap(src);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  const type = mimeOf(path);
  if (type === 'image/png' && k === 1) return null; // PNG re-encoding in the browser does not shrink
  const out = await canvasBlob(c, type, 0.82);
  return out.size < src.size * 0.9 ? { blob: out, width: c.width, height: c.height } : null;
}

async function optimizePaths(paths: string[]) {
  const imgs = paths.filter(editable);
  if (!imgs.length) return toast('אין תמונות לאופטימיזציה');
  if (!confirm(`לבצע אופטימיזציה ל-${imgs.length} תמונות?\nהתמונות יוקטנו ל-1600 פיקסלים לכל היותר ויידחסו. תמונה תוחלף רק אם החיסכון משמעותי.`)) return;
  let saved = 0, done = 0, changed = 0;
  let batch: { path: string; base64: string }[] = [];
  let batchMeta: Record<string, MMeta> = {};
  let batchSize = 0;
  const flush = async () => {
    if (!batch.length) return;
    const j = await api('/api/media', { method: 'POST', json: { files: batch, meta: batchMeta, action: 'optimize' } });
    M.meta = j.meta; batch = []; batchMeta = {}; batchSize = 0;
  };
  for (const p of imgs) {
    toast(`אופטימיזציה… ${++done}/${imgs.length}`, false, 60000);
    try {
      const src = await blobOf(p);
      const r = await optimizeBlob(p, src);
      if (!r) continue;
      const b64 = await fileToBase64(r.blob);
      batch.push({ path: `public${p}`, base64: b64 });
      batchMeta[p] = { width: r.width, height: r.height };
      batchSize += b64.length; saved += src.size - r.blob.size; changed++;
      const f = M.files.find((x) => x.path === p); if (f) f.size = r.blob.size;
      M.local.set(p, URL.createObjectURL(r.blob));
      if (batchSize > 6_000_000 || batch.length >= 40) await flush();
    } catch (e) { console.warn(p, e); }
  }
  await flush();
  toast(changed ? `הושלם: ${changed} תמונות עודכנו, נחסכו ${kb(saved)}` : 'כל התמונות כבר מותאמות — לא נדרש שינוי', false, 7000);
  if (M.open) openDetails(M.open);
  drawMediaList();
}

async function deletePaths(paths: string[]) {
  const used = usageMap();
  const inUse = paths.filter((p) => used.has(p));
  const msg = `למחוק ${paths.length === 1 ? 'את הקובץ' : `${paths.length} קבצים`} לצמיתות?` +
    (inUse.length ? `\n\nשימו לב: ${inUse.length === paths.length && inUse.length === 1 ? 'הקובץ' : `${inUse.length} מהם`} בשימוש באתר ויחסרו בעמודים:\n${inUse.slice(0, 5).map((p) => '• ' + used.get(p)![0].label).join('\n')}` : '');
  if (!confirm(msg)) return false;
  toast('מוחק…', false, 20000);
  const j = await api('/api/media', { method: 'DELETE', json: { paths } });
  M.meta = j.meta;
  M.files = M.files.filter((f) => !paths.includes(f.path));
  for (const p of paths) M.selected.delete(p);
  toast(paths.length === 1 ? 'הקובץ נמחק' : `${paths.length} קבצים נמחקו`);
  return true;
}

async function uploadFiles(files: File[], creation: number | null = null) {
  if (!files.length) return [];
  toast(`מעלה ${files.length} קבצים…`, false, 60000);
  const prepared = await Promise.all(files.map((f) => prepareFile(f, 'library')));
  const meta: Record<string, MMeta> = {};
  prepared.forEach((p, i) => { meta[p.path] = { title: files[i].name.replace(/\.[^.]+$/, ''), creation, uploaded: new Date().toISOString(), width: p.width, height: p.height }; });
  const j = await api('/api/media', { method: 'POST', json: { files: prepared.map((p) => ({ path: `public${p.path}`, base64: p.base64 })), meta } });
  M.meta = j.meta;
  for (const p of prepared) { M.local.set(p.path, p.url); M.files.unshift({ path: p.path, size: Math.round(p.base64.length * 0.75) }); }
  toast(`${files.length} קבצים הועלו`);
  return prepared.map((p) => p.path);
}

// --- image editor: rotate / flip / crop ---
let ed: { path: string; canvas: HTMLCanvasElement; history: HTMLCanvasElement[]; crop: null | { x: number; y: number; w: number; h: number } } | null = null;
const cloneCanvas = (src: HTMLCanvasElement, w = src.width, h = src.height, draw?: (g: CanvasRenderingContext2D) => void) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!; if (draw) draw(g); else g.drawImage(src, 0, 0); return c;
};
async function openEditor(path: string) {
  const bmp = await createImageBitmap(await blobOf(path));
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d')!.drawImage(bmp, 0, 0);
  ed = { path, canvas: c, history: [], crop: null };
  drawEditor();
}
function drawEditor() {
  if (!ed) return;
  const ov = document.getElementById('modal')!;
  ov.innerHTML = `<div class="sheet meditor" role="dialog" aria-modal="true" aria-label="עריכת תמונה">
    <header><b>עריכת תמונה</b><span class="muted small">${ed.canvas.width} × ${ed.canvas.height}</span><span class="sp"></span><button class="btn icon" data-a="ed-cancel" aria-label="סגירה">×</button></header>
    <div class="edtools">
      <button class="btn ghost small" data-a="ed-rot" data-d="-1">${I.rotl} סיבוב שמאלה</button>
      <button class="btn ghost small" data-a="ed-rot" data-d="1">${I.rotr} סיבוב ימינה</button>
      <button class="btn ghost small" data-a="ed-flip">${I.flip} היפוך</button>
      <button class="btn ${ed.crop ? 'teal' : 'ghost'} small" data-a="ed-crop" ${ed.crop ? '' : 'disabled'}>${I.crop} חיתוך לבחירה</button>
      <button class="btn ghost small" data-a="ed-undo" ${ed.history.length ? '' : 'disabled'}>ביטול פעולה</button>
    </div>
    <p class="muted small" style="margin:0 0 8px">לחיתוך: גררו על התמונה כדי לסמן את האזור שרוצים להשאיר.</p>
    <div class="edstage"><div class="edwrap" id="edwrap"><canvas id="edcanvas"></canvas><div class="edsel" id="edsel" hidden></div></div></div>
    <footer><span class="sp"></span><button class="btn ghost" data-a="ed-cancel">ביטול</button><button class="btn ghost" data-a="ed-save" data-copy="1">שמירה כעותק חדש</button><button class="btn pink" data-a="ed-save">שמירה במקום המקור</button></footer>
  </div>`;
  const view = document.getElementById('edcanvas') as HTMLCanvasElement;
  view.width = ed.canvas.width; view.height = ed.canvas.height;
  view.getContext('2d')!.drawImage(ed.canvas, 0, 0);
  const wrap = document.getElementById('edwrap')!;
  const sel = document.getElementById('edsel')!;
  let start: { x: number; y: number } | null = null;
  const pt = (e: PointerEvent) => { const r = view.getBoundingClientRect(); return { x: Math.max(0, Math.min(r.width, e.clientX - r.left)), y: Math.max(0, Math.min(r.height, e.clientY - r.top)), r }; };
  wrap.onpointerdown = (e) => { start = pt(e); wrap.setPointerCapture(e.pointerId); };
  wrap.onpointermove = (e) => {
    if (!start) return;
    const p = pt(e);
    const x = Math.min(start.x, p.x), y = Math.min(start.y, p.y), w = Math.abs(p.x - start.x), h = Math.abs(p.y - start.y);
    Object.assign(sel.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` }); sel.hidden = w < 4 || h < 4;
    const k = ed!.canvas.width / p.r.width;
    ed!.crop = w > 8 && h > 8 ? { x: Math.round(x * k), y: Math.round(y * k), w: Math.round(w * k), h: Math.round(h * k) } : null;
    (document.querySelector('[data-a="ed-crop"]') as HTMLButtonElement).disabled = !ed!.crop;
  };
  wrap.onpointerup = () => { start = null; const b = document.querySelector('[data-a="ed-crop"]') as HTMLElement; b.className = `btn ${ed?.crop ? 'teal' : 'ghost'} small`; };
}
function edApply(next: HTMLCanvasElement) { if (!ed) return; ed.history.push(ed.canvas); ed.canvas = next; ed.crop = null; drawEditor(); }
async function edSave(copy: boolean) {
  if (!ed) return;
  const { path, canvas } = ed;
  const blob = await canvasBlob(canvas, mimeOf(path), 0.88);
  const target = copy ? path.replace(/(\.[^.]+)$/, `-${Date.now().toString(36)}$1`) : path;
  const prev = M.meta[path] || {};
  const meta = { [target]: copy ? { ...prev, title: `${prev.title || fileName(path)} (עותק)`, uploaded: new Date().toISOString(), width: canvas.width, height: canvas.height } : { width: canvas.width, height: canvas.height } };
  toast('שומר…', false, 20000);
  const j = await api('/api/media', { method: 'POST', json: { files: [{ path: `public${target}`, base64: await fileToBase64(blob) }], meta, action: 'edit' } });
  M.meta = j.meta;
  M.local.set(target, URL.createObjectURL(blob));
  const f = M.files.find((x) => x.path === target);
  if (f) f.size = blob.size; else M.files.unshift({ path: target, size: blob.size });
  ed = null;
  toast(copy ? 'נשמר עותק חדש' : 'התמונה עודכנה — תתעדכן באתר תוך כ-2 דקות', false, 5000);
  openDetails(target); drawMediaList();
}

// --- picker (used by the creation editor and site content) ---
let pickerResolve: ((p: string | null) => void) | null = null;
let pickerQ = '';
function pickMedia(kind: 'image' | 'pdf' = 'image'): Promise<string | null> {
  return new Promise(async (resolve) => {
    pickerResolve = resolve;
    await Promise.all([loadMedia(), loadCreations()]);
    drawPicker(kind);
  });
}
function drawPicker(kind: 'image' | 'pdf') {
  const ov = document.getElementById('modal') || Object.assign(document.createElement('div'), { id: 'modal' });
  document.body.append(ov);
  ov.className = 'modal';
  const q = pickerQ.trim().toLowerCase();
  const list = M.files.filter((f) => (kind === 'pdf' ? isPdf(f.path) : isImg(f.path)) && (!q || `${fileName(f.path)} ${M.meta[f.path]?.title || ''} ${creationTitle(M.meta[f.path]?.creation)}`.toLowerCase().includes(q)))
    .sort((a, b) => (M.meta[b.path]?.uploaded || '').localeCompare(M.meta[a.path]?.uploaded || ''));
  ov.innerHTML = `<div class="sheet mpicker" role="dialog" aria-modal="true" aria-label="בחירה מהספרייה">
    <header><b>${kind === 'pdf' ? 'בחירת קובץ' : 'בחירת תמונה'}</b><span class="sp"></span><button class="btn pink small" data-a="pk-upload" data-k="${kind}">${I.upload} העלאה חדשה</button><button class="btn icon" data-a="pk-cancel" aria-label="סגירה">×</button></header>
    <div class="search" style="margin-bottom:12px">${I.search}<input class="input" type="search" id="pkq" value="${esc(pickerQ)}" placeholder="חיפוש לפי שם, כותרת או יצירה" aria-label="חיפוש" /></div>
    <div class="mgrid picker">${list.slice(0, 300).map((f) => `<button class="mtile" data-a="pk-pick" data-p="${esc(f.path)}" title="${esc(M.meta[f.path]?.title || fileName(f.path))}">${isImg(f.path) ? `<img src="${esc(mUrl(f.path))}" alt="" loading="lazy" />` : `<span class="ftype">${I.file}<b>${esc(M.meta[f.path]?.title || fileName(f.path))}</b></span>`}</button>`).join('') || '<p class="muted">לא נמצאו קבצים</p>'}</div>
  </div>`;
  const inp = document.getElementById('pkq') as HTMLInputElement;
  inp.oninput = () => { pickerQ = inp.value; const pos = inp.selectionStart; drawPicker(kind); const n = document.getElementById('pkq') as HTMLInputElement; n.focus(); n.setSelectionRange(pos, pos); };
}
function finishPick(p: string | null) { closeModal(); const r = pickerResolve; pickerResolve = null; r?.(p); }

async function handleMediaAction(a: string, t: HTMLElement) {
  const p = t.dataset.p || M.open;
  switch (a) {
    case 'm-upload': {
      const files = await pickFiles('image/*,application/pdf', true);
      await uploadFiles(files, /^\d+$/.test(M.creation) ? Number(M.creation) : null); drawMediaList(); break;
    }
    case 'm-view': M.view = t.dataset.v as 'grid' | 'list'; try { localStorage.setItem('yz-media-view', M.view); } catch {} renderMedia(); break;
    case 'm-select': M.selecting = !M.selecting; M.selected.clear(); renderMedia(); break;
    case 'm-sel-all': for (const f of filtered(usageMap())) M.selected.add(f.path); drawMediaList(); break;
    case 'm-sel-none': M.selected.clear(); drawMediaList(); break;
    case 'm-open':
      if (M.selecting) { M.selected.has(p) ? M.selected.delete(p) : M.selected.add(p); drawMediaList(); }
      else openDetails(p);
      break;
    case 'm-nav': {
      const list = filtered(usageMap()); const i = list.findIndex((f) => f.path === M.open) + Number(t.dataset.d);
      if (list[i]) openDetails(list[i].path); break;
    }
    case 'm-close': closeModal(); break;
    case 'm-close-go': closeModal(); break;
    case 'm-del-one': if (await deletePaths([M.open])) { closeModal(); drawMediaList(); } break;
    case 'm-del-sel': if (await deletePaths([...M.selected])) drawMediaList(); break;
    case 'm-optimize-one': await optimizePaths([M.open]); break;
    case 'm-optimize-sel': await optimizePaths([...M.selected]); break;
    case 'm-optimize-all': await optimizePaths(M.files.map((f) => f.path)); break;
    case 'm-edit': await openEditor(M.open); break;
    case 'ed-rot': {
      const c = ed!.canvas; const d = Number(t.dataset.d);
      edApply(cloneCanvas(c, c.height, c.width, (g) => { g.translate(d > 0 ? c.height : 0, d > 0 ? 0 : c.width); g.rotate((d * Math.PI) / 2); g.drawImage(c, 0, 0); })); break;
    }
    case 'ed-flip': { const c = ed!.canvas; edApply(cloneCanvas(c, c.width, c.height, (g) => { g.translate(c.width, 0); g.scale(-1, 1); g.drawImage(c, 0, 0); })); break; }
    case 'ed-crop': { const r = ed!.crop; if (!r) return; const c = ed!.canvas; edApply(cloneCanvas(c, r.w, r.h, (g) => g.drawImage(c, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h))); break; }
    case 'ed-undo': if (ed?.history.length) { ed.canvas = ed.history.pop()!; ed.crop = null; drawEditor(); } break;
    case 'ed-cancel': { const path = ed?.path; ed = null; if (path) openDetails(path); break; }
    case 'ed-save': await edSave(Boolean(t.dataset.copy)); break;
    case 'pk-cancel': finishPick(null); break;
    case 'pk-pick': finishPick(p); break;
    case 'pk-upload': {
      const kind = t.dataset.k === 'pdf' ? 'application/pdf' : 'image/*';
      const files = await pickFiles(kind, false);
      if (!files.length) return;
      const creation = draft && !draftIsNew ? draft.id : null;
      const [path] = await uploadFiles(files, creation);
      finishPick(path || null); break;
    }
    default: return false;
  }
  return true;
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
  ['gallery', 'דף השראות ויצירות', [['title', 'כותרת', 'text'], ['text', 'טקסט מתחת לכותרת', 'text'], ['seoTitle', 'כותרת לגוגל (לא חובה)', 'text'], ['seoDescription', 'תיאור לגוגל (לא חובה)', 'area']]],
  ['creationPage', 'עמוד יצירה', [['closingTitle', 'כותרת הסיום', 'text'], ['closingText', 'טקסט הסיום', 'area'], ['closingButton', 'כפתור וואטסאפ', 'text']]],
  ['footer', 'פוטר', [['tagline', 'משפט מתחת ללוגו', 'area'], ['phone', 'טלפון להצגה', 'text'], ['formTitle', 'כותרת הטופס', 'text'], ['rights', 'זכויות', 'text'], ['note', 'הערה', 'text']]],
  ['contact', 'טופס "יש לכם רעיון ליצירה"', [['whatsapp', 'מספר הוואטסאפ שמקבל את הפניות (בפורמט 9725XXXXXXXX)', 'text']]],
  ['seo', 'SEO — גוגל ושיתוף (דף הבית וברירת מחדל)', [['title', 'כותרת האתר בגוגל', 'text'], ['description', 'תיאור האתר בגוגל', 'area'], ['image', 'תמונת שיתוף ברירת מחדל (וואטסאפ / פייסבוק)', 'image'], ['googleVerification', 'קוד אימות Google Search Console (רק הקוד שבתוך content)', 'text']]],
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
            ${v(sec, k) ? `<img src="${esc(imgSrc(v(sec, k)))}" alt="" /><span class="chg">החלפה</span>` : 'לחצו לבחירת תמונה'}</div>
            ${v(sec, k) && sec === 'seo' ? `<button class="btn ghost small" data-a="site-img-clear" data-sec="${sec}" data-k="${k}" style="margin-top:8px">הסרה (שימוש בתמונה הראשית)</button>` : ''}</div>`
        : `<label class="field"><span>${label}</span>${type === 'area'
          ? `<textarea class="input" data-sec="${sec}" data-k="${k}" rows="4">${esc(v(sec, k))}</textarea>`
          : `<input class="input ${k === 'whatsapp' || k === 'phone' || k === 'googleVerification' ? 'ltr' : ''}" data-sec="${sec}" data-k="${k}" value="${esc(v(sec, k))}" />`}</label>`).join('')}
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
    pending.clear(); pendingMeta = {}; altEdits = {};
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
    <section class="card"><h2>מכשירים מחוברים</h2>
      <p class="muted">חושדים שמישהו אחר נכנס לחשבון, או ששכחתם להתנתק במחשב אחר? אפשר לנתק את כל המכשירים חוץ מזה.</p>
      <button class="btn ghost" data-a="signout-all">ניתוק כל המכשירים האחרים</button>
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
    pending.clear(); pendingMeta = {}; altEdits = {};
    if (!r.startsWith('creation:')) draft = null;
    route = r;
    render();
  });

  document.addEventListener('click', async (e) => {
    const t = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
    if (!t) return;
    const a = t.dataset.a!;
    if (a.startsWith('m-') || a.startsWith('ed-') || a.startsWith('pk-') && a !== 'pk-login' && a !== 'pk-add' && a !== 'pk-del') {
      e.preventDefault();
      try { await handleMediaAction(a, t); } catch (err) { toast((err as Error).message, true, 6000); }
      return;
    }
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
        case 'signout-all':
          if (!confirm('לנתק את כל המכשירים האחרים? יצטרכו להיכנס מחדש.')) return;
          await api('/api/users', { method: 'PATCH', json: { signOutAll: true } }); toast('כל המכשירים האחרים נותקו'); break;
        case 'more': document.body.classList.toggle('more-open'); break;
        case 'move': move(Number(t.dataset.id), Number(t.dataset.d)); break;
        case 'save': saveDraft(); break;
        case 'delete': {
          if (!c || !confirm(`למחוק את "${c.title}"? אי אפשר לבטל את זה מכאן.`)) return;
          const next = data.filter((x) => x.id !== c.id).map((x, k) => ({ ...x, order: k }));
          if (await saveCreations(next, [], `מחיקה: ${c.title}`, 'מחיקת יצירה', c.title)) { draft = null; go('creations'); toast('היצירה נמחקה'); }
          break;
        }
        case 'cover': { const p = await pickMedia('image'); if (!p || !c) return; c.cover = p; markDirty(); renderEditor(String(c.id)); break; }
        case 'seo-img': { const p = await pickMedia('image'); if (!p || !c) return; c.seo = { ...c.seo, image: p }; markDirty(); renderEditor(String(c.id)); break; }
        case 'seo-img-clear': if (c?.seo) { delete c.seo.image; markDirty(); renderEditor(String(c.id)); } break;
        case 'step-img': { const p = await pickMedia('image'); if (!p || !c) return; c.steps[i].image = p; markDirty(); renderEditor(String(c.id)); break; }
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
        case 'dl-add': { const p = await pickMedia('pdf'); if (!p || !c) return; c.download = { label: 'להורדת הקובץ', file: p, gated: false }; markDirty(); renderEditor(String(c.id)); break; }
        case 'dl-del': c!.download = null; markDirty(); renderEditor(String(c!.id)); break;
        case 'copy': {
          const v = t.dataset.v!;
          await navigator.clipboard.writeText(v).then(() => toast('הקישור הועתק'), () => toast(v));
          break;
        }
        case 'site-img': {
          const path = await pickMedia('image');
          if (!path) return;
          site[t.dataset.sec!] = site[t.dataset.sec!] || {};
          site[t.dataset.sec!][t.dataset.k!] = path;
          markDirty(); renderContent(); break;
        }
        case 'site-img-clear': site[t.dataset.sec!][t.dataset.k!] = ''; markDirty(); renderContent(); break;
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

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !document.getElementById('modal')) return;
    if (pickerResolve) finishPick(null); else if (ed) { const p = ed.path; ed = null; openDetails(p); } else closeModal();
  });
  // drag & drop upload on the media page
  let dragN = 0;
  document.addEventListener('dragenter', (e) => { if (route === 'media' && e.dataTransfer?.types.includes('Files')) { dragN++; document.body.classList.add('dragging'); } });
  document.addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; document.body.classList.remove('dragging'); } });
  document.addEventListener('dragover', (e) => { if (route === 'media') e.preventDefault(); });
  document.addEventListener('drop', async (e) => {
    if (route !== 'media') return;
    e.preventDefault(); dragN = 0; document.body.classList.remove('dragging');
    const files = [...(e.dataTransfer?.files || [])].filter((f) => /^image\/|application\/pdf/.test(f.type));
    if (!files.length) return toast('אפשר להעלות תמונות או PDF', true);
    try { await uploadFiles(files, /^\d+$/.test(M.creation) ? Number(M.creation) : null); drawMediaList(); } catch (err) { toast((err as Error).message, true); }
  });

  app.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if ((e.key === 'Enter' || e.key === ' ') && t.classList.contains('photo')) { e.preventDefault(); t.click(); }
  });

  app.addEventListener('input', async (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.m) {
      if (t.dataset.m === 'assign') {
        if (!t.value) return;
        const creation = t.value === 'none' ? null : Number(t.value);
        const patch = Object.fromEntries([...M.selected].map((p) => [p, { ...M.meta[p], creation }]));
        try { const j = await api('/api/media', { method: 'PUT', json: { patch } }); M.meta = j.meta; toast(`${M.selected.size} קבצים שויכו`); } catch (err) { toast((err as Error).message, true); }
        return drawMediaList();
      }
      (M as any)[t.dataset.m] = t.value;
      return drawMediaList();
    }
    if (t.dataset.alt !== undefined) { altEdits[t.dataset.alt] = t.value; updateSeoPreview(); return markDirty(); }
    if (t.dataset.seo && draft) {
      draft.seo = { ...draft.seo, [t.dataset.seo]: t.type === 'checkbox' ? t.checked : t.value };
      if (!draft.seo.title) delete draft.seo.title;
      if (!draft.seo.description) delete draft.seo.description;
      updateSeoPreview();
      return markDirty();
    }
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
    updateSeoPreview();
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
