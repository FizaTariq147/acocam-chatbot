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
    return bubble;
  }

  function showThinking(log: HTMLElement): HTMLElement {
    const bubble = el('div', { className: 'aap-bubble aap-assistant aap-thinking' });
    bubble.innerHTML =
      '<span class="aap-think-label">ACOCAM is thinking</span><span class="aap-dots"><i></i><i></i><i></i></span>';
    log.appendChild(bubble);
    log.scrollTop = log.scrollHeight;
    return bubble;
  }

  function typeAssistantMessage(log: HTMLElement, text: string): Promise<void> {
    return new Promise((resolve) => {
      const bubble = el('div', { className: 'aap-bubble aap-assistant aap-streaming' });
      const body = el('span', { className: 'aap-stream-body' });
      const caret = el('span', { className: 'aap-caret' }, ['']);
      bubble.appendChild(body);
      bubble.appendChild(caret);
      log.appendChild(bubble);

      const chars = Array.from(text);
      let i = 0;
      // ~28–45 chars/sec with slight jitter — feels like ChatGPT typing
      const baseDelay = chars.length > 600 ? 8 : chars.length > 250 ? 12 : 16;

      const tick = () => {
        if (i >= chars.length) {
          caret.remove();
          bubble.classList.remove('aap-streaming');
          body.replaceChildren();
          appendRichContent(body, text);
          log.scrollTop = log.scrollHeight;
          resolve();
          return;
        }
        // Type in small chunks for smoother animation
        const chunk = Math.min(2 + Math.floor(Math.random() * 3), chars.length - i);
        body.textContent = (body.textContent || '') + chars.slice(i, i + chunk).join('');
        i += chunk;
        log.scrollTop = log.scrollHeight;
        const pause = chars[i - 1] === '\n' ? baseDelay * 4 : baseDelay + Math.floor(Math.random() * 10);
        window.setTimeout(tick, pause);
      };
      tick();
    });
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
          const wait = showThinking(log);
          const result = await api<TurnResponse>(
            `/tenants/${tenant}/agents/${agent}/sessions/${sessionId}/messages`,
            {
              method: 'POST',
              body: messageBody('', action.id),
            },
          );
          wait.remove();
          await typeAssistantMessage(log, result.message);
          if (result.actions?.length) setActions(result.actions);
        } catch (err) {
          log.querySelectorAll('.aap-thinking').forEach((n) => n.remove());
          await typeAssistantMessage(
            log,
            err instanceof Error ? err.message : 'Request failed',
          );
        }
      })();
    });
  }

  function adaptActionsForAuth(
    actions: Array<{ id: string; label: string; url?: string }>,
  ): Array<{ id: string; label: string; url?: string }> {
    if (!resolveCustomerToken()) return actions;
    return actions.map((a) =>
      a.id === 'quote.request' ? { ...a, label: 'Book shipment' } : a,
    );
  }

  function renderActions(
    container: HTMLElement,
    actions: Array<{ id: string; label: string; url?: string }>,
    log: HTMLElement,
    setActions: (actions: Array<{ id: string; label: string; url?: string }>) => void,
  ) {
    container.replaceChildren();
    for (const action of adaptActionsForAuth(actions)) {
      const btn = el('button', { type: 'button', className: 'aap-action-btn' }, [action.label]) as HTMLButtonElement;
      btn.style.setProperty('background', '#e8f2f7', 'important');
      btn.style.setProperty('color', 'rgb(3,74,118)', 'important');
      btn.style.setProperty('border', '1px solid rgb(3,74,118)', 'important');
      btn.style.setProperty('-webkit-text-fill-color', 'rgb(3,74,118)', 'important');
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
    const thinking = showThinking(log);
    try {
      const result = await api<TurnResponse>(
        `/tenants/${tenant}/agents/${agent}/sessions/${sessionId}/messages`,
        {
          method: 'POST',
          body: messageBody(text, actionId),
        },
      );
      thinking.remove();
      await typeAssistantMessage(log, result.message);
      if (result.actions?.length) setActions(result.actions);
      return result;
    } catch (err) {
      thinking.remove();
      throw err;
    }
  }

  function mount(cfg: PublicConfig) {
    const pos = cfg.theme.position === 'bottom-left' ? 'left:20px' : 'right:20px';
    const font = 'Arial, Helvetica, sans-serif';
    const blue = 'rgb(3,74,118)';
    const blueDark = 'rgb(3,74,118)';
    const blueDarker = '#022f49';
    const blueLight = '#e8f2f7';
    const blueGradientEnd = '#5a8fad';
    const textDark = '#0f172a';
    const style = el('style', {}, [
      `
      .aap-root{position:fixed;bottom:72px;${pos};z-index:99999;font-family:${font}!important;line-height:1.4}
      .aap-root *,.aap-root *::before,.aap-root *::after{box-sizing:border-box;font-family:${font}!important}
      .aap-launcher{background:${blue}!important;color:#fff!important;border:0!important;border-radius:999px;padding:12px 18px;cursor:pointer;box-shadow:0 8px 24px rgba(3,74,118,.35);font-weight:600;font-size:14px}
      .aap-panel{display:none;width:min(380px,calc(100vw - 24px));height:520px;background:#fff!important;color:${textDark};border-radius:16px;overflow:hidden;box-shadow:0 18px 50px rgba(15,23,42,.25);flex-direction:column;margin-bottom:12px;border:1px solid #e2e8f0}
      .aap-panel.open{display:flex}
      .aap-header{display:flex;align-items:center;gap:8px;background:linear-gradient(135deg,${blue},${blueGradientEnd})!important;color:#fff!important;padding:12px 14px;font-weight:700;font-size:15px}
      .aap-header-title{flex:1;color:#fff!important;text-shadow:0 1px 2px rgba(0,0,0,.12)}
      .aap-close{flex-shrink:0;margin-left:auto;background:rgba(255,255,255,.22)!important;border:0!important;color:#fff!important;width:32px;height:32px;border-radius:8px;font-size:22px;line-height:1;cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center;font-weight:700}
      .aap-close:hover{background:rgba(255,255,255,.38)!important}
      .aap-log{flex:1;overflow:auto;padding:12px;background:#f8fafc}
      .aap-bubble{max-width:85%;margin:8px 0;padding:10px 12px;border-radius:12px;white-space:pre-wrap;line-height:1.4;font-size:14px;word-break:break-word}
      .aap-bubble a.aap-link{color:inherit;text-decoration:underline;text-underline-offset:2px}
      .aap-bubble a.aap-link:hover{opacity:.85}
      .aap-user a.aap-link{color:#fff!important}
      .aap-assistant a.aap-link{color:${blue}!important}
      .aap-user{margin-left:auto;background:${blue}!important;color:#fff!important}
      .aap-assistant{margin-right:auto;background:#fff!important;border:1px solid #e2e8f0;color:${textDark}!important}
      .aap-thinking{display:flex;align-items:center;gap:10px;color:#64748b;font-size:13px}
      .aap-think-label{opacity:.85}
      .aap-dots{display:inline-flex;gap:4px;align-items:center}
      .aap-dots i{width:6px;height:6px;border-radius:50%;background:#94a3b8;display:inline-block;animation:aap-bounce 1.2s infinite ease-in-out}
      .aap-dots i:nth-child(2){animation-delay:.15s}
      .aap-dots i:nth-child(3){animation-delay:.3s}
      @keyframes aap-bounce{0%,80%,100%{transform:translateY(0);opacity:.45}40%{transform:translateY(-4px);opacity:1}}
      .aap-streaming .aap-caret{display:inline-block;width:7px;height:1.05em;margin-left:2px;background:${blue};vertical-align:text-bottom;animation:aap-blink 1s step-end infinite}
      @keyframes aap-blink{50%{opacity:0}}
      .aap-actions{display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px;border-top:1px solid #e2e8f0;background:#f8fafc!important}
      .aap-root .aap-actions .aap-action-btn{border:1px solid ${blue}!important;background:${blueLight}!important;color:${blueDark}!important;border-radius:999px;padding:6px 12px;font-size:12px!important;font-weight:600!important;cursor:pointer;line-height:1.3;-webkit-text-fill-color:${blueDark}!important}
      .aap-root .aap-actions .aap-action-btn:hover{background:#d4e8f2!important;color:${blueDarker}!important;-webkit-text-fill-color:${blueDarker}!important}
      .aap-form{display:flex;gap:8px;padding:10px;border-top:1px solid #e2e8f0;background:#fff!important}
      .aap-root .aap-form input{flex:1;border:1px solid #cbd5e1!important;border-radius:10px;padding:10px;background:#fff!important;color:${textDark}!important;font-size:14px!important;-webkit-text-fill-color:${textDark}!important}
      .aap-root .aap-form input::placeholder{color:#94a3b8!important;opacity:1!important;-webkit-text-fill-color:#94a3b8!important}
      .aap-root .aap-form button{background:${blue}!important;color:#fff!important;border:0!important;border-radius:10px;padding:0 14px;cursor:pointer;font-size:14px;font-weight:600;min-width:56px}
      .aap-root .aap-form button:disabled{opacity:.6;cursor:not-allowed}
      `,
    ]);
    document.head.appendChild(style);

    const log = el('div', { className: 'aap-log' });
    const actionsBar = el('div', { className: 'aap-actions' });
    const setActions = (actions: Array<{ id: string; label: string; url?: string }>) => {
      renderActions(actionsBar, actions, log, setActions);
    };

    let open = false;
    const closeBtn = el('button', {
      type: 'button',
      className: 'aap-close',
      'aria-label': 'Close chat',
    }, ['×']) as HTMLButtonElement;

    const panel = el('div', { className: 'aap-panel' }, [
      el('div', { className: 'aap-header' }, [
        el('span', { className: 'aap-header-title' }, [cfg.name]),
        closeBtn,
      ]),
      log,
      actionsBar,
    ]);

    renderActions(actionsBar, adaptActionsForAuth(cfg.actions), log, setActions);

    const input = el('input', { type: 'text', placeholder: 'Type a message…' }) as HTMLInputElement;
    input.style.setProperty('background', '#ffffff', 'important');
    input.style.setProperty('color', '#0f172a', 'important');
    const sendBtn = el('button', { type: 'button' }, ['Send']) as HTMLButtonElement;
    sendBtn.style.setProperty('background', 'rgb(3,74,118)', 'important');
    sendBtn.style.setProperty('color', '#ffffff', 'important');
    const form = el('div', { className: 'aap-form' }, [input, sendBtn]);
    panel.appendChild(form);

    const launcher = el('button', { className: 'aap-launcher', type: 'button' }, [
      cfg.theme.launcherLabel || 'Chat',
    ]);
    const setOpen = (next: boolean) => {
      open = next;
      panel.classList.toggle('open', open);
    };
    closeBtn.addEventListener('click', () => setOpen(false));
    launcher.addEventListener('click', () => {
      setOpen(!open);
      if (open && log.childNodes.length === 0) {
        void typeAssistantMessage(log, cfg.welcome);
        void ensureSession();
      }
    });

    const submit = () => {
      const text = input.value.trim();
      if (!text || input.disabled) return;
      input.value = '';
      input.disabled = true;
      sendBtn.setAttribute('disabled', 'true');
      void sendMessage(text, undefined, log, setActions)
        .catch(async (err: Error) => {
          await typeAssistantMessage(log, err.message || 'Something went wrong.');
        })
        .finally(() => {
          input.disabled = false;
          sendBtn.removeAttribute('disabled');
          input.focus();
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
