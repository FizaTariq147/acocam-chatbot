import type { TenantPack } from './config.js';

import { safeEqual } from './security.js';



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



    const secret = pack.settings.secretKey;

    const publishable = pack.settings.publishableKey;



    if (secret && safeEqual(apiKey, secret)) {

      return { ok: true, mode: 'secret', tenantId };

    }

    if (!requireSecret && publishable && safeEqual(apiKey, publishable)) {

      return { ok: true, mode: 'publishable', tenantId };

    }

    return { ok: false, mode: 'none', tenantId, error: 'Invalid API key' };

  }

}


