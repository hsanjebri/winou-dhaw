/* Winou Edhaw — client. Vanilla JS, no deps.
   Privacy: GPS coords never leave the device — we match to the nearest
   delegation locally and only ever send the region id. */
'use strict';

// ─── i18n ────────────────────────────────────────────────────────────────────
const I18N = {
  ar: {
    appName: 'وينو الضو', yourArea: 'منطقتك:', pickArea: 'اختر المنطقة',
    noPower: 'ما فماش ضو', noWater: 'ما فماش ماء',
    addNote: 'أضف ملاحظة (اختياري)', notePh: 'مثال: من الصباح…',
    searchPh: 'لوّج على منطقة… (سوسة / Sousse / 9asrine)',
    list: 'القائمة', map: 'الخريطة', following: 'المتابَعة',
    confirmed: 'مؤكّد', unconfirmed: 'غير مؤكّد', likelyBack: 'يظهر رجع',
    waterShort: 'ماء', power: 'ضو', water: 'ماء',
    pickAreaTitle: 'وين إنت؟', autoDetect: 'حدّد موقعي (بالمعتمدية فقط)',
    reported: 'تسجّل البلاغ ✓', reportedWater: 'تسجّل بلاغ الماء ✓',
    failedQueued: 'ما فماش اتصال — البلاغ بش يتبعث وقتلي ترجع الشبكة',
    sinceAbout: 'منذ ~', reports: 'بلاغ', devices: 'جهاز',
    isBackQ: 'رجع الضو؟', isBackWaterQ: 'رجع الماء؟', yes: 'إي رجع', no: 'لا مازال',
    noOutages: 'ما فماش قطعان مبلّغ عليها توّا 🎉', noFollows: 'ما تتبّع حتى منطقة. إضغط ★ باش تتبّع منطقتك.',
    followedOk: 'كل شيء عادي في المناطق المتابَعة ✓',
    outageIn: 'قطع ضو في', waterOutageIn: 'قطع ماء في',
    updated: 'آخر تحديث:', geoFail: 'ما نجمناش نحدّدو موقعك — لوّج يدويًا',
    geoFound: 'تحدّدت منطقتك:', notifOn: 'بش نعلموك كان صار قطع في المناطق المتابَعة',
    yourAreaOut: 'الضو مقطوع في منطقتك', yourAreaWaterOut: 'الماء مقطوع في منطقتك',
    about: 'بلاغات من المواطنين — بدون حساب، بدون تسجيل. موقعك يتحدّد بالمعتمدية فقط.',
    min: 'د', hr: 'س', justNow: 'توّا',
  },
  fr: {
    appName: 'Winou Edhaw', yourArea: 'Votre zone :', pickArea: 'Choisir la zone',
    noPower: 'Pas de courant', noWater: 'Pas d\'eau',
    addNote: 'Ajouter une note (optionnel)', notePh: 'ex : depuis ce matin…',
    searchPh: 'Chercher une zone… (Sousse / سوسة / 9asrine)',
    list: 'Liste', map: 'Carte', following: 'Suivis',
    confirmed: 'Confirmé', unconfirmed: 'Non confirmé', likelyBack: 'Probablement rétabli',
    waterShort: 'eau', power: 'courant', water: 'eau',
    pickAreaTitle: 'Où êtes-vous ?', autoDetect: 'Détecter ma zone (délégation seulement)',
    reported: 'Signalement envoyé ✓', reportedWater: 'Signalement eau envoyé ✓',
    failedQueued: 'Hors ligne — le signalement partira au retour du réseau',
    sinceAbout: 'depuis ~', reports: 'signalements', devices: 'appareils',
    isBackQ: 'Courant rétabli ?', isBackWaterQ: 'Eau rétablie ?', yes: 'Oui', no: 'Non, toujours coupé',
    noOutages: 'Aucune coupure signalée actuellement 🎉', noFollows: 'Aucune zone suivie. Touchez ★ pour suivre votre zone.',
    followedOk: 'Tout est normal dans vos zones suivies ✓',
    outageIn: 'Coupure de courant à', waterOutageIn: 'Coupure d\'eau à',
    updated: 'Mis à jour :', geoFail: 'Localisation impossible — cherchez manuellement',
    geoFound: 'Zone détectée :', notifOn: 'Vous serez notifié en cas de coupure dans vos zones suivies',
    yourAreaOut: 'Courant coupé dans votre zone', yourAreaWaterOut: 'Eau coupée dans votre zone',
    about: 'Signalements citoyens — sans compte, sans inscription. Localisation au niveau délégation uniquement.',
    min: 'min', hr: 'h', justNow: 'à l\'instant',
  },
};
let lang = localStorage.getItem('we-lang') || 'ar';
const T = k => (I18N[lang][k] ?? k);

// ─── tiny helpers ────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const LS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
};
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// anonymous device token — random, local-only, never an identity
let DEV = localStorage.getItem('we-dev');
if (!DEV) { DEV = crypto.randomUUID().replace(/-/g, ''); localStorage.setItem('we-dev', DEV); }

// ─── region data ─────────────────────────────────────────────────────────────
let REGIONS = null;          // {governorates, delegations}
let BY_ID = {};              // id -> region record (with .kind)
let SEARCH_INDEX = [];       // search entries

function regionLabel(id, withGov = true) {
  const r = BY_ID[id];
  if (!r) return id;
  const name = lang === 'ar' ? r.ar : r.fr;
  if (r.kind === 'd' && withGov) {
    const g = BY_ID[r.gov];
    return { name, gov: lang === 'ar' ? g.ar : g.fr };
  }
  return { name, gov: '' };
}

// latin normalizer: lowercase, strip accents & punctuation
function normLat(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
// arabic normalizer: strip diacritics/tatweel, unify letters, drop "ال"
function normAr(s) {
  return s.replace(/[\u064B-\u0652\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .split(/\s+/).map(w => w.replace(/^ال/, '')).join(' ').trim();
}
// arabizi: expand digit shorthand into letter variants (9asrine -> kasrine/qasrine/gasrine)
function arabiziVariants(q) {
  const subs = { 2: ['a'], 3: ['a'], 5: ['kh'], 7: ['h'], 8: ['gh'], 9: ['k', 'q', 'g'] };
  let variants = [q];
  for (const [d, reps] of Object.entries(subs)) {
    if (!q.includes(d)) continue;
    const next = [];
    for (const v of variants) for (const rep of reps) next.push(v.split(d).join(rep));
    variants = next.slice(0, 24);
  }
  return variants;
}

function buildIndex() {
  BY_ID = {};
  SEARCH_INDEX = [];
  REGIONS.governorates.forEach(g => {
    BY_ID[g.id] = { ...g, kind: 'g' };
    SEARCH_INDEX.push({ id: g.id, lat: [normLat(g.fr), ...(g.al || []).filter(a => /[a-z]/i.test(a)).map(normLat)],
                        ar: [normAr(g.ar), ...(g.al || []).filter(a => /[\u0600-\u06ff]/.test(a)).map(normAr)] });
  });
  REGIONS.delegations.forEach(d => {
    BY_ID[d.id] = { ...d, kind: 'd' };
    SEARCH_INDEX.push({ id: d.id, lat: [normLat(d.fr)], ar: [normAr(d.ar)] });
  });
}

function searchRegions(query, limit = 8) {
  const qRaw = query.trim();
  if (!qRaw) return [];
  const isAr = /[\u0600-\u06ff]/.test(qRaw);
  const qs = isAr ? [normAr(qRaw)] : arabiziVariants(normLat(qRaw));
  const scored = [];
  for (const entry of SEARCH_INDEX) {
    const forms = isAr ? entry.ar : entry.lat;
    let best = 0;
    for (const f of forms) for (const q of qs) {
      if (!q) continue;
      if (f === q) best = Math.max(best, 100);
      else if (f.startsWith(q)) best = Math.max(best, 80);
      else if (f.split(' ').some(w => w.startsWith(q))) best = Math.max(best, 60);
      else if (q.length >= 3 && f.includes(q)) best = Math.max(best, 40);
    }
    if (best) scored.push([best + (BY_ID[entry.id].kind === 'g' ? 5 : 0), entry.id]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, limit).map(s => s[1]);
}

// nearest delegation to coords (client-side only — privacy)
function nearestDelegation(lat, lon) {
  let best = null, bd = Infinity;
  const kx = Math.cos(lat * Math.PI / 180);
  for (const d of REGIONS.delegations) {
    const dy = d.c[0] - lat, dx = (d.c[1] - lon) * kx;
    const dist = dx * dx + dy * dy;
    if (dist < bd) { bd = dist; best = d; }
  }
  return best && bd < 1 ? best.id : null; // sanity: within ~100km
}

// ─── local state ─────────────────────────────────────────────────────────────
let myRegion = LS.get('we-region', null);
let follows = LS.get('we-follows', []);
let lastSeen = LS.get('we-lastseen', {});   // "regionId|type" -> last status notified
let queue = LS.get('we-queue', []);         // offline report queue
let state = { now: Date.now(), clusters: [] };
let currentTab = 'list';
let selectedGov = null;
let listFilter = null;      // region id filtering the list view (from search)

// ─── network ─────────────────────────────────────────────────────────────────
async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error('http ' + res.status);
  return res.json();
}

async function sendReport(body) {
  try {
    await api('/api/report', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return true;
  } catch {
    queue.push(body);
    LS.set('we-queue', queue.slice(-20));
    return false;
  }
}
async function flushQueue() {
  if (!queue.length) return;
  const pending = queue.splice(0);
  LS.set('we-queue', []);
  for (const b of pending) await sendReport(b);
}
window.addEventListener('online', flushQueue);

async function refreshState() {
  try {
    state = await api('/api/state');
    renderAll();
    checkNotifications();
    $('lastUpdated').textContent = T('updated') + ' ' + new Date().toLocaleTimeString(
      lang === 'ar' ? 'ar-TN' : 'fr-TN', { hour: '2-digit', minute: '2-digit' });
  } catch { /* offline — keep last view */ }
}

// ─── formatting ──────────────────────────────────────────────────────────────
function fmtAgo(ts) {
  const m = Math.max(0, Math.round((state.now - ts) / 60e3));
  if (m < 2) return T('justNow');
  if (m < 60) return `${T('sinceAbout')}${m}${T('min')}`;
  const h = Math.floor(m / 60), mm = m % 60;
  return `${T('sinceAbout')}${h}${T('hr')}` + (mm >= 10 ? ` ${mm}${T('min')}` : '');
}
const STATUS_LABEL = { c: 'confirmed', u: 'unconfirmed', s: 'likelyBack' };

// ─── report flow ─────────────────────────────────────────────────────────────
function toast(msg, err = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (err ? ' err' : '');
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 3200);
}

async function report(type) {
  if (!myRegion) { openSheet(); return; }
  const note = $('noteInput').value.trim();
  $('noteInput').value = '';
  const ok = await sendReport({ r: myRegion, t: type, k: 'out', dev: DEV, note: note || undefined });
  toast(ok ? (type === 'p' ? T('reported') : T('reportedWater')) : T('failedQueued'), !ok);
  if (ok) setTimeout(refreshState, 400);
}

async function confirmBack(regionId, type, isBack) {
  await sendReport({ r: regionId, t: type, k: isBack ? 'ok' : 'out', dev: DEV });
  setTimeout(refreshState, 400);
}

// ─── follows & notifications ─────────────────────────────────────────────────
function toggleFollow(id) {
  const i = follows.indexOf(id);
  if (i >= 0) follows.splice(i, 1);
  else {
    follows.push(id);
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(p => { if (p === 'granted') toast(T('notifOn')); });
    }
  }
  LS.set('we-follows', follows);
  renderAll();
}

function clusterCoversRegion(cl, regionId) {
  if (cl.r === regionId) return true;
  const r = BY_ID[cl.r];
  return !!r && r.kind === 'd' && r.gov === regionId; // following a gov covers its delegations
}

function checkNotifications() {
  for (const id of follows) {
    for (const cl of state.clusters) {
      if (!clusterCoversRegion(cl, id)) continue;
      const key = cl.r + '|' + cl.t;
      if (cl.st === 'c' && lastSeen[key] !== 'c') {
        const lbl = regionLabel(cl.r);
        const msg = `${cl.t === 'p' ? T('outageIn') : T('waterOutageIn')} ${lbl.name}`;
        if ('Notification' in window && Notification.permission === 'granted') {
          try { new Notification(T('appName'), { body: msg, icon: '/icon.svg' }); } catch {}
        } else toast(msg, true);
      }
      lastSeen[key] = cl.st;
    }
  }
  LS.set('we-lastseen', lastSeen);
}

// ─── rendering ───────────────────────────────────────────────────────────────
function clusterRow(cl) {
  const row = el('div', 'row');
  const head = el('div', 'head');
  head.append(el('span', '', cl.t === 'p' ? '⚡' : '💧'));
  const lbl = regionLabel(cl.r);
  const name = el('span', 'name', lbl.name + ' ');
  if (lbl.gov) name.append(el('span', 'gov', '· ' + lbl.gov));
  head.append(name);
  head.append(el('span', 'status-chip ' + cl.st, T(STATUS_LABEL[cl.st])));
  const star = el('button', 'star' + (follows.includes(cl.r) ? ' on' : ''), '★');
  star.onclick = () => toggleFollow(cl.r);
  head.append(star);
  row.append(head);

  const meta = el('div', 'meta');
  meta.append(el('span', '', fmtAgo(cl.start)));
  meta.append(el('span', '', `${cl.n} ${T('reports')} · ${cl.dv} ${T('devices')}`));
  row.append(meta);
  if (cl.notes && cl.notes.length) row.append(el('div', 'note-q', '“' + cl.notes[cl.notes.length - 1] + '”'));

  if (cl.st === 's') { // likely restored -> one-tap confirm/deny
    const q = el('div', 'meta', cl.t === 'p' ? T('isBackQ') : T('isBackWaterQ'));
    const actions = el('div', 'actions');
    const yes = el('button', 'yes', '✓ ' + T('yes'));
    const no = el('button', 'no', '✗ ' + T('no'));
    yes.onclick = () => { confirmBack(cl.r, cl.t, true); yes.disabled = no.disabled = true; };
    no.onclick = () => { confirmBack(cl.r, cl.t, false); yes.disabled = no.disabled = true; };
    actions.append(yes, no);
    row.append(q, actions);
  }
  return row;
}

function renderList(container, clusters, emptyMsg) {
  container.textContent = '';
  if (!clusters.length) { container.append(el('div', 'empty', emptyMsg)); return; }
  clusters.forEach(cl => container.append(clusterRow(cl)));
}

function govStatus() { // gov id -> {p: worst power status, w: has water outage}
  const m = {};
  const rank = { c: 3, u: 2, s: 1 };
  for (const cl of state.clusters) {
    const gov = BY_ID[cl.r] ? (BY_ID[cl.r].kind === 'g' ? cl.r : BY_ID[cl.r].gov) : null;
    if (!gov) continue;
    m[gov] = m[gov] || { p: null, w: false };
    if (cl.t === 'w') m[gov].w = true;
    else if (!m[gov].p || rank[cl.st] > rank[m[gov].p]) m[gov].p = cl.st;
  }
  return m;
}

let mapBuilt = false;
function buildMap() {
  if (mapBuilt || !window.TN_MAP) return;
  mapBuilt = true;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', TN_MAP.viewBox);
  for (const s of TN_MAP.shapes) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', s.d);
    path.dataset.gov = s.id;
    path.addEventListener('click', () => { selectedGov = s.id; renderMap(); });
    svg.append(path);
    const badge = document.createElementNS(NS, 'text');
    badge.setAttribute('x', s.c[0]); badge.setAttribute('y', s.c[1]);
    badge.setAttribute('text-anchor', 'middle');
    badge.dataset.badge = s.id;
    svg.append(badge);
  }
  $('mapBox').append(svg);
}

function renderMap() {
  buildMap();
  const st = govStatus();
  document.querySelectorAll('#mapBox path').forEach(p => {
    p.setAttribute('class', (st[p.dataset.gov] && st[p.dataset.gov].p) || '');
  });
  document.querySelectorAll('#mapBox text').forEach(t => {
    t.textContent = st[t.dataset.badge] && st[t.dataset.badge].w ? '💧' : '';
  });
  const detail = $('govDetail');
  detail.textContent = '';
  if (selectedGov) {
    const lbl = regionLabel(selectedGov);
    const cls = state.clusters.filter(cl => clusterCoversRegion(cl, selectedGov));
    const listBox = el('div');
    renderList(listBox, cls, T('noOutages'));
    detail.append(el('h3', 'gov-title', lbl.name), listBox);
  }
}

function renderMyStatus() {
  const box = $('myStatus');
  if (!myRegion) { box.hidden = true; return; }
  const mine = state.clusters.filter(cl => cl.r === myRegion && cl.st !== 's');
  if (!mine.length) { box.hidden = true; return; }
  box.hidden = false;
  box.textContent = '';
  mine.forEach(cl => {
    const line = el('div', '', `${cl.t === 'p' ? '⚡ ' + T('yourAreaOut') : '💧 ' + T('yourAreaWaterOut')} — ${fmtAgo(cl.start)} · ${cl.n} ${T('reports')}`);
    box.append(line);
  });
}

function renderFollowView() {
  const v = $('viewFollow');
  v.textContent = '';
  if (!follows.length) { v.append(el('div', 'empty', T('noFollows'))); return; }
  let any = false;
  for (const id of follows) {
    const lbl = regionLabel(id);
    const head = el('div', 'head');
    const name = el('span', 'name', lbl.name + (lbl.gov ? ' ' : ''));
    if (lbl.gov) name.append(el('span', 'gov', '· ' + lbl.gov));
    const star = el('button', 'star on', '★');
    star.onclick = () => toggleFollow(id);
    head.append(name, star);
    const wrap = el('div', 'row');
    wrap.append(head);
    const cls = state.clusters.filter(cl => clusterCoversRegion(cl, id));
    if (cls.length) {
      any = true;
      cls.forEach(cl => {
        const meta = el('div', 'meta');
        meta.append(el('span', '', cl.t === 'p' ? '⚡' : '💧'));
        meta.append(el('span', 'status-chip ' + cl.st, T(STATUS_LABEL[cl.st])));
        meta.append(el('span', '', fmtAgo(cl.start) + ` · ${cl.n} ${T('reports')}`));
        wrap.append(meta);
      });
    } else wrap.append(el('div', 'meta', '✓'));
    v.append(wrap);
  }
  if (!any && follows.length) v.prepend(el('div', 'empty', T('followedOk')));
}

function renderAll() {
  const listView = $('viewList');
  if (listFilter) {
    const cls = state.clusters.filter(cl => clusterCoversRegion(cl, listFilter));
    renderList(listView, cls, T('noOutages'));
    // filter header: region name + follow star + clear
    const bar = el('div', 'row');
    const head = el('div', 'head');
    const lbl = regionLabel(listFilter);
    const name = el('span', 'name', lbl.name + ' ');
    if (lbl.gov) name.append(el('span', 'gov', '· ' + lbl.gov));
    const star = el('button', 'star' + (follows.includes(listFilter) ? ' on' : ''), '★');
    star.onclick = () => toggleFollow(listFilter);
    const clear = el('button', 'ghost', '✕');
    clear.onclick = () => { listFilter = null; renderAll(); };
    head.append(name, star, clear);
    bar.append(head);
    listView.prepend(bar);
  } else {
    renderList(listView, state.clusters, T('noOutages'));
  }
  renderMyStatus();
  renderFollowView();
  if (currentTab === 'map') renderMap();
  $('followCount').hidden = !follows.length;
  $('followCount').textContent = follows.length;
  const locName = $('locName');
  locName.textContent = myRegion ? regionLabel(myRegion).name : T('pickArea');
  $('reportPower').disabled = $('reportWater').disabled = !REGIONS;
}

// ─── search UI ───────────────────────────────────────────────────────────────
function attachSearch(input, box, onPick, showBadges) {
  input.addEventListener('input', () => {
    const ids = searchRegions(input.value);
    box.textContent = '';
    box.hidden = !ids.length;
    ids.forEach(id => {
      const lbl = regionLabel(id);
      const b = el('button', 'sug');
      const left = el('span', '', lbl.name + ' ');
      if (lbl.gov) left.append(el('span', 'gov', '· ' + lbl.gov));
      else left.append(el('span', 'gov', '· ' + (lang === 'ar' ? 'ولاية' : 'gouvernorat')));
      b.append(left);
      if (showBadges) {
        const cls = state.clusters.filter(cl => cl.r === id);
        if (cls.length) b.append(el('span', 'badges', cls.map(c => c.t === 'p' ? '⚡' : '💧').join(' ')));
      }
      b.onclick = () => { box.hidden = true; input.value = ''; onPick(id); };
      box.append(b);
    });
  });
  input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 180));
  input.addEventListener('focus', () => { if (box.children.length) box.hidden = false; });
}

// ─── region picker sheet ─────────────────────────────────────────────────────
function openSheet() { $('sheet').hidden = false; $('sheetSearch').focus(); }
function closeSheet() { $('sheet').hidden = true; $('sheetResults').textContent = ''; $('sheetSearch').value = ''; }
function setMyRegion(id) {
  myRegion = id;
  LS.set('we-region', id);
  closeSheet();
  renderAll();
}

function geolocate() {
  if (!navigator.geolocation) { toast(T('geoFail'), true); return; }
  navigator.geolocation.getCurrentPosition(pos => {
    const id = nearestDelegation(pos.coords.latitude, pos.coords.longitude);
    if (id) { setMyRegion(id); toast(`${T('geoFound')} ${regionLabel(id).name}`); }
    else toast(T('geoFail'), true);
  }, () => toast(T('geoFail'), true), { enableHighAccuracy: false, timeout: 8000, maximumAge: 600e3 });
}

// ─── language ────────────────────────────────────────────────────────────────
function applyLang() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  $('langBtn').textContent = lang === 'ar' ? 'FR' : 'ع';
  document.querySelectorAll('[data-i18n]').forEach(n => { n.textContent = T(n.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach(n => { n.placeholder = T(n.dataset.i18nPh); });
  renderAll();
}

// ─── tabs ────────────────────────────────────────────────────────────────────
function setTab(name) {
  currentTab = name;
  const tabs = { list: 'tabList', map: 'tabMap', follow: 'tabFollow' };
  Object.entries(tabs).forEach(([k, id]) => $(id).classList.toggle('active', k === name));
  $('viewList').hidden = name !== 'list';
  $('viewMap').hidden = name !== 'map';
  $('viewFollow').hidden = name !== 'follow';
  if (name === 'map') renderMap();
}

// ─── boot ────────────────────────────────────────────────────────────────────
async function boot() {
  $('reportPower').onclick = () => report('p');
  $('reportWater').onclick = () => report('w');
  $('locBtn').onclick = openSheet;
  $('sheetClose').onclick = closeSheet;
  $('sheet').addEventListener('click', e => { if (e.target === $('sheet')) closeSheet(); });
  $('geoBtn').onclick = geolocate;
  $('langBtn').onclick = () => { lang = lang === 'ar' ? 'fr' : 'ar'; localStorage.setItem('we-lang', lang); applyLang(); };
  $('tabList').onclick = () => setTab('list');
  $('tabMap').onclick = () => setTab('map');
  $('tabFollow').onclick = () => setTab('follow');

  applyLang();

  REGIONS = await api('/api/regions');   // cached by the browser (max-age + ETag)
  buildIndex();
  attachSearch($('search'), $('suggestions'), id => {
    listFilter = id;
    setTab('list');
    renderAll();
  }, true);
  attachSearch($('sheetSearch'), $('sheetResults'), setMyRegion, false);

  renderAll();
  flushQueue();
  await refreshState();
  setInterval(refreshState, 45e3);            // light polling; 304 when unchanged
  setInterval(() => { if (state.clusters.length) renderAll(); }, 30e3); // live durations

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}
boot();
