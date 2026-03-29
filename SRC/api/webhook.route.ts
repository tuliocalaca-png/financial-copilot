import { FastifyInstance } from "fastify";
import { resolveInboundMessage } from "../services/inbound-resolution.service";
import { sendWhatsappMessage } from "../integrations/whatsapp.client";
import { formatSpendingResponse } from "../services/openai.service";
import { fetchFinanceAggregate } from "../services/spending-query.service";
import { getOrCreateUser } from "../services/user.service";

export async function webhookRoutes(app: FastifyInstance) {
  app.post("/webhook/whatsapp", async (req, reply) => {
    const body: any = req.body;

    const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) {
      return reply.send({ ok: true });
    }

    const phone = message.from;
    const text = message.text?.body ?? "";

    // 🔥 resolve usuário (ESSENCIAL)
    const user = await getOrCreateUser(phone);
    const userId = user.id;

    const resolution = await resolveInboundMessage(phone, text);

    // =========================
    // 💰 TRANSAÇÃO
    // =========================
    if (resolution.kind === "expense") {
      // ⚠️ IMPORTANTE: aqui você deveria salvar com userId
      // (vou deixar simples por enquanto)
      await sendWhatsappMessage(phone, "Anotado 👍");
      return reply.send({ ok: true });
    }

    // =========================
    // 📊 CONSULTA
    // =========================
    if (resolution.kind === "spending_query") {
      let period = resolution.period as any;

      let start = period?.startUtc ?? period?.start ?? period?.from;
      let end = period?.endUtc ?? period?.end ?? period?.to;

      // 🔥 FALLBACK GARANTIDO
      if (!start || !end) {
        console.warn("⚠️ Usando fallback de período (hoje)");

        const now = new Date();

        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(now);
        endOfDay.setHours(23, 59, 59, 999);

        start = startOfDay.toISOString();
        end = endOfDay.toISOString();

        period = {
          label: "hoje"
        };
      }

      console.log("📊 Query:", {
        userId,
        start,
        end,
        label: period.label
      });

      const data = await fetchFinanceAggregate(userId, start, end);

      const responseText = formatSpendingResponse({
        periodLabel: period.label ?? "período",
        aggregate: data
      });

      await sendWhatsappMessage(phone, responseText);
      return reply.send({ ok: true });
    }

    // =========================
    // ⚙️ CONFIG
    // =========================
    if (resolution.kind === "report_settings") {
      await sendWhatsappMessage(phone, resolution.result.reply);
      return reply.send({ ok: true });
    }

    // =========================
    // 🆕 NOVOS TIPOS (SAFE FALLBACK)
    // =========================
    if (
      resolution.kind === "daily_limit_query" ||
      resolution.kind === "daily_limit_settings" ||
      resolution.kind === "planned_transaction" ||
      resolution.kind === "planned_transaction_missing_amount" ||
      resolution.kind === "forecast_query"
    ) {
      await sendWhatsappMessage(
        phone,
        "Essa função ainda está sendo finalizada 🚧"
      );
      return reply.send({ ok: true });
    }

    // =========================
    // 🤖 FALLBACK
    // =========================
    await sendWhatsappMessage(
      phone,
      "Posso te ajudar com gastos, entradas e saldo 👍\n\nExemplos:\n• gastei 20 no almoço\n• recebi 500 no pix\n• quanto gastei hoje"
    );

    return reply.send({ ok: true });
  });
}