import OpenAI from "openai";
import { config } from "../core/config";
import { DailyLimitResult, Intent, ParsedExpense } from "../core/types";

const openai = new OpenAI({ apiKey: config.openAiApiKey });

interface ResponseInput {
  intent: Intent;
  originalMessage: string;
  parsedExpense?: ParsedExpense;
  dailyLimit?: DailyLimitResult;
}

export async function generateAssistantReply(input: ResponseInput): Promise<string> {
  try {
    const completion = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "Você é um copiloto financeiro pessoal via WhatsApp.\n\n" +
            "Seu papel não é só registrar gastos. Você ajuda a pessoa a tomar decisões melhores no dia a dia, " +
            "como um parceiro inteligente, direto e útil (quase um CFO pessoal, sem formalidade).\n\n" +
            "Objetivo:\n" +
            "- registrar gastos sem fricção\n" +
            "- responder consultas de gasto (hoje, ontem, semana, período)\n" +
            "- ajudar em decisões tipo: 'posso gastar isso?', 'vale a pena?', 'to gastando muito?'\n" +
            "- criar consciência financeira sem ser chato ou burocrático\n\n" +
            "Comportamento:\n" +
            "- fale como humano no WhatsApp\n" +
            "- tom direto, inteligente e levemente provocador quando fizer sentido\n" +
            "- máximo 3–5 linhas\n" +
            "- pode usar emoji com moderação (👀 💸 👍)\n\n" +
            "Princípio central:\n" +
            "- interpretar intenção antes de exigir precisão\n" +
            "- ajudar, não bloquear\n\n" +
            "Regras críticas:\n" +
            "- NUNCA diga 'não entendi'\n" +
            "- NUNCA peça para reformular\n" +
            "- NUNCA seja robótico ou acadêmico\n" +
            "- NUNCA responda com JSON/markdown/listas técnicas\n\n" +
            "Intenções que você deve assumir mesmo com frase imperfeita:\n" +
            "- consulta de gasto: 'quanto gastei hoje', 'quanto gastei ontem', 'qnto gastei ontem', 'gastei quanto ontem?', 'meu total hoje', 'ontem deu quanto?'\n" +
            "- pergunta de decisão: 'posso gastar isso?', 'vale a pena comprar isso?', 'to gastando muito?'\n\n" +
            "Saudação esperada (oi/olá/e aí):\n" +
            "\"Oi! 👋\\nEu te ajudo a registrar gastos e entender pra onde seu dinheiro está indo.\\nEx: 'gastei 20 no almoço' ou 'quanto gastei hoje?'\"\n\n" +
            "Se não houver dados para consulta, seja útil:\n" +
            "\"Consigo te mostrar isso 👀\\nMas primeiro você precisa registrar alguns gastos.\\nEx: 'gastei 20 no almoço'\"\n\n" +
            "Quando houver gasto, confirme de forma simples e clara."
        },
        {
          role: "user",
          content: buildPrompt(input)
        }
      ]
    });

    const text = completion.output_text?.trim();
    if (text) {
      return enforceDailyLimitTone(text, input);
    }
  } catch (error) {
    console.error("OpenAI generation failed:", error);
  }

  return enforceDailyLimitTone(fallbackReply(input), input);
}

function buildPrompt(input: ResponseInput): string {
  if (input.intent === "expense" && input.parsedExpense) {
    const isConcern = hasConcernQuestion(input.originalMessage);
    const dailyLimitValue = input.dailyLimit?.dailyLimit;
    const amountTotal = input.parsedExpense.amount;
    const typeLabel = extractExpenseTypeLabel(input);
    const scenario = classifyExpenseScenario(amountTotal, input.dailyLimit);
    const statusAnswer =
      isConcern && input.dailyLimit ? concernOpening(input.originalMessage, input.dailyLimit.dailyLimit) : "";

    const numericCount = countNumericAmounts(input.originalMessage);
    const isMultipleAmounts = numericCount >= 2;

    const baseRules = [
      "Responda em 1 ou 2 frases curtas, em tom de WhatsApp.",
      "Nunca repita numeros que aparecem na mensagem do usuario; use somente o valor total R$ " +
        `${amountTotal.toFixed(2)} e o numero do dia (se estiver positivo).`,
      "Nunca comece com 'Gastou'. Comece com 'Esse' ou 'Esses'.",
      "Nao use tom de relatorio ou linguagem contabil.",
      "Nao cite rotulos internos de categoria."
    ];

    // Scenario 3: status question
    if (statusAnswer) {
      const day =
        dailyLimitValue != null && dailyLimitValue > 0
          ? `; seu número do dia fica em R$${dailyLimitValue.toFixed(0)}`
          : "";
      return [
        ...baseRules,
        `Primeiras palavras (nao altere): ${statusAnswer}`,
        `Responda exatamente com: "${statusAnswer} Esse ${typeLabel} de R$${amountTotal.toFixed(0)} mexe no seu dia${day}. Se continuar nesse ritmo, o mês aperta."`
      ].join("\n");
    }

    // Scenario 4: multiple amounts in the same message (mention only TOTAL)
    if (isMultipleAmounts && dailyLimitValue != null && dailyLimitValue > 0) {
      return [
        ...baseRules,
        `Responda exatamente com: "Esses R$${amountTotal.toFixed(0)} de uma vez já pesam no dia; seu número do dia fica em R$${dailyLimitValue.toFixed(0)}. Mantendo esse ritmo, o mês perde folga rápido."`
      ].join("\n");
    }

    // Scenario: NEGATIVE DAY
    if (dailyLimitValue != null && dailyLimitValue < 0) {
      return [
        ...baseRules,
        `Responda exatamente com: "Hoje você já está no vermelho. Esse ${typeLabel} de R$${amountTotal.toFixed(0)} só aumenta a pressão para fechar o mês."`
      ].join("\n");
    }

    // SMALL / MEDIUM positive dailyLimit
    if (dailyLimitValue != null && dailyLimitValue > 0) {
      if (scenario === "SMALL_EXPENSE") {
        return [
          ...baseRules,
          `Responda exatamente com: "Esse ${typeLabel} de R$${amountTotal.toFixed(0)} ainda quase não mexe no dia; seu número do dia fica em R$${dailyLimitValue.toFixed(0)}. O risco aparece quando esse tipo de saída vira rotina."`
        ].join("\n");
      }

      if (scenario === "MEDIUM_EXPENSE") {
        return [
          ...baseRules,
          `Responda exatamente com: "Esse ${typeLabel} de R$${amountTotal.toFixed(0)} já reduz um pouco sua folga; seu número do dia fica em R$${dailyLimitValue.toFixed(0)}. Repetindo esse ritmo, o mês começa a perder margem."`
        ].join("\n");
      }

      // HIGH_EXPENSE positive
      return [
        ...baseRules,
        `Responda exatamente com: "Esse ${typeLabel} de R$${amountTotal.toFixed(0)} puxa forte seu dia; seu número do dia fica em R$${dailyLimitValue.toFixed(0)}. Mantendo esse ritmo, o impacto no mês vem rápido."`
      ].join("\n");
    }

    // Fallback: keep output short and consistent
    return [
      ...baseRules,
      `Responda exatamente com: "Esse ${typeLabel} de R$${amountTotal.toFixed(0)} mexe no seu dia. Mantendo esse ritmo, o mês aperta."`
    ].join("\n");
  }

  if (input.intent === "daily_limit_query" && input.dailyLimit) {
    return [
      `Mensagem original: "${input.originalMessage}"`,
      "Responda em 1 ou 2 frases, em tom de WhatsApp, sem linguagem contabil e sem lista de numeros.",
      "Se houver pergunta de preocupacao, responda isso diretamente nas primeiras palavras.",
      `Numero do dia atual: R$ ${input.dailyLimit.dailyLimit.toFixed(2)}.`,
      "Conecte com a consequencia de manter esse ritmo no restante do mes."
    ].join("\n");
  }

  return [
    `Mensagem original: "${input.originalMessage}"`,
    isGreetingMessage(input.originalMessage)
      ? "Se o usuário estiver cumprimentando, responda com exatamente: \"Oi! 👋\\nEu te ajudo a registrar gastos e entender pra onde seu dinheiro está indo.\\nEx: 'gastei 20 no almoço' ou 'quanto gastei hoje?'\""
      : isSpendingConsultQuery(input.originalMessage)
        ? "O usuário está pedindo consulta de gasto (hoje/ontem/período). Responda como se entendeu perfeitamente, sem pedir reformulação. Se não houver dados, use: \"Consigo te mostrar isso 👀\\nMas primeiro você precisa registrar alguns gastos.\\nEx: 'gastei 20 no almoço'\""
        : isDecisionQuestion(input.originalMessage)
          ? "O usuário está pedindo ajuda de decisão. Responda de forma prática e com reflexão leve, sem ser genérico. Exemplo de estilo: \"Depende — isso é necessidade ou impulso? Se for recorrente, pesa mais do que parece 👀\""
          : "Não responda com \"não entendi\". Seja útil mesmo se a mensagem for vaga. Interprete intenção e sugira próximos passos curtos."
  ].join("\n");
}

function fallbackReply(input: ResponseInput): string {
  if (input.intent === "expense" && input.parsedExpense) {
    if (input.dailyLimit) {
      const opening = concernOpening(input.originalMessage, input.dailyLimit.dailyLimit);
      const prefix = opening ? `${opening} ` : "";
      const scenario = classifyExpenseScenario(input.parsedExpense.amount, input.dailyLimit);
      const typeLabel = extractExpenseTypeLabel(input);
      if (scenario === "NEGATIVE_DAY") {
        return `${prefix}Hoje voce ja esta no vermelho. Esse gasto so aumenta a pressao para fechar o mes.`;
      }
      if (scenario === "HIGH_EXPENSE") {
        return `${prefix}Esse ${typeLabel} de R$${input.parsedExpense.amount.toFixed(0)} puxa forte seu dia; seu número do dia fica em R$${input.dailyLimit.dailyLimit.toFixed(0)}. Mantendo esse ritmo, o impacto no mês vem rápido.`;
      }
      if (scenario === "MEDIUM_EXPENSE") {
        return `${prefix}Esse ${typeLabel} de R$${input.parsedExpense.amount.toFixed(0)} já reduz um pouco sua folga; seu número do dia vai para R$${input.dailyLimit.dailyLimit.toFixed(0)}. Repetindo esse ritmo, o mês começa a perder margem.`;
      }
      // SMALL_EXPENSE com dailyLimit positivo: mantenha o tom leve e humanizado.
      return `${prefix}Esse ${typeLabel} de R$${input.parsedExpense.amount.toFixed(0)} ainda quase não mexe no dia; seu número do dia fica em R$${input.dailyLimit.dailyLimit.toFixed(0)}. O risco aparece quando esse tipo de saída vira rotina.`;
    }
    return `Esse gasto de R$${input.parsedExpense.amount.toFixed(0)} ja pesa agora. No ritmo de agora, a folga do mes encurta mais cedo.`;
  }

  if (input.intent === "daily_limit_query" && input.dailyLimit) {
    const opening = concernOpening(input.originalMessage, input.dailyLimit.dailyLimit);
    const prefix = opening ? `${opening} ` : "";
    if (input.dailyLimit.dailyLimit < 0) {
      return `${prefix}Seu numero do dia ja esta no negativo; esse ritmo continua pesando no mes.`;
    }
    return `${prefix}Seu numero do dia agora esta em R$${input.dailyLimit.dailyLimit.toFixed(0)}; ` +
      `se esse ritmo continuar, a margem encurta rapido no resto do mes.`;
  }

  // Fallback para mensagens vagas/primeira interação.
  if (isGreetingMessage(input.originalMessage)) {
    return "Oi! 👋\nEu te ajudo a registrar gastos e entender pra onde seu dinheiro está indo.\nEx: 'gastei 20 no almoço' ou 'quanto gastei hoje?'";
  }
  if (isSpendingConsultQuery(input.originalMessage)) {
    return "Consigo te mostrar isso 👀\nMas primeiro você precisa registrar alguns gastos.\nEx: 'gastei 20 no almoço'";
  }
  if (isDecisionQuestion(input.originalMessage)) {
    return "Boa pergunta 👀\nIsso é necessidade ou impulso?\nSe virar padrão, pesa mais do que parece.";
  }
  return "Posso te ajudar! 💸\nMe diga o que você gastou (ex: 'gastei 20 no almoço') ou, se quiser, pergunte 'quanto gastei hoje?'.";
}

function hasConcernQuestion(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes("fora do orcamento") ||
    text.includes("fora do orçamento") ||
    text.includes("to estourando") ||
    text.includes("tô estourando") ||
    text.includes("ainda cabe") ||
    text.includes("ta ruim") ||
    text.includes("tá ruim")
  );
}

function isGreetingMessage(message: string): boolean {
  const text = (message || "").toLowerCase().trim();
  return (
    text === "oi" ||
    text === "olá" ||
    text === "ola" ||
    text === "e ai" ||
    text === "e aí" ||
    text === "eae" ||
    text === "e aí?" ||
    text === "oi!" ||
    text === "olá!" ||
    text === "ola!" ||
    text === "bom dia" ||
    text === "boa tarde" ||
    text === "boa noite"
  );
}

function isSpendingConsultQuery(message: string): boolean {
  const text = (message || "").toLowerCase();

  const hasQuanto = text.includes("quanto");
  const hasGastei = text.includes("gastei") || text.includes("gastou");
  const hasTotal = text.includes("meu total") || text.includes("total de") || text.includes("total");
  const hasFoi = text.includes("quanto foi");

  const hasHoje = text.includes("hoje");
  const hasOntem = text.includes("ontem");
  const hasSemana = text.includes("semana");
  const hasMes = text.includes("mes") || text.includes("mês");
  const hasPeriodo = text.includes("periodo") || text.includes("período");

  const hasAnyTime = hasHoje || hasOntem || hasSemana || hasMes || hasPeriodo;

  return (
    (hasQuanto && hasGastei && hasAnyTime) ||
    (hasFoi && (hasHoje || hasOntem)) ||
    (hasGastei && hasAnyTime) ||
    (hasTotal && (hasHoje || hasOntem || hasSemana || hasMes || hasPeriodo))
  );
}

function isDecisionQuestion(message: string): boolean {
  const text = (message || "").toLowerCase();
  return (
    text.includes("posso gastar isso") ||
    text.includes("vale a pena") ||
    text.includes("to gastando muito") ||
    text.includes("tô gastando muito") ||
    text.includes("isso cabe") ||
    text.includes("devo comprar")
  );
}

function concernOpening(message: string, dailyLimit: number): string {
  if (!hasConcernQuestion(message)) {
    return "";
  }
  if (dailyLimit < 0) {
    return "Sim, hoje voce ja esta fora da margem.";
  }
  if (dailyLimit < 80) {
    return "Ja comecou a apertar.";
  }
  return "Ainda cabe, mas a folga ficou curta.";
}

type ExpenseScenario = "SMALL_EXPENSE" | "MEDIUM_EXPENSE" | "HIGH_EXPENSE" | "NEGATIVE_DAY";

function classifyExpenseScenario(amount: number, dailyLimit?: DailyLimitResult): ExpenseScenario {
  if (dailyLimit && dailyLimit.dailyLimit < 0) {
    return "NEGATIVE_DAY";
  }
  if (!dailyLimit) {
    return "MEDIUM_EXPENSE";
  }

  const safeDailyLimit = Math.max(dailyLimit.dailyLimit, 0.01);
  const ratio = amount / safeDailyLimit;
  if (ratio <= 0.2) return "SMALL_EXPENSE";
  if (ratio <= 0.6) return "MEDIUM_EXPENSE";
  return "HIGH_EXPENSE";
}

function enforceDailyLimitTone(text: string, input: ResponseInput): string {
  if (!input.dailyLimit || (input.intent !== "expense" && input.intent !== "daily_limit_query")) {
    return text;
  }

  const dailyLimit = input.dailyLimit.dailyLimit;
  const normalized = text.toLowerCase();
  const hasNegativeWords =
    normalized.includes("vermelho") ||
    normalized.includes("negativo") ||
    normalized.includes("no vermelho") ||
    normalized.includes("no negativo");

  // SMALL expense with positive dailyLimit: always use a consistent, human WhatsApp-like pattern.
  if (input.intent === "expense" && input.parsedExpense && dailyLimit > 0) {
    const scenario = classifyExpenseScenario(input.parsedExpense.amount, input.dailyLimit);
    if (scenario === "SMALL_EXPENSE") {
      const label = extractExpenseTypeLabel(input);
      return `Esse ${label} de R$${input.parsedExpense.amount.toFixed(0)} ainda quase não mexe no dia; seu número do dia fica em R$${dailyLimit.toFixed(0)}. O risco aparece quando esse tipo de saída vira rotina.`;
    }
  }

  if (dailyLimit > 0 && hasNegativeWords) {
    return positiveToneFallback(input);
  }

  if (dailyLimit < 0 && !hasNegativeWords) {
    const base = text.endsWith(".") ? text : `${text}.`;
    return `Hoje voce ja esta no vermelho. ${base}`;
  }

  return text;
}

function positiveToneFallback(input: ResponseInput): string {
  const amount = input.parsedExpense?.amount;
  const dailyLimit = input.dailyLimit?.dailyLimit;
  const label = extractExpenseTypeLabel(input);

  if (!dailyLimit || amount == null) {
    return "Ainda cabe hoje, mas o ritmo pede atencao para o mes nao apertar.";
  }

  const ratio = amount / Math.max(dailyLimit, 0.01);
  if (ratio <= 0.2) {
    return `Esse ${label} de R$${amount.toFixed(0)} ainda quase não mexe no dia; seu número do dia fica em R$${dailyLimit.toFixed(0)}. O risco aparece quando esse tipo de saída vira rotina.`;
  }
  if (ratio <= 0.6) {
    return `Esse ${label} de R$${amount.toFixed(0)} já reduz um pouco sua folga de hoje; seu número do dia vai para R$${dailyLimit.toFixed(0)}. Repetindo esse ritmo, o mês começa a perder margem.`;
  }
  return `Esse ${label} de R$${amount.toFixed(0)} puxa forte seu dia agora; seu número do dia fica apertado em R$${dailyLimit.toFixed(0)}. Mantendo esse ritmo, o impacto no mês vem rápido.`;
}

function extractExpenseTypeLabel(input: ResponseInput): string {
  const original = (input.originalMessage || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (original.includes("ifood")) return "iFood";
  if (original.includes("uber")) return "Uber";
  if (original.includes("mercado") || original.includes("supermercado")) return "mercado";
  if (original.includes("restaurante")) return "restaurante";
  if (original.includes("barzinho") || original.includes("bar ")) return "barzinho";
  if (original.includes("cafe") || original.includes("cafezinho")) return "café";
  if (original.includes("delivery")) return "delivery";
  if (original.includes("almoco") || original.includes("almoço")) return "almoço";
  if (original.includes("lanche")) return "lanche";
  if (original.includes("jantar")) return "jantar";
  if (original.includes("taxi")) return "táxi";
  if (original.includes("onibus") || original.includes("ônibus")) return "ônibus";
  if (original.includes("metro") || original.includes("metrô")) return "metrô";
  if (original.includes("farmacia") || original.includes("farmácia")) return "farmácia";
  if (original.includes("consulta") || original.includes("medico") || original.includes("médico")) return "consulta";

  return "gasto";
}

function countNumericAmounts(text: string): number {
  const matches = text
    .toLowerCase()
    .match(/(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?/g);
  return matches ? matches.length : 0;
}
