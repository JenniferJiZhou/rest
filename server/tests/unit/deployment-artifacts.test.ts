import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

describe("deployment artifacts", () => {
  it("defines a safe Zeabur OCI image pipeline", () => {
    const workflow = readFileSync(
      resolve(
        repositoryRoot,
        ".github/workflows/publish-staging-image.yml"
      ),
      "utf8"
    );
    const environment = readFileSync(
      resolve(repositoryRoot, "deploy/zeabur.env.example"),
      "utf8"
    );
    const document = parse(workflow) as {
      jobs: {
        build: {
          permissions: Record<string, string>;
          outputs: Record<string, string>;
        };
        publish: {
          if: string;
          needs: string;
          permissions: Record<string, string>;
        };
      };
    };
    const env = new Map(
      environment
        .trim()
        .split("\n")
        .map((line) => {
          const separator = line.indexOf("=");
          return [
            line.slice(0, separator),
            line.slice(separator + 1)
          ] as const;
        })
    );

    expect(workflow).toContain("ghcr.io/");
    expect(workflow).toContain("hush-server-staging");
    expect(workflow).toContain("docker/setup-buildx-action@");
    expect(workflow).toContain("docker/build-push-action@");
    expect(workflow).toContain("docker/login-action@");
    expect(workflow).toContain("load: true");
    expect(workflow).toContain("push: true");
    expect(workflow).toContain("docker buildx imagetools create");
    expect(workflow).toContain("GITHUB_SHA");
    expect(workflow).toContain("http://127.0.0.1:3000/v1/health");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("workflow_dispatch");
    expect(workflow).toContain("inputs.publish");
    expect(workflow).not.toContain("CLAUDE_API_KEY");
    expect(workflow).not.toContain("HUSH_DEMO_TOKEN");
    expect(workflow.toLowerCase()).not.toContain("clawcloud");
    expect(environment.toLowerCase()).not.toContain("clawcloud");
    expect(document.jobs.build.permissions).toEqual({
      contents: "read"
    });
    expect(document.jobs.build.outputs.image_name).toContain(
      "steps.image.outputs.name"
    );
    expect(document.jobs.publish.needs).toBe("build");
    expect(document.jobs.publish.if).toContain(
      "github.event_name == 'push'"
    );
    expect(document.jobs.publish.permissions).toEqual({
      contents: "read",
      packages: "write"
    });
    expect(env.get("NODE_ENV")).toBe("production");
    expect(env.get("HOST")).toBe("0.0.0.0");
    expect(env.get("TRUST_PROXY")).toBe("true");
    expect(env.get("PUBLIC_BASE_URL")).toMatch(/^https:\/\//u);
    expect(env.get("HUSH_REST_DECISION_PROVIDER")).toBe("canned");
    expect(env.get("HUSH_DEMO_MODE")).toBe("false");
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
      "contracts/fixtures/unified-inbox-items.json"
    );
    expect(dockerignore).toContain(
      "!contracts/fixtures/unified-inbox-items.json"
    );
    expect(dockerfile).toContain(
      'CMD ["node", "dist/bootstrap.js"]'
    );
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).toContain("http://127.0.0.1:3000/v1/health");
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
