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
  actions?: Array<{ id: string; label: string }>;
  escalate?: boolean;
};

(function () {
  const script = document.currentScript as HTMLScriptElement | null;
  if (!script) return;

  const tenant = script.getAttribute('data-tenant') || 'acocam';
  const agent = script.getAttribute('data-agent') || 'customer-support';
  const key = script.getAttribute('data-key') || '';
  const apiBase = (script.getAttribute('data-api') || '/v1').replace(/\/$/, '');

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
    const bubble = el('div', { className: `aap-bubble aap-${role}` }, [text]);
    log.appendChild(bubble);
    log.scrollTop = log.scrollHeight;
  }

  async function ensureSession() {
    if (sessionId) return;
    const created = await api<{ sessionId: string; welcome: string }>(
      `/tenants/${tenant}/agents/${agent}/sessions`,
      { method: 'POST', body: '{}' },
    );
    sessionId = created.sessionId;
  }

  async function sendMessage(text: string, actionId?: string, log?: HTMLElement) {
    await ensureSession();
    if (log && text) appendBubble(log, 'user', text);
    const result = await api<TurnResponse>(
      `/tenants/${tenant}/agents/${agent}/sessions/${sessionId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({ message: text || actionId, actionId }),
      },
    );
    if (log) appendBubble(log, 'assistant', result.message);
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
      .aap-bubble{max-width:85%;margin:8px 0;padding:10px 12px;border-radius:12px;white-space:pre-wrap;line-height:1.4;font-size:14px}
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
    const panel = el('div', { className: 'aap-panel' }, [
      el('div', { className: 'aap-header' }, [cfg.name]),
      log,
      el(
        'div',
        { className: 'aap-actions' },
        cfg.actions.map((a) => {
          const btn = el('button', { type: 'button' }, [a.label]);
          btn.addEventListener('click', () => {
            void sendMessage(a.label, a.id, log);
          });
          return btn;
        }),
      ),
    ]);

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
      void sendMessage(text, undefined, log).catch((err: Error) => {
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
