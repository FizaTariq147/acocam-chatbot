# Tenant Guide — Add a company in under 10 minutes

## 1. Copy the template

```bash
cp -r tenants/_template tenants/my-company
```

## 2. Edit `settings.json`

Set `tenantId`, `name`, agents, API keys (dev placeholders), thresholds, and feature flags.

## 3. Add knowledge

Place `.md` files under `tenants/my-company/knowledge/`.

## 4. Configure intents

Edit `intents/intents.json` — phrases, keywords, handler (`knowledge|workflow|tool|conversational|escalation|fallback`), priority.

## 5. Prompts & branding

- `prompts/system.md`, `prompts/style.md`, `prompts/safety.md`
- `branding/theme.json` — colors, position, welcome text

## 6. Optional workflows & tools

- `workflows/*.json` — multi-step collection
- `tools/*.json` — HTTP integrations
- `policies/escalation.json`, `policies/routing.json`

## 7. Reindex & embed

```bash
curl -X POST http://localhost:8787/v1/admin/tenants/my-company/knowledge/reindex \
  -H "Authorization: Bearer sk_my_company_secret"
```

```html
<script
  src="http://localhost:8787/embed.js"
  data-tenant="my-company"
  data-agent="customer-support"
  data-key="pk_my_company_public"
  data-api="http://localhost:8787/v1">
</script>
```

**Do not modify core packages** to add a company.
