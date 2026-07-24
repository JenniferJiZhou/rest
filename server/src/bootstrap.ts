import { pathToFileURL } from "node:url";
import type { FastifyInstance } from "fastify";
import {
  UnavailableRestDecisionProvider
} from "./agent/rest-decision-providers.js";
import { createServer } from "./api/create-server.js";
import { buildServerDependencies } from "./composition.js";
import { loadConfig } from "./config.js";

export function createApplicationServer(
  environment: NodeJS.ProcessEnv = process.env
): FastifyInstance {
  const config = loadConfig(environment);
  const normalRestDecisionProvider =
    config.HUSH_REST_DECISION_PROVIDER === "unavailable"
      ? new UnavailableRestDecisionProvider()
      : undefined;
  return createServer(
    buildServerDependencies(config, {
      ...(normalRestDecisionProvider
        ? { normalRestDecisionProvider }
        : {})
    })
  );
}

export function createShutdownHandler(
  server: Pick<FastifyInstance, "close" | "log">,
  exit: (code: number) => void = process.exit
): (signal: "SIGINT" | "SIGTERM") => Promise<void> {
  let shutdown: Promise<void> | undefined;
  return async (signal) => {
    shutdown ??= (async () => {
      server.log.info({ signal }, "shutting down");
      try {
        await server.close();
        exit(0);
      } catch (error) {
        server.log.error(
          { signal, errorType: errorName(error) },
          "shutdown failed"
        );
        exit(1);
      }
    })();
    await shutdown;
  };
}

async function run(): Promise<void> {
  const server = createApplicationServer();
  const shutdown = createShutdownHandler(server);
  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  try {
    const config = loadConfig();
    await server.listen({
      host: config.HOST,
      port: config.PORT
    });
    server.log.info(
      { host: config.HOST, port: config.PORT },
      "server listening"
    );
  } catch (error) {
    server.log.error(
      { errorType: errorName(error) },
      "server startup failed"
    );
    process.exit(1);
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  pathToFileURL(entrypoint).href === import.meta.url
) {
  await run();
}
