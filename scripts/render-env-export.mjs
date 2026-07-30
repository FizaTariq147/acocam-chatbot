#!/usr/bin/env node
/**
 * Print env vars to paste into Render Dashboard → Environment.
 * Reads repo-root .env (never commit .env).
 * Usage: node scripts/render-env-export.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');

const RENDER_KEYS = [
  'NODE_ENV',
  'HOST',
  'TRUST_PROXY',
  'TENANTS_DIR',
  'DATA_DIR',
  'ACOCAM_PUBLISHABLE_KEY',
  'ACOCAM_SECRET_KEY',
  'ACOCAM_API_BASE_URL',
  'CORS_ORIGIN',
  'ACOCAM_PORTAL_LOGIN_URL',
  'ACOCAM_PORTAL_SIGNUP_URL',
  'ACOCAM_PORTAL_QUOTE_URL',
  'AI_PROVIDER',
  'JWT_VALIDATE_EXP',
  'PERSIST_SESSIONS',
  'PERSIST_ANALYTICS',
  'PERSIST_ESCALATIONS',
  'RATE_LIMIT_PER_MINUTE',
  'MAX_MESSAGE_LENGTH',
  'TOOL_TIMEOUT_MS',
  'DEFAULT_COUNTRY',
];

const DEFAULTS = {
  NODE_ENV: 'production',
  HOST: '0.0.0.0',
  TRUST_PROXY: 'true',
  TENANTS_DIR: './tenants',
  DATA_DIR: './data',
  AI_PROVIDER: 'null',
  JWT_VALIDATE_EXP: 'true',
  PERSIST_SESSIONS: 'true',
  PERSIST_ANALYTICS: 'true',
  PERSIST_ESCALATIONS: 'true',
  RATE_LIMIT_PER_MINUTE: '120',
  MAX_MESSAGE_LENGTH: '4000',
  TOOL_TIMEOUT_MS: '20000',
  DEFAULT_COUNTRY: 'Canada',
};

function loadEnv() {
  const out = { ...DEFAULTS };
  if (!existsSync(envPath)) return out;
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
    out[key] = val;
  }
  return out;
}

const env = loadEnv();
const secrets = new Set(['ACOCAM_PUBLISHABLE_KEY', 'ACOCAM_SECRET_KEY']);

console.log('\n=== Paste into Render → Web Service → Environment ===\n');
console.log('Do NOT commit this output. Mark keys ending in _KEY as Secret in Render.\n');

for (const key of RENDER_KEYS) {
  const val = env[key] ?? DEFAULTS[key];
  if (val === undefined) continue;
  const tag = secrets.has(key) ? ' [SECRET]' : '';
  console.log(`${key}=${val}${tag}`);
}

console.log('\nHealth check path: /v1/health');
console.log('Instance type: Free');
console.log('Do not set PORT — Render sets it automatically.\n');
