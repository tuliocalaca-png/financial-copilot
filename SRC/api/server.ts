import Fastify from "fastify";
import { registerWhatsappWebhookRoute } from "./webhook.route";
import { registerCronRoutes } from "./cron.route";

export async function buildServer() {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ ok: true }));

  await registerWhatsappWebhookRoute(app);
  await registerCronRoutes(app);

  return app;
}