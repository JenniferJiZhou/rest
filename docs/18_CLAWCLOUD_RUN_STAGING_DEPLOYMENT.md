# ClawCloud Run HTTPS Staging Deployment

Status: deployment-ready container pipeline; no ClawCloud application has
been created yet.

HTTPS staging URL: pending

## Why this path is viable

ClawCloud Run App Launchpad accepts public or private Docker/OCI images,
supports a configurable container port and environment variables, and
provides a public address with managed HTTPS. Hush already has a
repository-root multi-stage `Dockerfile`, so no application or Contract
change is required.

Authoritative platform references:

- [Deploy from Docker](https://docs.run.claw.cloud/clawcloud-run/getting-started/deploy-from-docker)
- [App Launchpad](https://docs.run.claw.cloud/clawcloud-run/guide/app-launchpad)
- [Environment variables](https://docs.run.claw.cloud/clawcloud-run/guide/app-launchpad/environment-variables)
- [HTTPS and container FAQ](https://docs.run.claw.cloud/clawcloud-run/guide/app-launchpad/frequently-asked-questions)
- [Free-plan limits](https://docs.run.claw.cloud/clawcloud-run/pricing)

ClawCloud does not consume a repository deployment manifest. Its deployment
boundary is:

```text
GitHub main commit
  -> GitHub Actions builds the repository-root Dockerfile
  -> immutable OCI image in GitHub Container Registry (GHCR)
  -> ClawCloud Run App Launchpad pulls that image
  -> container port 3000
  -> ClawCloud public HTTPS address
  -> Apple clients
```

The checked-in source of truth is therefore the `Dockerfile`,
`.github/workflows/publish-clawcloud-image.yml`, and
`deploy/clawcloud-run.env.example`. There is intentionally no invented
ClawCloud YAML file that the platform cannot import.

## Container image publication

The `ClawCloud Staging Image` GitHub Actions workflow:

- builds the repository-root Dockerfile on pull requests;
- starts the built image and checks `/v1/health`;
- publishes only from `main`;
- tags each published image with the full Git commit SHA;
- also updates the convenience tag `main`;
- authenticates to GHCR with the job-scoped `GITHUB_TOKEN`;
- never stores a registry token in the repository or ClawCloud.

Published image name:

```text
ghcr.io/simon-byte-png/hush-server-staging:<full-git-commit-sha>
```

Deploy the immutable SHA tag to ClawCloud. Do not deploy the moving `main`
tag when recording a staging release or rollback point.

GitHub Container Registry creates the first package as private by default.
After the first successful publication, open the package settings and change
its visibility to **Public**. This lets ClawCloud pull the image without a
GitHub username, Personal Access Token, or registry password. Confirm
anonymous access before deployment:

```bash
docker pull \
  ghcr.io/simon-byte-png/hush-server-staging:<full-git-commit-sha>
```

Do not put a GitHub token in ClawCloud. If the image cannot be made public,
stop and obtain an approved read-only package credential through the project
Owner rather than reusing a personal repository token.

## Image contents and runtime

Build context must remain the repository root. The image includes:

- `server/dist`;
- production `server/node_modules`;
- `content/rest-quests.json`;
- `contracts/fixtures/mail-items-demo.json`.

The runtime image uses Node 20.19.5, runs as the non-root `node` user,
exposes port 3000, defines an image-level `/v1/health` check, and starts with
the direct exec-form command:

```text
node dist/bootstrap.js
```

No ClawCloud build command or start command is required. App Launchpad pulls
and runs the already-built image.

## App Launchpad configuration

Use **App Launchpad > Create App** with these values:

| Setting | Value |
|---|---|
| Application name | `hush-server-staging` |
| Image source | Public |
| Image | `ghcr.io/simon-byte-png/hush-server-staging:<full-git-commit-sha>` |
| Deployment mode | Fixed |
| Replicas | `1` |
| CPU | `0.2` vCPU |
| Memory | `256 MiB` |
| Container port | `3000` |
| Public network access | Enabled |
| Health path, when shown | `/v1/health` |
| Storage | None |
| Startup command | Leave blank; use image `CMD` |

Keep one replica. Jobs, idempotency claims, draft state, and the Canned
decision cache are process-local; multiple replicas would partition them.

Choose a Free availability zone close to the Apple testers when the console
offers one. Free availability zones have no SLA and are suitable only for
controlled staging and Demo use.

## Environment variables

In App Launchpad, choose the public hostname before pasting environment
variables. Copy `deploy/clawcloud-run.env.example`, replace the
`PUBLIC_BASE_URL` placeholder with that exact root HTTPS origin, and paste
the lines into the environment-variable editor:

```text
NODE_ENV=production
HOST=0.0.0.0
TRUST_PROXY=true
PUBLIC_BASE_URL=https://<clawcloud-public-address>
HUSH_REST_DECISION_PROVIDER=canned
HUSH_DEMO_MODE=false
LOG_LEVEL=info
```

`PUBLIC_BASE_URL` must contain only the HTTPS origin. It must not contain an
API path, query, fragment, username, password, or trailing application path.

Do not set `PORT`. The Hush image listens on its default port 3000, while
App Launchpad's network configuration maps public HTTPS to container port
3000.

`TRUST_PROXY=true` is required because ClawCloud terminates TLS before
forwarding internal HTTP to Fastify. It allows Fastify to recognize the
forwarded HTTPS protocol and emit HSTS.

This staging configuration selects the normal Canned graph:

- no Demo Token is required;
- `/v1/rest/evaluate` is deterministic;
- `X-Hush-Data-Origin: mock` truthfully identifies the result;
- no Claude or OpenAI key is required;
- no email or external message is sent.

Real Provider deployment is outside this staging path. If it is approved
later, follow `docs/19_REAL_REST_DECISION_AGENT.md` and enter credentials
only in the platform secret store.

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

1. Merge a green PR to `main`.
2. Confirm the `ClawCloud Staging Image` workflow completed for that commit.
3. Record the full commit SHA and the published image digest.
4. Make the GHCR package public and confirm an anonymous pull.
5. In ClawCloud Run, open **App Launchpad > Create App**.
6. Enter the immutable image and runtime settings above.
7. Enable public access on container port 3000.
8. Copy the final public HTTPS origin into `PUBLIC_BASE_URL`.
9. Paste the remaining Canned staging environment.
10. Deploy and wait until the single instance is running and healthy.
11. Inspect instance logs before sending any request payload.

Logs must show the server listening on `0.0.0.0:3000`. They must not contain
request bodies, user-provided context labels, tokens, credentials, or full
URLs supplied by Apple.

## HTTPS and API verification

Set only the root origin:

```bash
BASE_URL="https://<clawcloud-public-address>"
curl -i "$BASE_URL/v1/health"
```

Expected:

- valid public TLS certificate;
- no certificate warning or redirect loop;
- HTTP 200;
- JSON `{"status":"ok","contract_version":"1.0"}`;
- `X-Request-ID`;
- `X-Contract-Version: 1.0`;
- `X-Hush-Data-Origin`;
- baseline no-cache/security headers;
- `Strict-Transport-Security: max-age=31536000`.

Run the checked-in staging smoke tool:

```powershell
.\scripts\smoke-https-staging.ps1 `
  -BaseUrl "https://<clawcloud-public-address>" `
  -Mode Https `
  -ExpectedStatus 200 `
  -ExpectedDataOrigin mock
```

The script verifies health plus iOS App, Mac App, and Mac Website payloads.
It checks the Contract headers, request ID echo, response schema, and actual
data origin. It never contacts a URL unless `BaseUrl` is explicitly supplied.

Give the Apple Owner only the root HTTPS Base URL:

```text
https://<clawcloud-public-address>
```

Do not append `/v1/rest/evaluate`; the Apple client appends the path.

## Local image verification

Build from the repository root:

```bash
docker build -t hush-server:clawcloud-staging .
docker run --rm -p 3000:3000 \
  -e NODE_ENV=production \
  -e PUBLIC_BASE_URL=https://hush-staging.example.com \
  -e TRUST_PROXY=false \
  -e HUSH_REST_DECISION_PROVIDER=canned \
  -e HUSH_DEMO_MODE=false \
  hush-server:clawcloud-staging
```

For this direct local HTTP check, keep `TRUST_PROXY=false`. The public
ClawCloud instance must use `TRUST_PROXY=true`.

## Rollback and operations

Every published image has an immutable full-SHA tag. To roll back:

1. select the last known-good SHA;
2. update the App Launchpad image to that SHA tag;
3. keep the same public address and environment;
4. deploy the update;
5. confirm health and rerun the full staging smoke test.

Do not disable certificate validation, add an Apple ATS exception, or replace
the HTTPS origin with HTTP.

After any restart or image update, verify health before using old Job IDs.
Process-local Jobs and idempotency state do not survive restarts.

The Free plan is sufficient for a small Canned Demo, but it has no SLA.
Instance availability, free credits, regions, quotas, and platform behavior
can change. Check the current ClawCloud console before the Demo and keep a
local recording as fallback.

This remains controlled staging infrastructure, not a complete production
security boundary. The Apple Contract has no formal client authentication.
Production authentication, abuse protection, rate limiting, durable state,
and multi-replica coordination require separate reviewed changes.
