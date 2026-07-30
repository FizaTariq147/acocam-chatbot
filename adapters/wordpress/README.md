# WordPress adapter — acocamtrading.ca



Thin plugin that loads the platform embed script. **No chat logic in WordPress.**



## Install on live site



1. Zip folder `adapters/wordpress/acocam-agent-embed/`

2. WordPress → Plugins → Add New → Upload → Activate

3. Settings → **Agent Embed**



## Production settings (example)



| Setting | Value |

|---------|--------|

| Enabled | ✓ |

| API base | `https://chat-api.acocamtrading.ca/v1` |

| Embed script URL | `https://chat-api.acocamtrading.ca/embed/agent-embed.js` |

| Tenant | `acocam` |

| Agent ID | `customer-support` |

| Publishable key | `pk_live_...` (from server `.env`) |

| Customer JWT storage key | `token` (match login localStorage on your site) |



## Logged-in users



When a customer is logged in on acocamtrading.ca, the widget reads their JWT from `localStorage` using the key above so they can **Book shipment** instead of quote-only.



## Notes



- Chatbot API must be deployed separately (see `docs/GO_LIVE.md`)

- Logistics API (tracking/quotes) is a third server — not WordPress

- Do not commit live keys to git


