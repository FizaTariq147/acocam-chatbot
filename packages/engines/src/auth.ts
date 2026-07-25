import type { TenantPack } from './config.js';

export type AuthMode = 'publishable' | 'secret' | 'none';

export interface AuthContext {
  ok: boolean;
  mode: AuthMode;
  tenantId: string;
  error?: string;
}

export class AuthEngine {
  resolve(pack: TenantPack, apiKey: string | undefined, requireSecret = false): AuthContext {
    const tenantId = pack.settings.tenantId;
    if (!apiKey) {
      return { ok: false, mode: 'none', tenantId, error: 'Missing API key' };
    }
    if (apiKey === pack.settings.secretKey) {
      return { ok: true, mode: 'secret', tenantId };
    }
    if (!requireSecret && apiKey === pack.settings.publishableKey) {
      return { ok: true, mode: 'publishable', tenantId };
    }
    return { ok: false, mode: 'none', tenantId, error: 'Invalid API key' };
  }
}
