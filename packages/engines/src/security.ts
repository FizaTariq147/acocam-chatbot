import { timingSafeEqual, createHash } from 'node:crypto';

/** Reject path traversal and invalid tenant ids. */
export function sanitizeTenantId(tenantId: string): string | null {
  const id = tenantId.trim();
  if (!id || id.includes('..') || id.includes('/') || id.includes('\\') || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    return null;
  }
  return id;
}

/** Constant-time string compare (handles unequal lengths safely). */
export function safeEqual(a: string, b: string): boolean {
  const da = createHash('sha256').update(a).digest();
  const db = createHash('sha256').update(b).digest();
  return timingSafeEqual(da, db);
}

/** Optional JWT sanity check — does not verify signature unless secret is set. */
export function validateCustomerToken(
  token: string | undefined,
  env: NodeJS.ProcessEnv,
): { ok: true; token: string } | { ok: false; error: string } {
  if (!token?.trim()) return { ok: false, error: 'Missing token' };
  const trimmed = token.trim();
  const maxLen = Number(env.MAX_CUSTOMER_TOKEN_LENGTH ?? 8192);
  if (trimmed.length > maxLen) return { ok: false, error: 'Token too long' };

  const parts = trimmed.split('.');
  if (parts.length !== 3) {
    // Opaque tokens — allow pass-through when validation disabled
    if (env.JWT_VALIDATE !== 'true') return { ok: true, token: trimmed };
    return { ok: false, error: 'Invalid token format' };
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as {
      exp?: number;
    };
    if (env.JWT_VALIDATE === 'true' || env.JWT_VALIDATE_EXP === 'true') {
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        return { ok: false, error: 'Token expired' };
      }
    }
  } catch {
    if (env.JWT_VALIDATE === 'true') return { ok: false, error: 'Invalid token payload' };
  }

  return { ok: true, token: trimmed };
}

/** User-facing tool/API errors — hide internal URLs and env var names. */
export function sanitizeUserFacingError(raw: string | undefined, devMode: boolean): string {
  if (!raw) return 'Service temporarily unavailable.';
  if (devMode || process.env.EXPOSE_INTERNAL_ERRORS === 'true') return raw;
  if (/ECONNREFUSED|ENOTFOUND|fetch failed|timed out|HTML instead of JSON|endpoint not found/i.test(raw)) {
    return 'The logistics service is temporarily unavailable. Please try again shortly.';
  }
  if (/API returned \d{3}/.test(raw)) return raw;
  if (/sign-in|login|auth/i.test(raw)) return raw;
  return 'Something went wrong while completing your request. Please try again or talk to a human agent.';
}

export function isDevMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.NODE_ENV ?? 'development') !== 'production';
}
