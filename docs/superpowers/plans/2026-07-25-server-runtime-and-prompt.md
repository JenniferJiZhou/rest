# Server Runtime and Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the server runtime port fully environment-selected and migrate the valid local companion-agent rules into the current Contract 1.1 Dynamic Rest prompt.

**Architecture:** Keep `config.PORT` as the only listener-port source and make the container health probe read the same runtime environment value. Extend the existing TypeScript prompt builder and tests; do not load the stale Markdown prompt or change the Contract 1.1 output schema.

**Tech Stack:** Node.js 20.19.5, TypeScript 5.9, Fastify 5, Vitest 3, Docker/OCI, StepFun chat completions.

## Global Constraints

- Do not change `contracts/**` or add dependencies.
- Do not copy Contract 1.0 fixed-Quest output examples into Contract 1.1.
- Never put API keys, tokens, provider IDs, or private content in source or logs.
- Local default port remains `3000`; a supplied `PORT` must require no source or image-command change.
- Dynamic Rest still returns schema-validated `generated_task` for Contract 1.1 Mode A and Mode B.

---

### Task 1: PowerShell Smoke Transport Portability

**Files:**
- Modify: `scripts/smoke-dynamic-rest-decision.ps1`
- Modify: `scripts/smoke-https-staging.ps1`
- Test: `server/tests/integration/dynamic-rest-decision-smoke.test.ts`
- Test: `server/tests/integration/smoke-script.test.ts`

**Interfaces:**
- Consumes: loopback HTTP servers created by the existing Vitest suites.
- Produces: cookie-free `HttpClient` instances that behave consistently on Windows and sandboxed macOS PowerShell.

- [ ] **Step 1: Record the existing failing smoke tests**

Run: `pnpm --dir server vitest run tests/integration/dynamic-rest-decision-smoke.test.ts tests/integration/smoke-script.test.ts`

Expected on the affected macOS environment: five local-request cases FAIL because `System.Net.CookieContainer` throws `GetDomainName: -1`; argument-validation cases PASS.

- [ ] **Step 2: Disable unused cookie handling at client construction**

Replace each direct client construction with:

```powershell
$handler = [System.Net.Http.HttpClientHandler]::new()
$handler.UseCookies = $false
$client = [System.Net.Http.HttpClient]::new($handler)
```

Dispose both `$client` and `$handler` in the scripts' existing outer cleanup. Do not alter URL validation, headers, payloads, timeout behavior, or response assertions.

- [ ] **Step 3: Re-run both smoke suites**

Run: `pnpm --dir server vitest run tests/integration/dynamic-rest-decision-smoke.test.ts tests/integration/smoke-script.test.ts`

Expected: 12/12 tests PASS.

- [ ] **Step 4: Commit the cross-platform transport fix**

```bash
git add scripts/smoke-dynamic-rest-decision.ps1 scripts/smoke-https-staging.ps1
git commit -m "fix(smoke): disable unused PowerShell cookies"
```

---

### Task 2: Contract 1.1 Companion Prompt Rules

**Files:**
- Modify: `server/tests/unit/rest-decision-prompt.test.ts`
- Modify: `server/src/agent/rest-decision/dynamic-rest-decision-prompt.ts`

**Interfaces:**
- Consumes: `DYNAMIC_REST_DECISION_SYSTEM_PROMPT: string`
- Produces: versioned prompt text retaining `generatedTask` and the current JSON schema contract.

- [ ] **Step 1: Add failing behavioral assertions**

Add assertions to the Dynamic Rest test:

```ts
for (const rule of [
  "not a productivity coach, therapist, doctor, evaluator, or cheerleader",
  "Use only facts present in the input",
  "Never invent work duration",
  "Do not diagnose",
  "Do not praise endurance or romanticize overwork",
  "Prefer one or two short sentences",
  "do not ask whether the user wants to rest"
]) {
  expect(DYNAMIC_REST_DECISION_SYSTEM_PROMPT).toContain(rule);
}
expect(DYNAMIC_REST_DECISION_SYSTEM_PROMPT).toContain("generatedTask");
expect(DYNAMIC_REST_DECISION_SYSTEM_PROMPT).not.toContain("defaultQuestId");
expect(DYNAMIC_REST_DECISION_SYSTEM_PROMPT).not.toContain("allowedQuestIds");
```

- [ ] **Step 2: Verify the new assertions fail**

Run: `pnpm --dir server vitest run tests/unit/rest-decision-prompt.test.ts`

Expected: FAIL on the first newly required behavioral phrase.

- [ ] **Step 3: Update the current TypeScript system prompt**

Add concise sections to `DYNAMIC_REST_DECISION_SYSTEM_PROMPT` using the exact tested phrases. Keep the existing Mode A decision policy and append this manual-rest distinction:

```text
For user-initiated Mode B, the user has already chosen to rest. Briefly validate
that choice, do not analyze work metrics, and do not ask whether the user wants
to rest. Return the schema-selected generatedTask, never a fixed Quest ID.
```

Do not add a runtime Markdown-file loader.

- [ ] **Step 4: Run focused and provider tests**

Run: `pnpm --dir server vitest run tests/unit/rest-decision-prompt.test.ts tests/provider-contracts/dynamic-rest-decision-provider.test.ts tests/provider-contracts/stepfun-rest-decision-client.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit the prompt migration**

```bash
git add server/src/agent/rest-decision/dynamic-rest-decision-prompt.ts server/tests/unit/rest-decision-prompt.test.ts
git commit -m "feat(rest): align dynamic prompt with companion voice"
```

---

### Task 3: Environment-selected Container Health Port

**Files:**
- Modify: `server/tests/unit/deployment-artifacts.test.ts`
- Modify: `Dockerfile`
- Modify: `docs/18_ZEABUR_STAGING_DEPLOYMENT.md`
- Modify: `deploy/zeabur.env.example`

**Interfaces:**
- Consumes: runtime `PORT`, defaulting to `3000` through `server/src/config.ts`.
- Produces: a listener and health probe that target the same runtime port.

- [ ] **Step 1: Replace fixed-port artifact expectations with failing dynamic-port expectations**

```ts
expect(dockerfile).not.toContain("EXPOSE 3000");
expect(dockerfile).toContain("process.env.PORT ?? '3000'");
expect(dockerfile).not.toContain("http://127.0.0.1:3000/v1/health");
expect(environment).toContain("# PORT=3000");
```

Retain the workflow's explicit CI smoke port assertion: CI deliberately starts its container on `3000`.

- [ ] **Step 2: Verify the artifact test fails**

Run: `pnpm --dir server vitest run tests/unit/deployment-artifacts.test.ts`

Expected: FAIL because the Dockerfile still contains `EXPOSE 3000` and a fixed health URL.

- [ ] **Step 3: Make the Docker health probe read runtime `PORT`**

Remove `EXPOSE 3000` and use this exec-form probe:

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "-e", "const port = process.env.PORT ?? '3000'; fetch(`http://127.0.0.1:${port}/v1/health`).then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]
```

The server listener already consumes `config.PORT`; do not duplicate port parsing in `bootstrap.ts`.

- [ ] **Step 4: Document operator-set and platform-set ports**

Add `# PORT=3000` to `deploy/zeabur.env.example`. Update the Zeabur runbook to state that `PORT` may be injected by the platform or set by the operator, and the same image follows it without rebuild. Remove instructions requiring a domain binding specifically to container port 3000.

- [ ] **Step 5: Run deployment tests**

Run: `pnpm --dir server test:deployment`

Expected: all deployment/config/smoke tests PASS.

- [ ] **Step 6: Commit the port change**

```bash
git add Dockerfile deploy/zeabur.env.example docs/18_ZEABUR_STAGING_DEPLOYMENT.md server/tests/unit/deployment-artifacts.test.ts
git commit -m "fix(deploy): follow runtime server port"
```

---

### Task 4: Server Regression and Runtime Smoke

**Files:**
- Verify only; no expected source changes.

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: evidence that canned mode works without credentials and real providers remain environment-configurable.

- [ ] **Step 1: Run the complete server gate**

Run: `pnpm --dir server check`

Expected: typecheck, all Vitest suites, and build PASS.

- [ ] **Step 2: Start the built server on a non-default port**

Run:

```bash
HOST=127.0.0.1 PORT=3100 NODE_ENV=test \
PUBLIC_BASE_URL=http://127.0.0.1:3100 LOG_LEVEL=silent \
pnpm --dir server start
```

Expected: log reports port `3100`; `GET http://127.0.0.1:3100/v1/health` returns `200`.

- [ ] **Step 3: Exercise canned Dynamic Rest**

Run the existing `scripts/smoke-dynamic-rest-decision.ps1` against port `3100`, or issue its Contract 1.1 fixture request with the same headers.

Expected: valid Contract 1.1 JSON; no StepFun key is required in canned mode.

- [ ] **Step 4: Record the server verification**

Add the exact commands and results to the final handoff; do not commit generated logs.
