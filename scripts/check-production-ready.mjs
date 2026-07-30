#!/usr/bin/env node
/**
 * Pre-launch checklist (local only). Run: npm run check:prod
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');

function loadEnv() {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnv();

const checks = [];
function ok(msg) {
  checks.push({ ok: true, msg });
}
function warn(msg) {
  checks.push({ ok: false, msg });
}

if (!existsSync(envPath)) warn('Missing .env — copy env.production.example to .env');
else ok('.env present');

if (process.env.NODE_ENV === 'production') ok('NODE_ENV=production');
else warn('NODE_ENV is not production (set for live server)');

if (process.env.CORS_ORIGIN?.includes('acocamtrading.ca')) ok('CORS_ORIGIN includes acocamtrading.ca');
else warn('CORS_ORIGIN should list https://acocamtrading.ca (comma-separated)');

const pub = process.env.ACOCAM_PUBLISHABLE_KEY || '';
const sec = process.env.ACOCAM_SECRET_KEY || '';
if (pub && !pub.includes('demo')) ok('Publishable key set (non-demo)');
else warn('Set ACOCAM_PUBLISHABLE_KEY to a live key (not pk_acocam_demo)');

if (sec && !sec.includes('demo')) ok('Secret key set (non-demo)');
else warn('Set ACOCAM_SECRET_KEY to a live secret (not sk_acocam_demo_secret)');

if (process.env.ACOCAM_API_BASE_URL) ok(`Logistics URL: ${process.env.ACOCAM_API_BASE_URL}`);
else warn('ACOCAM_API_BASE_URL not set');

const embed = path.join(root, 'packages/sdk-js/dist/agent-embed.js');
if (existsSync(embed)) ok('Embed bundle built (packages/sdk-js/dist/agent-embed.js)');
else warn('Run npm run build before deploy');

const apiDist = path.join(root, 'apps/api/dist/index.js');
if (existsSync(apiDist)) ok('API compiled (apps/api/dist/index.js)');
else warn('Run npm run build before deploy');

console.log('\nProduction readiness:\n');
for (const c of checks) {
  console.log(`${c.ok ? '✓' : '!' } ${c.msg}`);
}
const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${failed ? failed + ' item(s) need attention before go-live.' : 'All checks passed.'}`);
process.exit(failed ? 1 : 0);
