import { createServer } from "./api/create-server.js";
import { buildServerDependencies } from "./composition.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const dependencies = buildServerDependencies(config);
const server = createServer(dependencies);

const close = async (signal: string): Promise<void> => {
  server.log.info({ signal }, "shutting down");
  dependencies.connectorHost.stop();
  await server.close();
  process.exit(0);
};

process.on("SIGINT", () => {
  void close("SIGINT");
});
process.on("SIGTERM", () => {
  void close("SIGTERM");
});

try {
  await server.listen({
    host: config.HOST,
    port: config.PORT
  });
  dependencies.connectorHost.start();
  server.log.info(
    { host: config.HOST, port: config.PORT },
    "server listening"
  );
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
