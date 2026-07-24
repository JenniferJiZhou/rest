import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

describe("server toolchain certification config", () => {
  it("pins Node 20.19+ and pnpm 9 consistently", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(repositoryRoot, "server/package.json"), "utf8")
    ) as {
      packageManager: string;
      engines: { node: string; pnpm: string };
    };

    expect(packageJson.engines).toEqual({
      node: ">=20.19 <21",
      pnpm: ">=9 <10"
    });
    expect(packageJson.packageManager).toBe("pnpm@9.15.9");
    expect(
      readFileSync(resolve(repositoryRoot, ".nvmrc"), "utf8").trim()
    ).toMatch(/^20\.(?:19|[2-9]\d)\.\d+$/);
    expect(
      readFileSync(resolve(repositoryRoot, ".node-version"), "utf8").trim()
    ).toBe(
      readFileSync(resolve(repositoryRoot, ".nvmrc"), "utf8").trim()
    );
  });

  it("defines a no-secret frozen-lockfile server CI workflow", () => {
    const workflowPath = resolve(
      repositoryRoot,
      ".github/workflows/server-ci.yml"
    );
    const source = readFileSync(workflowPath, "utf8");
    const workflow = parse(source) as {
      on: { push: { branches: string[] }; pull_request: unknown };
    };

    expect(workflow.on.push.branches).toContain("main");
    expect(workflow.on).toHaveProperty("pull_request");
    expect(source).toContain("20.19");
    expect(source).toContain("pnpm@9.15.9");
    expect(source).toContain("pnpm install --frozen-lockfile");
    expect(source).toContain("pnpm typecheck");
    expect(source).toContain("pnpm test:providers");
    expect(source).toContain("pnpm test:integration");
    expect(source).toContain("pnpm test:vertical");
    expect(source).toContain("pnpm test");
    expect(source).toContain("pnpm build");
    expect(source).toContain("git diff --check");
    expect(source).toContain("pnpm-lock.yaml");
    expect(source).not.toMatch(
      /CLAUDE_API_KEY|GOOGLE_CLIENT_SECRET|PHOTON_API_KEY/
    );
  });
});
