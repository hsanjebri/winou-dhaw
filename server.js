// Winou Edhaw (وينو الضو) — crowdsourced power/water outage tracker for Tunisia.
// Zero-dependency Node.js server: static files + JSON API + clustering engine.
//
// ─── Data model ────────────────────────────────────────────────────────────
// Report (raw, append-only, pruned after RETENTION_MS):
//   { id, r: regionId,        // delegation "TN1151" or governorate "TN11" (coarse only)
//     t: 'p'|'w',             // power | water
//     k: 'out'|'ok',          // outage report | "it's back" confirmation
//     dev: sha256(salt+token),// anonymous device token hash (rate limiting only)
//     ips: sha256(salt+ip),   // ip hash (rate limiting only, never stored raw)
//     at: epoch-ms, note: string? }
//
// Cluster (derived on the fly per (region, type), never stored):
//   reports sorted by time; a cluster groups outage reports whose gaps <= GAP_MS.
//   status: 'u' unconfirmed  — fewer than CONFIRM_DEVICES distinct devices
//           'c' confirmed    — >= CONFIRM_DEVICES distinct devices in the cluster
//           's' stale        — no outage report for STALE_MS ("likely restored",
//                              clients prompt nearby users to confirm/deny)
//   closed (hidden): >= RESOLVE_DEVICES distinct devices sent 'ok' after the last
//   outage report, or stale for longer than EXPIRE_MS.
//   A new outage report after closing simply starts a new cluster.
// ───────────────────────────────────────────────────────────────────────────

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');
const STORE_FILE = path.join(ROOT, 'data', 'store.json');

// ─── Tunables ───────────────────────────────────────────────────────────────
const GAP_MS = 90 * 60e3;          // max gap between reports of one cluster
const CONFIRM_DEVICES = 3;         // distinct devices to mark "confirmed"
const RESOLVE_DEVICES = 2;         // distinct devices to close via "it's back"
const STALE_MS = 60 * 60e3;        // silence before "likely restored"
const EXPIRE_MS = 3 * 60 * 60e3;   // stale this long -> cluster disappears
const RETENTION_MS = 48 * 60 * 60e3;
// rate limits (anti-spam without accounts/friction)
const DEDUPE_MS = 15 * 60e3;       // same device+region+type coalesced
const DEV_HOURLY = 10;             // reports/hour per device
const IP_HOURLY = 40;              // reports/hour per IP
const DEV_GOV_HOURLY = 3;          // distinct governorates/hour per device ("teleport" guard)

// ─── Regions ────────────────────────────────────────────────────────────────
const REGIONS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'regions.json'), 'utf8'));
const REGION_GOV = {};             // regionId -> governorate id
REGIONS.governorates.forEach(g => { REGION_GOV[g.id] = g.id; });
REGIONS.delegations.forEach(d => { REGION_GOV[d.id] = d.gov; });

// ─── Store ──────────────────────────────────────────────────────────────────
let store = { reports: [], salt: crypto.randomBytes(16).toString('hex') };
try {
  const loaded = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  if (loaded && Array.isArray(loaded.reports)) store = loaded;
} catch { /* first boot */ }

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    fs.writeFile(STORE_FILE, JSON.stringify(store), () => {});
  }, 1500);
}

function prune() {
  const cut = Date.now() - RETENTION_MS;
  const before = store.reports.length;
  store.reports = store.reports.filter(r => r.at >= cut);
  if (store.reports.length !== before) save();
}
setInterval(prune, 10 * 60e3).unref();
prune();

const hash = v => crypto.createHash('sha256').update(store.salt + v).digest('hex').slice(0, 16);

// ─── Clustering engine ──────────────────────────────────────────────────────
function activeClusters(now = Date.now()) {
  // bucket reports by (region, type)
  const buckets = new Map();
  for (const r of store.reports) {
    const key = r.r + '|' + r.t;
    let b = buckets.get(key);
    if (!b) buckets.set(key, b = []);
    b.push(r);
  }
  const out = [];
  for (const [key, reps] of buckets) {
    reps.sort((a, b) => a.at - b.at);
    // walk backwards to find the latest cluster of outage reports
    const outs = reps.filter(r => r.k === 'out');
    if (!outs.length) continue;
    let i = outs.length - 1;
    while (i > 0 && outs[i].at - outs[i - 1].at <= GAP_MS) i--;
    const cluster = outs.slice(i);
    const first = cluster[0].at, last = cluster[cluster.length - 1].at;
    if (now - last > STALE_MS + EXPIRE_MS) continue;              // expired
    // "it's back" confirmations after the last outage report
    const oks = reps.filter(r => r.k === 'ok' && r.at > last);
    const okDevs = new Set(oks.map(r => r.dev)).size;
    if (okDevs >= RESOLVE_DEVICES) continue;                      // resolved
    const devs = new Set(cluster.map(r => r.dev)).size;
    const status = now - last > STALE_MS ? 's' : (devs >= CONFIRM_DEVICES ? 'c' : 'u');
    const [regionId, type] = key.split('|');
    const notes = cluster.filter(r => r.note).slice(-3).map(r => r.note);
    out.push({ r: regionId, t: type, st: status, n: cluster.length, dv: devs,
               ok: okDevs, start: first, last, notes });
  }
  out.sort((a, b) => b.last - a.last);
  return out;
}

// ─── Rate limiting (in-memory, resets on restart — acceptable) ──────────────
function allowed(dev, ips, regionId, type, kind, now) {
  const hourAgo = now - 3600e3;
  let devCount = 0, ipCount = 0;
  const govs = new Set();
  for (let i = store.reports.length - 1; i >= 0; i--) {
    const r = store.reports[i];
    if (r.at < hourAgo) break;                 // reports are time-ordered
    if (r.dev === dev) {
      devCount++;
      govs.add(REGION_GOV[r.r]);
      if (kind === 'out' && r.k === 'out' && r.r === regionId && r.t === type &&
          now - r.at < DEDUPE_MS) return 'coalesced';
    }
    if (r.ips === ips) ipCount++;
  }
  if (devCount >= DEV_HOURLY || ipCount >= IP_HOURLY) return 'limited';
  if (!govs.has(REGION_GOV[regionId]) && govs.size >= DEV_GOV_HOURLY) return 'limited';
  return 'ok';
}

const sanitizeNote = n => typeof n === 'string'
  ? n.replace(/[<>&\u0000-\u001f\u2066-\u2069]/g, '').trim().slice(0, 120) || undefined
  : undefined;

// ─── HTTP plumbing ──────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
};

function send(req, res, code, body, headers = {}) {
  const h = { 'Cache-Control': 'no-store', ...headers };
  if (typeof body === 'object' && !(body instanceof Buffer)) {
    body = JSON.stringify(body);
    h['Content-Type'] = 'application/json; charset=utf-8';
  }
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  if (buf.length > 512 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    const gz = zlib.gzipSync(buf);
    h['Content-Encoding'] = 'gzip';
    res.writeHead(code, { ...h, 'Content-Length': gz.length });
    res.end(gz);
  } else {
    res.writeHead(code, { ...h, 'Content-Length': buf.length });
    res.end(buf);
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '', len = 0;
    req.on('data', c => {
      len += c.length;
      if (len > 4096) { reject(new Error('too big')); req.destroy(); return; }
      data += c;
    });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const etagOf = s => '"' + crypto.createHash('sha1').update(s).digest('hex').slice(0, 12) + '"';
const REGIONS_BODY = JSON.stringify(REGIONS);
const REGIONS_ETAG = etagOf(REGIONS_BODY);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    // ── API ──
    if (p === '/api/regions') {
      if (req.headers['if-none-match'] === REGIONS_ETAG)
        return send(req, res, 304, '', { ETag: REGIONS_ETAG });
      return send(req, res, 200, REGIONS_BODY, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=86400', ETag: REGIONS_ETAG,
      });
    }
    if (p === '/api/state') {
      const now = Date.now();
      const body = JSON.stringify({ now, clusters: activeClusters(now) });
      const tag = etagOf(body);
      if (req.headers['if-none-match'] === tag)
        return send(req, res, 304, '', { ETag: tag });
      return send(req, res, 200, body, {
        'Content-Type': 'application/json; charset=utf-8', ETag: tag,
        'Cache-Control': 'no-cache', // browser revalidates -> 304 when unchanged
      });
    }
    if (p === '/api/report' && req.method === 'POST') {
      const b = await readBody(req);
      const { r, t, k, dev } = b;
      if (!REGION_GOV[r] || !['p', 'w'].includes(t) || !['out', 'ok'].includes(k) ||
          typeof dev !== 'string' || dev.length < 8 || dev.length > 64)
        return send(req, res, 400, { ok: false, error: 'bad request' });
      const now = Date.now();
      const devH = hash(dev);
      const ipH = hash((req.socket.remoteAddress || '') +
                       (req.headers['x-forwarded-for'] || '').split(',')[0]);
      const verdict = allowed(devH, ipH, r, t, k, now);
      // Coalesced/limited requests still get {ok:true} — no feedback loop for spammers,
      // and an honest double-tap simply feels like it worked (it did, earlier).
      if (verdict !== 'ok') return send(req, res, 200, { ok: true, note: verdict });
      store.reports.push({
        id: crypto.randomUUID(), r, t, k, dev: devH, ips: ipH, at: now,
        note: k === 'out' ? sanitizeNote(b.note) : undefined,
      });
      save();
      return send(req, res, 200, { ok: true });
    }
    // ── static ──
    let file = p === '/' ? '/index.html' : p;
    file = path.normalize(file).replace(/^([.\\/])+/, '');
    const full = path.join(PUB, file);
    if (!full.startsWith(PUB)) return send(req, res, 404, 'not found');
    let buf;
    try { buf = fs.readFileSync(full); } catch { return send(req, res, 404, 'not found'); }
    const tag = etagOf(buf);
    if (req.headers['if-none-match'] === tag) return send(req, res, 304, '', { ETag: tag });
    return send(req, res, 200, buf, {
      'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
      'Cache-Control': 'no-cache', ETag: tag, // revalidate: 304 unless the file changed
    });
  } catch (e) {
    return send(req, res, 500, { ok: false, error: 'server error' });
  }
});

server.listen(PORT, () => console.log(`Winou Edhaw on http://localhost:${PORT}`));
