import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

describe("deployment artifacts", () => {
  it("defines a safe Render native Node staging service", () => {
    const document = parse(
      readFileSync(resolve(repositoryRoot, "render.yaml"), "utf8")
    ) as {
      services: Array<Record<string, unknown>>;
    };
    const service = document.services[0] as {
      type: string;
      runtime: string;
      rootDir: string;
      buildCommand: string;
      startCommand: string;
      healthCheckPath: string;
      envVars: Array<{ key: string; value?: string; sync?: boolean }>;
    };
    const env = new Map(
      service.envVars.map((item) => [item.key, item])
    );

    expect(service).toMatchObject({
      type: "web",
      runtime: "node",
      rootDir: ".",
      healthCheckPath: "/v1/health",
      startCommand: "cd server && pnpm start"
    });
    expect(service.buildCommand).toContain("corepack enable");
    expect(service.buildCommand).toContain("pnpm@9.15.9");
    expect(service.buildCommand).toContain(
      "pnpm install --frozen-lockfile"
    );
    expect(service.buildCommand).toContain("pnpm build");
    expect(env.get("NODE_VERSION")?.value).toBe("20.19.5");
    expect(env.get("HOST")?.value).toBe("0.0.0.0");
    expect(env.get("TRUST_PROXY")?.value).toBe("true");
    expect(env.get("PUBLIC_BASE_URL")?.sync).toBe(false);
    expect(env.has("PORT")).toBe(false);
    expect(env.has("HUSH_DEMO_TOKEN")).toBe(false);
    expect(env.has("CLAUDE_API_KEY")).toBe(false);
  });

  it("defines a multi-stage non-root production container", () => {
    const dockerfile = readFileSync(
      resolve(repositoryRoot, "Dockerfile"),
      "utf8"
    );
    const dockerignore = readFileSync(
      resolve(repositoryRoot, ".dockerignore"),
      "utf8"
    );

    expect(dockerfile).toContain("node:20.19.5");
    expect(dockerfile).toContain("pnpm@9.15.9");
    expect(dockerfile).toContain("pnpm install --frozen-lockfile");
    expect(dockerfile).toContain("USER node");
    expect(dockerfile).toContain(
      "content/rest-quests.json"
    );
    expect(dockerfile).toContain(
      "contracts/fixtures/mail-items-demo.json"
    );
    expect(dockerfile).toContain(
      'CMD ["node", "dist/bootstrap.js"]'
    );
    expect(dockerignore).toContain(".env");
    expect(dockerignore).toContain(".git");
    expect(dockerignore).toContain("*.pem");
    expect(dockerignore).toContain("*.key");
  });

  it("keeps Unified Inbox smoke opt-in and on the existing HTTPS origin", () => {
    const smoke = readFileSync(
      resolve(repositoryRoot, "scripts/smoke-unified-inbox.ps1"),
      "utf8"
    );

    expect(smoke).toContain("[string]$BaseUrl");
    expect(smoke).toContain("[switch]$AllowSimulatedSend");
    expect(smoke).toContain(
      "HTTPS smoke requires an https BaseUrl"
    );
    expect(smoke).toContain(
      "no network request was made"
    );
    expect(smoke).not.toContain(
      'BaseUrl = "https://'
    );
    expect(smoke).toContain(
      'delivery_mode -ne "simulated"'
    );
  });
});
