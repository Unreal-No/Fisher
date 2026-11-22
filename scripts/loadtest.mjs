#!/usr/bin/env node
// Simple HTTP load test for the Fisher API (no dependencies).
// Usage: node scripts/loadtest.mjs [baseUrl=http://localhost:3000] [concurrency=20] [seconds=20]
// Env: LT_USER (admin), LT_PASSWORD (Admin@12345). The server's RATE_LIMIT_PER_MIN must allow the load.
const [base = 'http://localhost:3000', conc = '20', secs = '20'] = process.argv.slice(2);
const user = process.env.LT_USER ?? 'admin';
const password = process.env.LT_PASSWORD ?? 'Admin@12345';

const login = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user, password }) });
if (!login.ok) throw new Error(`login failed ${login.status} ${await login.text()}`);
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

const year = new Date().getFullYear();
const endpoints = [
  '/api/v1/auth/me',
  '/api/v1/dashboard/summary',
  '/api/v1/trips?page=1&pageSize=20',
  '/api/v1/catch/records?page=1&pageSize=20',
  '/api/v1/sales/invoices?page=1&pageSize=20',
  '/api/v1/inventory/balances',
  '/api/v1/gps/fleet',
  `/api/v1/accounting/reports/trial-balance?from=${year}-01-01`,
  `/api/v1/accounting/reports/profit-loss?from=${year}-01-01`,
  '/api/v1/accounting/journals?page=1&pageSize=20',
];
const stats = Object.fromEntries(endpoints.map((e) => [e, { ms: [], errors: 0, codes: {} }]));
const deadline = Date.now() + Number(secs) * 1000;
let i = 0;
async function worker() {
  while (Date.now() < deadline) {
    const ep = endpoints[i++ % endpoints.length];
    const t = performance.now();
    try {
      const r = await fetch(base + ep, { headers: { cookie } });
      await r.arrayBuffer();
      const s = stats[ep];
      s.ms.push(performance.now() - t);
      if (!r.ok) { s.errors++; s.codes[r.status] = (s.codes[r.status] ?? 0) + 1; }
    } catch {
      stats[ep].errors++;
    }
  }
}
const started = performance.now();
await Promise.all(Array.from({ length: Number(conc) }, worker));
const elapsed = (performance.now() - started) / 1000;
const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor((a.length * p) / 100))] : 0);
let total = 0;
let errors = 0;
console.log(`\n${base} · concurrency ${conc} · ${elapsed.toFixed(1)} s\n`);
console.log('endpoint'.padEnd(62), 'req'.padStart(6), 'p50'.padStart(7), 'p95'.padStart(7), 'p99'.padStart(7), 'err'.padStart(5));
for (const [ep, s] of Object.entries(stats)) {
  const a = s.ms.sort((x, y) => x - y);
  total += a.length;
  errors += s.errors;
  console.log(ep.slice(0, 62).padEnd(62), String(a.length).padStart(6), pct(a, 50).toFixed(0).padStart(7), pct(a, 95).toFixed(0).padStart(7), pct(a, 99).toFixed(0).padStart(7), String(s.errors).padStart(5), Object.keys(s.codes).length ? JSON.stringify(s.codes) : '');
}
console.log(`\ntotal ${total} requests, ${(total / elapsed).toFixed(1)} req/s, errors ${errors} (${((errors / Math.max(1, total)) * 100).toFixed(2)}%)`);
