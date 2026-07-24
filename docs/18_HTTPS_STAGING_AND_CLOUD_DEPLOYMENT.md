# HTTPS Staging and Cloud Deployment

Status: deployment-ready configuration; no cloud resource has been created.
HTTPS staging URL: pending

## Architecture

```text
Apple client
  -> HTTPS with normal certificate validation
Render / cloud load balancer / reverse proxy (TLS termination)
  -> internal HTTP
Fastify on HOST=0.0.0.0 and platform-supplied PORT
```

Fastify does not load a certificate or private key. `TRUST_PROXY=true` is
required behind the trusted platform proxy so Fastify can recognize
`X-Forwarded-Proto: https` and emit HSTS. Local defaults remain
`HOST=127.0.0.1` and `TRUST_PROXY=false`.

## Render Blueprint

Use the repository-root `render.yaml` in Render's **New > Blueprint** flow.
During initial creation, Render prompts for `PUBLIC_BASE_URL` because it is
declared with `sync: false`. Enter the final service origin, for example
`https://<service-name>.onrender.com`, with no API path, query, or fragment.

Blueprint settings:

| Setting | Value |
|---|---|
| Service | `hush-server-staging` |
| Type/runtime | Web / Node |
| Root Directory | repository root (`.`) |
| Build | Corepack; pnpm 9.15.9; frozen install; `pnpm build` |
| Start | `cd server && pnpm start` |
| Health | `/v1/health` |
| Node | 20.19.5 |
| pnpm | 9.15.9 |

The task's initial `rootDir: server` target is intentionally not used.
Current Hush runtime loads `content/rest-quests.json` and
`contracts/fixtures/mail-items-demo.json`. Render documents that files
outside a configured Root Directory are unavailable. Repository-root context
is therefore required until those assets are packaged inside the server.

For a manual Dashboard service, use the same settings:

```text
Root Directory: <leave blank / repository root>
Build Command: corepack enable && corepack prepare pnpm@9.15.9 --activate && cd server && pnpm install --frozen-lockfile && pnpm build
Start Command: cd server && pnpm start
Health Check Path: /v1/health
```

Required staging environment:

```text
NODE_VERSION=20.19.5
NODE_ENV=production
HOST=0.0.0.0
TRUST_PROXY=true
PUBLIC_BASE_URL=https://<deployed-origin>
HUSH_REST_DECISION_PROVIDER=canned
HUSH_DEMO_MODE=false
LOG_LEVEL=info
```

Do not set `PORT`; Render supplies it. Canned staging uses the normal graph
and needs no Demo Token. `X-Hush-Data-Origin: mock` truthfully identifies
the Canned Provider.

Failure injection:

```text
HUSH_REST_DECISION_PROVIDER=unavailable
```

This makes `/v1/rest/evaluate` return the existing safe HTTP 503 response.
Restore the intended Provider after the test. The implemented credentialed
Real mode uses:

```text
HUSH_REST_DECISION_PROVIDER=real
CLAUDE_API_KEY=<secret>
CLAUDE_BASE_URL=https://api.anthropic.com
REST_DECISION_MODEL=<deployment-selected-model>
REST_DECISION_TIMEOUT_MS=3500
```

`REST_DECISION_MODEL` falls back to `CLAUDE_MODEL`. Missing Real credentials
or model configuration selects Unavailable; runtime failure, timeout, and
invalid output never fall back to Canned. Keep these values in the platform
environment or secret store rather than `render.yaml`.

Secret values include `HUSH_DEMO_TOKEN`, model/API keys, OAuth tokens,
Gmail/Photon credentials, SMTP credentials, and webhook secrets. Enter them
only in the platform secret store when the selected staging mode requires
them. Never put them in `render.yaml`, `.env.example`, curl examples, logs,
or an Apple binary.

## First deploy and verification

1. Create the Blueprint or manual Web Service.
2. Enter `PUBLIC_BASE_URL` using the final Render HTTPS origin.
3. Confirm every environment value above and that `PORT` is absent.
4. Deploy the selected commit. Do not enable Demo Mode.
5. In Render, open the service's **Events** for build/deploy state and
   **Logs** for startup/request metadata. Logs must not contain request
   bodies, context labels, or credentials.
6. Verify:

```bash
BASE_URL="https://<deployed-origin>"
curl -i "$BASE_URL/v1/health"
```

Expected: HTTP 200, JSON
`{"status":"ok","contract_version":"1.0"}`, Contract headers, baseline
no-cache/security headers, and HSTS.

Then run the checked-in smoke tool:

```powershell
.\scripts\smoke-https-staging.ps1 `
  -BaseUrl "https://<deployed-origin>" `
  -Mode Https `
  -ExpectedStatus 200 `
  -ExpectedDataOrigin mock
```

The script verifies health plus iOS, Mac App, and Mac Website evaluate
payloads. It never contacts a URL unless `BaseUrl` is explicitly supplied.
`LocalHttp` mode is only local functional testing and is not HTTPS proof.

Give the Apple Owner only the root HTTPS Base URL:

```text
https://<deployed-origin>
```

Do not include `/v1/rest/evaluate`; current Swift code appends that path.

## Docker and other platforms

Build from repository root because the image explicitly copies the two
runtime resources:

```bash
docker build -t hush-server:staging .
docker run --rm -p 3000:3000 \
  -e PORT=3000 \
  -e PUBLIC_BASE_URL=https://hush-staging.example.com \
  -e TRUST_PROXY=false \
  hush-server:staging
```

The image uses Node 20.19.5, pnpm 9.15.9 during build, a multi-stage
production install, and the non-root `node` user. Its direct exec-form command
is `node dist/bootstrap.js`, so the process receives SIGTERM directly.
`HOST=0.0.0.0` is container-only. For a public platform proxy, set
`TRUST_PROXY=true`; for the direct local HTTP command above, keep it false.

Generic platform checklist:

- build with repository-root context;
- Node 20.19.5 and pnpm 9.15.9;
- frozen lockfile and `pnpm build`;
- runtime `HOST=0.0.0.0` and platform-injected `PORT`;
- explicit public HTTPS `PUBLIC_BASE_URL`;
- `TRUST_PROXY=true` only behind the trusted platform proxy;
- TLS termination and valid public certificate at the platform edge;
- health path `/v1/health`;
- Canned normal graph for HTTPS-only controlled staging, or explicitly
  configured Real normal graph for credentialed Agent staging;
- secret store for credentials;
- SIGTERM grace period long enough for Fastify `close()`.

## Rollback and operations

To roll back, select the last known-good deploy in Render and redeploy it;
then confirm health and run the smoke script. Keep `PUBLIC_BASE_URL` aligned
with the active public origin. Do not use an HTTP origin, disable certificate
validation, or add an ATS exception.

Custom domains are configured at the platform edge. Wait for certificate
issuance, change `PUBLIC_BASE_URL` to the custom HTTPS origin, redeploy, and
repeat smoke verification before handing the URL to Apple.

This setup is controlled staging/Demo infrastructure, not a complete
production security boundary. The current Apple Contract has no formal
client identity authentication. Production authentication, abuse
protection, and rate limiting require a separate Contract Change.

Jobs and idempotency state are in process memory. Restarting or scaling to
multiple instances loses or partitions that state. Free instances may sleep
or cold-start; the current Apple Rest Decision request timeout is 5 seconds,
so a cold start can safely result in no new reminder. No latency guarantee is
made.
