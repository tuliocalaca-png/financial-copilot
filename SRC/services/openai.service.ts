import OpenAI from "openai";
import { config } from "../core/config";

const openai = new OpenAI({
  apiKey: config.openAiApiKey
});

const SYSTEM_PROMPT = `
Você é um copiloto financeiro no WhatsApp.

ESTILO:
- tom humano, direto e útil
- 2 a 4 linhas
- emoji com moderação
- nunca robótico
- nunca prolixo

REGRAS ABSOLUTAS:
- Use APENAS números, totais, períodos e categorias que aparecerem no bloco DADOS_DO_SISTEMA (JSON).
- Não invente valores.
- Não invente totais.
- Não invente categorias.
- Não arredonde diferente do que veio.
- Não fale de limite diário, orçamento ou “quanto pode gastar” a menos que isso esteja explicitamente no JSON.
- Nunca diga “não entendi”.
- Nunca peça para reformular.
- Nunca finja que o sistema sabe algo que não foi enviado no JSON.
- Se faltar dado, diga com honestidade que o sistema não trouxe aquele número.

MAPEAMENTO DE CATEGORIA INTERNA:
- alimentacao -> alimentação
- transporte -> transporte
- saude -> saúde
- lazer -> lazer
- mercado -> mercado
- outros -> outros

REGRAS DE SAÍDA:
- Se for registro de gasto, confirme de forma curta e natural.
- Se for consulta de gastos, responda com os números exatos recebidos.
- Se houver categorias, mencione de forma curta e natural.
- Se não houver categorias, não invente nenhuma.
- Se for uma mensagem genérica, responda de forma útil e curta, sugerindo exemplos concretos.
`.trim();

export type ParsedExpensePayload = {
  amount: number;
  description: string;
  category: string;
};

export type SpendingFactsPayload = {
  periodLabel: string;
  total: number;
  transactionCount: number;
  byCategory: { category: string; total: number }[];
};

export type AssistantRequest =
  | {
      variant: "expense";
      originalMessage: string;
      parsedExpense: ParsedExpensePayload;
    }
  | {
      variant: "spending";
      originalMessage: string;
      facts: SpendingFactsPayload;
    }
  | {
      variant: "generic";
      originalMessage: string;
    };

function spendingFallbackNoData(periodLabel: string): string {
  return (
    `No período “${periodLabel}” não tenho nenhum gasto registrado 👀\n\n` +
    `Quando gastar, manda tipo: “gastei 20 no almoço”.`
  );
}

export async function generateAssistantReply(input: AssistantRequest): Promise<string> {
  if (input.variant === "spending") {
    const { facts } = input;

    if (facts.transactionCount === 0) {
      return spendingFallbackNoData(facts.periodLabel);
    }
  }

  const userBlocks: string[] = [];

  if (input.variant === "expense") {
    userBlocks.push(
      "DADOS_DO_SISTEMA:",
      JSON.stringify(
        {
          tipo: "registro_gasto",
          valor: input.parsedExpense.amount,
          descricao: input.parsedExpense.description,
          categoria_interna: input.parsedExpense.category
        },
        null,
        0
      ),
      `MENSAGEM_ORIGINAL: ${JSON.stringify(input.originalMessage)}`,
      "Tarefa: confirme o registro usando somente os campos acima, de forma curta e natural."
    );
  } else if (input.variant === "spending") {
    userBlocks.push(
      "DADOS_DO_SISTEMA:",
      JSON.stringify(
        {
          tipo: "consulta_periodo",
          periodo_rotulo: input.facts.periodLabel,
          total_gastos: input.facts.total,
          quantidade_lancamentos: input.facts.transactionCount,
          por_categoria: input.facts.byCategory
        },
        null,
        0
      ),
      `MENSAGEM_ORIGINAL: ${JSON.stringify(input.originalMessage)}`,
      [
        "Tarefa:",
        "- resuma os gastos do período usando os números exatos",
        "- se houver categorias, mencione de forma curta",
        "- não invente categorias que não vieram",
        "- mantenha a resposta curta e útil"
      ].join("\n")
    );
  } else {
    userBlocks.push(
      "DADOS_DO_SISTEMA:",
      JSON.stringify(
        {
          tipo: "sem_dados_financeiros"
        },
        null,
        0
      ),
      `MENSAGEM_ORIGINAL: ${JSON.stringify(input.originalMessage)}`,
      [
        "Tarefa:",
        "- responda de forma útil e curta",
        "- não invente valores financeiros",
        "- sugira exemplos concretos como:",
        '  - "gastei 20 no almoço"',
        '  - "quanto gastei hoje"',
        '  - "quanto gastei no mês passado por categoria"'
      ].join("\n")
    );
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userBlocks.join("\n") }
    ]
  });

  const text = completion.choices[0]?.message?.content?.trim();
  return text && text.length > 0 ? text : "Beleza 👍";
}