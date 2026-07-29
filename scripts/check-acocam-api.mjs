#!/usr/bin/env node
/**
 * Verify the chatbot can reach the ACOCAM logistics API (separate from this repo).
 * Reads ACOCAM_API_BASE_URL from repo-root .env when present.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(repoRoot, '.env');

function loadEnvFile() {
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

loadEnvFile();

const base = (process.env.ACOCAM_API_BASE_URL || 'http://localhost:3019').replace(/\/$/, '');
const healthUrl = `${base}/api/health`;
const trackUrl = `${base}/api/shipments/track/TEST-000000`;

console.log(`ACOCAM logistics API base: ${base}`);
console.log(`Health check: ${healthUrl}`);

try {
  const res = await fetch(healthUrl, { signal: AbortSignal.timeout(8000) });
  const text = await res.text();
  const html = /^\s*<!DOCTYPE html/i.test(text);
  if (html) {
    console.error('\nFAIL: Response is HTML — this URL is likely the WordPress site, not the logistics API.');
    process.exit(1);
  }
  console.log(`\nHealth: HTTP ${res.status}`);
  if (!res.ok) {
    console.error('FAIL: /api/health did not return OK. Start the logistics API from your ACOCAM backend project.');
    process.exit(1);
  }
} catch (err) {
  const code = err?.cause?.code ?? err?.code;
  console.error(`\nFAIL: Cannot reach ${healthUrl}`);
  if (code === 'ECONNREFUSED') {
    console.error('Connection refused — the logistics API is not running on that host/port.');
    console.error('Default per api/api.json: http://localhost:3019 (same as D:\\ACOCAM\\acocam-integration).');
  } else {
    console.error(err instanceof Error ? err.message : String(err));
  }
  console.error('\nTracking and quotes in chat will fail until this API is up.');
  console.error('Chatbot API (port 8787) is separate — both must run.');
  process.exit(1);
}

try {
  const res = await fetch(trackUrl, { signal: AbortSignal.timeout(8000) });
  console.log(`Track probe: HTTP ${res.status} (${trackUrl})`);
  if (res.status === 401) {
    console.log('Note: Track endpoint returned 401 without JWT — log in on the website for full tracking, or confirm public track is enabled.');
  }
} catch {
  /* health passed; track probe optional */
}

console.log('\nOK: Logistics API is reachable. Restart chatbot API if you changed .env.');
