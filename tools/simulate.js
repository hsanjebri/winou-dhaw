// Dev tool: seeds the running server with realistic fake reports to exercise
// every cluster state. Usage: node tools/simulate.js [base-url]
const BASE = process.argv[2] || 'http://localhost:3000';

const dev = i => 'simdevice' + String(i).padStart(4, '0');

async function post(body) {
  const res = await fetch(BASE + '/api/report', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  if (!j.ok) console.log('rejected', body, j);
  return j;
}

async function main() {
  // Scenario 1: CONFIRMED power outage — Sousse Ville area, 5 devices
  // (TN3151.. ids: look up real delegation ids from the API)
  const regions = await (await fetch(BASE + '/api/regions')).json();
  const byFr = q => {
    const d = regions.delegations.find(d => d.fr.toLowerCase().includes(q));
    if (!d) throw new Error('no delegation for ' + q);
    return d.id;
  };

  const sousse = byFr('sousse');       // some Sousse delegation
  const ariana = byFr('ariana');       // Ariana Ville
  const kasserine = byFr('kasserine'); // Kasserine
  const djerba = byFr('houmt');        // Djerba Houmt Souk
  console.log({ sousse, ariana, kasserine, djerba });

  // confirmed power outage in Sousse: 5 distinct devices, notes
  for (let i = 0; i < 5; i++)
    await post({ r: sousse, t: 'p', k: 'out', dev: dev(i), note: i === 0 ? 'من 9 متاع الصباح' : undefined });

  // unconfirmed power outage in Kasserine: 1 device
  await post({ r: kasserine, t: 'p', k: 'out', dev: dev(10) });

  // confirmed WATER outage in Djerba: 3 devices
  for (let i = 20; i < 23; i++)
    await post({ r: djerba, t: 'w', k: 'out', dev: dev(i), note: i === 20 ? 'ماء مقطوع من البارح' : undefined });

  // gov-level report (user didn't pick a delegation): Ariana Ville power, 2 devices
  for (let i = 30; i < 32; i++)
    await post({ r: ariana, t: 'p', k: 'out', dev: dev(i) });

  // spam test: same device hammering
  for (let i = 0; i < 15; i++)
    await post({ r: sousse, t: 'p', k: 'out', dev: dev(0), note: 'spam ' + i });

  const state = await (await fetch(BASE + '/api/state')).json();
  console.log(JSON.stringify(state, null, 1));
}
main().catch(e => { console.error(e); process.exit(1); });
