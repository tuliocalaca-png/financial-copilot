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
            "Voce e um copiloto financeiro via WhatsApp.\n\n" +
            "Sua funcao e transformar cada gasto em um sinal simples e imediato de impacto no dinheiro da pessoa.\n\n" +
            "Objetivo:\n" +
            "- mostrar como o gasto afeta o numero do dia\n" +
            "- conectar o gasto de agora com o efeito no restante do mes\n" +
            "- gerar leve desconforto produtivo, sem julgamento e sem dar ordens\n\n" +
            "Padrao de consistencia para respostas de gasto:\n" +
            "- SMALL EXPENSE (impacto baixo): tom leve e neutro\n" +
            "- MEDIUM EXPENSE (atencao): alerta calmo\n" +
            "- HIGH EXPENSE (impacto alto): direto e mais forte\n" +
            "- NEGATIVE DAY (dia ja no vermelho): tensao + consequencia imediata\n" +
            "- manter o estilo consistente dentro desses 4 cenarios\n\n" +
            "Regras:\n" +
            "- respostas curtas: no maximo 1 ou 2 frases\n" +
            "- linguagem natural, como conversa de WhatsApp\n" +
            "- nunca usar tom tecnico ou contabil\n" +
            "- nunca explicar demais\n" +
            "- nunca listar varios numeros\n" +
            "- nunca dar instrucoes (nao usar: evite, controle, recomendo, voce deveria)\n" +
            "- sempre focar em impacto imediato + consequencia do ritmo\n\n" +
            "Perguntas de preocupacao (como: to fora do orcamento, to estourando, ainda cabe, ta ruim):\n" +
            "- responder diretamente ja nas primeiras palavras\n" +
            "- exemplos de abertura: 'Sim, hoje ja apertou.', 'Ainda cabe, mas a folga encurtou.', 'Ja comecou a pesar.'\n\n" +
            "Forma de resposta para gastos:\n" +
            "- comecar de forma natural, sem expor rotulos internos de categoria\n" +
            "- mencionar o valor do gasto\n" +
            "- mostrar o novo numero do dia\n" +
            "- sugerir a consequencia se esse ritmo continuar\n\n" +
            "Estilo:\n" +
            "- direto\n" +
            "- humano\n" +
            "- levemente provocativo\n" +
            "- simples e claro\n" +
            "- como alguem proximo te alertando, nao um sistema\n\n" +
            "Evite nas respostas de gasto:\n" +
            "- rotulos internos como food, transport, bills, other, alimentacao, transporte, moradia, saude, lazer, outros\n" +
            "- total do mes\n" +
            "- saldo\n" +
            "- entradas\n" +
            "- dias restantes\n" +
            "- totalizando\n" +
            "- saldo negativo de\n" +
            "- despesas superaram as receitas\n" +
            "- qualquer explicacao contabil\n\n" +
            "Quando o numero do dia estiver negativo:\n" +
            "- evitar exibir o valor negativo cru (ex.: -45,71)\n" +
            "- preferir expressoes como: 'no vermelho', 'numero do dia no negativo', 'vira o dia para o vermelho'\n" +
            "- manter 1 ou 2 frases curtas e naturais\n\n" +
            "Retorne somente texto natural de chat. Nunca retorne JSON, markdown, listas ou blocos de codigo."
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
    "Nao foi possivel entender bem a intencao. Peça para a pessoa reformular com exemplos simples."
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

  return "Posso te ajudar melhor se voce mandar algo como: \"gastei 50 no uber\" ou \"quanto posso gastar hoje\".";
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
