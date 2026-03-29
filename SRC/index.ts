import "dotenv/config";
import { buildServer } from "./api/server";
import { config } from "./core/config";
import { startReportScheduler } from "./services/report-scheduler.service";

async function main(): Promise<void> {
  const server = await buildServer();

  startReportScheduler();

  await server.listen({
    host: "0.0.0.0",
    port: config.port
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});