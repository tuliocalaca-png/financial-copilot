import { FastifyInstance } from "fastify";
import { resolveInboundMessage } from "../services/inbound-resolution.service";
import { sendWhatsAppMessage } from "../integrations/whatsapp.client";
import { formatSpendingResponse, formatDailyLimitResponse, formatForecastResponse } from "../services/openai.service";
import { fetchFinanceAggregate } from "../services/spending-query.service";
import { fetchTransactionDetails } from "../services/transaction-details.service";
import { resolvePeriod } from "../services/period-resolver.service";
import { handleBudgetCommand } from "../services/budget-settings.service";
import { getDailyLimitStatus } from "../services/daily-limit.service";
import { createPlannedTransaction, getPlannedTransactions } from "../services/planned-transaction.service";

export async function webhookRoutes(app: FastifyInstance) {
  app.post("/webhook", async (req, reply) => {
    const body: any = req.body;

    const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) {
      return reply.send({ ok: true });
    }

    const phone = message.from;
    const text = message.text?.body ?? "";

    const resolution = await resolveInboundMessage({
      phoneNumber: phone,
      messageText: text
    });

    // -------------------------
    // 💰 TRANSAÇÕES (já existente)
    // -------------------------
    if (resolution.kind === "transaction") {
      await sendWhatsAppMessage(phone, resolution.reply);
      return reply.send({ ok: true });
    }

    // -------------------------
    // 📊 CONSULTA DE GASTOS (já existente)
    // -------------------------
    if (resolution.kind === "spending_query") {
      const data = await fetchFinanceAggregate(
        phone,
        resolution.period.startUtc,
        resolution.period.endUtc
      );

      const details =
        resolution.detailLevel === "transaction"
          ? await fetchTransactionDetails(
              phone,
              resolution.period.startUtc,
              resolution.period.endUtc
            )
          : null;

      const text = formatSpendingResponse({
        periodLabel: resolution.period.label,
        aggregate: data,
        details,
        byCategory: resolution.byCategory
      });

      await sendWhatsAppMessage(phone, text);
      return reply.send({ ok: true });
    }

    // -------------------------
    // ⚙️ CONFIG (já existente)
    // -------------------------
    if (resolution.kind === "report_settings") {
      await sendWhatsAppMessage(phone, resolution.reply);
      return reply.send({ ok: true });
    }

    // =========================
    // 🆕 LIMITE DIÁRIO (SETTINGS)
    // =========================
    if (resolution.kind === "daily_limit_settings") {
      await sendWhatsAppMessage(phone, resolution.result.reply);
      return reply.send({ ok: true });
    }

    // =========================
    // 🆕 LIMITE DIÁRIO (QUERY)
    // =========================
    if (resolution.kind === "daily_limit_query") {
      const result = await getDailyLimitStatus(phone);

      const text = formatDailyLimitResponse(result);

      await sendWhatsAppMessage(phone, text);
      return reply.send({ ok: true });
    }

    // =========================
    // 🆕 LANÇAMENTO FUTURO
    // =========================
    if (resolution.kind === "planned_transaction") {
      await createPlannedTransaction(phone, resolution.transaction);

      await sendWhatsAppMessage(
        phone,
        `Anotei 📅 ${resolution.transaction.type === "income" ? "entrada" : "saída"} futura de R$ ${resolution.transaction.amount.toFixed(
          2
        )} para ${resolution.transaction.date}.`
      );

      return reply.send({ ok: true });
    }

    if (resolution.kind === "planned_transaction_missing_amount") {
      await sendWhatsAppMessage(phone, resolution.reply);
      return reply.send({ ok: true });
    }

    // =========================
    // 🆕 FORECAST (receber/pagar/saldo)
    // =========================
    if (resolution.kind === "forecast_query") {
      const planned = await getPlannedTransactions(
        phone,
        resolution.period.startUtc,
        resolution.period.endUtc
      );

      const text = formatForecastResponse({
        queryType: resolution.queryType,
        planned,
        periodLabel: resolution.period.label
      });

      await sendWhatsAppMessage(phone, text);
      return reply.send({ ok: true });
    }

    // -------------------------
    // 🤖 FALLBACK
    // -------------------------
    await sendWhatsAppMessage(
      phone,
      "Posso te ajudar com gastos, entradas e saldo 👍\n\nExemplos:\n• gastei 20 no almoço\n• recebi 500 no pix\n• quanto gastei hoje"
    );

    return reply.send({ ok: true });
  });
}