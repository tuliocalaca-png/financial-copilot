import { FastifyInstance } from "fastify";
import { config } from "../core/config";
import { sendWhatsappMessage } from "../integrations/whatsapp.client";
import { generateAssistantReply } from "../services/openai.service";
import {
  resolveInboundMessage,
  type InboundResolution
} from "../services/inbound-resolution.service";
import { fetchSpendingAggregate } from "../services/spending-query.service";
import { fetchSpendingTransactions } from "../services/transaction-details.service";
import { upsertReportSettings } from "../services/report-settings.service";
import { upsertQueryContext } from "../services/query-context.service";
import {
  getOrCreateUserByPhone,
  saveExpense,
  saveMessageEvent
} from "../services/persistence.service";

type IncomingMessage = {
  phoneNumber: string;
  messageText: string;
};

type ExtractedWebhookPayload = {
  incoming: IncomingMessage;
  messageId?: string;
};

const processedMessageIds = new Map<string, number>();
const PROCESSED_TTL_MS = 10 * 60 * 1000;

function cleanupProcessedMessageIds(): void {
  const now = Date.now();

  for (const [messageId, timestamp] of processedMessageIds.entries()) {
    if (now - timestamp > PROCESSED_TTL_MS) {
      processedMessageIds.delete(messageId);
    }
  }
}

function extractIncomingMessage(payload: unknown): ExtractedWebhookPayload | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const body = payload as Record<string, unknown>;

  const directMessage =
    typeof body.messageText === "string"
      ? body.messageText
      : typeof body.message === "string"
      ? body.message
      : typeof body.text === "string"
      ? body.text
      : null;

  const directPhone =
    typeof body.phoneNumber === "string"
      ? body.phoneNumber
      : typeof body.phone === "string"
      ? body.phone
      : typeof body.from === "string"
      ? body.from
      : null;

  const directMessageId =
    typeof body.messageId === "string"
      ? body.messageId
      : typeof body.id === "string"
      ? body.id
      : undefined;

  if (directMessage && directPhone) {
    return {
      incoming: {
        messageText: directMessage,
        phoneNumber: directPhone
      },
      messageId: directMessageId
    };
  }

  const entry = Array.isArray(body.entry) ? body.entry[0] : null;
  const changes =
    entry && typeof entry === "object"
      ? (entry as Record<string, unknown>).changes
      : null;
  const change = Array.isArray(changes) ? changes[0] : null;
  const value =
    change && typeof change === "object"
      ? (change as Record<string, unknown>).value
      : null;
  const messages =
    value && typeof value === "object"
      ? (value as Record<string, unknown>).messages
      : null;
  const messageItem = Array.isArray(messages) ? messages[0] : null;

  if (!messageItem || typeof messageItem !== "object") {
    return null;
  }

  const messageRecord = messageItem as Record<string, unknown>;
  const from = messageRecord.from;
  const messageId =
    typeof messageRecord.id === "string" ? messageRecord.id : undefined;

  const textObj = messageRecord.text;
  const textBody =
    textObj && typeof textObj === "object"
      ? (textObj as Record<string, unknown>).body
      : null;

  if (typeof from === "string" && typeof textBody === "string") {
    return {
      incoming: {
        phoneNumber: from,
        messageText: textBody
      },
      messageId
    };
  }

  return null;
}

function intentLabelFromResolution(resolution: InboundResolution): string {
  switch (resolution.kind) {
    case "report_settings":
      return "report_settings";
    case "spending_query":
      return "spending_query";
    case "expense":
      return "expense";
    case "multi_expense_warning":
      return "multi_expense_blocked";
    default:
      return "unknown";
  }
}

export async function registerWhatsappWebhookRoute(
  app: FastifyInstance
): Promise<void> {
  app.get("/webhook/whatsapp", async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;

    const mode = query["hub.mode"];
    const token = query["hub.verify_token"];
    const challenge = query["hub.challenge"];

    if (mode === "subscribe" && token === config.verifyToken) {
      return reply.type("text/plain").send(challenge ?? "");
    }

    return reply.status(403).send("Forbidden");
  });

  app.post("/webhook/whatsapp", async (request, reply) => {
    try {
      cleanupProcessedMessageIds();

      const extracted = extractIncomingMessage(request.body);

      if (!extracted) {
        return reply.status(200).send({ ok: true, ignored: true });
      }

      const { incoming, messageId } = extracted;

      if (messageId) {
        if (processedMessageIds.has(messageId)) {
          return reply.status(200).send({ ok: true, duplicate: true });
        }

        processedMessageIds.set(messageId, Date.now());
      }

      const userId = await getOrCreateUserByPhone(incoming.phoneNumber);
      const resolution = await resolveInboundMessage(userId, incoming.messageText);
      const intent = intentLabelFromResolution(resolution);

      await saveMessageEvent({
        userId,
        direction: "inbound",
        messageText: incoming.messageText,
        intent
      });

      let responseText: string;

      if (resolution.kind === "report_settings") {
        if (Object.keys(resolution.result.patch).length > 0) {
          await upsertReportSettings(userId, resolution.result.patch);
        }

        responseText = resolution.result.reply;
      } else if (resolution.kind === "spending_query") {
        const aggregate = await fetchSpendingAggregate(
          userId,
          resolution.period.rangeStartUtc,
          resolution.period.rangeEndUtc
        );

        const transactions =
          resolution.detailLevel === "transaction"
            ? await fetchSpendingTransactions(
                userId,
                resolution.period.rangeStartUtc,
                resolution.period.rangeEndUtc
              )
            : [];

        await upsertQueryContext(userId, {
          kind: "spending_period",
          periodStartUtc: resolution.period.rangeStartUtc,
          periodEndUtc: resolution.period.rangeEndUtc,
          periodLabel: resolution.period.label,
          byCategory: resolution.byCategory,
          detailLevel: resolution.detailLevel,
          source: "query"
        });

        responseText = await generateAssistantReply({
          variant: "spending",
          originalMessage: incoming.messageText,
          facts: {
            periodLabel: resolution.period.label,
            total: aggregate.total,
            transactionCount: aggregate.transactionCount,
            byCategory: aggregate.byCategory,
            detailLevel: resolution.detailLevel,
            byCategoryRequested: resolution.byCategory,
            transactions
          }
        });
      } else if (resolution.kind === "multi_expense_warning") {
        responseText =
          "Peguei que você mandou mais de um gasto 👀\n\nPra não errar, me manda um por vez 👍";
      } else if (resolution.kind === "expense") {
        await saveExpense(userId, resolution.parsed);

        responseText = await generateAssistantReply({
          variant: "expense",
          originalMessage: incoming.messageText,
          parsedExpense: resolution.parsed
        });
      } else {
        responseText = await generateAssistantReply({
          variant: "generic",
          originalMessage: incoming.messageText
        });
      }

      await sendWhatsappMessage(incoming.phoneNumber, responseText);

      await saveMessageEvent({
        userId,
        direction: "outbound",
        messageText: responseText,
        intent
      });

      return reply.status(200).send({ ok: true });
    } catch (error) {
      request.log.error(error);

      return reply.status(500).send({
        error: "Internal server error"
      });
    }
  });
}