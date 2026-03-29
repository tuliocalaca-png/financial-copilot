import { FastifyInstance } from "fastify";
import { resolveInboundMessage } from "../services/inbound-resolution.service";
import { sendWhatsappMessage } from "../integrations/whatsapp.client";
import { formatSpendingResponse } from "../services/openai.service";
import { fetchFinanceAggregate } from "../services/spending-query.service";

export async function webhookRoutes(app: FastifyInstance) {
  app.post("/webhook/whatsapp", async (req, reply) => {
    const body: any = req.body;

    const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) {
      return reply.send({ ok: true });
    }

    const phone = message.from;
    const text = message.text?.body ?? "";

    const resolution = await resolveInboundMessage(phone, text);

    // =========================
    // 💰 TRANSAÇÃO
    // =========================
    if (resolution.kind === "expense") {
      // aqui você provavelmente já tem persistência em outro lugar
      await sendWhatsappMessage(phone, "Anotado 👍");
      return reply.send({ ok: true });
    }

    // =========================
    // 📊 CONSULTA
    // =========================
    if (resolution.kind === "spending_query") {
      const period: any = resolution.period;

      const start = period.startUtc ?? period.start ?? period.from;
      const end = period.endUtc ?? period.end ?? period.to;
      
      if (!start || !end) {
        console.error("❌ Period inválido:", period);
      
        await sendWhatsappMessage(
          phone,
          "Não consegui entender o período 😕"
        );
      
        return reply.send({ ok: true });
      }
      
      const data = await fetchFinanceAggregate(phone, start, end);

      const text = formatSpendingResponse({
        periodLabel: period.label,
        aggregate: data
      });

      await sendWhatsappMessage(phone, text);
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