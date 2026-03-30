import { FastifyInstance } from "fastify";
import { resolveInboundMessage } from "../services/inbound-resolution.service";
import { sendWhatsappMessage } from "../integrations/whatsapp.client";
import {
  formatSpendingResponse,
  formatDailyLimitResponse,
  formatForecastResponse
} from "../services/openai.service";
import { fetchFinanceAggregate } from "../services/spending-query.service";
import {
  getOrCreateUserByPhone,
  saveExpense,
  saveMessageEvent
} from "../services/persistence.service";
import { upsertBudgetSettings } from "../services/budget-settings.service";
import { calculateDailyLimit } from "../services/daily-limit.service";
import {
  savePlannedTransaction,
  settlePlannedTransactionByKeyword,
  fetchPlannedForecastSummary
} from "../services/planned-transaction.service";

function brl(value: number): string {
  return `R$ ${value.toFixed(2).replace(".", ",")}`;
}

function dueDateLabel(isoDate: string): string {
  const parts = isoDate.split("-");
  if (parts.length < 3) return isoDate;
  return `${parts[2]}/${parts[1]}`;
}

type WhatsAppWebhookBody = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          from?: string;
          text?: {
            body?: string;
          };
        }>;
      };
    }>;
  }>;
};

export async function webhookRoutes(app: FastifyInstance) {
  app.post("/webhook/whatsapp", async (req, reply) => {
    try {
      const body = req.body as WhatsAppWebhookBody;

      const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

      if (!message?.from || !message?.text?.body) {
        return reply.send({ ok: true });
      }

      const phone = message.from;
      const text = message.text.body.trim();

      const userId = await getOrCreateUserByPhone(phone);
      const resolution = await resolveInboundMessage(userId, text);

      await saveMessageEvent({
        userId,
        direction: "inbound",
        messageText: text,
        intent: resolution.kind
      });

      // =========================
      // 💰 TRANSAÇÃO
      // =========================
      if (resolution.kind === "expense") {
        try {
          await saveExpense(userId, resolution.parsed);

          const amount = Number(resolution.parsed.amount ?? 0);
          const label = resolution.parsed.kind === "income" ? "entrada" : "gasto";

          await sendWhatsappMessage(
            phone,
            `Anotado 👍\n${label}: R$ ${amount.toFixed(2)}`
          );

          await saveMessageEvent({
            userId,
            direction: "outbound",
            messageText: `Anotado 👍\n${label}: R$ ${amount.toFixed(2)}`,
            intent: resolution.kind
          });
        } catch (err) {
          req.log.error(err);

          await sendWhatsappMessage(phone, "Erro ao registrar gasto 😕");

          await saveMessageEvent({
            userId,
            direction: "outbound",
            messageText: "Erro ao registrar gasto 😕",
            intent: resolution.kind
          });
        }

        return reply.send({ ok: true });
      }

      // =========================
      // 📊 CONSULTA
      // =========================
      if (resolution.kind === "spending_query") {
        let period = resolution.period as any;

        let start =
          period?.rangeStartUtc ??
          period?.startUtc ??
          period?.start ??
          period?.from;

        let end =
          period?.rangeEndUtc ??
          period?.endUtc ??
          period?.end ??
          period?.to;

        if (!start || !end) {
          req.log.warn({ period }, "Using fallback period: today");

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

        req.log.info({
          userId,
          start,
          end,
          label: period.label
        }, "Finance query");

        const aggregate = await fetchFinanceAggregate(userId, start, end);

        const responseText = formatSpendingResponse({
          periodLabel: period.label ?? "período",
          aggregate
        });

        await sendWhatsappMessage(phone, responseText);

        await saveMessageEvent({
          userId,
          direction: "outbound",
          messageText: responseText,
          intent: resolution.kind
        });

        return reply.send({ ok: true });
      }

      // =========================
      // ⚙️ CONFIG DE RELATÓRIO
      // =========================
      if (resolution.kind === "report_settings") {
        await sendWhatsappMessage(phone, resolution.result.reply);

        await saveMessageEvent({
          userId,
          direction: "outbound",
          messageText: resolution.result.reply,
          intent: resolution.kind
        });

        return reply.send({ ok: true });
      }

      // =========================
      // ⚙️ CONFIG DE ORÇAMENTO
      // =========================
      if (resolution.kind === "daily_limit_settings") {
        try {
          if (Object.keys(resolution.result.patch).length > 0) {
            await upsertBudgetSettings(userId, resolution.result.patch);
          }
        } catch (err) {
          req.log.error(err);
        }

        await sendWhatsappMessage(phone, resolution.result.reply);
        await saveMessageEvent({
          userId,
          direction: "outbound",
          messageText: resolution.result.reply,
          intent: resolution.kind
        });
        return reply.send({ ok: true });
      }

      // =========================
      // 💰 LIMITE DIÁRIO
      // =========================
      if (resolution.kind === "daily_limit_query") {
        try {
          const limitResult = await calculateDailyLimit(userId);
          const responseText = formatDailyLimitResponse(limitResult);

          await sendWhatsappMessage(phone, responseText);
          await saveMessageEvent({
            userId,
            direction: "outbound",
            messageText: responseText,
            intent: resolution.kind
          });
        } catch (err) {
          req.log.error(err);
          const errorText = "Não consegui calcular o limite agora 😕";
          await sendWhatsappMessage(phone, errorText);
          await saveMessageEvent({
            userId,
            direction: "outbound",
            messageText: errorText,
            intent: resolution.kind
          });
        }
        return reply.send({ ok: true });
      }

      // =========================
      // 📋 TRANSAÇÃO PLANEJADA — REGISTRO
      // =========================
      if (resolution.kind === "planned_transaction") {
        try {
          await savePlannedTransaction(userId, resolution.transaction);

          const kindLabel = resolution.transaction.kind === "income" ? "a receber" : "a pagar";
          const responseText =
            `Anotado 👍\n${resolution.transaction.description} — ${brl(resolution.transaction.amount)} (${kindLabel}, vence ${dueDateLabel(resolution.transaction.dueDate)})`;

          await sendWhatsappMessage(phone, responseText);
          await saveMessageEvent({
            userId,
            direction: "outbound",
            messageText: responseText,
            intent: resolution.kind
          });
        } catch (err) {
          req.log.error(err);
          const errorText = "Erro ao registrar o compromisso 😕";
          await sendWhatsappMessage(phone, errorText);
          await saveMessageEvent({
            userId,
            direction: "outbound",
            messageText: errorText,
            intent: resolution.kind
          });
        }
        return reply.send({ ok: true });
      }

      // =========================
      // 📋 TRANSAÇÃO PLANEJADA — VALOR FALTANDO
      // =========================
      if (resolution.kind === "planned_transaction_missing_amount") {
        await sendWhatsappMessage(phone, resolution.reply);
        await saveMessageEvent({
          userId,
          direction: "outbound",
          messageText: resolution.reply,
          intent: resolution.kind
        });
        return reply.send({ ok: true });
      }

      // =========================
      // ✅ BAIXA EM TRANSAÇÃO PLANEJADA
      // =========================
      if (resolution.kind === "planned_transaction_settle") {
        try {
          const { settled, description } = await settlePlannedTransactionByKeyword(
            userId,
            resolution.keyword,
            resolution.txKind
          );

          const responseText = settled
            ? `Marcado como ${resolution.txKind === "income" ? "recebido" : "pago"} ✅\n${description}`
            : `Não encontrei nenhum compromisso pendente com "${resolution.keyword}" 🤔\n\nVerifique com "quanto tenho a pagar esse mês".`;

          await sendWhatsappMessage(phone, responseText);
          await saveMessageEvent({
            userId,
            direction: "outbound",
            messageText: responseText,
            intent: resolution.kind
          });
        } catch (err) {
          req.log.error(err);
          const errorText = "Erro ao dar baixa no compromisso 😕";
          await sendWhatsappMessage(phone, errorText);
          await saveMessageEvent({
            userId,
            direction: "outbound",
            messageText: errorText,
            intent: resolution.kind
          });
        }
        return reply.send({ ok: true });
      }

      // =========================
      // 🔮 FORECAST
      // =========================
      if (resolution.kind === "forecast_query") {
        try {
          const { rangeStartUtc, rangeEndUtc, label } = resolution.period;

          // Para datas de planned_transactions usamos só a parte de data (YYYY-MM-DD)
          const startDate = rangeStartUtc.split("T")[0];
          const endDate = rangeEndUtc.split("T")[0];

          const forecastSummary = await fetchPlannedForecastSummary(userId, startDate, endDate);

          let realBalance: number | undefined;
          if (resolution.queryType === "projected_balance") {
            const realAggregate = await fetchFinanceAggregate(userId, rangeStartUtc, rangeEndUtc);
            realBalance = realAggregate.balance;
          }

          const allPlanned = [
            ...forecastSummary.receivables,
            ...forecastSummary.payables
          ];

          const responseText = formatForecastResponse({
            queryType: resolution.queryType,
            planned: allPlanned,
            periodLabel: label,
            realBalance
          });

          await sendWhatsappMessage(phone, responseText);
          await saveMessageEvent({
            userId,
            direction: "outbound",
            messageText: responseText,
            intent: resolution.kind
          });
        } catch (err) {
          req.log.error(err);
          const errorText = "Não consegui carregar a projeção agora 😕";
          await sendWhatsappMessage(phone, errorText);
          await saveMessageEvent({
            userId,
            direction: "outbound",
            messageText: errorText,
            intent: resolution.kind
          });
        }
        return reply.send({ ok: true });
      }

      // =========================
      // 🤖 FALLBACK
      // =========================
      const fallbackText =
        "Posso te ajudar com gastos, entradas e saldo 👍\n\nExemplos:\n• gastei 20 no almoço\n• recebi 500 no pix\n• quanto gastei hoje";

      await sendWhatsappMessage(phone, fallbackText);

      await saveMessageEvent({
        userId,
        direction: "outbound",
        messageText: fallbackText,
        intent: resolution.kind
      });

      return reply.send({ ok: true });
    } catch (err) {
      req.log.error(err);
      return reply.status(500).send({ ok: false });
    }
  });
}