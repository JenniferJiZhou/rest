# Zeabur HTTPS Staging Deployment

Status: deployed and HTTPS smoke-tested.

HTTPS staging URL:
`https://hush-server-staging.preview.aliyun-zeabur.cn`

Current immutable image:
`ghcr.io/simon-byte-png/hush-server-staging:1938cc88d062ef3ece2547b384ec6085dbf7a20b`

The current instance uses an existing ZeaburOS server in Alibaba Cloud
Hangzhou. Creating this service did not add a payment method, but the existing
server is separate from Zeabur's hosted Free Plan and can have its own renewal
cost. The generated mainland-China preview domain required the account owner
to complete identity verification; no identity data is stored in this
repository.

## Why Zeabur

The current deployment does not use Zeabur's hosted Free Plan as container
runtime. It uses the existing ZeaburOS server recorded above. A Zeabur account
can stay on the Free Plan without adding a payment method, but the runtime
server is separate and can have its own renewal cost.

New Zeabur projects must select an existing Server, buy a Server, or bind an
external Server. Shared-cluster projects are deprecated and cannot be used as
a new free container target. This runbook therefore assumes that a suitable
Server already exists before project creation.

Zeabur can deploy a prebuilt public Docker/OCI image, inject environment
variables, expose the image port, issue a managed address, and manage HTTPS
automatically. Hosted regions commonly use `*.zeabur.app`. The current
mainland-China ZeaburOS server issued
`*.preview.aliyun-zeabur.cn` after identity verification. Hush already ships a
repository-root multi-stage `Dockerfile`, so the Apple API and Contract do not
need to change.

Authoritative platform references:

- [Free Plan](https://zeabur.com/docs/en-US/pricing/free-plan)
- [Create Project and select a Server](https://zeabur.com/docs/en-US/deploy/create/create-project)
- [Shared Cluster deprecation](https://zeabur.com/docs/en-US/server/shared-cluster)
- [Create Service](https://zeabur.com/docs/en-US/deploy/create/create-service)
- [Dockerfile deployments](https://zeabur.com/docs/en-US/deploy/methods/dockerfile)
- [GitHub integration](https://zeabur.com/docs/en-US/deploy/methods/github-integration)
- [Quick Start and managed HTTPS](https://zeabur.com/docs/en-US/get-started/quick-start)
- [Template format](https://zeabur.com/docs/en-US/template/template-format)

The deployment boundary is:

```text
GitHub commit
  -> GitHub Actions builds and smoke-tests the repository-root Dockerfile
  -> immutable OCI image in GitHub Container Registry (GHCR)
  -> Zeabur pulls the public immutable image
  -> container port 3000
  -> Zeabur-managed public HTTPS address
  -> Apple clients
```

The checked-in source of truth is the `Dockerfile`,
`.github/workflows/publish-staging-image.yml`, and
`deploy/zeabur.env.example`. Zeabur receives no GitHub repository token.

## Why use a prebuilt image

Zeabur also supports building directly from GitHub. Staging deliberately uses
a prebuilt public GHCR image instead:

- GitHub Actions runs the same image check before any cloud rollout;
- Zeabur receives no permission to read the repository;
- a full Git commit SHA identifies every deployed image;
- rollback changes only the image SHA;
- the same artifact can move to another Docker-compatible provider.

This follows the same `PREBUILT` image boundary used by Zeabur templates
instead of inventing a provider-specific build system.

## Container image publication

The `HTTPS Staging Image` GitHub Actions workflow:

- builds the repository-root Dockerfile on pull requests;
- uses the maintained Docker Buildx and Build Push GitHub Actions;
- starts the built image and checks `/v1/health`;
- publishes automatically after a relevant push to `main`;
- allows an explicit manual immutable-SHA publication for staging bootstrap;
- never publishes a pull-request event automatically;
- tags every published image with the full Git commit SHA;
- updates the convenience `main` tag only from a `main` push;
- authenticates to GHCR with the job-scoped `GITHUB_TOKEN`;
- never stores a registry token in GitHub source or Zeabur.

Published image name:

```text
ghcr.io/simon-byte-png/hush-server-staging:<full-git-commit-sha>
```

Deploy the immutable SHA tag. Do not configure Zeabur to follow the moving
`main` tag when recording a release or rollback point.

For an initial staging bootstrap before the deployment PR is merged, run the
workflow manually on the reviewed branch with `publish=true`. This publishes
only that branch commit's immutable SHA tag. It does not move the `main` tag.
After merge, use the image created by the `main` workflow run.

GitHub Container Registry may create the first package as private. After the
first publication, open the package settings and change its visibility to
**Public**. Confirm anonymous access before creating the Zeabur service:

```bash
docker pull \
  ghcr.io/simon-byte-png/hush-server-staging:<full-git-commit-sha>
```

The repository is public and the image contains only repository code and
synthetic fixtures. Do not put a GitHub Personal Access Token in Zeabur. If
anonymous pull cannot be enabled, stop instead of reusing a personal token.

## Image contents and runtime

Build context must remain the repository root. The image includes:

- `server/dist`;
- production `server/node_modules`;
- `content/rest-quests.json`;
- `contracts/fixtures/mail-items-demo.json`;
- `contracts/fixtures/unified-inbox-items.json`.

The runtime image uses Node 20.19.5, runs as the non-root `node` user, exposes
port 3000, defines an image-level `/v1/health` check, and starts with:

```text
node dist/bootstrap.js
```

Zeabur must use the image `CMD`; do not add a custom build or start command.

## Zeabur service configuration

Create one Zeabur project and add a **Docker Image** service:

| Setting | Value |
|---|---|
| Project | `hush-staging` |
| Service | `hush-server-staging` |
| Image | `ghcr.io/simon-byte-png/hush-server-staging:<full-git-commit-sha>` |
| Container port | `3000` |
| Replicas | `1` |
| Domain | Platform-managed domain for the selected server/region |
| Storage | None |
| Start command | Leave blank; use image `CMD` |

Keep one replica. Jobs, idempotency claims, draft state, and the Canned
decision cache are process-local; multiple replicas would partition them.

The current deployment uses an existing ZeaburOS server and does not rely on
hosted Free Plan auto-sleep behavior. After an image update or restart, call
`/v1/health` until it returns HTTP 200 before a Demo, then run the full smoke
test. Do not treat an initial image pull or cold request as an Agent timeout
measurement.

For a mainland-China ZeaburOS server, Zeabur shows a compliance notice before
public-domain binding. The account owner must complete the required identity
verification. Never put identity details in source, logs, or a support
message.

## Environment variables

Generate the Zeabur domain first. Copy `deploy/zeabur.env.example`, use the
exact root HTTPS origin, and enter:

```text
NODE_ENV=production
HOST=0.0.0.0
TRUST_PROXY=true
PUBLIC_BASE_URL=https://hush-server-staging.preview.aliyun-zeabur.cn
HUSH_REST_DECISION_PROVIDER=canned
HUSH_DEMO_MODE=false
LOG_LEVEL=info
```

`PUBLIC_BASE_URL` must contain only the HTTPS origin. It must not contain an
API path, query, fragment, username, password, or trailing application path.

Do not set `PORT`. The image listens on port 3000 and declares `EXPOSE 3000`.
The Zeabur domain must be bound to that port.

`TRUST_PROXY=true` is required because Zeabur terminates TLS before forwarding
internal HTTP to Fastify. It lets Fastify recognize the forwarded HTTPS
protocol and emit HSTS.

This staging configuration selects the normal Canned graph:

- no Demo Token is required;
- `/v1/rest/evaluate` is deterministic;
- `X-Hush-Data-Origin: mock` truthfully identifies the result;
- no Claude or OpenAI key is required;
- no email or external message is sent.

Contract 1.1 StepFun Real deployment uses the same service and requires the
following values in Zeabur's secret/config store:

```text
HUSH_REST_DECISION_PROVIDER=real
STEPFUN_API_KEY=<secret>
STEPFUN_BASE_URL=https://api.stepfun.com/v1
STEPFUN_MODEL=<explicit account-enabled model>
STEPFUN_TIMEOUT_MS=30000
```

Do not infer model availability from the example in `.env.example`. Contract
1.0 Real still follows `docs/19_REAL_REST_DECISION_AGENT.md`; Contract 1.1
follows `docs/22_DYNAMIC_REST_TASK_CONTRACT_1_1.md`.

Never place `HUSH_DEMO_TOKEN`, model keys, OAuth tokens, Gmail/Photon
credentials, SMTP credentials, webhook secrets, or registry credentials in:

- the image;
- the workflow;
- the example environment file;
- GitHub source;
- logs;
- curl commands;
- an Apple binary.

## First deployment

Prerequisite: select an existing Server, buy a Server, or bind an external
Server before creating the project. A Free Plan account by itself is not
container runtime for a new project.

1. Run a reviewed `HTTPS Staging Image` workflow with `publish=true`.
2. Record the full commit SHA and image digest.
3. Make the GHCR package public and confirm an anonymous pull.
4. In Zeabur, create project `hush-staging`.
5. Add a Docker Image service using the immutable SHA image.
6. Leave the image command unchanged and expose port 3000.
7. Add the region-appropriate managed domain to port 3000.
8. Copy the final HTTPS origin into `PUBLIC_BASE_URL`.
9. Add the remaining Canned staging environment variables.
10. Redeploy and wait for the single service instance to be healthy.
11. Inspect logs before sending any request payload.

Logs must show the server listening on `0.0.0.0:3000`. They must not contain
request bodies, user-provided context labels, tokens, credentials, or full
URLs supplied by Apple.

After the deployment PR is merged, replace the bootstrap branch image with
the immutable image published from the merge commit on `main`.

## HTTPS and API verification

Set only the root origin:

```bash
BASE_URL="https://hush-server-staging.preview.aliyun-zeabur.cn"
curl -i "$BASE_URL/v1/health"
```

Expected:

- valid public TLS certificate;
- no certificate warning or redirect loop;
- HTTP 200;
- JSON with `status=ok`, `contract_version=1.0`, and provider-neutral
  `providers.rest_decision=ready|unavailable`;
- `X-Request-ID`;
- `X-Contract-Version: 1.0`;
- `X-Hush-Data-Origin`;
- baseline no-cache/security headers;
- `Strict-Transport-Security: max-age=31536000`.

Run the checked-in staging smoke tool:

```powershell
.\scripts\smoke-https-staging.ps1 `
  -BaseUrl "https://hush-server-staging.preview.aliyun-zeabur.cn" `
  -Mode Https `
  -ExpectedStatus 200 `
  -ExpectedDataOrigin mock
```

The script verifies health plus iOS App, Mac App, and Mac Website payloads.
It checks Contract headers, request ID echo, response schema, and actual data
origin. It never contacts a URL unless `BaseUrl` is explicitly supplied.

Give the Apple Owner only the root HTTPS Base URL:

```text
https://hush-server-staging.preview.aliyun-zeabur.cn
```

Do not append `/v1/rest/evaluate`; the Apple client appends the path.

## Local image verification

Build from the repository root:

```bash
docker build -t hush-server:zeabur-staging .
docker run --rm -p 3000:3000 \
  -e NODE_ENV=production \
  -e PUBLIC_BASE_URL=https://hush-staging.example.com \
  -e TRUST_PROXY=false \
  -e HUSH_REST_DECISION_PROVIDER=canned \
  -e HUSH_DEMO_MODE=false \
  hush-server:zeabur-staging
```

For this direct local HTTP check, keep `TRUST_PROXY=false`. The public Zeabur
instance must use `TRUST_PROXY=true`.

## Routine release and rollback

Normal release:

1. merge a reviewed PR to `main`;
2. wait for Server CI and `HTTPS Staging Image`;
3. record the merge commit SHA and image digest;
4. change the Zeabur service image to that immutable SHA;
5. wait for health and run the staging smoke test;
6. record the deployed SHA and HTTPS smoke result in the release handoff.

Rollback:

1. select the last known-good SHA;
2. change only the Zeabur image reference to that SHA tag;
3. keep the same public domain and environment;
4. redeploy;
5. confirm health and rerun the full staging smoke test.

Do not disable certificate validation, add an Apple ATS exception, or replace
the HTTPS origin with HTTP.

## Current staging verification

The service was verified on 2026-07-25 after the final
`PUBLIC_BASE_URL` update and restart:

- `GET /v1/health`: HTTP 200 with `status=ok` and Contract `1.0`;
- TLS: public ZeroSSL certificate, hostname match, verification result `0`;
- HTTP redirects once to HTTPS; HTTPS does not redirect;
- HSTS: `max-age=31536000`;
- `X-Request-ID` present;
- `X-Contract-Version: 1.0`;
- `X-Hush-Data-Origin: mock`;
- iOS App checkpoint: HTTP 200 and matching request ID;
- Mac App checkpoint: HTTP 200 and matching request ID;
- Mac Website checkpoint: HTTP 200 and matching request ID;
- all three decisions returned the required boolean, message, and
  `default_quest_id`.

The Rest Decision Provider is Canned/Mock. No Demo Token, model key, registry
credential, or `PORT` environment variable is configured.

After any restart or image update, verify health before using old Job IDs.
Process-local Jobs and idempotency state do not survive restarts.

This remains controlled staging infrastructure, not a complete production
security boundary. The Apple Contract has no formal client authentication.
Production authentication, abuse protection, rate limiting, durable state,
and multi-replica coordination require separate reviewed changes.
