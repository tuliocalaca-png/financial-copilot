import { FastifyInstance } from "fastify";
import { IncomingMessage } from "../core/types";
import { sendWhatsappMessage } from "../integrations/whatsapp.client";
import { calculateDailyLimit } from "../services/daily-limit.service";
import { parseExpense } from "../services/expense-parser.service";
import { generateAssistantReply } from "../services/openai.service";
import {
  getOrCreateUserByPhone,
  saveExpense,
  saveMessageEvent
} from "../services/persistence.service";

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

  // formato simplificado (testes locais)
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

  // estrutura oficial WhatsApp Cloud API
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

export async function registerWhatsappWebhookRoute(
  app: FastifyInstance
): Promise<void> {

  // 🔹 Verificação do webhook (Meta)
  app.get("/webhook/whatsapp", async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;

    const mode = query["hub.mode"];
    const token = query["hub.verify_token"];
    const challenge = query["hub.challenge"];

    if (mode === "subscribe" && token === "meu_token_123") {
      return reply.type("text/plain").send(challenge ?? "");
    }

    return reply.status(403).send("Forbidden");
  });

  // 🔹 Receber mensagens
  app.post("/webhook/whatsapp", async (request, reply) => {
    try {
      cleanupProcessedMessageIds();

      const extracted = extractIncomingMessage(request.body);

      // ignora eventos que não são mensagem
      if (!extracted) {
        return reply.status(200).send({ ok: true, ignored: true });
      }

      const { incoming, messageId } = extracted;

      // 🔹 evita resposta duplicada (Meta envia duplicado às vezes)
      if (messageId) {
        if (processedMessageIds.has(messageId)) {
          return reply.status(200).send({ ok: true, duplicate: true });
        }

        processedMessageIds.set(messageId, Date.now());
      }

      const userId = await getOrCreateUserByPhone(incoming.phoneNumber);

      // 🚨 SEMPRE tenta parsear (não depende de intent)
      const parsedExpense = parseExpense(incoming.messageText);

      const intent = parsedExpense ? "expense" : "unknown";

      await saveMessageEvent({
        userId,
        direction: "inbound",
        messageText: incoming.messageText,
        intent
      });

      // 🚨 Só salva se parseou corretamente
      if (parsedExpense) {
        await saveExpense(userId, parsedExpense);
      }

      // 🚨 NÃO usamos dailyLimit na resposta (evita lixo)
      const responseText = await generateAssistantReply({
        intent,
        originalMessage: incoming.messageText,
        parsedExpense: parsedExpense ?? undefined
      });

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