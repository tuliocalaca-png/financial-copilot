import Fastify from "fastify";
import { registerCronRoutes } from "./cron.route";
import { registerWhatsappWebhookRoute } from "./webhook.route";

export async function buildServer() {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ ok: true }));

  await registerWhatsappWebhookRoute(app);
  await registerCronRoutes(app);

  return app;
}
