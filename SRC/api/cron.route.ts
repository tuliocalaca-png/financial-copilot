import { FastifyInstance } from "fastify";
import { config } from "../core/config";
import { runScheduledReportsTick } from "../services/report-scheduler.service";

function extractCronSecret(request: any): string | null {
  const header = request.headers["x-cron-secret"];
  const auth = request.headers.authorization;

  if (typeof header === "string" && header) {
    return header;
  }

  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length);
  }

  return null;
}

export async function registerCronRoutes(app: FastifyInstance): Promise<void> {
  app.post("/internal/cron/reports", async (request, reply) => {
    if (!config.cronSecret) {
      return reply.status(503).send({
        error: "Cron desativado: defina CRON_SECRET"
      });
    }

    const provided = extractCronSecret(request);

    if (!provided || provided !== config.cronSecret) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const startedAt = Date.now();

    try {
      await runScheduledReportsTick();

      const durationMs = Date.now() - startedAt;

      request.log.info(
        { durationMs },
        "Cron reports executed successfully"
      );

      return reply.send({
        ok: true,
        durationMs
      });
    } catch (error) {
      request.log.error(error, "Cron reports failed");

      return reply.status(500).send({
        error: "Cron execution failed"
      });
    }
  });
}
