(() => {
'use strict';

/* ---------- app ---------- */
const APP_NAME = 'Λογοτετράδιο';
const APP_VERSION = '0.2.0';

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const wait = ms => new Promise(r => setTimeout(r, ms));
const reduced = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();
const finePointer = (() => { try { return matchMedia('(pointer: fine)').matches; } catch (e) { return false; } })();

const P = {
  mic: '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path d="M19 11a7 7 0 0 1-14 0"/><path d="M12 18v3"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2.2" fill="currentColor" stroke="none"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
  check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chev: '<path d="M9 5l7 7-7 7"/>',
  more: '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  wave: '<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5v.6"/><circle cx="12" cy="17" r=".5" fill="currentColor"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r=".8" fill="currentColor"/><circle cx="4.5" cy="12" r=".8" fill="currentColor"/><circle cx="4.5" cy="18" r=".8" fill="currentColor"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".6" fill="currentColor"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 20c1.4-3.6 4.4-5.5 8-5.5s6.6 1.9 8 5.5"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4.5h-4.5"/>'
};
const ic = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]}</svg>`;
const LOGO = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="1.5" y="1.5" width="29" height="29" rx="8" fill="var(--accent)"/><path d="M8.5 11h9M8.5 16h7M8.5 21h5" stroke="var(--accent-ink)" stroke-width="2.2" stroke-linecap="round"/><path d="M21.2 13.2c1.3 1.6 1.3 4 0 5.6M24.4 10.6c2.6 3 2.6 7.8 0 10.8" stroke="var(--accent-ink)" stroke-width="2" stroke-linecap="round" fill="none"/></svg>';

/* ---------- storage (IndexedDB, memory fallback) ---------- */
const Store = (() => {
  const mem = { kv: new Map(), audio: new Map() };
  let dbp = null, persistent = true;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise(res => {
      let done = false;
      const fail = () => { if (!done) { done = true; persistent = false; res(null); } };
      const t = setTimeout(fail, 2500);
      try {
        const req = indexedDB.open('logotetradio', 1);
        req.onupgradeneeded = () => { const db = req.result; db.createObjectStore('kv'); db.createObjectStore('audio'); };
        req.onsuccess = () => { if (done) return; done = true; clearTimeout(t); res(req.result); };
        req.onerror = () => { clearTimeout(t); fail(); };
        req.onblocked = () => { clearTimeout(t); fail(); };
      } catch (e) { clearTimeout(t); fail(); }
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const db = await open();
    if (!db) return undefined;
    return new Promise(res => {
      try {
        const t = db.transaction(store, mode);
        const r = fn(t.objectStore(store));
        t.oncomplete = () => res(r && 'result' in r ? r.result : true);
        t.onerror = () => { persistent = false; res(undefined); };
        t.onabort = () => { persistent = false; res(undefined); };
      } catch (e) { persistent = false; res(undefined); }
    });
  }
  return {
    open,
    isPersistent: () => persistent,
    async get(store, key) {
      const v = await tx(store, 'readonly', s => s.get(key));
      return v !== undefined && v !== true ? v : mem[store].get(key);
    },
    async put(store, key, val) { mem[store].set(key, val); await tx(store, 'readwrite', s => s.put(val, key)); },
    async del(store, key) { mem[store].delete(key); await tx(store, 'readwrite', s => s.delete(key)); },
    async clear(store) { mem[store].clear(); await tx(store, 'readwrite', s => s.clear()); }
  };
})();

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

/* ---------- state ---------- */
let S = { children: [], sessions: [] };
const ui = { view: 'home', childId: null, sessionId: null, activeItemId: null, editMode: false, micNoticeDismissed: lsGet('lt-mic-notice') === '1', asrNoticeDismissed: lsGet('lt-asr-notice') === '1' };
let saveTimer = null;
function saveNow() { clearTimeout(saveTimer); saveTimer = null; return Store.put('kv', 'state', JSON.parse(JSON.stringify(S))); }
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 200); }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && saveTimer) saveNow(); });
window.addEventListener('pagehide', () => { if (saveTimer) saveNow(); });

const child = (id = ui.childId) => S.children.find(c => c.id === id);
const session = (id = ui.sessionId) => S.sessions.find(s => s.id === id);
const sessionsOf = cid => S.sessions.filter(s => s.childId === cid).sort((a, b) => b.date.localeCompare(a.date));
const flatItems = s => s ? s.exercises.flatMap(ex => ex.items) : [];
function findItem(id) { for (const s of S.sessions) for (const ex of s.exercises) { const it = ex.items.find(i => i.id === id); if (it) return it; } return null; }
function findEx(id) { const s = session(); return s ? s.exercises.find(e => e.id === id) : null; }

/* ---------- text + comparison ---------- */
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ς/g, 'σ').replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
const isCorrect = it => norm(it.said || it.text) === norm(it.text);
function stats(s) {
  const r = { total: 0, done: 0, ok: 0, dev: 0 };
  flatItems(s).forEach(it => { r.total++; if (it.status === 'done') { r.done++; isCorrect(it) ? r.ok++ : r.dev++; } });
  return r;
}
function diffOps(target, said) {
  const clean = s => Array.from(String(s || '')).filter(ch => /[\p{L}\p{N}\s]/u.test(ch)).join('').replace(/\s+/g, ' ').trim().slice(0, 160);
  const A = Array.from(clean(target)), B = Array.from(clean(said));
  const key = ch => ch.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace('ς', 'σ');
  const a = A.map(key), b = B.map(key), n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops = []; let i = 0, j = 0;
  const push = (t, c) => { const last = ops[ops.length - 1]; if (last && last.t === t) last.c += c; else ops.push({ t, c }); };
  while (i < n && j < m) {
    if (a[i] === b[j]) { push('eq', A[i]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) { push('del', A[i]); i++; }
    else { push('ins', B[j]); j++; }
  }
  while (i < n) push('del', A[i++]);
  while (j < m) push('ins', B[j++]);
  return ops;
}
const diffHTML = (t, s) => diffOps(t, s).map(o => o.t === 'eq' ? esc(o.c) : o.t === 'del' ? `<del>${esc(o.c)}</del>` : `<ins>${esc(o.c)}</ins>`).join('');

/* ---------- latin (greeklish) -> greek ---------- */
// Speech services sometimes answer in latin script ("spiti", "THELO"). The target words are
// greek, so anything latin is transliterated before it reaches the «Όπως το είπε» field.
const hasGreek = s => /\p{Script=Greek}/u.test(String(s || ''));
const hasLatin = s => /[A-Za-z]/.test(String(s || ''));
// Doubles are left as doubles on purpose (κρεμμύδι, θάλασσα): the comparison is letter by letter.
const GR_DI = {
  th: 'θ', ch: 'χ', kh: 'χ', ph: 'φ', gh: 'γ', ps: 'ψ', ks: 'ξ',
  ou: 'ου', ai: 'αι', ei: 'ει', oi: 'οι', au: 'αυ', eu: 'ευ',
  mp: 'μπ', nt: 'ντ', gk: 'γκ', gg: 'γγ', ts: 'τσ', tz: 'τζ'
};
const GR_ONE = {
  a: 'α', b: 'μπ', c: 'κ', d: 'δ', e: 'ε', f: 'φ', g: 'γ', h: 'η', i: 'ι', j: 'τζ', k: 'κ',
  l: 'λ', m: 'μ', n: 'ν', o: 'ο', p: 'π', q: 'κ', r: 'ρ', s: 'σ', t: 'τ', u: 'ου',
  v: 'β', w: 'ω', x: 'ξ', y: 'υ', z: 'ζ'
};
function latinToGreekWord(w) {
  const low = w.toLowerCase();
  let out = '';
  for (let i = 0; i < low.length;) {
    const two = low.slice(i, i + 2);
    if (GR_DI[two]) { out += GR_DI[two]; i += 2; continue; }
    const one = low[i];
    out += Object.prototype.hasOwnProperty.call(GR_ONE, one) ? GR_ONE[one] : one;
    i++;
  }
  out = out.replace(/σ$/, 'ς');
  if (w[0] && w[0] === w[0].toUpperCase() && w[0] !== w[0].toLowerCase()) out = out.charAt(0).toUpperCase() + out.slice(1);
  return out;
}
// Latin runs only: greek already in the text is left untouched.
const toGreek = s => String(s || '').replace(/[A-Za-z]+/g, latinToGreekWord);

/* ---------- dates ---------- */
const DF = new Intl.DateTimeFormat('el-GR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const sod = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
function relDate(iso) {
  const diff = Math.round((sod(new Date()) - sod(new Date(iso))) / 86400000);
  if (diff === 0) return 'Σήμερα';
  if (diff === 1) return 'Χθες';
  if (diff > 1 && diff < 7) return `Πριν από ${diff} μέρες`;
  return DF.format(new Date(iso));
}
const fullDate = iso => DF.format(new Date(iso));
const fmtDur = sec => { sec = Math.max(0, Math.round(sec || 0)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };

/* ---------- presets + demo data ---------- */
const PRESETS = [
  { label: '/σ/ αρχή', title: '/σ/ στην αρχή της λέξης', words: ['σαπούνι', 'σάκος', 'σοκολάτα', 'σύννεφο', 'σούπα'] },
  { label: '/σ/ συμπλέγματα', title: '/σ/ + σύμφωνο στην αρχή', words: ['σπίτι', 'στόμα', 'σκύλος', 'σταφύλι', 'σφουγγάρι', 'σκάλα'] },
  { label: '/ρ/ αρχή', title: '/ρ/ στην αρχή της λέξης', words: ['ράφι', 'ρόδα', 'ρολόι', 'ρύζι', 'ρίζα'] },
  { label: '/ρ/ συμπλέγματα', title: 'Συμπλέγματα με /ρ/', words: ['τρένο', 'δράκος', 'κρεβάτι', 'πράσινο', 'γρανίτα', 'βροχή'] },
  { label: '/λ/', title: '/λ/ στην αρχή και στη μέση', words: ['λεμόνι', 'λύκος', 'λουλούδι', 'μπάλα', 'γάλα'] },
  { label: '/κ/ – /γ/', title: '/κ/ και /γ/', words: ['κότα', 'κουτάλι', 'κάστρο', 'γάτα', 'γόμα'] },
  { label: 'Φράσεις', title: 'Φράσεις', words: ['Ο σκύλος τρέχει', 'Η γάτα πίνει γάλα', 'Θέλω ένα ποτήρι νερό'] }
];
function daysAgo(n) { const d = new Date(); d.setHours(10, 0, 0, 0); d.setDate(d.getDate() - n); return d.toISOString(); }
function mkItem(text, said) {
  const it = { id: uid(), text, note: '', status: 'pending', said: '', audio: false, audioDur: 0, doneAt: null };
  if (said !== undefined) { it.status = 'done'; it.said = said === true ? text : said; it.doneAt = new Date().toISOString(); }
  return it;
}
const mkEx = (title, list) => ({ id: uid(), title, items: list.map(x => Array.isArray(x) ? mkItem(x[0], x[1]) : mkItem(x)) });
function seed() {
  const c1 = { id: uid(), name: 'Μαρία Κ.', age: '5 ετών', focus: '/σ/ σε συμπλέγματα', av: 1, example: true };
  const c2 = { id: uid(), name: 'Νικόλας Π.', age: '6 ετών', focus: '/ρ/ και συμπλέγματα με /ρ/', av: 2, example: true };
  const c3 = { id: uid(), name: 'Ελένη Μ.', age: '4 ετών', focus: '/κ/ – /γ/', av: 3, example: true };
  return {
    children: [c1, c2, c3],
    sessions: [
      { id: uid(), childId: c1.id, date: daysAgo(0), exercises: [
        mkEx('/σ/ + σύμφωνο στην αρχή', [['σπίτι', true], ['στόμα', 'τόμα'], ['σκύλος', true], 'σκάλα', 'σφουγγάρι', 'σταφύλι']),
        mkEx('/σ/ στη μέση της λέξης', ['κάστρο', 'μάσκα', 'πάστα', 'κόσμος']),
        mkEx('Φράσεις', ['Το σπίτι είναι μεγάλο', 'Ο σκύλος τρέχει στο πάρκο'])
      ]},
      { id: uid(), childId: c1.id, date: daysAgo(7), exercises: [
        mkEx('/σ/ + σύμφωνο στην αρχή', [['σπίτι', 'πίτι'], ['στόμα', 'τόμα'], ['σκύλος', 'κύλος'], ['σκάλα', true], ['σφουγγάρι', 'φουγγάρι'], ['σταφύλι', 'ταφύλι']]),
        mkEx('Φράσεις', [['Ο σκύλος τρέχει', 'Ο κύλος τέχει']])
      ]},
      { id: uid(), childId: c2.id, date: daysAgo(3), exercises: [
        mkEx('/ρ/ στην αρχή της λέξης', [['ράφι', 'λάφι'], ['ρόδα', true], 'ρολόι', 'ρύζι']),
        mkEx('Συμπλέγματα με /ρ/', [['τρένο', 'τλένο'], ['δράκος', 'δλάκος'], ['κρεβάτι', true], ['πράσινο', 'πλάσινο'], 'βροχή', 'γρανίτα'])
      ]},
      { id: uid(), childId: c3.id, date: daysAgo(1), exercises: [
        mkEx('/κ/ στην αρχή της λέξης', ['κότα', 'κουτάλι', 'κάστρο', 'καπέλο']),
        mkEx('/γ/ στην αρχή της λέξης', ['γάτα', 'γόμα', 'γάλα', 'γουρούνι'])
      ]}
    ]
  };
}

/* ---------- microphone mode ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
const UA = navigator.userAgent || '';
const isIOS = /iPad|iPhone|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// iOS hands the audio session to one consumer at a time: speech recognition and MediaRecorder
// cannot both hold the microphone, so «Ήχος και υπαγόρευση» can only ever give one of the two.
const noDualMic = isIOS;
// Added to the Home Screen, iOS runs the page outside full Safari, where Apple does not
// enable the Web Speech API at all: start() fails instantly, without a permission prompt.
const isStandalone = !!(navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches));
const srBlocked = isIOS && isStandalone;
function detectMic() {
  try {
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) return 'native';
    const fp = document.permissionsPolicy || document.featurePolicy;
    if (fp && typeof fp.allowsFeature === 'function' && !fp.allowsFeature('microphone')) return 'native';
  } catch (e) { return 'native'; }
  return 'live';
}
let micMode = detectMic();

/* ---------- audio store + playback ---------- */
const urlCache = new Map();
async function putAudio(id, blob) {
  if (urlCache.has(id)) { try { URL.revokeObjectURL(urlCache.get(id)); } catch (e) {} urlCache.delete(id); }
  await Store.put('audio', id, blob);
}
async function deleteAudio(id) {
  if (urlCache.has(id)) { try { URL.revokeObjectURL(urlCache.get(id)); } catch (e) {} urlCache.delete(id); }
  await Store.del('audio', id);
}
async function audioURL(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  const blob = await Store.get('audio', id);
  if (!blob) return null;
  const u = URL.createObjectURL(blob); urlCache.set(id, u); return u;
}
const blobToDataURL = blob => new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(blob); });
const player = new Audio();
let playingId = null;
// Slower playback is for hearing how a sound was actually made, so keep the pitch.
const PLAY_RATES = [0.5, 0.75, 1];
let playRate = parseFloat(lsGet('lt-play-rate'));
if (!PLAY_RATES.includes(playRate)) playRate = 1;
let seekDrag = false, seekTimer = 0;
function applyRate() {
  try {
    player.playbackRate = playRate;
    player.preservesPitch = true;
    if ('webkitPreservesPitch' in player) player.webkitPreservesPitch = true;
  } catch (e) {}
}
// MediaRecorder blobs often report an Infinite duration, so the length measured while
// recording is the reliable one and the element's duration is only a refinement.
function itemDur(it) {
  if (playingId === it.id && isFinite(player.duration) && player.duration > 0) return player.duration;
  return it.audioDur || 0;
}
player.addEventListener('ended', syncPlay); player.addEventListener('pause', syncPlay); player.addEventListener('play', syncPlay);
player.addEventListener('timeupdate', syncPlayTime);
player.addEventListener('loadedmetadata', syncPlayTime);
player.addEventListener('ended', () => { try { player.currentTime = 0; } catch (e) {} syncPlayTime(); });
function syncPlay() {
  $$('[data-act="play"]').forEach(b => {
    const on = b.dataset.item === playingId && !player.paused;
    b.innerHTML = ic(on ? 'pause' : 'play');
    b.setAttribute('aria-label', on ? 'Παύση' : 'Αναπαραγωγή');
  });
}
function syncPlayTime() {
  if (!playingId) return;
  const it = findItem(playingId); if (!it) return;
  const dur = itemDur(it), cur = player.currentTime || 0;
  const sl = document.getElementById('seek-' + playingId);
  if (sl && !seekDrag) { if (dur && parseFloat(sl.max) !== dur) sl.max = dur; sl.value = cur; fillSeek(sl, cur, dur); }
  const lab = document.getElementById('ptime-' + playingId);
  if (lab) lab.textContent = fmtDur(cur) + ' / ' + fmtDur(dur);
}
const fillSeek = (sl, cur, dur) => { if (sl) sl.style.setProperty('--p', dur > 0 ? Math.min(1, cur / dur) : 0); };
async function loadInto(id) {
  if (playingId === id && player.src) return true;
  const u = await audioURL(id);
  if (!u) return false;
  stopPlayback(); playingId = id; player.src = u; applyRate();
  return true;
}
async function seekTo(id, t) {
  if (!await loadInto(id)) return;
  try { player.currentTime = t; } catch (e) {}
  syncPlay(); syncPlayTime();
}
function stopPlayback() { try { player.pause(); } catch (e) {} }
async function togglePlay(id) {
  if (playingId === id && !player.paused) { player.pause(); return; }
  if (playingId === id && player.src) { applyRate(); try { await player.play(); return; } catch (e) {} }
  const u = await audioURL(id);
  if (!u) { toast('Η ηχογράφηση δεν βρέθηκε σε αυτή τη συσκευή.'); return; }
  playingId = id; player.src = u; applyRate();
  try { await player.play(); }
  catch (e) {
    const blob = await Store.get('audio', id);
    const d = blob ? await blobToDataURL(blob) : null;
    if (d) { player.src = d; applyRate(); try { await player.play(); return; } catch (e2) {} }
    toast('Αυτή η μορφή ήχου δεν αναπαράγεται σε αυτόν τον browser.');
  }
}
function measureDuration(blob) {
  return new Promise(res => {
    try {
      const a = document.createElement('audio'); const u = URL.createObjectURL(blob);
      const t = setTimeout(() => { URL.revokeObjectURL(u); res(0); }, 4000);
      a.preload = 'metadata';
      a.onloadedmetadata = () => { clearTimeout(t); const d = isFinite(a.duration) ? a.duration : 0; URL.revokeObjectURL(u); res(d); };
      a.onerror = () => { clearTimeout(t); URL.revokeObjectURL(u); res(0); };
      a.src = u;
    } catch (e) { res(0); }
  });
}

/* ---------- on-device transcription (Whisper via transformers.js) ---------- */
// iOS hands the microphone to one consumer, so dictation while recording is impossible there.
// Transcribing the saved clip afterwards sidesteps that entirely, and the audio never leaves
// the device — unlike the browser's own dictation, which goes to Google or Apple.
const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js';
// Measured on greek single words: tiny got 1 of 4 right and base 0 of 4, while small got
// 4 of 4. Anything below small is not worth offering as a working option.
// Only whisper-small is reliable on greek single words (4/4 in testing, against 1/4 for tiny
// and 0/4 for base), so there is one option rather than a choice that can be made wrongly.
const ASR_MODEL = { repo: 'onnx-community/whisper-small', mb: 238 };
const ASR_MODELS = { small: ASR_MODEL };
let asrModel = lsGet('lt-asr-model') || '';
if (!ASR_MODELS[asrModel]) asrModel = '';
let asrPipe = null, asrPipeKey = '', asrLoading = null;
const asrBusy = new Set();

function asrStatus(id, msg, cls) {
  const el = document.getElementById('asr-' + id);
  if (!el) return;
  el.hidden = !msg;
  el.className = 'hint' + (cls ? ' ' + cls : '');
  el.textContent = msg || '';
}

// One combined percentage across every file the model needs, so the wait reads as one download.
function makeProgress(id) {
  const files = new Map();
  let shown = 0;
  return p => {
    if (!p || p.status !== 'progress' || !p.total) return;
    files.set(p.file, { loaded: p.loaded || 0, total: p.total });
    let loaded = 0, total = 0;
    files.forEach(f => { loaded += f.loaded; total += f.total; });
    if (!total) return;
    // Files appear one by one, so the raw ratio jumps backwards as new ones join.
    const pct = Math.round(loaded / total * 100);
    if (pct < shown) return;
    shown = pct;
    asrStatus(id, 'Λήψη μοντέλου… ' + pct + '%');
  };
}

// navigator.gpu being present does not mean an adapter exists, and asking for a webgpu
// pipeline without one hangs instead of throwing.
let gpuOK = null;
async function hasWebGPU() {
  if (gpuOK !== null) return gpuOK;
  gpuOK = false;
  try { if (navigator.gpu) gpuOK = !!(await navigator.gpu.requestAdapter()); } catch (e) {}
  return gpuOK;
}

async function loadASR(onProgress) {
  if (asrPipe && asrPipeKey === asrModel) return asrPipe;
  if (asrLoading) return asrLoading;
  asrLoading = (async () => {
    const T = await import(TRANSFORMERS_URL);
    T.env.allowLocalModels = false;
    const repo = ASR_MODEL.repo;
    // WebGPU where it exists (Safari 26, recent Chrome); plain wasm is the fallback, and
    // GitHub Pages cannot send the COOP/COEP headers that wasm threads would need.
    const tries = await hasWebGPU()
      ? [{ device: 'webgpu', dtype: 'q4' }, { device: 'wasm', dtype: 'q8' }]
      : [{ device: 'wasm', dtype: 'q8' }, {}];
    let err = null;
    for (const opts of tries) {
      try {
        asrPipe = await T.pipeline('automatic-speech-recognition', repo, Object.assign({ progress_callback: onProgress }, opts));
        asrPipeKey = asrModel;
        return asrPipe;
      } catch (e) { err = e; }
    }
    throw err || new Error('pipeline failed');
  })();
  try { return await asrLoading; }
  finally { asrLoading = null; }
}

// Whisper wants mono 16 kHz float samples.
async function decodeTo16k(blob) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) throw new Error('no AudioContext');
  const buf = await blob.arrayBuffer();
  const ctx = new AC();
  let decoded;
  try {
    decoded = await new Promise((res, rej) => {
      const p = ctx.decodeAudioData(buf, res, rej);
      if (p && p.then) p.then(res, rej);
    });
  } finally { try { ctx.close(); } catch (e) {} }
  const frames = Math.ceil(decoded.duration * 16000);
  if (!frames) throw new Error('empty audio');
  try {
    const OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const off = new OC(1, frames, 16000);
    const src = off.createBufferSource();
    src.buffer = decoded; src.connect(off.destination); src.start();
    return (await off.startRendering()).getChannelData(0);
  } catch (e) {
    // Older Safari refuses odd sample rates on OfflineAudioContext: resample by hand.
    const ch = decoded.numberOfChannels;
    const src = decoded.getChannelData(0);
    const mono = new Float32Array(src.length);
    mono.set(src);
    for (let c = 1; c < ch; c++) { const d = decoded.getChannelData(c); for (let i = 0; i < mono.length; i++) mono[i] += d[i]; }
    if (ch > 1) for (let i = 0; i < mono.length; i++) mono[i] /= ch;
    const ratio = decoded.sampleRate / 16000;
    const out = new Float32Array(frames);
    for (let i = 0; i < frames; i++) out[i] = mono[Math.min(mono.length - 1, Math.round(i * ratio))] || 0;
    return out;
  }
}

const cleanASR = t => String(t || '').replace(/[\s]+/g, ' ').replace(/^[\s.,!?·"'«»-]+|[\s.,!?·"'«»-]+$/g, '').trim();

async function transcribeItem(id) {
  const it = findItem(id);
  if (!it || !it.audio || !asrModel || asrBusy.has(id)) return;
  asrBusy.add(id);
  renderAsrButton(id, true);
  try {
    asrStatus(id, 'Προετοιμασία…');
    const pipe = await loadASR(makeProgress(id));
    const blob = await Store.get('audio', id);
    if (!blob) throw new Error('no audio');
    const t0 = Date.now();
    const tick = setInterval(() => asrStatus(id, 'Απομαγνητοφώνηση… ' + Math.round((Date.now() - t0) / 1000) + 's'), 1000);
    let out;
    try {
      asrStatus(id, 'Απομαγνητοφώνηση…');
      const audio = await decodeTo16k(blob);
      out = await pipe(audio, { language: 'el', task: 'transcribe', return_timestamps: false });
    } finally { clearInterval(tick); }
    const text = toGreek(cleanASR(out && out.text));
    const cur = findItem(id);
    if (!cur) return;
    if (!text) { asrStatus(id, 'Δεν αναγνωρίστηκε ομιλία στην ηχογράφηση.', 'warn'); return; }
    cur.said = text;
    if (cur.status === 'done') cur.doneAt = cur.doneAt || new Date().toISOString();
    saveNow();
    const ta = document.getElementById('said-' + id);
    if (ta) { ta.value = text; autoGrow(ta); }
    const cmp = document.getElementById('cmp-' + id);
    if (cmp) cmp.innerHTML = compareHTML(cur, text);
    asrStatus(id, 'Γράφτηκε από την ηχογράφηση. Ακούστε την και διορθώστε αν χρειάζεται.', 'ok');
    updateProgress();
  } catch (e) {
    const off = !navigator.onLine;
    asrStatus(id, off
      ? 'Η πρώτη λήψη του μοντέλου χρειάζεται σύνδεση στο internet.'
      : 'Η τοπική απομαγνητοφώνηση απέτυχε σε αυτή τη συσκευή. ' + ((e && e.message) || e), 'warn');
  } finally {
    asrBusy.delete(id);
    renderAsrButton(id, false);
  }
}

function renderAsrButton(id, busy) {
  const b = document.querySelector(`[data-act="asr"][data-item="${id}"]`);
  if (!b) return;
  b.disabled = !!busy;
  b.textContent = busy ? 'Απομαγνητοφώνηση…' : 'Απομαγνητοφώνηση στη συσκευή';
}

/* ---------- live recording + dictation ---------- */
const REC_MODES = {
  both: { label: 'Ήχος και υπαγόρευση', desc: 'Κρατά την ηχογράφηση και γράφει αυτόματα το κείμενο.' },
  dictation: { label: 'Μόνο υπαγόρευση', desc: 'Γράφει αυτόματα το κείμενο, χωρίς αρχείο ήχου. Για κινητά όπου τα δύο μαζί δεν δουλεύουν.' },
  audio: { label: 'Μόνο ήχος', desc: 'Κρατά μόνο την ηχογράφηση. Το κείμενο το γράφετε ή το υπαγορεύετε με το πληκτρολόγιο.' }
};
let recMode = lsGet('lt-rec-mode');
// On iPhone and iPad the microphone cannot be shared, and from the Home Screen there is no
// Web Speech at all, so live dictation is never the right default there.
if (!REC_MODES[recMode]) recMode = (isIOS ? 'audio' : 'both');
// A dictation mode used to be offered on iOS. It cannot work there, so a stored choice is
// moved over once instead of leaving anyone stuck with a button that produces nothing.
if (isIOS && recMode !== 'audio' && lsGet('lt-ios-mode-fix') !== '1') { recMode = 'audio'; lsSet('lt-rec-mode', recMode); }
if (isIOS) lsSet('lt-ios-mode-fix', '1');
const wantAudio = () => recMode !== 'dictation';
const wantSR = () => recMode !== 'audio' && !!SR;
const SETTINGS_ERR = new Set(['audio-capture', 'unsupported', 'start', 'service-not-allowed', 'not-allowed']);

const Rec = { state: 'idle', itemId: null, note: null };
let wakeLock = null;
async function requestWake() { try { if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {} }
function releaseWake() { try { wakeLock && wakeLock.release(); } catch (e) {} wakeLock = null; }
function pickMime() {
  const list = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
  try { return list.find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || ''; } catch (e) { return ''; }
}
const liveText = () => [Rec.final, Rec.interim].filter(Boolean).join(' ');

async function toggleRec(id) {
  if (Rec.state === 'recording') { const same = Rec.itemId === id; await stopRec(); if (same) return; }
  if (Rec.state !== 'idle') return;
  await startRec(id);
}

function handleMicError(err, id) {
  const name = err && err.name;
  let framed = false;
  try { framed = window.self !== window.top; } catch (e) { framed = true; }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') { toast('Δεν βρέθηκε μικρόφωνο σε αυτή τη συσκευή.', 4200); return; }
  if (name === 'NotReadableError' || name === 'AbortError') { toast('Το μικρόφωνο χρησιμοποιείται από άλλη εφαρμογή. Κλείστε την και δοκιμάστε ξανά.', 4800); return; }
  if (framed || name === 'SecurityError' || name === 'TypeError') {
    micMode = 'native'; ui.micNoticeDismissed = false; renderKeep();
    toast('Εδώ ο browser δεν δίνει πρόσβαση στο μικρόφωνο. Πατήστε ξανά το κουμπί για την κάμερα ή την ηχογράφηση του κινητού.', 5200);
    return;
  }
  micPermissionSheet(id);
}

// Recognition refusing leaves a dictation-only take with neither text nor audio, which
// reads as «the button does nothing». There is no microphone conflict to respect any more
// at that point, so take the mic and keep the recording instead.
function attachRecorder(stream) {
  const mime = pickMime();
  try { Rec.mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); } catch (e) { Rec.mr = new MediaRecorder(stream); }
  Rec.mr.ondataavailable = e => { if (e.data && e.data.size) Rec.chunks.push(e.data); };
  Rec.mrStopped = new Promise(res => { Rec.mr.onstop = res; });
  Rec.mr.start(250);
  const tr = stream.getAudioTracks()[0];
  if (tr) tr.onmute = () => { Rec.muted = true; };
}
async function fallbackToAudio(id) {
  if (Rec.itemId !== id || Rec.stream || !navigator.mediaDevices) return false;
  let stream = null;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch (e) { return false; }
  if (Rec.itemId !== id || Rec.state !== 'recording' || Rec.stream) {
    try { stream.getTracks().forEach(t => t.stop()); } catch (e) {}
    return false;
  }
  Rec.stream = stream; Rec.fellBack = true; Rec.t0 = performance.now();
  attachRecorder(stream);
  startMeter(stream);
  renderKeep();
  return true;
}
async function recoverOrStop(id) {
  const ok = await fallbackToAudio(id);
  if (!ok && Rec.state === 'recording' && Rec.itemId === id) stopRec();
}

async function startRec(id) {
  const it = findItem(id); if (!it) return;
  stopPlayback();
  Rec.state = 'starting'; Rec.itemId = id; Rec.note = null;
  Object.assign(Rec, {
    stream: null, chunks: [], final: '', interim: '', srError: null, srErrorMsg: '', restarts: 0, srActive: false, srEndResolve: null,
    recog: null, mr: null, mrStopped: Promise.resolve(), peak: null, muted: false,
    single: !/\s/.test(String(it.text).trim()), t0: performance.now(), fellBack: false
  });
  // «Μόνο υπαγόρευση» is a preference, not a guarantee. On a device with no working
  // recognition — an iOS Home Screen app, or Firefox — keep the audio instead of refusing
  // to start, so the red button always does something.
  Rec.fellBack = !wantAudio() && !wantSR();
  // Safari grants speech recognition only from inside the tap that asked for it. Awaiting
  // getUserMedia first ends the user gesture and start() then fails with service-not-allowed,
  // so dictation starts here, before the first await.
  if (wantSR()) startSR();
  let stream = null;
  if (wantAudio() || Rec.fellBack) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (err) {
      abortSR();
      Rec.state = 'idle'; Rec.itemId = null;
      handleMicError(err, id);
      return;
    }
  }
  if (it.audio) await deleteAudio(id);
  Object.assign(it, { audio: false, audioDur: 0, said: '', status: 'pending', doneAt: null });
  Rec.stream = stream;
  Rec.t0 = performance.now();
  if (stream) attachRecorder(stream);
  Rec.state = 'recording';
  if (stream) startMeter(stream);
  // Recognition may already have failed while we were still starting up, and the handler
  // could not act on a take that had not begun.
  if (!stream && Rec.srError) recoverOrStop(id);
  Rec.timer = setInterval(tick, 200);
  Rec.autoStop = setTimeout(() => { if (Rec.state === 'recording' && Rec.itemId === id) stopRec(); }, 60000);
  requestWake();
  renderKeep();
}

function tick() {
  const el = document.getElementById('recTime-' + Rec.itemId);
  if (el) el.textContent = fmtDur((performance.now() - Rec.t0) / 1000);
}

// Greek is what we compare against, so a greek-script alternative wins over a latin one.
function bestAlt(res) {
  const first = (res[0] && res[0].transcript || '').trim();
  if (!first || hasGreek(first)) return first;
  for (let k = 1; k < res.length; k++) {
    const t = (res[k] && res[k].transcript || '').trim();
    if (t && hasGreek(t)) return t;
  }
  return first;
}
function startSR() {
  let r;
  try { r = new SR(); } catch (e) { Rec.srError = 'unsupported'; return; }
  r.lang = 'el-GR'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 5;
  r.onstart = () => { Rec.srActive = true; };
  r.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i], t = toGreek(bestAlt(res));
      if (res.isFinal) { if (t) Rec.final = Rec.final ? Rec.final + ' ' + t : t; }
      else if (t) interim += (interim ? ' ' : '') + t;
    }
    Rec.interim = interim;
    updateLive();
  };
  r.onerror = e => {
    if (['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported'].includes(e.error)) {
      Rec.srError = e.error; Rec.srErrorMsg = e.message || ''; updateLive();
      if (!Rec.stream && Rec.state === 'recording') recoverOrStop(Rec.itemId);
    }
  };
  r.onend = () => {
    Rec.srActive = false;
    if (Rec.interim) { Rec.final = Rec.final ? Rec.final + ' ' + Rec.interim : Rec.interim; Rec.interim = ''; }
    // Single words: keep the first thing heard (fewer restart beeps on Android). Phrases: keep listening.
    const live = Rec.state === 'recording' || Rec.state === 'starting';
    const keepGoing = live && !Rec.srError && Rec.restarts < 40 && !(Rec.single && Rec.final);
    if (keepGoing) {
      Rec.restarts++;
      setTimeout(() => { if ((Rec.state === 'recording' || Rec.state === 'starting') && Rec.recog === r) { try { r.start(); } catch (e) {} } }, 120);
    } else if (Rec.srEndResolve) { const f = Rec.srEndResolve; Rec.srEndResolve = null; f(); }
    updateLive();
  };
  Rec.recog = r;
  try { r.start(); } catch (e) { Rec.srError = 'start'; }
}
function abortSR() {
  const r = Rec.recog; Rec.recog = null;
  if (!r) return;
  try { r.onend = r.onresult = r.onerror = null; r.abort(); } catch (e) {}
  Rec.srActive = false;
}
function stopSR() {
  const r = Rec.recog;
  if (!r || !Rec.srActive) return Promise.resolve();
  return new Promise(res => {
    const t = setTimeout(res, 1600);
    Rec.srEndResolve = () => { clearTimeout(t); res(); };
    try { r.stop(); } catch (e) { clearTimeout(t); res(); }
  });
}

function startMeter(stream) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = new AC();
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
    const src = ctx.createMediaStreamSource(stream); const an = ctx.createAnalyser();
    an.fftSize = 1024; src.connect(an);
    const buf = new Float32Array(an.fftSize); const hist = new Array(16).fill(0); let last = 0;
    Rec.meter = { ctx, raf: 0 }; Rec.peak = 0;
    const loop = t => {
      if (Rec.state !== 'recording') return;
      try {
        an.getFloatTimeDomainData(buf);
        let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        if (rms > Rec.peak) Rec.peak = rms;
        if (t - last > 70) {
          last = t; hist.push(Math.min(1, rms * 7)); hist.shift();
          $$('#level-' + Rec.itemId + ' i').forEach((b, i) => { b.style.transform = `scaleY(${Math.max(0.08, hist[i] || 0)})`; });
        }
      } catch (e) {}
      Rec.meter.raf = requestAnimationFrame(loop);
    };
    Rec.meter.raf = requestAnimationFrame(loop);
  } catch (e) {}
}
function stopMeter() { try { if (Rec.meter) { cancelAnimationFrame(Rec.meter.raf); Rec.meter.ctx.close(); } } catch (e) {} Rec.meter = null; }

async function stopRec() {
  if (Rec.state !== 'recording') return;
  Rec.state = 'stopping';
  const id = Rec.itemId, it = findItem(id);
  clearInterval(Rec.timer); clearTimeout(Rec.autoStop);
  const dur = (performance.now() - Rec.t0) / 1000;
  try { if (Rec.mr && Rec.mr.state !== 'inactive') Rec.mr.stop(); } catch (e) {}
  const srDone = stopSR();
  await Promise.race([Rec.mrStopped, wait(2000)]);
  await srDone;
  stopMeter();
  if (Rec.stream) { try { Rec.stream.getTracks().forEach(t => t.stop()); } catch (e) {} }
  const text = liveText().trim();
  let saved = false;
  if (it) {
    if (Rec.mr && Rec.chunks.length) {
      const type = Rec.mr.mimeType || (Rec.chunks[0] && Rec.chunks[0].type) || 'audio/webm';
      const blob = new Blob(Rec.chunks, { type });
      if (blob.size > 0) { await putAudio(id, blob); it.audio = true; it.audioDur = dur; saved = true; }
    }
    it.said = text;
  }
  const silent = saved && dur > 1 && Rec.peak !== null && (Rec.muted || Rec.peak < 0.0005 || (!!text && Rec.peak < 0.003));
  let note = null;
  if (silent) {
    note = recMode === 'both' && SR
      ? { msg: 'Η ηχογράφηση βγήκε χωρίς ήχο. Σε κάποια κινητά η υπαγόρευση παίρνει το μικρόφωνο από την ηχογράφηση. Δοκιμάστε «Μόνο υπαγόρευση» ή «Μόνο ήχος».', settings: true }
      : { msg: 'Η ηχογράφηση βγήκε χωρίς ήχο. Ελέγξτε ότι το μικρόφωνο δεν είναι σε σίγαση ή σε χρήση από άλλη εφαρμογή.', settings: false };
  } else if (Rec.srError && !text) {
    note = { msg: srMessage(Rec.srError) + (saved ? ' Η ηχογράφηση κρατήθηκε.' : '') + errCode(Rec.srError, Rec.srErrorMsg), settings: SETTINGS_ERR.has(Rec.srError) };
  } else if (Rec.fellBack) {
    note = { msg: 'Αυτή η συσκευή δεν έχει αυτόματη υπαγόρευση, οπότε κρατήθηκε η ηχογράφηση.', settings: true };
  }
  Rec.note = note ? Object.assign(note, { item: id }) : null;
  releaseWake();
  Object.assign(Rec, { state: 'idle', itemId: null, mr: null, stream: null, recog: null, chunks: [] });
  saveNow(); renderKeep();
  if (finePointer) { const ta = document.getElementById('said-' + id); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }
  // The recorder had the microphone, so on iOS there is never dictation text to keep here.
  if (saved && asrModel && !text) transcribeItem(id);
}

// The raw code travels with the advice: testers report it back and it is what tells
// a permission problem apart from a missing language or an unreachable service.
function errCode(err, msg) { return err ? ' [' + err + (msg ? ': ' + msg : '') + ']' : ''; }
function hintText(err, msg) { const m = srMessage(err); return m ? m + errCode(err, msg) : ''; }

function srMessage(err) {
  switch (err) {
    case null: case undefined: case '': return '';
    case 'unsupported': return 'Αυτός ο browser δεν έχει αυτόματη υπαγόρευση. Γράψτε το κείμενο ή χρησιμοποιήστε το μικρόφωνο του πληκτρολογίου.';
    case 'network': return 'Η υπαγόρευση χρειάζεται σύνδεση στο internet. Η ηχογράφηση συνεχίζεται κανονικά.';
    case 'language-not-supported': return 'Η ελληνική υπαγόρευση δεν είναι διαθέσιμη σε αυτή τη συσκευή.';
    case 'service-not-allowed':
      if (isIOS) return 'Το iOS δίνει αυτόματη υπαγόρευση μόνο μέσα στην ίδια την εφαρμογή Safari: όχι από την οθόνη αφετηρίας, ούτε από σύνδεσμο που άνοιξε μέσα σε άλλη εφαρμογή (Messages, Mail, WhatsApp). Ανοίξτε τη διεύθυνση στο Safari, ή —πιο αξιόπιστα εδώ— αφήστε την τοπική απομαγνητοφώνηση να γράψει το κείμενο από την ηχογράφηση.';
      return 'Η υπαγόρευση είναι απενεργοποιημένη στη συσκευή. Ενεργοποιήστε την από Ρυθμίσεις → Γενικά → Πληκτρολόγιο → Υπαγόρευση, βεβαιωθείτε ότι στις «Γλώσσες υπαγόρευσης» υπάρχουν τα Ελληνικά, και δοκιμάστε ξανά.';
    case 'not-allowed':
      if (noDualMic && wantAudio()) return 'Στο iPhone και στο iPad η υπαγόρευση δεν δουλεύει ταυτόχρονα με την ηχογράφηση. Διαλέξτε «Μόνο υπαγόρευση».';
      return 'Ο browser δεν έδωσε άδεια για την υπαγόρευση. Επιτρέψτε το μικρόφωνο στις ρυθμίσεις του ιστότοπου και δοκιμάστε ξανά.';
    case 'audio-capture': return 'Η υπαγόρευση δεν βρήκε ελεύθερο μικρόφωνο. Σε κάποια κινητά δεν δουλεύει μαζί με την ηχογράφηση: δοκιμάστε «Μόνο υπαγόρευση».';
    default: return 'Η υπαγόρευση δεν ξεκίνησε σε αυτή τη συσκευή. Γράψτε το κείμενο ή χρησιμοποιήστε το μικρόφωνο του πληκτρολογίου.';
  }
}

function updateLive() {
  if (!Rec.itemId) return;
  const id = Rec.itemId, it = findItem(id);
  const ta = document.getElementById('said-' + id);
  if (ta) { ta.value = liveText(); autoGrow(ta); }
  const cmp = document.getElementById('cmp-' + id);
  if (cmp && it) cmp.innerHTML = compareHTML(it, liveText());
  const h = document.getElementById('recHint-' + id);
  if (h) { const m = hintText(Rec.srError, Rec.srErrorMsg); h.textContent = m; h.hidden = !m; }
}

/* ---------- native recorder fallback ---------- */
let nativeTarget = null;
$('#nativeRecInput').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0];
  const id = nativeTarget; e.target.value = ''; nativeTarget = null;
  if (!f || !id) return;
  const it = findItem(id); if (!it) return;
  if (sheetCtx) closeSheet();
  stopPlayback(); Rec.note = null;
  await putAudio(id, f);
  it.audio = true; it.audioDur = await measureDuration(f);
  if (it.status === 'done') { it.status = 'pending'; it.doneAt = null; }
  saveNow(); renderKeep();
  toast('Το κλιπ αποθηκεύτηκε. Για το κείμενο, πατήστε «Όπως το είπε» και το μικρόφωνο του πληκτρολογίου.', 4200);
});

/* ---------- rendering ---------- */
function render() {
  renderTop();
  const v = $('#view');
  if (ui.view === 'child' && child()) v.innerHTML = viewChild();
  else if (ui.view === 'session' && session()) v.innerHTML = viewSession();
  else { ui.view = 'home'; v.innerHTML = viewHome(); }
  $$('textarea.said').forEach(autoGrow);
}
function renderKeep() { const y = window.scrollY; render(); window.scrollTo(0, y); }
function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.max(56, ta.scrollHeight + 3) + 'px'; }

function renderTop() {
  const t = $('#top');
  if (ui.view === 'child' && child()) {
    const c = child();
    t.innerHTML = `<button class="icon-btn" data-act="back" aria-label="Πίσω">${ic('back')}</button>
      <div class="top-title"><b>${esc(c.name)}</b><small>Καρτέλα παιδιού</small></div>
      <button class="icon-btn" data-act="edit-child" aria-label="Στοιχεία παιδιού">${ic('edit')}</button>`;
  } else if (ui.view === 'session' && session()) {
    const s = session(), c = child(s.childId);
    t.innerHTML = `<button class="icon-btn" data-act="back" aria-label="Πίσω">${ic('back')}</button>
      <div class="top-title"><b>${esc(c ? c.name : '')}</b><small>Συνεδρία · ${esc(fullDate(s.date))}</small></div>
      <button class="icon-btn" data-act="menu-session" aria-label="Επιλογές συνεδρίας">${ic('more')}</button>`;
  } else {
    t.innerHTML = `<div class="brand">${LOGO}<span class="brand-name">${esc(APP_NAME)}</span></div>
      <div class="top-actions"><button class="icon-btn" data-act="help" aria-label="Πώς λειτουργεί">${ic('help')}</button>
      <button class="icon-btn" data-act="menu-home" aria-label="Επιλογές">${ic('more')}</button></div>`;
  }
}

const avClass = c => 'av' + (((c.av || 1) - 1) % 4 + 1);
const initial = name => esc((String(name || '?').trim()[0] || '?').toUpperCase());
function miniBar(st) {
  const t = st.total || 1;
  return `<span class="mini-bar" aria-hidden="true"><i class="b-ok" style="width:${st.ok / t * 100}%"></i><i class="b-dev" style="width:${st.dev / t * 100}%"></i></span>`;
}

function storageNotice() {
  if (!Store.isPersistent()) return `<div class="notice plain">${ic('info')}<div><strong>Προσωρινή αποθήκευση</strong><p>Σε αυτή την προβολή ο browser δεν κρατά δεδομένα. Οι αλλαγές και οι ηχογραφήσεις χάνονται με ανανέωση της σελίδας.</p></div></div>`;
  return `<div class="notice plain">${ic('info')}<div><strong>Έκδοση επίδειξης</strong><p>Τα παιδιά είναι παραδείγματα. Ό,τι προσθέτετε, μαζί με τις ηχογραφήσεις, μένει μόνο σε αυτή τη συσκευή.</p></div></div>`;
}

function viewHome() {
  const kids = S.children;
  const inProgress = S.sessions.map(s => ({ s, st: stats(s) })).filter(x => x.st.done > 0 && x.st.done < x.st.total && child(x.s.childId))
    .sort((a, b) => b.s.date.localeCompare(a.s.date)).slice(0, 2);
  const resume = inProgress.map(({ s, st }) => {
    const c = child(s.childId);
    return `<li><button class="row-card resume" data-act="open-session" data-id="${s.id}">
      <span class="rc-main"><span class="resume-k">Συνέχεια συνεδρίας</span>
        <span class="rc-title">${esc(c.name)}</span>
        <span class="rc-foot">${miniBar(st)}<span>${esc(relDate(s.date))} · ${st.done} από ${st.total}</span></span></span>
      ${ic('chev', 'chev')}</button></li>`;
  }).join('');
  const cards = kids.map(c => {
    const ss = sessionsOf(c.id), last = ss[0], st = last ? stats(last) : null;
    return `<li><button class="row-card" data-act="open-child" data-id="${c.id}">
      <span class="avatar ${avClass(c)}">${initial(c.name)}</span>
      <span class="rc-main">
        <span class="rc-title">${esc(c.name)}${c.example ? '<span class="tag">Παράδειγμα</span>' : ''}</span>
        <span class="rc-meta">${esc([c.age, c.focus].filter(Boolean).join(' · '))}</span>
        ${last ? `<span class="rc-foot">${miniBar(st)}<span>${esc(relDate(last.date))} · ${st.done}/${st.total}</span></span>` : '<span class="rc-foot">Χωρίς συνεδρίες ακόμα</span>'}
      </span>${ic('chev', 'chev')}</button></li>`;
  }).join('');
  return `<div class="stack">
    <p class="lede">Πλάνο ασκήσεων για κάθε παιδί και καταγραφή του πώς ακριβώς ειπώθηκε κάθε λέξη.</p>
    ${storageNotice()}
    ${resume ? `<ul class="list">${resume}</ul>` : ''}
    <div class="section-head"><h2 class="eyebrow">Παιδιά</h2><span class="count">${kids.length}</span></div>
    ${kids.length ? `<ul class="list">${cards}</ul>` : `<div class="empty"><p>Δεν έχετε προσθέσει παιδιά ακόμα.</p><button class="btn btn-soft" data-act="load-demo">Φόρτωση παραδείγματος</button></div>`}
    <button class="btn btn-primary btn-block" data-act="new-child">${ic('plus')} Νέο παιδί</button>
    <button class="link-btn" data-act="help">Πώς λειτουργεί</button>
  </div>`;
}

function viewChild() {
  const c = child(), ss = sessionsOf(c.id);
  const rows = ss.map(s => {
    const st = stats(s), acc = st.done ? Math.round(st.ok / st.done * 100) : null;
    return `<li><button class="row-card" data-act="open-session" data-id="${s.id}">
      <span class="rc-main"><span class="rc-title">${esc(relDate(s.date))}</span>
        <span class="rc-meta">${esc(fullDate(s.date))} · ${s.exercises.length} ${s.exercises.length === 1 ? 'άσκηση' : 'ασκήσεις'}</span>
        <span class="rc-foot">${miniBar(st)}<span>${st.done}/${st.total}${acc !== null ? ` · ${acc}% σωστά` : ''}</span></span></span>
      ${ic('chev', 'chev')}</button></li>`;
  }).join('');
  return `<div class="stack">
    <section class="child-head"><span class="avatar lg ${avClass(c)}">${initial(c.name)}</span>
      <div><h1 class="h1">${esc(c.name)}</h1><p class="muted">${esc([c.age, c.focus ? 'Στόχος: ' + c.focus : ''].filter(Boolean).join(' · ')) || 'Χωρίς στοιχεία'}</p></div></section>
    <button class="btn btn-primary btn-block" data-act="new-session">${ic('plus')} Νέα συνεδρία</button>
    <div class="section-head"><h2 class="eyebrow">Συνεδρίες</h2><span class="count">${ss.length}</span></div>
    ${ss.length ? `<ul class="list">${rows}</ul>` : '<div class="empty"><p>Καμία συνεδρία ακόμα. Ξεκινήστε με ένα πλάνο ασκήσεων.</p></div>'}
  </div>`;
}

function progressHTML(s) {
  const st = stats(s), t = st.total || 1;
  return `<div class="bar" role="img" aria-label="${st.done} από ${st.total} ολοκληρώθηκαν"><i class="b-ok" style="width:${st.ok / t * 100}%"></i><i class="b-dev" style="width:${st.dev / t * 100}%"></i></div>
    <div class="legend"><span><b>${st.done}</b>/${st.total} ολοκληρώθηκαν</span><span class="lg ok"><span>${st.ok} σωστά</span></span><span class="lg dev"><span>${st.dev} με απόκλιση</span></span></div>`;
}
function updateProgress() { const el = $('#progress'); const s = session(); if (el && s) el.innerHTML = progressHTML(s); }

function micNotice() {
  if (micMode !== 'native' || ui.micNoticeDismissed) return '';
  return `<div class="notice">${ic('mic')}<div><strong>Ηχογράφηση με την κάμερα ή την εφαρμογή του κινητού</strong>
    <p>Σε αυτή την προβολή ο browser δεν δίνει πρόσβαση στο μικρόφωνο. Το κόκκινο κουμπί ανοίγει την κάμερα ή την ηχογράφηση του κινητού και το κλιπ αποθηκεύεται στη λέξη για να το ξανακούσετε. Το κείμενο δεν γράφεται αυτόματα από το κλιπ: πατήστε στο «Όπως το είπε» και χρησιμοποιήστε το μικρόφωνο του πληκτρολογίου.</p></div>
    <button class="icon-btn sm" data-act="dismiss-mic" aria-label="Απόκρυψη">${ic('close')}</button></div>`;
}

function asrNotice() {
  if (!isIOS || asrModel || ui.asrNoticeDismissed) return '';
  return `<div class="notice">${ic('wave')}<div><strong>Αυτόματο κείμενο στο iPhone</strong>
    <p>Το iPhone δεν δίνει το μικρόφωνο στην υπαγόρευση όσο ηχογραφεί. Η εφαρμογή μπορεί να γράφει το κείμενο από την ηχογράφηση, μέσα στη συσκευή. Λήψη ${ASR_MODEL.mb} MB μία φορά.</p>
    <button class="link-btn" data-act="enable-asr">Ενεργοποίηση</button></div>
    <button class="icon-btn sm" data-act="dismiss-asr" aria-label="Απόκρυψη">${ic('close')}</button></div>`;
}

function viewSession() {
  const s = session(), st = stats(s);
  if (ui.activeItemId && !flatItems(s).some(i => i.id === ui.activeItemId)) ui.activeItemId = null;
  const exs = s.exercises.map((ex, i) => exHTML(ex, i)).join('');
  return `<div class="stack">
    <div class="progress" id="progress">${progressHTML(s)}</div>
    ${micNotice()}
    ${asrNotice()}
    ${ui.editMode
      ? `<div class="edit-banner"><span>Επεξεργασία πλάνου</span><button class="btn btn-primary" data-act="edit-off">Τέλος</button></div>`
      : `<div class="toolbar"><button class="btn btn-ghost" data-act="edit-on">${ic('edit')} Επεξεργασία πλάνου</button><button class="btn btn-ghost" data-act="summary">${ic('list')} Σύνοψη</button></div>`}
    ${!ui.editMode && st.total && st.done === st.total ? `<div class="done-banner">${ic('check')}<span class="grow">Η συνεδρία ολοκληρώθηκε.</span><button class="btn btn-ok" data-act="summary">Σύνοψη</button></div>` : ''}
    ${s.exercises.length ? exs : `<div class="empty"><p>Το πλάνο είναι κενό. Προσθέστε την πρώτη άσκηση με λέξεις ή φράσεις.</p></div>`}
    <button class="btn btn-soft btn-block" data-act="new-ex">${ic('plus')} Νέα άσκηση</button>
  </div>`;
}

function exHTML(ex, i) {
  const done = ex.items.filter(x => x.status === 'done').length;
  const head = ui.editMode
    ? `<div class="ex-head"><div style="flex:1;min-width:0"><p class="eyebrow">Άσκηση ${i + 1}</p>
        <input class="ex-title-input" id="ext-${ex.id}" data-input="ex-title" data-ex="${ex.id}" value="${esc(ex.title)}" placeholder="Τίτλος άσκησης" aria-label="Τίτλος άσκησης"></div>
        <div class="ex-tools"><button class="icon-btn" data-act="del-ex" data-ex="${ex.id}" aria-label="Διαγραφή άσκησης">${ic('trash')}</button></div></div>`
    : `<div class="ex-head"><div><p class="eyebrow">Άσκηση ${i + 1}</p><h2>${esc(ex.title || 'Χωρίς τίτλο')}</h2></div><span class="ex-count">${done}/${ex.items.length}</span></div>`;
  return `<section class="ex">${head}
    <ol class="items">${ex.items.map(it => itemHTML(it)).join('')}</ol>
    <button class="add-words" data-act="add-words" data-ex="${ex.id}">${ic('plus')} Προσθήκη λέξεων</button>
  </section>`;
}

function dotHTML(it) {
  if (it.status !== 'done') return '<span class="dot" aria-label="Σε αναμονή"></span>';
  return isCorrect(it) ? `<span class="dot ok" aria-label="Σωστό">${ic('check')}</span>` : '<span class="dot dev" aria-label="Με απόκλιση"></span>';
}

function itemHTML(it) {
  if (ui.editMode) {
    return `<li class="item edit"><input id="it-${it.id}" data-input="item-text" data-item="${it.id}" value="${esc(it.text)}" aria-label="Λέξη ή φράση" autocomplete="off" spellcheck="false">
      <button class="icon-btn" data-act="del-item" data-item="${it.id}" aria-label="Διαγραφή">${ic('trash')}</button></li>`;
  }
  if (it.id === ui.activeItemId) return cardHTML(it);
  const done = it.status === 'done', dev = done && !isCorrect(it);
  return `<li class="item ${done ? 'is-done' : ''}">
    <button class="item-main" data-act="activate" data-item="${it.id}">
      ${dotHTML(it)}
      <span class="item-words"><span class="item-text">${esc(it.text)}</span>${dev ? `<span class="item-said"><span class="arrow">είπε</span>${esc(it.said)}</span>` : ''}</span>
      ${it.audio ? `<span class="mini-ic" title="Υπάρχει ηχογράφηση">${ic('wave')}</span>` : ''}
    </button>
    ${done ? '' : `<button class="quick-ok" data-act="quick-ok" data-item="${it.id}" aria-label="Σωστό: ${esc(it.text)}">${ic('check')}</button>`}
  </li>`;
}

function compareHTML(it, said) {
  said = (said || '').trim();
  if (!said) return it.status === 'done' ? `<span class="match">${ic('check')} Ειπώθηκε σωστά</span>` : '';
  if (norm(said) === norm(it.text)) return `<span class="match">${ic('check')} Ίδιο με τον στόχο</span>`;
  return `<span class="field-label">Σύγκριση με τον στόχο</span>
    <span class="cmp-row"><span class="cmp-tag">Στόχος</span><span class="cmp-word" lang="el">${esc(it.text)}</span></span>
    <span class="cmp-row"><span class="cmp-tag">Διαφορά</span><span class="diff" lang="el">${diffHTML(it.text, said)}</span></span>
    <span class="diff-legend"><del>α</del> παραλείφθηκε · <ins>α</ins> αντικατάσταση ή προσθήκη</span>`;
}

function playerRowHTML(it) {
  const on = playingId === it.id && !player.paused;
  const dur = itemDur(it), cur = playingId === it.id ? (player.currentTime || 0) : 0;
  return `<div class="play-row">
    <button class="play-btn" data-act="play" data-item="${it.id}" aria-label="${on ? 'Παύση' : 'Αναπαραγωγή'}">${ic(on ? 'pause' : 'play')}</button>
    <div class="player">
      <input type="range" class="seek" id="seek-${it.id}" data-input="seek" data-item="${it.id}" min="0" max="${dur || 1}" step="0.01" value="${cur}" style="--p:${dur > 0 ? Math.min(1, cur / dur) : 0}" aria-label="Θέση στην ηχογράφηση">
      <div class="play-meta">
        <span class="ptime" id="ptime-${it.id}">${fmtDur(cur)} / ${fmtDur(dur)}</span>
        <span class="rates" role="group" aria-label="Ταχύτητα αναπαραγωγής">${PLAY_RATES.map(r => `<button data-act="rate" data-rate="${r}" class="${r === playRate ? 'sel' : ''}" aria-pressed="${r === playRate}">${r}×</button>`).join('')}</span>
      </div>
    </div>
  </div>`;
}

function recButtonHTML(it, rec) {
  if (micMode === 'native') {
    return `<label class="rec-btn" for="nativeRecInput" data-native-item="${it.id}" role="button" tabindex="0" aria-label="Ηχογράφηση με την κάμερα ή την εφαρμογή του κινητού">${ic('mic')}</label>`;
  }
  return `<button class="rec-btn ${rec ? 'recording' : ''}" data-act="rec" data-item="${it.id}" aria-label="${rec ? 'Τέλος ηχογράφησης' : 'Έναρξη ηχογράφησης'}">${ic(rec ? 'stop' : 'mic')}</button>`;
}

function cardHTML(it) {
  const rec = Rec.itemId === it.id && Rec.state === 'recording';
  const said = rec ? liveText() : (it.said || '');
  const done = it.status === 'done';
  const hasSaid = !!said.trim();
  let info;
  if (rec) {
    info = `<strong>${Rec.stream ? 'Ηχογράφηση' : 'Ακούω'}… <span id="recTime-${it.id}">${fmtDur((performance.now() - Rec.t0) / 1000)}</span></strong>
      ${Rec.stream ? `<span class="level" id="level-${it.id}" aria-hidden="true">${'<i></i>'.repeat(16)}</span>` : ''}
      <small>${Rec.stream ? 'Πατήστε ■ όταν τελειώσει το παιδί.' : 'Η υπαγόρευση γράφει όσο μιλά το παιδί. Πατήστε ■ για τέλος.'}</small>`;
  } else if (micMode === 'native') {
    info = it.audio
      ? `<strong>Νέα ηχογράφηση</strong><small>Αντικαθιστά την τρέχουσα.</small>`
      : `<strong>Πατήστε για ηχογράφηση</strong><small>Ανοίγει την κάμερα ή την ηχογράφηση του κινητού. Κρατάμε το κλιπ για επανάληψη.</small>`;
  } else {
    const sub = recMode === 'dictation' ? 'Μόνο υπαγόρευση: γράφει ό,τι ακούγεται, χωρίς αρχείο ήχου.'
      : recMode === 'audio' ? 'Μόνο ήχος: η ηχογράφηση αποθηκεύεται στη λέξη.'
      : (SR ? 'Κρατά την ηχογράφηση και γράφει αυτόματα ό,τι ακούγεται.' : 'Η ηχογράφηση αποθηκεύεται στη λέξη. Αυτός ο browser δεν έχει αυτόματη υπαγόρευση.');
    info = (it.audio || hasSaid) && !done
      ? `<strong>Νέα προσπάθεια</strong><small>Αντικαθιστά την τρέχουσα ηχογράφηση και το κείμενο.</small>`
      : `<strong>Πατήστε για ηχογράφηση</strong><small>${sub}</small>`;
  }
  const note = !rec && Rec.note && Rec.note.item === it.id ? Rec.note : null;
  const hintMsg = rec ? hintText(Rec.srError, Rec.srErrorMsg) : (note ? note.msg : '');
  const primary = done ? `Επόμενη λέξη ${ic('chev')}` : `${ic('check')} ${hasSaid ? 'Ολοκλήρωση' : 'Σωστό'} <span class="sub">· Επόμενο</span>`;
  return `<li class="item-card ${rec ? 'is-rec' : ''}" id="card-${it.id}">
    <div class="card-top">
      <div><p class="eyebrow">Στόχος</p><div class="target" lang="el">${esc(it.text)}</div>${it.note ? `<div class="note">${esc(it.note)}</div>` : ''}</div>
      ${done ? (isCorrect(it) ? `<span class="pill ok">${ic('check')} Σωστό</span>` : '<span class="pill dev">Με απόκλιση</span>') : ''}
    </div>
    <div class="rec-row">${recButtonHTML(it, rec)}<div class="rec-info">${info}</div></div>
    ${it.audio && !rec ? playerRowHTML(it) : ''}
    <div class="field">
      <label class="field-label" for="said-${it.id}">Όπως το είπε</label>
      <textarea id="said-${it.id}" class="said ${rec ? 'live' : ''}" rows="1" data-input="said" data-item="${it.id}" placeholder="${done ? '' : 'Αφήστε κενό αν ειπώθηκε σωστά'}" ${rec ? 'readonly' : ''} autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" lang="el" enterkeyhint="done">${esc(said)}</textarea>
      <p class="hint warn" id="recHint-${it.id}" ${hintMsg ? '' : 'hidden'}>${esc(hintMsg)}</p>
      ${note && note.settings ? (isIOS && !asrModel
        ? '<button class="link-btn" data-act="enable-asr">Ενεργοποίηση αυτόματου κειμένου στη συσκευή</button>'
        : '<button class="link-btn" data-act="rec-settings">Ρυθμίσεις εγγραφής</button>') : ''}
      <button class="link-btn" data-act="to-greek" data-item="${it.id}" id="lat-${it.id}" ${!rec && hasLatin(said) ? '' : 'hidden'}>Μετατροπή σε ελληνικά</button>
      ${!rec && hasSaid && it.audio && !done ? '<p class="hint">Ακούστε την ηχογράφηση και διορθώστε το κείμενο ώστε να γράφει ακριβώς ό,τι ειπώθηκε.</p>' : ''}
      ${it.audio && !rec && asrModel ? `<button class="link-btn" data-act="asr" data-item="${it.id}" ${asrBusy.has(it.id) ? 'disabled' : ''}>${asrBusy.has(it.id) ? 'Απομαγνητοφώνηση…' : 'Απομαγνητοφώνηση στη συσκευή'}</button>` : ''}
      <p class="hint" id="asr-${it.id}" hidden></p>
    </div>
    <div class="compare" id="cmp-${it.id}">${compareHTML(it, said)}</div>
    <div class="card-actions">
      <button class="btn btn-ghost" data-act="reset" data-item="${it.id}" aria-label="Επαναφορά" ${rec || (!it.audio && !hasSaid && !done) ? 'disabled' : ''}>${ic('reset')} <span class="hide-sm">Επαναφορά</span></button>
      <button class="btn btn-ok" id="done-${it.id}" data-act="done" data-item="${it.id}" ${rec ? 'disabled' : ''}>${primary}</button>
    </div>
  </li>`;
}

/* ---------- sheets ---------- */
let sheetCtx = null;
function openSheet(html, ctx = {}) {
  const root = $('#sheetRoot');
  root.innerHTML = `<div class="overlay" data-overlay="1"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  root.hidden = false; document.body.classList.add('noscroll');
  sheetCtx = ctx;
  const f = root.querySelector('[autofocus]');
  if (f && finePointer) setTimeout(() => f.focus(), 30);
  if (ctx.mount) ctx.mount(root);
}
function closeSheet() { const root = $('#sheetRoot'); root.innerHTML = ''; root.hidden = true; document.body.classList.remove('noscroll'); sheetCtx = null; }

function confirmSheet(title, text, label, onYes) {
  openSheet(`<h2 class="sheet-title">${esc(title)}</h2><p class="sheet-sub" style="margin:0">${esc(text)}</p>
    <div class="sheet-actions"><button class="btn btn-ghost" data-act="close-sheet">Άκυρο</button><button class="btn btn-danger" data-act="sheet-yes">${esc(label)}</button></div>`, { yes: onYes });
}

function childSheet(c) {
  openSheet(`<h2 class="sheet-title">${c ? 'Στοιχεία παιδιού' : 'Νέο παιδί'}</h2>
    <form id="childForm" class="stack" novalidate>
      <div><label class="lbl" for="cf-name">Όνομα</label><input class="input" id="cf-name" value="${esc(c ? c.name : '')}" placeholder="π.χ. Γιώργος Α." autocomplete="off" autofocus><p class="err" id="cf-err" hidden>Γράψτε ένα όνομα.</p></div>
      <div><label class="lbl" for="cf-age">Ηλικία</label><input class="input" id="cf-age" value="${esc(c ? c.age : '')}" placeholder="π.χ. 5 ετών" autocomplete="off"></div>
      <div><label class="lbl" for="cf-focus">Στόχος θεραπείας</label><input class="input" id="cf-focus" value="${esc(c ? c.focus : '')}" placeholder="π.χ. /σ/ σε συμπλέγματα" autocomplete="off"></div>
      <div class="sheet-actions"><button type="button" class="btn btn-ghost" data-act="close-sheet">Άκυρο</button><button type="submit" class="btn btn-primary">${c ? 'Αποθήκευση' : 'Δημιουργία και πλάνο'}</button></div>
      ${c ? `<button type="button" class="link-btn" style="color:var(--red)" data-act="del-child">Διαγραφή παιδιού</button>` : ''}
    </form>`, { childId: c ? c.id : null });
}

function wordsSheet(exId) {
  const ex = exId ? findEx(exId) : null;
  openSheet(`<h2 class="sheet-title">${ex ? 'Προσθήκη λέξεων' : 'Νέα άσκηση'}</h2>
    ${ex ? `<p class="sheet-sub">${esc(ex.title)}</p>` : ''}
    <form id="wordsForm" class="stack" novalidate>
      ${ex ? '' : `<div><label class="lbl" for="wf-title">Τίτλος άσκησης</label><input class="input" id="wf-title" placeholder="π.χ. /σ/ + σύμφωνο στην αρχή" autocomplete="off"></div>`}
      <div><label class="lbl" for="wf-words">Λέξεις ή φράσεις, μία σε κάθε γραμμή</label>
        <textarea class="textarea" id="wf-words" placeholder="σπίτι&#10;στόμα&#10;σκύλος" autocomplete="off" autocorrect="off" spellcheck="false" lang="el" ${ex ? 'autofocus' : ''}></textarea></div>
      <div><span class="lbl">Έτοιμες λίστες</span><div class="chips">${PRESETS.map((p, i) => `<button type="button" class="chip" data-act="preset" data-i="${i}">${esc(p.label)}</button>`).join('')}</div></div>
      <p class="err" id="wf-err" hidden>Γράψτε τουλάχιστον μία λέξη.</p>
      <div class="sheet-actions"><button type="button" class="btn btn-ghost" data-act="close-sheet">Άκυρο</button><button type="submit" class="btn btn-primary" id="wf-submit">Προσθήκη</button></div>
    </form>`, { exId });
}
function parseWords(v) {
  v = String(v || '');
  const parts = /\n/.test(v) ? v.split(/\n/) : v.split(/[,;]/);
  return parts.map(x => x.trim()).filter(Boolean);
}
function updateWordsCount() {
  const n = parseWords(($('#wf-words') || {}).value).length, b = $('#wf-submit');
  if (b) b.textContent = n ? `Προσθήκη ${n} ${n === 1 ? 'λέξης' : 'λέξεων'}` : 'Προσθήκη';
}

function newSessionSheet() {
  const c = child(), last = sessionsOf(c.id)[0];
  if (!last) { createSession(false); return; }
  const n = flatItems(last).length;
  openSheet(`<h2 class="sheet-title">Νέα συνεδρία</h2><p class="sheet-sub">${esc(c.name)} · ${esc(fullDate(new Date().toISOString()))}</p>
    <button class="opt" data-act="ns-copy"><b>Ίδιο πλάνο με την τελευταία</b><span>${last.exercises.length} ${last.exercises.length === 1 ? 'άσκηση' : 'ασκήσεις'} και ${n} λέξεις από τη συνεδρία της ${esc(fullDate(last.date))}. Όλες ξεκινούν από την αρχή.</span></button>
    <button class="opt" data-act="ns-empty"><b>Κενό πλάνο</b><span>Προσθέτετε νέες ασκήσεις.</span></button>
    <div class="sheet-actions"><button class="btn btn-ghost" data-act="close-sheet">Άκυρο</button></div>`);
}
function createSession(copy) {
  const c = child(), last = sessionsOf(c.id)[0];
  const s = { id: uid(), childId: c.id, date: new Date().toISOString(), exercises: [] };
  if (copy && last) s.exercises = last.exercises.map(ex => ({ id: uid(), title: ex.title, items: ex.items.map(it => ({ ...mkItem(it.text), note: it.note || '' })) }));
  S.sessions.push(s); save(); closeSheet();
  openSession(s.id);
  if (!s.exercises.length) wordsSheet(null);
}

function summaryText(s) {
  const c = child(s.childId), st = stats(s);
  const lines = [`${c ? c.name : ''} · Συνεδρία ${fullDate(s.date)}`, `Ολοκληρώθηκαν ${st.done}/${st.total} · Σωστά ${st.ok} · Με απόκλιση ${st.dev}`, ''];
  s.exercises.forEach(ex => {
    lines.push(ex.title || 'Άσκηση');
    ex.items.forEach(it => {
      if (it.status !== 'done') lines.push(`  –  ${it.text} (δεν έγινε)`);
      else if (isCorrect(it)) lines.push(`  ✓  ${it.text}`);
      else lines.push(`  ✗  ${it.text} → ${it.said}`);
    });
    lines.push('');
  });
  return lines.join('\n').trim();
}
function summarySheet() {
  const s = session(), c = child(s.childId), st = stats(s);
  const body = s.exercises.map(ex => `<h3 class="sum-ex">${esc(ex.title || 'Άσκηση')}</h3><ul class="sum-list">${ex.items.map(it => {
    const done = it.status === 'done', ok = done && isCorrect(it);
    return `<li>${dotHTML(it)}<span class="w"><span>${esc(it.text)}</span>${done && !ok ? `<span class="diff">${diffHTML(it.text, it.said)}</span>` : ''}${!done ? '<span class="pend">δεν έγινε</span>' : ''}</span>${it.audio ? `<span class="mini-ic" style="color:var(--faint)">${ic('wave')}</span>` : ''}</li>`;
  }).join('')}</ul>`).join('');
  openSheet(`<h2 class="sheet-title">Σύνοψη συνεδρίας</h2><p class="sheet-sub">${esc(c ? c.name : '')} · ${esc(fullDate(s.date))}</p>
    <div class="sum-stats"><span><b style="color:var(--ink)">${st.done}</b>/${st.total} ολοκληρώθηκαν</span><span class="lg ok"><span>${st.ok} σωστά</span></span><span class="lg dev"><span>${st.dev} με απόκλιση</span></span></div>
    ${body || '<p class="muted">Δεν υπάρχουν λέξεις στο πλάνο.</p>'}
    <textarea id="sumText" class="vh" readonly tabindex="-1" aria-hidden="true">${esc(summaryText(s))}</textarea>
    <div class="sheet-actions"><button class="btn btn-ghost" data-act="close-sheet">Κλείσιμο</button><button class="btn btn-primary" data-act="copy-summary">${ic('copy')} Αντιγραφή κειμένου</button></div>`);
}

function helpSheet() {
  const recText = micMode === 'live'
    ? REC_MODES[recMode].label + (SR || recMode === 'audio' ? '' : ' (χωρίς υπαγόρευση σε αυτόν τον browser)')
    : 'Κάμερα ή εφαρμογή ηχογράφησης του κινητού, κείμενο από το μικρόφωνο του πληκτρολογίου';
  openSheet(`<h2 class="sheet-title">Πώς λειτουργεί</h2>
    <ol class="steps">
      <li><b>Πλάνο.</b> Για κάθε παιδί ανοίγετε συνεδρία και προσθέτετε ασκήσεις. Γράφετε ή επικολλάτε λέξεις και φράσεις, μία σε κάθε γραμμή, ή διαλέγετε έτοιμη λίστα.</li>
      <li><b>Εγγραφή.</b> Πατάτε το κόκκινο κουμπί στη λέξη. Η ηχογράφηση αποθηκεύεται και η υπαγόρευση γράφει στο «Όπως το είπε» ό,τι ακούστηκε.</li>
      <li><b>Έλεγχος.</b> Διορθώνετε το κείμενο ώστε να γράφει ακριβώς την παραγωγή του παιδιού. Η σύγκριση δείχνει τι παραλείφθηκε ή αντικαταστάθηκε. Με την «Επαναφορά» ξεκινάτε νέα προσπάθεια.</li>
      <li><b>Ολοκλήρωση.</b> Το «Σωστό» κλείνει τη λέξη ακόμα και χωρίς ηχογράφηση και ανοίγει αμέσως την επόμενη. Για γρήγορο πέρασμα, πατάτε το ✓ δίπλα σε κάθε λέξη της λίστας.</li>
    </ol>
    <div class="notice plain">${ic('info')}<div><strong>Η υπαγόρευση γράφει πάντα ελληνικά</strong><p>Αν η υπηρεσία φωνής απαντήσει με λατινικούς χαρακτήρες («spiti»), το κείμενο μετατρέπεται αυτόματα σε ελληνικά («σπιτι») ώστε να συγκρίνεται γράμμα προς γράμμα με τον στόχο. Αν γράψετε εσείς greeklish, πατήστε «Μετατροπή σε ελληνικά» κάτω από το πεδίο.</p></div></div>
    <div class="notice plain">${ic('info')}<div><strong>Η υπαγόρευση διορθώνει προς υπαρκτές λέξεις</strong><p>Αν το παιδί πει «πίτι», η υπαγόρευση μπορεί να γράψει «πίτα». Ακούτε την ηχογράφηση και διορθώνετε το κείμενο.</p></div></div>
    <div class="notice plain">${ic('info')}<div><strong>Πού πηγαίνει ο ήχος</strong><p>Οι ηχογραφήσεις και τα δεδομένα μένουν μόνο σε αυτή τη συσκευή. Η αυτόματη υπαγόρευση όμως χρησιμοποιεί την υπηρεσία φωνής του browser: στο Chrome ο ήχος της υπαγόρευσης επεξεργάζεται από την Google, στο Safari από την Apple.</p></div></div>
    <dl class="facts"><dt>Εγγραφή</dt><dd>${esc(recText)}</dd><dt>Αποθήκευση</dt><dd>${Store.isPersistent() ? 'Μόνο σε αυτή τη συσκευή' : 'Προσωρινή, μέχρι την ανανέωση'}</dd><dt>Έκδοση</dt><dd>${APP_VERSION}</dd></dl>
    <div class="sheet-actions">${micMode === 'live' ? '<button class="btn btn-ghost" data-act="rec-settings">Ρυθμίσεις εγγραφής</button>' : ''}<button class="btn btn-primary" data-act="close-sheet">Εντάξει</button></div>`);
}

function recSettingsSheet(msg) {
  openSheet(`<h2 class="sheet-title">Ρυθμίσεις εγγραφής</h2>
    <p class="sheet-sub">Τι κάνει το κόκκινο κουμπί σε αυτή τη συσκευή.</p>
    ${msg ? `<p class="hint warn">${esc(msg)}</p>` : ''}
    ${Object.keys(REC_MODES).map(k => {
      const dead = k !== 'audio' && (!SR || srBlocked);
      return `<button class="opt ${k === recMode && !dead ? 'sel' : ''}" data-act="set-rec-mode" data-mode="${k}" aria-pressed="${k === recMode && !dead}" ${dead ? 'disabled' : ''}><b>${esc(REC_MODES[k].label)}</b><span>${dead ? (srBlocked ? 'Δεν δουλεύει από την οθόνη αφετηρίας. Ανοίξτε τη διεύθυνση στο Safari.' : 'Δεν υποστηρίζεται σε αυτόν τον browser.') : esc(REC_MODES[k].desc)}</span></button>`;
    }).join('')}
    ${SR ? `<button class="btn btn-ghost" data-act="sr-test" style="width:100%;margin-top:4px">${ic('mic')} Δοκιμή υπαγόρευσης</button>
      <p class="hint" id="srTestOut" hidden></p>
      <button class="link-btn" data-act="sr-test-any" id="srTestMore" hidden>Δοκιμή με τη γλώσσα της συσκευής</button>
      <p class="hint">Η δοκιμή ακούει χωρίς να ηχογραφεί, ώστε να φανεί αν φταίει η υπαγόρευση ή το μικρόφωνο.</p>
      ${noDualMic ? '<p class="hint warn">Σε iPhone και iPad η υπαγόρευση δεν δουλεύει ταυτόχρονα με την ηχογράφηση. Διαλέξτε «Μόνο υπαγόρευση» ή «Μόνο ήχος».</p>' : ''}
      <h3 class="sheet-sub" style="margin:18px 0 2px;font-weight:700;color:var(--ink)">Τοπική απομαγνητοφώνηση</h3>
      <p class="hint" style="margin-bottom:8px">Γράφει το κείμενο από την αποθηκευμένη ηχογράφηση, μέσα στη συσκευή. Δουλεύει και σε iPhone μαζί με τον ήχο, γιατί δεν χρειάζεται το μικρόφωνο. Το μοντέλο κατεβαίνει μία φορά και μένει στον browser.</p>
      <button class="opt ${asrModel ? '' : 'sel'}" data-act="set-asr-model" data-model="" aria-pressed="${!asrModel}"><b>Ανενεργή</b><span>Το κείμενο το γράφετε εσείς.</span></button>
      <button class="opt ${asrModel ? 'sel' : ''}" data-act="set-asr-model" data-model="small" aria-pressed="${!!asrModel}"><b>Ενεργή</b><span>Λήψη ${ASR_MODEL.mb} MB μία φορά, μετά δουλεύει χωρίς internet.</span></button>
      <p class="hint">Γράφει κι αυτή προς υπαρκτές λέξεις, όπως η υπαγόρευση. Ακούτε πάντα την ηχογράφηση και διορθώνετε.</p>
      <button class="link-btn" data-act="copy-diag">Αντιγραφή στοιχείων για αναφορά</button>
      <textarea id="diagText" class="vh" readonly tabindex="-1" aria-hidden="true"></textarea>`
      : '<p class="hint">Αυτός ο browser δεν έχει αυτόματη υπαγόρευση. Για υπαγόρευση χρησιμοποιήστε Chrome ή Safari.</p>'}
    <div class="sheet-actions"><button class="btn btn-ghost" data-act="close-sheet">Κλείσιμο</button></div>`);
}

// Runs recognition alone: no getUserMedia, no MediaRecorder, started straight from the tap.
// That separates a permission or service refusal from the microphone being taken by the recorder.
let srTest = null;
const diagLog = [];
function diagReport() {
  return [
    'Λογοτετράδιο ' + APP_VERSION,
    'UA: ' + UA,
    'iOS: ' + isIOS + ' · standalone: ' + isStandalone + ' · SR: ' + (SR ? 'yes' : 'no') + ' · mic: ' + micMode + ' · mode: ' + recMode,
    'secure: ' + window.isSecureContext + ' · online: ' + navigator.onLine + ' · lang: ' + (navigator.language || '?'),
    'local asr: ' + (asrModel || 'off') + ' · webgpu: ' + !!navigator.gpu,
    'last recording error: ' + (Rec.srError || '-') + (Rec.srErrorMsg ? ' (' + Rec.srErrorMsg + ')' : '')
  ].concat(diagLog.length ? diagLog : ['(καμία δοκιμή)']).join('\n');
}

// Recognition on its own: no getUserMedia, no MediaRecorder, started straight from the tap.
// Greek first; if only Greek fails, the language is missing from the device rather than the
// service being blocked, which is a different fix.
function runSRTest(lang) {
  const out = document.getElementById('srTestOut');
  const more = document.getElementById('srTestMore');
  const show = (cls, txt) => { if (out) { out.hidden = false; out.className = 'hint ' + cls; out.textContent = txt; } };
  const offerFallback = on => { if (more) more.hidden = !on; };
  if (srTest) { try { srTest.abort(); } catch (e) {} srTest = null; }
  if (!SR) { show('warn', 'Αυτός ο browser δεν έχει υπαγόρευση.'); return; }
  let r;
  try { r = new SR(); } catch (e) { show('warn', 'Δεν ξεκίνησε: ' + ((e && e.message) || e)); return; }
  const greek = !lang;
  r.lang = lang || 'el-GR';
  r.interimResults = true; r.continuous = false; r.maxAlternatives = 5;
  let heard = '', failed = false;
  offerFallback(false);
  show('', greek ? 'Ακούω… πείτε μια λέξη στα ελληνικά.' : 'Ακούω… πείτε μια λέξη στη γλώσσα της συσκευής.');
  r.onresult = e => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = (e.results[i][0] && e.results[i][0].transcript || '').trim();
      if (t) heard = t;
    }
    if (heard) show('', 'Ακούω… «' + toGreek(heard) + '»');
  };
  r.onerror = e => {
    failed = true;
    diagLog.push('test ' + r.lang + ': ERROR ' + e.error + (e.message ? ' — ' + e.message : ''));
    show('warn', srMessage(e.error) + errCode(e.error, e.message));
    if (greek) offerFallback(true);
  };
  r.onend = () => {
    srTest = null;
    if (heard) {
      diagLog.push('test ' + r.lang + ': ok "' + heard + '"');
      show('ok', greek
        ? 'Η υπαγόρευση δουλεύει. Ακούστηκε: «' + toGreek(heard) + '»'
        : 'Δουλεύει στη γλώσσα της συσκευής αλλά όχι στα ελληνικά. Προσθέστε τα Ελληνικά από Ρυθμίσεις → Γενικά → Πληκτρολόγιο → Υπαγόρευση → Γλώσσες υπαγόρευσης.');
    } else if (!failed) {
      diagLog.push('test ' + r.lang + ': no speech');
      show('warn', 'Δεν ακούστηκε τίποτα. Μιλήστε πιο κοντά στο μικρόφωνο και δοκιμάστε ξανά.');
    }
  };
  srTest = r;
  try { r.start(); }
  catch (e) { srTest = null; diagLog.push('test ' + r.lang + ': start threw ' + ((e && e.name) || e)); show('warn', 'Δεν ξεκίνησε: ' + ((e && e.message) || e)); }
}

function micPermissionSheet(id) {
  openSheet(`<h2 class="sheet-title">Χρειάζεται άδεια για το μικρόφωνο</h2>
    <p class="sheet-sub" style="margin:0">Ο browser δεν έδωσε πρόσβαση στο μικρόφωνο. Επιτρέψτε το και πατήστε ξανά το κόκκινο κουμπί.</p>
    <dl class="facts"><dt>Chrome</dt><dd>Πατήστε το εικονίδιο αριστερά από τη διεύθυνση, ενεργοποιήστε το «Μικρόφωνο» και ανανεώστε τη σελίδα.</dd>
      <dt>Safari</dt><dd>Στο iPhone πατήστε «aA» στη γραμμή διεύθυνσης, μετά «Ρυθμίσεις ιστότοπου», και στο «Μικρόφωνο» επιλέξτε «Να επιτρέπεται».</dd></dl>
    <div class="sheet-actions"><label class="btn btn-ghost" for="nativeRecInput" data-native-item="${esc(id)}" role="button" tabindex="0">Κάμερα ή εφαρμογή κινητού</label><button class="btn btn-primary" data-act="close-sheet">Εντάξει</button></div>`);
}

function menuSheet(items) {
  openSheet(`<div class="menu">${items.map(m => `<button data-act="${m.act}" class="${m.danger ? 'danger' : ''}">${ic(m.icon)} ${esc(m.label)}</button>`).join('')}</div>
    <div class="sheet-actions"><button class="btn btn-ghost" data-act="close-sheet">Κλείσιμο</button></div>`);
}

/* ---------- toast ---------- */
let toastTimer = null;
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms); }

/* ---------- navigation + actions ---------- */
async function ensureStopped() { if (Rec.state === 'recording') await stopRec(); stopPlayback(); }
function openSession(id) {
  const s = session(id); if (!s) return;
  ui.view = 'session'; ui.sessionId = id; ui.childId = s.childId; ui.editMode = false;
  const first = flatItems(s).find(i => i.status !== 'done');
  ui.activeItemId = first ? first.id : null;
  render(); window.scrollTo(0, 0);
}
function scrollToCard(id) {
  requestAnimationFrame(() => {
    const el = document.getElementById('card-' + id); if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top < 80 || r.bottom > window.innerHeight - 12) el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: r.height > window.innerHeight * 0.7 ? 'start' : 'center' });
  });
}
function advance(fromId) {
  const list = flatItems(session()), idx = list.findIndex(x => x.id === fromId);
  const next = list.slice(idx + 1).find(x => x.status !== 'done') || list.find(x => x.status !== 'done');
  ui.activeItemId = next ? next.id : null;
  renderKeep();
  if (next) scrollToCard(next.id);
  else toast('Όλες οι λέξεις της συνεδρίας ολοκληρώθηκαν.');
}
async function removeItemsAudio(items) { for (const it of items) if (it.audio) await deleteAudio(it.id); }

const actions = {
  'back': async () => { await ensureStopped(); if (ui.view === 'session') { ui.view = 'child'; ui.editMode = false; } else { ui.view = 'home'; } render(); window.scrollTo(0, 0); },
  'open-child': async el => { await ensureStopped(); ui.view = 'child'; ui.childId = el.dataset.id; render(); window.scrollTo(0, 0); },
  'open-session': async el => { await ensureStopped(); openSession(el.dataset.id); },
  'new-child': () => childSheet(null),
  'edit-child': () => childSheet(child()),
  'del-child': () => {
    const c = child(sheetCtx && sheetCtx.childId); if (!c) return;
    confirmSheet('Διαγραφή παιδιού', `Θα διαγραφούν ο/η ${c.name}, όλες οι συνεδρίες και οι ηχογραφήσεις. Δεν αναιρείται.`, 'Διαγραφή', async () => {
      const ss = S.sessions.filter(s => s.childId === c.id);
      for (const s of ss) await removeItemsAudio(flatItems(s));
      S.sessions = S.sessions.filter(s => s.childId !== c.id); S.children = S.children.filter(x => x.id !== c.id);
      save(); closeSheet(); ui.view = 'home'; render(); toast('Το παιδί διαγράφηκε.');
    });
  },
  'new-session': () => newSessionSheet(),
  'ns-copy': () => createSession(true),
  'ns-empty': () => createSession(false),
  'menu-home': () => menuSheet([
    { act: 'help', icon: 'help', label: 'Πώς λειτουργεί' },
    { act: 'rec-settings', icon: 'mic', label: 'Ρυθμίσεις εγγραφής' },
    { act: 'reset-demo', icon: 'refresh', label: 'Επαναφορά παραδείγματος' },
    { act: 'wipe', icon: 'trash', label: 'Διαγραφή όλων των δεδομένων', danger: true }
  ]),
  'menu-session': () => menuSheet([
    { act: 'edit-on', icon: 'edit', label: 'Επεξεργασία πλάνου' },
    { act: 'new-ex', icon: 'plus', label: 'Νέα άσκηση' },
    { act: 'summary', icon: 'list', label: 'Σύνοψη και αντιγραφή' },
    { act: 'rec-settings', icon: 'mic', label: 'Ρυθμίσεις εγγραφής' },
    { act: 'help', icon: 'help', label: 'Πώς λειτουργεί' },
    { act: 'del-session', icon: 'trash', label: 'Διαγραφή συνεδρίας', danger: true }
  ]),
  'help': () => helpSheet(),
  'sr-test': () => runSRTest(),
  'sr-test-any': () => runSRTest(navigator.language || 'en-US'),
  'copy-diag': () => {
    const ta = $('#diagText'); if (!ta) return;
    ta.value = diagReport();
    const fallback = () => { try { ta.classList.remove('vh'); ta.select(); const ok = document.execCommand('copy'); ta.classList.add('vh'); toast(ok ? 'Τα στοιχεία αντιγράφηκαν.' : 'Η αντιγραφή δεν επιτρέπεται εδώ.'); } catch (e) { toast('Η αντιγραφή δεν επιτρέπεται εδώ.'); } };
    try { navigator.clipboard.writeText(ta.value).then(() => toast('Τα στοιχεία αντιγράφηκαν.'), fallback); } catch (e) { fallback(); }
  },
  'rec-settings': async () => { if (Rec.state === 'recording') await stopRec(); recSettingsSheet(); },
  'set-rec-mode': el => {
    recMode = el.dataset.mode; lsSet('lt-rec-mode', recMode); Rec.note = null;
    closeSheet(); renderKeep(); toast('Εγγραφή: ' + REC_MODES[recMode].label);
  },
  'close-sheet': () => closeSheet(),
  'sheet-yes': () => { const f = sheetCtx && sheetCtx.yes; if (f) f(); },
  'reset-demo': () => confirmSheet('Επαναφορά παραδείγματος', 'Τα δεδομένα αυτής της συσκευής αντικαθίστανται με τα αρχικά παραδείγματα. Οι ηχογραφήσεις διαγράφονται.', 'Επαναφορά', async () => {
    await ensureStopped(); await Store.clear('audio'); urlCache.clear(); S = seed(); save(); closeSheet(); ui.view = 'home'; render(); window.scrollTo(0, 0); toast('Τα παραδείγματα επανήλθαν.');
  }),
  'load-demo': () => { S = seed(); save(); render(); },
  'wipe': () => confirmSheet('Διαγραφή όλων', 'Διαγράφονται όλα τα παιδιά, οι συνεδρίες και οι ηχογραφήσεις από αυτή τη συσκευή.', 'Διαγραφή όλων', async () => {
    await ensureStopped(); await Store.clear('audio'); urlCache.clear(); S = { children: [], sessions: [] }; save(); closeSheet(); ui.view = 'home'; render(); toast('Όλα τα δεδομένα διαγράφηκαν.');
  }),
  'del-session': () => {
    const s = session(); if (!s) return;
    confirmSheet('Διαγραφή συνεδρίας', `Η συνεδρία της ${fullDate(s.date)} και οι ηχογραφήσεις της διαγράφονται.`, 'Διαγραφή', async () => {
      await ensureStopped(); await removeItemsAudio(flatItems(s));
      S.sessions = S.sessions.filter(x => x.id !== s.id); save(); closeSheet(); ui.view = 'child'; render(); window.scrollTo(0, 0); toast('Η συνεδρία διαγράφηκε.');
    });
  },
  'edit-on': async () => { await ensureStopped(); closeSheet(); ui.editMode = true; renderKeep(); },
  'edit-off': () => {
    const s = session();
    s.exercises.forEach(ex => { ex.items = ex.items.filter(it => it.text.trim() || it.audio || it.status === 'done'); });
    save(); ui.editMode = false;
    if (!ui.activeItemId) { const f = flatItems(s).find(i => i.status !== 'done'); ui.activeItemId = f ? f.id : null; }
    renderKeep();
  },
  'new-ex': () => { closeSheet(); wordsSheet(null); },
  'add-words': el => wordsSheet(el.dataset.ex),
  'preset': el => {
    const p = PRESETS[+el.dataset.i], ta = $('#wf-words'), tt = $('#wf-title');
    if (tt && !tt.value.trim()) tt.value = p.title;
    const cur = ta.value.replace(/\s+$/, '');
    ta.value = (cur ? cur + '\n' : '') + p.words.join('\n');
    updateWordsCount();
  },
  'del-ex': el => {
    const ex = findEx(el.dataset.ex); if (!ex) return;
    confirmSheet('Διαγραφή άσκησης', `Η άσκηση «${ex.title || 'Χωρίς τίτλο'}» και οι ${ex.items.length} λέξεις της διαγράφονται.`, 'Διαγραφή', async () => {
      await removeItemsAudio(ex.items); const s = session(); s.exercises = s.exercises.filter(x => x.id !== ex.id); save(); closeSheet(); renderKeep();
    });
  },
  'del-item': el => {
    const s = session(), id = el.dataset.item, it = findItem(id); if (!it) return;
    const doDel = async () => { if (it.audio) await deleteAudio(id); s.exercises.forEach(ex => { ex.items = ex.items.filter(x => x.id !== id); }); if (ui.activeItemId === id) ui.activeItemId = null; save(); closeSheet(); renderKeep(); };
    if (it.audio || it.status === 'done') confirmSheet('Διαγραφή λέξης', `Η «${it.text}» έχει ήδη αποτέλεσμα ή ηχογράφηση. Να διαγραφεί;`, 'Διαγραφή', doDel);
    else doDel();
  },
  'summary': () => { closeSheet(); summarySheet(); },
  'copy-summary': () => {
    const ta = $('#sumText'); const text = ta ? ta.value : '';
    const fallback = () => { try { ta.classList.remove('vh'); ta.select(); const ok = document.execCommand('copy'); ta.classList.add('vh'); toast(ok ? 'Η σύνοψη αντιγράφηκε.' : 'Η αντιγραφή δεν επιτρέπεται εδώ.'); } catch (e) { toast('Η αντιγραφή δεν επιτρέπεται εδώ.'); } };
    try { navigator.clipboard.writeText(text).then(() => toast('Η σύνοψη αντιγράφηκε.'), fallback); } catch (e) { fallback(); }
  },
  'enable-asr': () => {
    asrModel = 'small'; lsSet('lt-asr-model', asrModel);
    ui.asrNoticeDismissed = true; lsSet('lt-asr-notice', '1');
    toast('Ενεργό. Το μοντέλο κατεβαίνει την πρώτη φορά που θα ηχογραφήσετε.', 4600);
    renderKeep();
  },
  'dismiss-asr': () => { ui.asrNoticeDismissed = true; lsSet('lt-asr-notice', '1'); renderKeep(); },
  'dismiss-mic': () => { ui.micNoticeDismissed = true; lsSet('lt-mic-notice', '1'); renderKeep(); },
  'activate': async el => {
    const id = el.dataset.item;
    if (Rec.state === 'recording') await stopRec();
    stopPlayback();
    ui.activeItemId = id; renderKeep(); scrollToCard(id);
  },
  'quick-ok': el => {
    const it = findItem(el.dataset.item); if (!it) return;
    it.status = 'done'; it.said = it.text; it.doneAt = new Date().toISOString(); saveNow();
    if (!ui.activeItemId) { const f = flatItems(session()).find(i => i.status !== 'done'); ui.activeItemId = f ? f.id : null; }
    renderKeep();
  },
  'asr': el => transcribeItem(el.dataset.item),
  'set-asr-model': el => {
    const m = el.dataset.model || '';
    asrModel = ASR_MODELS[m] ? m : '';
    lsSet('lt-asr-model', asrModel);
    if (asrPipeKey && asrPipeKey !== asrModel) { asrPipe = null; asrPipeKey = ''; }
    renderKeep();
    recSettingsSheet();
  },
  'to-greek': el => {
    const id = el.dataset.item, it = findItem(id); if (!it) return;
    const ta = document.getElementById('said-' + id);
    const v = toGreek((ta ? ta.value : it.said) || '');
    it.said = v; saveNow();
    if (ta) { ta.value = v; autoGrow(ta); }
    const cmp = document.getElementById('cmp-' + id); if (cmp) cmp.innerHTML = compareHTML(it, v);
    el.hidden = true;
    if (it.status === 'done') updateProgress();
  },
  'rec': el => toggleRec(el.dataset.item),
  'play': el => togglePlay(el.dataset.item),
  'rate': el => {
    const r = parseFloat(el.dataset.rate); if (!PLAY_RATES.includes(r)) return;
    playRate = r; lsSet('lt-play-rate', String(r)); applyRate();
    $$('[data-act="rate"]').forEach(b => {
      const on = parseFloat(b.dataset.rate) === r;
      b.classList.toggle('sel', on); b.setAttribute('aria-pressed', on);
    });
  },
  'reset': async el => {
    const id = el.dataset.item, it = findItem(id); if (!it) return;
    stopPlayback(); if (it.audio) await deleteAudio(id);
    Object.assign(it, { audio: false, audioDur: 0, said: '', status: 'pending', doneAt: null });
    Rec.note = null; saveNow(); renderKeep();
  },
  'done': el => {
    const id = el.dataset.item, it = findItem(id); if (!it) return;
    if (it.status !== 'done') {
      const ta = document.getElementById('said-' + id);
      const v = (ta ? ta.value : it.said || '').trim();
      it.said = v || it.text; it.status = 'done'; it.doneAt = new Date().toISOString(); saveNow();
    }
    stopPlayback(); Rec.note = null;
    advance(id);
  }
};

document.addEventListener('click', e => {
  const ov = e.target.closest('[data-overlay]');
  if (ov && e.target === ov) { closeSheet(); return; }
  const nat = e.target.closest('[data-native-item]');
  if (nat) { nativeTarget = nat.dataset.nativeItem; stopPlayback(); return; }
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && sheetCtx) { closeSheet(); return; }
  const nat = e.target.closest && e.target.closest('[data-native-item]');
  if (nat && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); nativeTarget = nat.dataset.nativeItem; $('#nativeRecInput').click(); return; }
  if (e.key === 'Enter' && !e.shiftKey && e.target.matches && e.target.matches('textarea.said') && !e.isComposing) {
    e.preventDefault(); const b = document.getElementById('done-' + e.target.dataset.item); if (b && !b.disabled) b.click();
  }
});
document.addEventListener('input', e => {
  const el = e.target, kind = el.dataset && el.dataset.input;
  if (el.id === 'wf-words') { updateWordsCount(); return; }
  if (!kind) return;
  if (kind === 'seek') {
    const id = el.dataset.item, it = findItem(id); if (!it) return;
    seekDrag = true; clearTimeout(seekTimer); seekTimer = setTimeout(() => { seekDrag = false; }, 400);
    const t = parseFloat(el.value) || 0;
    const lab = document.getElementById('ptime-' + id);
    const dur = itemDur(it);
    if (lab) lab.textContent = fmtDur(t) + ' / ' + fmtDur(dur);
    fillSeek(el, t, dur);
    seekTo(id, t);
    return;
  }
  if (kind === 'said') {
    const it = findItem(el.dataset.item); if (!it) return;
    it.said = el.value; autoGrow(el); save();
    const cmp = document.getElementById('cmp-' + it.id); if (cmp) cmp.innerHTML = compareHTML(it, el.value);
    const b = document.getElementById('done-' + it.id);
    if (b && it.status !== 'done') b.innerHTML = `${ic('check')} ${el.value.trim() ? 'Ολοκλήρωση' : 'Σωστό'} <span class="sub">· Επόμενο</span>`;
    const r = document.querySelector(`[data-act="reset"][data-item="${it.id}"]`); if (r) r.disabled = !(it.audio || el.value.trim() || it.status === 'done');
    const lat = document.getElementById('lat-' + it.id); if (lat) lat.hidden = !hasLatin(el.value);
    if (it.status === 'done') updateProgress();
  } else if (kind === 'ex-title') { const ex = findEx(el.dataset.ex); if (ex) { ex.title = el.value; save(); } }
  else if (kind === 'item-text') { const it = findItem(el.dataset.item); if (it) { it.text = el.value; save(); } }
});
document.addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.id === 'childForm') {
    const name = $('#cf-name').value.trim();
    if (!name) { $('#cf-err').hidden = false; $('#cf-name').focus(); return; }
    const age = $('#cf-age').value.trim(), focus = $('#cf-focus').value.trim();
    const existing = child(sheetCtx && sheetCtx.childId);
    if (existing) { Object.assign(existing, { name, age, focus }); save(); closeSheet(); render(); toast('Τα στοιχεία αποθηκεύτηκαν.'); return; }
    const c = { id: uid(), name, age, focus, av: (S.children.length % 4) + 1 };
    S.children.push(c); ui.childId = c.id; save(); closeSheet();
    createSession(false);
  } else if (e.target.id === 'wordsForm') {
    const words = parseWords($('#wf-words').value);
    if (!words.length) { $('#wf-err').hidden = false; return; }
    const s = session(); let ex = sheetCtx && sheetCtx.exId ? findEx(sheetCtx.exId) : null;
    if (!ex) { const tt = $('#wf-title'); ex = { id: uid(), title: (tt && tt.value.trim()) || `Άσκηση ${s.exercises.length + 1}`, items: [] }; s.exercises.push(ex); }
    const added = words.map(w => mkItem(w)); ex.items.push(...added);
    if (!ui.activeItemId || !flatItems(s).some(i => i.id === ui.activeItemId && i.status !== 'done')) ui.activeItemId = (flatItems(s).find(i => i.status !== 'done') || {}).id || null;
    save(); closeSheet(); renderKeep();
    toast(`Προστέθηκαν ${added.length} ${added.length === 1 ? 'λέξη' : 'λέξεις'}.`);
  }
});

/* ---------- boot ---------- */
(async function boot() {
  await Store.open();
  let saved = null;
  try { saved = await Store.get('kv', 'state'); } catch (e) {}
  S = saved && Array.isArray(saved.children) ? saved : seed();
  if (!saved) save();
  render();
})();
})();
