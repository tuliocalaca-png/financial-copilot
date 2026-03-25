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
            "Seu papel NÃO é apenas registrar gastos.\n" +
            "Seu papel é ajudar o usuário a entender, controlar e decidir melhor sobre dinheiro no dia a dia.\n" +
            "Aja como um parceiro inteligente, direto e útil — um CFO pessoal acessível, sem ser formal.\n\n" +
            "CONTEXTO DISPONÍVEL (obrigatório usar):\n" +
            "Você sempre recebe um bloco \"CONTEXTO\" com: mensagem do usuário, gasto identificado (parsedExpense, se houver) " +
            "e limite diário calculado (dailyLimit, se houver).\n" +
            "Ignorar contexto quando ele existe é erro grave.\n" +
            "Se já há gasto registrado nesta mensagem (parsedExpense): confirme o registro de forma natural.\n" +
            "Se total gasto no mês (totalSpentMonth) > 0: USE isso em consultas; NÃO peça para registrar de novo.\n" +
            "Se totalSpentMonth for 0 e o usuário consultar gastos: diga que ainda não há registros suficientes e sugira um exemplo.\n\n" +
            "OBJETIVO:\n" +
            "- Registrar gastos sem fricção\n" +
            "- Entender quanto já gastou (hoje, ontem, semana, etc.) — use o que o contexto permite\n" +
            "- Entender categorias com base no que foi registrado (use descrição/categoria amigável do contexto)\n" +
            "- Ajudar em decisões melhores\n" +
            "- Consciência financeira sem burocracia\n\n" +
            "COMPORTAMENTO:\n" +
            "- Fale como humano no WhatsApp\n" +
            "- Direto, claro, máximo 3–5 linhas\n" +
            "- Emoji com moderação (👀 💸 👍)\n" +
            "- Nunca robótico, nunca genérico quando há dados no contexto\n\n" +
            "INTERPRETAÇÃO:\n" +
            "Frases como 'quanto gastei ontem', 'qnt gaste ontem', 'gastei quanto ontem?', 'ontem deu quanto?' são consulta válida — nunca diga que não entendeu.\n\n" +
            "REGISTRO (com parsedExpense):\n" +
            "Confirme de forma natural, ex.: 'Anotei 💸 R$X no …'. Pode comentar leve se fizer sentido.\n" +
            "Se houver vários valores na mensagem, use só o total já fornecido no contexto.\n\n" +
            "CONSULTAS SEM DETALHE DE ONTEM NO BACKEND:\n" +
            "Se o usuário pedir 'ontem' mas o contexto só tiver acumulado do mês, responda com o que sabe (total do mês e número do dia) " +
            "e diga em uma linha que o detalhe por dia ainda é limitado — sem soar técnico.\n\n" +
            "DECISÃO:\n" +
            "Resposta prática e levemente provocadora, ex.: 'Depende — isso é pontual ou recorrente? Se repetir muito, pesa mais do que parece 👀'\n\n" +
            "SAUDAÇÃO:\n" +
            "\"Oi! 👋\\nEu te ajudo a registrar gastos e entender pra onde seu dinheiro está indo.\\nEx: 'gastei 20 no almoço' ou 'quanto gastei hoje?'\"\n\n" +
            "ERROS PROIBIDOS:\n" +
            "- 'não entendi', pedir reformular, ignorar contexto, resposta genérica com dados disponíveis\n\n" +
            "Responda só em texto de chat. Sem JSON, markdown ou listas técnicas."
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

function formatContextBlock(input: ResponseInput): string {
  const lines = [
    "CONTEXTO:",
    `- Mensagem do usuario: "${input.originalMessage}"`,
    `- Intent (sistema): ${input.intent}`
  ];

  if (input.parsedExpense) {
    lines.push(
      `- Gasto identificado (parsedExpense): valor total R$ ${input.parsedExpense.amount.toFixed(2)}`,
      `  Descricao original: ${input.parsedExpense.description}`,
      `  Categoria (apresente em portugues natural ao usuario, ex.: "${categoryFriendlyPT(input.parsedExpense.category)}") — nao use rotulos tecnicos em ingles`
    );
  } else {
    lines.push("- Gasto identificado (parsedExpense): nenhum nesta mensagem");
  }

  if (input.dailyLimit) {
    const d = input.dailyLimit;
    lines.push(
      `- Limite diario (dailyLimit / numero do dia): R$ ${d.dailyLimit.toFixed(2)}`,
      `- Total gasto no mes acumulado (totalSpentMonth): R$ ${d.totalSpentMonth.toFixed(2)}`,
      `- Margem restante no mes (remainingMonthBudget): R$ ${d.remainingMonthBudget.toFixed(2)}`,
      `- Dias restantes no mes (remainingDaysInMonth): ${d.remainingDaysInMonth}`
    );
  } else {
    lines.push("- Limite diario calculado: indisponivel");
  }

  lines.push(
    "Use o contexto acima na resposta. Se totalSpentMonth > 0, nao peca para registrar como se nao houvesse historico."
  );

  return lines.join("\n");
}

function categoryFriendlyPT(internal: string): string {
  const map: Record<string, string> = {
    alimentacao: "alimentação",
    transporte: "transporte",
    moradia: "moradia",
    saude: "saúde",
    lazer: "lazer",
    outros: "outros gastos"
  };
  const key = (internal || "").trim().toLowerCase();
  return map[key] ?? (key || "gastos");
}

function buildPrompt(input: ResponseInput): string {
  const ctx = `${formatContextBlock(input)}\n\n`;

  if (input.parsedExpense) {
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
      return (
        ctx +
        [
          ...baseRules,
          `Primeiras palavras (nao altere): ${statusAnswer}`,
          `Responda exatamente com: "${statusAnswer} Esse ${typeLabel} de R$${amountTotal.toFixed(0)} mexe no seu dia${day}. Se continuar nesse ritmo, o mês aperta."`
        ].join("\n")
      );
    }

    // Scenario 4: multiple amounts in the same message (mention only TOTAL)
    if (isMultipleAmounts && dailyLimitValue != null && dailyLimitValue > 0) {
      return (
        ctx +
        [
          ...baseRules,
          `Responda exatamente com: "Esses R$${amountTotal.toFixed(0)} de uma vez já pesam no dia; seu número do dia fica em R$${dailyLimitValue.toFixed(0)}. Mantendo esse ritmo, o mês perde folga rápido."`
        ].join("\n")
      );
    }

    // Scenario: NEGATIVE DAY
    if (dailyLimitValue != null && dailyLimitValue < 0) {
      return (
        ctx +
        [
          ...baseRules,
          `Responda exatamente com: "Hoje você já está no vermelho. Esse ${typeLabel} de R$${amountTotal.toFixed(0)} só aumenta a pressão para fechar o mês."`
        ].join("\n")
      );
    }

    // SMALL / MEDIUM positive dailyLimit
    if (dailyLimitValue != null && dailyLimitValue > 0) {
      if (scenario === "SMALL_EXPENSE") {
        return (
          ctx +
          [
            ...baseRules,
            `Responda exatamente com: "Esse ${typeLabel} de R$${amountTotal.toFixed(0)} ainda quase não mexe no dia; seu número do dia fica em R$${dailyLimitValue.toFixed(0)}. O risco aparece quando esse tipo de saída vira rotina."`
          ].join("\n")
        );
      }

      if (scenario === "MEDIUM_EXPENSE") {
        return (
          ctx +
          [
            ...baseRules,
            `Responda exatamente com: "Esse ${typeLabel} de R$${amountTotal.toFixed(0)} já reduz um pouco sua folga; seu número do dia fica em R$${dailyLimitValue.toFixed(0)}. Repetindo esse ritmo, o mês começa a perder margem."`
          ].join("\n")
        );
      }

      // HIGH_EXPENSE positive
      return (
        ctx +
        [
          ...baseRules,
          `Responda exatamente com: "Esse ${typeLabel} de R$${amountTotal.toFixed(0)} puxa forte seu dia; seu número do dia fica em R$${dailyLimitValue.toFixed(0)}. Mantendo esse ritmo, o impacto no mês vem rápido."`
        ].join("\n")
      );
    }

    // Fallback: keep output short and consistent
    return (
      ctx +
      [
        ...baseRules,
        `Responda exatamente com: "Esse ${typeLabel} de R$${amountTotal.toFixed(0)} mexe no seu dia. Mantendo esse ritmo, o mês aperta."`
      ].join("\n")
    );
  }

  if (input.intent === "daily_limit_query" && input.dailyLimit) {
    return (
      ctx +
      [
        "Responda em 3–5 linhas, tom WhatsApp, usando obrigatoriamente o CONTEXTO.",
        "Traga numero do dia e total gasto no mes do contexto.",
        "Sem linguagem contabil; sem lista longa de numeros.",
        `Referencia: numero do dia R$ ${input.dailyLimit.dailyLimit.toFixed(2)}; total no mes R$ ${input.dailyLimit.totalSpentMonth.toFixed(2)}.`
      ].join("\n")
    );
  }

  const consultInstruction =
    input.dailyLimit && input.dailyLimit.totalSpentMonth > 0
      ? "O usuario consulta gastos. Ha dados no contexto (totalSpentMonth > 0). Responda com esses numeros de forma natural (ex.: quanto ja acumulou no mes) e o numero do dia. " +
        "Se a pergunta for especifica de 'ontem' e voce nao tiver o valor de ontem no contexto, diga o que sabe (mes + numero do dia) e que o detalhe por dia ainda e simples nesta versao — sem jargao. " +
        "NUNCA peca para registrar como se nao houvesse historico."
      : "O usuario consulta gastos. Se totalSpentMonth no contexto for 0 ou inexistente, use: \"Consigo te mostrar isso 👀\\nMas ainda não tenho registros suficientes.\\nEx: 'gastei 20 no almoço'\"";

  const categoryInstruction =
    isCategoryQuestion(input.originalMessage) && input.dailyLimit && input.dailyLimit.totalSpentMonth > 0
      ? "O usuario pergunta sobre categorias. Use apenas o que o CONTEXTO mostra (ultima despesa/categoria amigavel se houver; total do mes). Nao invente itens nao registrados."
      : "";

  return (
    ctx +
    [
      isGreetingMessage(input.originalMessage)
        ? "Se o usuário estiver cumprimentando, responda com exatamente: \"Oi! 👋\\nEu te ajudo a registrar gastos e entender pra onde seu dinheiro está indo.\\nEx: 'gastei 20 no almoço' ou 'quanto gastei hoje?'\""
        : isSpendingConsultQuery(input.originalMessage)
          ? consultInstruction
          : isCategoryQuestion(input.originalMessage)
            ? categoryInstruction ||
              "O usuario pergunta sobre categorias. Se nao houver dados no contexto, oriente a registrar um gasto com exemplo, sem ser robotico."
            : isDecisionQuestion(input.originalMessage)
              ? "O usuário está pedindo ajuda de decisão. Responda de forma prática e com reflexão leve. Use dailyLimit do contexto se couber (ex.: se numero do dia esta apertado). Estilo: \"Depende — isso é pontual ou recorrente? Se repetir muito, pesa mais do que parece 👀\""
              : "Não responda com \"não entendi\". Seja útil; interprete intenção; sugira um proximo passo curto com exemplo."
    ].join("\n\n")
  );
}

function fallbackReply(input: ResponseInput): string {
  if (input.parsedExpense) {
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
    if (input.dailyLimit && input.dailyLimit.totalSpentMonth > 0) {
      const d = input.dailyLimit;
      return (
        `No mês você já acumulou cerca de R$${d.totalSpentMonth.toFixed(0)} em gastos 💸\n` +
        `Seu número do dia agora fica em R$${d.dailyLimit.toFixed(0)}.\n` +
        `Se você perguntou só de um dia (ex.: ontem), aqui eu ainda consolido melhor o mês todo — posso refinar isso depois 👀`
      );
    }
    return "Consigo te mostrar isso 👀\nMas ainda não tenho registros suficientes.\nEx: 'gastei 20 no almoço'";
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

  const hasQuanto = text.includes("quanto") || text.includes("qnt") || text.includes("qnto");
  const hasGastei =
    text.includes("gastei") || text.includes("gastou") || /\bgaste\b/.test(text);
  const hasTotal = text.includes("meu total") || text.includes("total de") || text.includes("total");
  const hasFoi = text.includes("quanto foi");
  const hasDeuQuanto = text.includes("deu quanto") || text.includes("deu qto");

  const hasHoje = text.includes("hoje");
  const hasOntem = text.includes("ontem");
  const hasSemana = text.includes("semana");
  const hasMes = text.includes("mes") || text.includes("mês");
  const hasPeriodo = text.includes("periodo") || text.includes("período");

  const hasAnyTime = hasHoje || hasOntem || hasSemana || hasMes || hasPeriodo;

  return (
    (hasOntem && (hasQuanto || hasGastei || hasDeuQuanto)) ||
    (hasQuanto && hasGastei && hasAnyTime) ||
    (hasFoi && (hasHoje || hasOntem)) ||
    (hasGastei && hasAnyTime) ||
    (hasTotal && (hasHoje || hasOntem || hasSemana || hasMes || hasPeriodo)) ||
    (text.includes("gastei quanto") && hasOntem)
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

function isCategoryQuestion(message: string): boolean {
  const text = (message || "").toLowerCase();
  return (
    text.includes("categoria") ||
    text.includes("categorias") ||
    text.includes("onde gastei") ||
    text.includes("em que gastei") ||
    text.includes("no que gastei")
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
  if (!input.dailyLimit) {
    return text;
  }

  const toneApplies =
    Boolean(input.parsedExpense) ||
    input.intent === "daily_limit_query" ||
    isSpendingConsultQuery(input.originalMessage);

  if (!toneApplies) {
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
  if (input.parsedExpense && dailyLimit > 0) {
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
