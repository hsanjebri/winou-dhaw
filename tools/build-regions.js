// Build-time tool: produces data/regions.json from open-admin-data (CC-BY-4.0)
// Governorates + delegations, FR/AR names, coordinates, and dialect alias lists.
const fs = require('fs');
const path = require('path');

const oadGov = JSON.parse(fs.readFileSync(path.join(__dirname, 'oad-governorates.json'), 'utf8'));
const oadDel = JSON.parse(fs.readFileSync(path.join(__dirname, 'oad-delegations.json'), 'utf8'));

// Preferred Latin (French) display names where OAD's English name is off
const FR_FIX = {
  TN14: 'Manouba',
  TN23: 'Le Kef',
  TN42: 'Kasserine',
  TN43: 'Sidi Bouzid',
};

// Common dialect / alternate spellings (arabizi digits are handled by the search
// normalizer at runtime; these are for genuinely different spellings)
const GOV_ALIASES = {
  TN11: ['tounes', 'tunis ville', 'العاصمة'],
  TN12: ['aryanah', 'l\'ariana'],
  TN13: ['benarous', 'bin arous'],
  TN14: ['manubah', 'mannouba', 'la manouba'],
  TN15: ['nabel', 'nebeul'],
  TN16: ['zaghwan', 'zagouan', 'zaghouene'],
  TN17: ['banzart', 'bizerta', 'binzart'],
  TN21: ['beja', 'baja'],
  TN22: ['jandouba', 'jendoba', 'ghardimaou'],
  TN23: ['kef', 'el kef', 'le kef'],
  TN24: ['silyana'],
  TN31: ['sousa', 'soussa', 'susah'],
  TN32: ['mestir', 'monastir'],
  TN33: ['mehdia', 'el mahdia', 'mahdiya'],
  TN34: ['sfaqes', 'safaqis', 'sfax ville'],
  TN41: ['kairwan', 'qayrawan', 'kayrawen', 'qairouan'],
  TN42: ['kasrine', 'gasrine', 'kassrine'],
  TN43: ['sidi bou zid', 'sidi bouzide'],
  TN51: ['gabes', 'qabis', 'gabss'],
  TN52: ['mednine', 'madanin', 'medenin'],
  TN53: ['tatawin', 'tatooine', 'tataouin'],
  TN61: ['gafsa', 'qafsa'],
  TN62: ['tozer', 'touzeur', 'tawzar'],
  TN63: ['kebili', 'gbelli', 'kbilli', 'kebilli', 'douz'],
};

const clean = s => (s || '').replace(/\u0640/g, '').trim(); // strip tatweel

const governorates = oadGov.map(g => ({
  id: g.id,
  fr: FR_FIX[g.id] || g.name.en,
  ar: clean(g.name.local),
  c: [+g.geo.lat, +g.geo.lon],
  al: GOV_ALIASES[g.id] || [],
}));

const delegations = oadDel.map(d => ({
  id: d.id,
  fr: d.name.en,
  ar: clean(d.name.local),
  gov: d.parent.id,
  c: [+d.geo.lat, +d.geo.lon],
}));

const out = { governorates, delegations };
fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'data', 'regions.json'), JSON.stringify(out));
console.log('governorates:', governorates.length, 'delegations:', delegations.length,
  'bytes:', JSON.stringify(out).length);
// sanity: every delegation's gov exists
const govIds = new Set(governorates.map(g => g.id));
const bad = delegations.filter(d => !govIds.has(d.gov));
console.log('orphan delegations:', bad.length);
