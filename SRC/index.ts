import { buildServer } from "./api/server";
import { config } from "./core/config";

async function start() {
  const server = await buildServer();

  await server.listen({
    port: config.port,
    host: "0.0.0.0"
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
