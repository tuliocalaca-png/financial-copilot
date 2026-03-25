import { FastifyInstance } from "fastify";
import { IncomingMessage } from "../core/types";
import { sendWhatsappMessage } from "../integrations/whatsapp.client";
import { calculateDailyLimit } from "../services/daily-limit.service";
import { parseExpense } from "../services/expense-parser.service";
import { detectIntent } from "../services/intent.service";
import { generateAssistantReply } from "../services/openai.service";
import {
  getOrCreateUserByPhone,
  saveExpense,
  saveMessageEvent
} from "../services/persistence.service";

function extractIncomingMessage(payload: unknown): IncomingMessage | null {
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

  if (directMessage && directPhone) {
    return { messageText: directMessage, phoneNumber: directPhone };
  }

  // WhatsApp Cloud API structure
  const entry = Array.isArray(body.entry) ? body.entry[0] : null;
  const changes = entry && typeof entry === "object" ? (entry as Record<string, unknown>).changes : null;
  const change = Array.isArray(changes) ? changes[0] : null;
  const value = change && typeof change === "object" ? (change as Record<string, unknown>).value : null;
  const messages = value && typeof value === "object" ? (value as Record<string, unknown>).messages : null;
  const messageItem = Array.isArray(messages) ? messages[0] : null;

  if (!messageItem || typeof messageItem !== "object") {
    return null;
  }

  const from = (messageItem as Record<string, unknown>).from;
  const textObj = (messageItem as Record<string, unknown>).text;
  const textBody =
    textObj && typeof textObj === "object" ? (textObj as Record<string, unknown>).body : null;

  if (typeof from === "string" && typeof textBody === "string") {
    return { phoneNumber: from, messageText: textBody };
  }

  return null;
}

export async function registerWhatsappWebhookRoute(app: FastifyInstance): Promise<void> {

  // ✅ VERIFICAÇÃO DO WEBHOOK (META)
  app.get("/webhook/whatsapp", async (request, reply) => {
    const query = request.query as any;

    const mode = query["hub.mode"];
    const token = query["hub.verify_token"];
    const challenge = query["hub.challenge"];

    if (mode === "subscribe" && token === "meu_token_123") {
      return reply.type("text/plain").send(challenge);
    }

    return reply.status(403).send("Forbidden");
  });

  // ✅ RECEBER MENSAGENS
  app.post("/webhook/whatsapp", async (request, reply) => {
    try {
      const incoming = extractIncomingMessage(request.body);

      if (!incoming) {
        return reply.status(400).send({
          error: "Invalid payload. Provide message text and phone number."
        });
      }

      const userId = await getOrCreateUserByPhone(incoming.phoneNumber);
      const intent = detectIntent(incoming.messageText);

      await saveMessageEvent({
        userId,
        direction: "inbound",
        messageText: incoming.messageText,
        intent
      });

      const parsedExpense =
        intent === "expense" ? parseExpense(incoming.messageText) : null;

      let dailyLimit:
        | Awaited<ReturnType<typeof calculateDailyLimit>>
        | undefined;

      if (intent === "expense" && parsedExpense) {
        await saveExpense(userId, parsedExpense);
        dailyLimit = await calculateDailyLimit(userId);
      } else if (intent === "daily_limit_query") {
        dailyLimit = await calculateDailyLimit(userId);
      }

      const responseText = await generateAssistantReply({
        intent,
        originalMessage: incoming.messageText,
        parsedExpense: parsedExpense ?? undefined,
        dailyLimit
      });

      await sendWhatsappMessage(incoming.phoneNumber, responseText);

      await saveMessageEvent({
        userId,
        direction: "outbound",
        messageText: responseText,
        intent
      });

      return reply.status(200).send({
        ok: true,
        intent,
        responseText,
        dailyLimitDebug: dailyLimit ?? null
      });

    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({
        error: "Internal server error"
      });
    }
  });
}