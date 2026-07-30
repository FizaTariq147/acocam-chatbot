# Embed & App Integration



## Script embed (any website)



```html

<script

  src="http://localhost:8787/embed/agent-embed.js"

  data-tenant="acocam"

  data-agent="customer-support"

  data-key="pk_acocam_demo"

  data-api="http://localhost:8787/v1">

</script>

```



The script loads public config (branding/welcome), creates a session, and renders a floating chat widget.



## REST (mobile / custom apps)



Base URL: `http://localhost:8787/v1`



```http

Authorization: Bearer pk_acocam_demo

```



1. `POST /tenants/acocam/agents/customer-support/sessions`

2. `POST /tenants/acocam/agents/customer-support/sessions/{id}/messages`  

   Body: `{ "message": "Hello", "actionId": null, "customerAuthToken": null }`

3. `POST .../reset` or `POST .../escalate` as needed

4. `GET .../config/public` for theme without starting a chat



## WordPress



Install `adapters/wordpress/agent-platform-embed` and set API URL, tenant, agent, and publishable key in settings. The plugin prints the embed script in `wp_footer`.



## Streaming (optional)



`GET .../sessions/{id}/stream?message=hello` returns `text/event-stream` with a single `token` event (full reply). Pass `customerAuthToken` as a query param when the user is signed in.


