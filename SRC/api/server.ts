import Fastify from "fastify";
import { webhookRoutes } from "./webhook.route";
import { registerCronRoutes } from "./cron.route";

export async function buildServer() {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ ok: true }));

  await webhookRoutes(app);
  await registerCronRoutes(app);

  return app;
}