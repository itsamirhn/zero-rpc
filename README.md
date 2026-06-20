# zero-rpc

Minimal reverse proxy for private RPC endpoints, on Cloudflare Workers.

Register a private RPC URL, pick a short public path for it, and optionally attach
headers (such as an API token) that get sent to the upstream on every request.
The admin page and every public path sit behind Cloudflare Access, so the private
URL and tokens stay hidden and only authorized callers get through.

Routes live in Workers KV. One private upstream per public path.

## Routes

- `GET /health` is open.
- `GET /` is the admin page to add, edit, and delete routes. Behind Access.
- `/<path>` proxies to the registered upstream, keeping method, body, path suffix,
  and query, and adding any stored headers. Behind Access.

The Worker checks that Cloudflare Access added its `Cf-Access-Jwt-Assertion`
header. Without the Access app set up, every path except `/health` returns 401.

## Setup

```bash
pnpm install
pnpm exec wrangler login
pnpm exec wrangler kv namespace create ROUTES   # paste the id into wrangler.jsonc
pnpm exec wrangler deploy
```

In the Cloudflare dashboard, go to Zero Trust > Access > Applications and add a
self-hosted app for your worker domain with path `*`. Add a policy that allows
your identity, plus an Access service token for machine callers. This one app
protects both the admin page and the public paths.

## Usage

Open `/`, add a route (a public path, a private URL, and optional headers), and
the public path becomes your guarded RPC endpoint.

Machine callers pass the service token:

```bash
curl -X POST https://<worker>/<path> \
  -H 'CF-Access-Client-Id: <id>' \
  -H 'CF-Access-Client-Secret: <secret>' \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
```

## CI

`.github/workflows/deploy.yml` deploys on push to `main`. Required repo secrets:
`CLOUDFLARE_API_TOKEN` (with `Workers Scripts:Edit`) and `CLOUDFLARE_ACCOUNT_ID`.

## Local development

```bash
pnpm exec wrangler dev
```

KV is simulated locally and there is no Access edge, so pass the header yourself:

```bash
H='Cf-Access-Jwt-Assertion: local'
curl -s -X PUT -H "$H" -H 'content-type: application/json' \
  -d '{"upstream":"<private-url>","headers":{"Authorization":"Bearer <token>"}}' \
  http://localhost:8787/_routes/<path>
curl -s -X POST -H "$H" http://localhost:8787/<path> \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
```
