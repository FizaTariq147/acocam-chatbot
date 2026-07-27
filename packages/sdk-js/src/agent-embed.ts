type PublicConfig = {
  tenantId: string;
  agentId: string;
  name: string;
  welcome: string;
  theme: {
    primaryColor: string;
    secondaryColor: string;
    backgroundColor: string;
    textColor: string;
    fontFamily: string;
    position: 'bottom-right' | 'bottom-left';
    launcherLabel: string;
    logoUrl?: string;
  };
  actions: Array<{ id: string; label: string; url?: string }>;
};

type TurnResponse = {
  message: string;
  actions?: Array<{ id: string; label: string; url?: string }>;
  escalate?: boolean;
};

(function () {
  const script = document.currentScript as HTMLScriptElement | null;
  if (!script) return;

  const tenant = script.getAttribute('data-tenant') || 'acocam';
  const agent = script.getAttribute('data-agent') || 'customer-support';
  const key = script.getAttribute('data-key') || '';
  const apiBase = (script.getAttribute('data-api') || '/v1').replace(/\/$/, '');

  function parseStoredToken(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('{')) {
      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>;
        for (const field of ['token', 'accessToken', 'access_token', 'jwt', 'authToken']) {
          const value = obj[field];
          if (typeof value === 'string' && value.trim()) return value.trim();
        }
      } catch {
        /* fall through */
      }
    }
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === 'string' && parsed.trim()) return parsed.trim();
      } catch {
        /* fall through */
      }
    }
    return trimmed;
  }

  function readTokenFromStorage(keyName: string): string {
    const raw = localStorage.getItem(keyName) || sessionStorage.getItem(keyName);
    return raw ? parseStoredToken(raw) : '';
  }

  function resolveCustomerToken(): string {
    const fromAttr = script!.getAttribute('data-customer-token')?.trim();
    if (fromAttr) return fromAttr;

    const storageKey = script!.getAttribute('data-customer-token-key')?.trim();
    if (storageKey) {
      const stored = readTokenFromStorage(storageKey);
      if (stored) return stored;
    }

    for (const keyName of ['token', 'authToken', 'accessToken', 'access_token', 'jwt']) {
      const stored = readTokenFromStorage(keyName);
      if (stored) return stored;
    }

    const globalToken = (window as { ACOCAM_AUTH_TOKEN?: string }).ACOCAM_AUTH_TOKEN;
    return typeof globalToken === 'string' ? globalToken.trim() : '';
  }

  let sessionId: string | null = null;
  let config: PublicConfig | null = null;

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${apiBase}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        ...(init?.headers || {}),
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs: Record<string, string> = {},
    children: (Node | string)[] = [],
  ): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'className') node.className = v;
      else node.setAttribute(k, v);
    }
    for (const child of children) {
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  function appendBubble(log: HTMLElement, role: 'user' | 'assistant', text: string) {
    const bubble = el('div', { className: `aap-bubble aap-${role}` });
    appendRichContent(bubble, text);
    log.appendChild(bubble);
    log.scrollTop = log.scrollHeight;
  }

  type RichSegment =
    | { kind: 'text'; value: string }
    | { kind: 'link'; label: string; href: string }
    | { kind: 'url'; href: string; label: string }
    | { kind: 'email'; address: string }
    | { kind: 'bold'; value: string };

  function normalizeUrl(raw: string): { href: string; label: string } {
    let label = raw;
    let href = raw;
    const trailing = label.match(/([.,;:!?)]+)$/);
    if (trailing) {
      label = label.slice(0, -trailing[1].length);
      href = href.slice(0, -trailing[1].length);
    }
    if (/^www\./i.test(href)) href = `https://${href}`;
    return { href, label };
  }

  function parseInlineSegments(text: string): RichSegment[] {
    const segments: RichSegment[] = [];
    let i = 0;
    while (i < text.length) {
      const rest = text.slice(i);
      const mdLink = rest.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/);
      if (mdLink) {
        segments.push({ kind: 'link', label: mdLink[1]!, href: mdLink[2]! });
        i += mdLink[0].length;
        continue;
      }
      const bold = rest.match(/^\*\*([^*]+)\*\*/);
      if (bold) {
        segments.push({ kind: 'bold', value: bold[1]! });
        i += bold[0].length;
        continue;
      }
      const url = rest.match(/^(https?:\/\/[^\s<>"')\]]+|www\.[^\s<>"')\]]+)/i);
      if (url) {
        const normalized = normalizeUrl(url[0]);
        segments.push({ kind: 'url', href: normalized.href, label: normalized.label });
        i += url[0].length;
        continue;
      }
      const email = rest.match(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      if (email) {
        segments.push({ kind: 'email', address: email[0] });
        i += email[0].length;
        continue;
      }
      const nextSpecial = rest.search(/\n|\[|\*\*|https?:\/\/|www\.|[a-zA-Z0-9._%+-]+@/i);
      const end = nextSpecial === -1 ? rest.length : nextSpecial;
      if (end === 0) {
        segments.push({ kind: 'text', value: text[i]! });
        i += 1;
      } else {
        segments.push({ kind: 'text', value: rest.slice(0, end) });
        i += end;
      }
    }
    return segments;
  }

  function parseRichSegments(text: string): RichSegment[] {
    const parts = text.split(/(```[\s\S]*?```)/g);
    const segments: RichSegment[] = [];
    for (const part of parts) {
      if (part.startsWith('```') && part.endsWith('```')) {
        segments.push({ kind: 'text', value: part });
        continue;
      }
      segments.push(...parseInlineSegments(part));
    }
    return segments;
  }

  function appendRichContent(container: HTMLElement, text: string) {
    for (const segment of parseRichSegments(text)) {
      if (segment.kind === 'text') {
        container.appendChild(document.createTextNode(segment.value));
        continue;
      }
      if (segment.kind === 'bold') {
        const strong = document.createElement('strong');
        strong.textContent = segment.value;
        container.appendChild(strong);
        continue;
      }
      const anchor = document.createElement('a');
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.className = 'aap-link';
      if (segment.kind === 'email') {
        anchor.href = `mailto:${segment.address}`;
        anchor.textContent = segment.address;
      } else {
        anchor.href = segment.href;
        anchor.textContent = segment.kind === 'link' ? segment.label : segment.label;
      }
      container.appendChild(anchor);
    }
  }

  async function ensureSession() {
    if (sessionId) return;
    const created = await api<{ sessionId: string; welcome: string }>(
      `/tenants/${tenant}/agents/${agent}/sessions`,
      { method: 'POST', body: '{}' },
    );
    sessionId = created.sessionId;
  }

  function messageBody(text: string, actionId?: string): string {
    const payload: { message: string; actionId?: string; customerAuthToken?: string } = {
      message: text || '',
    };
    if (actionId) payload.actionId = actionId;
    const token = resolveCustomerToken();
    if (token) payload.customerAuthToken = token;
    return JSON.stringify(payload);
  }

  function bindAction(
    btn: HTMLButtonElement,
    action: { id: string; label: string; url?: string },
    log: HTMLElement,
    setActions: (actions: Array<{ id: string; label: string; url?: string }>) => void,
  ) {
    btn.addEventListener('click', () => {
      if (action.url) {
        window.open(action.url, '_blank', 'noopener,noreferrer');
        return;
      }
      void (async () => {
        try {
          await ensureSession();
          appendBubble(log, 'user', action.label);
          const result = await api<TurnResponse>(
            `/tenants/${tenant}/agents/${agent}/sessions/${sessionId}/messages`,
            {
              method: 'POST',
              body: messageBody('', action.id),
            },
          );
          appendBubble(log, 'assistant', result.message);
          if (result.actions?.length) setActions(result.actions);
        } catch (err) {
          appendBubble(log, 'assistant', err instanceof Error ? err.message : 'Request failed');
        }
      })();
    });
  }

  function renderActions(
    container: HTMLElement,
    actions: Array<{ id: string; label: string; url?: string }>,
    log: HTMLElement,
    setActions: (actions: Array<{ id: string; label: string; url?: string }>) => void,
  ) {
    container.replaceChildren();
    for (const action of actions) {
      const btn = el('button', { type: 'button' }, [action.label]) as HTMLButtonElement;
      bindAction(btn, action, log, setActions);
      container.appendChild(btn);
    }
  }

  async function sendMessage(
    text: string,
    actionId: string | undefined,
    log: HTMLElement,
    setActions: (actions: Array<{ id: string; label: string; url?: string }>) => void,
  ) {
    await ensureSession();
    if (text) appendBubble(log, 'user', text);
    const result = await api<TurnResponse>(
      `/tenants/${tenant}/agents/${agent}/sessions/${sessionId}/messages`,
      {
        method: 'POST',
        body: messageBody(text, actionId),
      },
    );
    appendBubble(log, 'assistant', result.message);
    if (result.actions?.length) setActions(result.actions);
    return result;
  }

  function mount(cfg: PublicConfig) {
    const pos = cfg.theme.position === 'bottom-left' ? 'left:20px' : 'right:20px';
    const style = el('style', {}, [
      `
      .aap-root{position:fixed;bottom:20px;${pos};z-index:99999;font-family:${cfg.theme.fontFamily}}
      .aap-launcher{background:${cfg.theme.primaryColor};color:#fff;border:0;border-radius:999px;padding:12px 18px;cursor:pointer;box-shadow:0 8px 24px rgba(15,23,42,.2);font-weight:600}
      .aap-panel{display:none;width:min(380px,calc(100vw - 24px));height:520px;background:${cfg.theme.backgroundColor};color:${cfg.theme.textColor};border-radius:16px;overflow:hidden;box-shadow:0 18px 50px rgba(15,23,42,.25);flex-direction:column;margin-bottom:12px}
      .aap-panel.open{display:flex}
      .aap-header{background:linear-gradient(135deg,${cfg.theme.primaryColor},${cfg.theme.secondaryColor});color:#fff;padding:14px 16px;font-weight:700}
      .aap-log{flex:1;overflow:auto;padding:12px;background:#f8fafc}
      .aap-bubble{max-width:85%;margin:8px 0;padding:10px 12px;border-radius:12px;white-space:pre-wrap;line-height:1.4;font-size:14px;word-break:break-word}
      .aap-bubble a.aap-link{color:inherit;text-decoration:underline;text-underline-offset:2px}
      .aap-bubble a.aap-link:hover{opacity:.85}
      .aap-user a.aap-link{color:#fff}
      .aap-assistant a.aap-link{color:#2563eb}
      .aap-user{margin-left:auto;background:${cfg.theme.primaryColor};color:#fff}
      .aap-assistant{margin-right:auto;background:#fff;border:1px solid #e2e8f0}
      .aap-actions{display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px;border-top:1px solid #e2e8f0;background:#fff}
      .aap-actions button{border:1px solid #cbd5e1;background:#fff;border-radius:999px;padding:6px 10px;font-size:12px;cursor:pointer}
      .aap-form{display:flex;gap:8px;padding:10px;border-top:1px solid #e2e8f0;background:#fff}
      .aap-form input{flex:1;border:1px solid #cbd5e1;border-radius:10px;padding:10px}
      .aap-form button{background:${cfg.theme.primaryColor};color:#fff;border:0;border-radius:10px;padding:0 14px;cursor:pointer}
      `,
    ]);
    document.head.appendChild(style);

    const log = el('div', { className: 'aap-log' });
    const actionsBar = el('div', { className: 'aap-actions' });
    const setActions = (actions: Array<{ id: string; label: string; url?: string }>) => {
      renderActions(actionsBar, actions, log, setActions);
    };

    const panel = el('div', { className: 'aap-panel' }, [
      el('div', { className: 'aap-header' }, [cfg.name]),
      log,
      actionsBar,
    ]);

    renderActions(actionsBar, cfg.actions, log, setActions);

    const input = el('input', { type: 'text', placeholder: 'Type a message…' }) as HTMLInputElement;
    const sendBtn = el('button', { type: 'button' }, ['Send']);
    const form = el('div', { className: 'aap-form' }, [input, sendBtn]);
    panel.appendChild(form);

    const launcher = el('button', { className: 'aap-launcher', type: 'button' }, [
      cfg.theme.launcherLabel || 'Chat',
    ]);
    let open = false;
    launcher.addEventListener('click', () => {
      open = !open;
      panel.classList.toggle('open', open);
      if (open && log.childNodes.length === 0) {
        appendBubble(log, 'assistant', cfg.welcome);
        void ensureSession();
      }
    });

    const submit = () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      void sendMessage(text, undefined, log, setActions).catch((err: Error) => {
        appendBubble(log, 'assistant', err.message || 'Something went wrong.');
      });
    };
    sendBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });

    const root = el('div', { className: 'aap-root' }, [panel, launcher]);
    document.body.appendChild(root);
  }

  void (async () => {
    try {
      config = await api<PublicConfig>(`/tenants/${tenant}/agents/${agent}/config/public`);
      mount(config);
    } catch (err) {
      console.error('[agent-embed]', err);
    }
  })();
})();
