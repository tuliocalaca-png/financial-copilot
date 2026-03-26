import OpenAI from "openai";
import { config } from "../core/config";
import { naturalCategoryLabel } from "./transaction-helpers";
import type { QueryDetailLevel } from "./query-context.service";
import type { SpendingTransaction } from "./transaction-details.service";

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
- Não invente números.
- Não invente totais.
- Não invente categorias.
- Não finja que o sistema sabe algo que não foi enviado.
- Nunca diga “não entendi”.
- Nunca peça para reformular.
- Se faltar dado, diga com honestidade que o sistema ainda não trouxe aquele número.
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
  detailLevel: QueryDetailLevel;
  byCategoryRequested: boolean;
  transactions?: SpendingTransaction[];
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

function brl(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(value);
}

function titleCase(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : "Gasto";
}

function formatExpenseReply(parsedExpense: ParsedExpensePayload): string {
  return `Anotei 💸 ${brl(parsedExpense.amount)} em ${titleCase(parsedExpense.description)}.`;
}

function formatNoDataReply(periodLabel: string): string {
  return `No período “${periodLabel}” não encontrei gastos registrados 👀\n\nQuando gastar, manda tipo: “gastei 20 no almoço”.`;
}

function formatSummaryReply(facts: SpendingFactsPayload): string {
  return [
    `📊 ${facts.periodLabel}`,
    `Total: ${brl(facts.total)}`,
    `Lançamentos: ${facts.transactionCount}`
  ].join("\n");
}

function formatCategoryReply(facts: SpendingFactsPayload): string {
  const lines = [
    `📊 ${facts.periodLabel}`,
    `Total: ${brl(facts.total)}`,
    `Lançamentos: ${facts.transactionCount}`
  ];

  if (facts.byCategory.length > 0) {
    lines.push("Por categoria:");
    for (const row of facts.byCategory.slice(0, 10)) {
      lines.push(`• ${naturalCategoryLabel(row.category)}: ${brl(row.total)}`);
    }
  }

  return lines.join("\n");
}

function formatTransactionReply(facts: SpendingFactsPayload): string {
  const transactions = facts.transactions ?? [];

  const lines = [
    `📊 ${facts.periodLabel}`,
    `Total: ${brl(facts.total)}`,
    `Lançamentos: ${facts.transactionCount}`
  ];

  if (transactions.length === 0) {
    return lines.join("\n");
  }

  if (facts.byCategoryRequested) {
    const grouped = new Map<string, SpendingTransaction[]>();

    for (const tx of transactions) {
      const key = tx.category;
      const list = grouped.get(key) ?? [];
      list.push(tx);
      grouped.set(key, list);
    }

    lines.push("Por categoria:");

    for (const row of facts.byCategory) {
      const txs = grouped.get(row.category) ?? [];
      if (txs.length === 0) continue;

      lines.push(`${naturalCategoryLabel(row.category)} — ${brl(row.total)}`);
      for (const tx of txs) {
        lines.push(`• ${titleCase(tx.description)} — ${brl(tx.amount)}`);
      }
    }

    return lines.join("\n");
  }

  lines.push("Lançamentos:");
  for (const tx of transactions.slice(0, 20)) {
    lines.push(`• ${titleCase(tx.description)} — ${brl(tx.amount)}`);
  }

  return lines.join("\n");
}

function formatSpendingReply(facts: SpendingFactsPayload): string {
  if (facts.transactionCount === 0) {
    return formatNoDataReply(facts.periodLabel);
  }

  if (facts.detailLevel === "transaction") {
    return formatTransactionReply(facts);
  }

  if (facts.detailLevel === "category") {
    return formatCategoryReply(facts);
  }

  return formatSummaryReply(facts);
}

export async function generateAssistantReply(
  input: AssistantRequest
): Promise<string> {
  if (input.variant === "expense") {
    return formatExpenseReply(input.parsedExpense);
  }

  if (input.variant === "spending") {
    return formatSpendingReply(input.facts);
  }

  const userBlocks = [
    "DADOS_DO_SISTEMA:",
    JSON.stringify({ tipo: "sem_dados_financeiros" }, null, 0),
    `MENSAGEM_ORIGINAL: ${JSON.stringify(input.originalMessage)}`,
    [
      "Tarefa:",
      "- responda de forma útil e curta",
      "- não invente valores financeiros",
      "- sugira exemplos concretos como:",
      '  - "gastei 20 no almoço"',
      '  - "quanto gastei hoje"',
      '  - "quanto gastei no mês passado por categoria"',
      '  - "abre os lançamentos por categoria"'
    ].join("\n")
  ];

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