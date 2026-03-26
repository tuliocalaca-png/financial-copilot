import OpenAI from "openai";
import { config } from "../core/config";
import { naturalCategoryLabel } from "./transaction-helpers";
import type { QueryDetailLevel } from "./query-context.service";
import type { SpendingTransaction } from "./transaction-details.service";
import type { FinanceQueryType } from "./spending-query.service";

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
  kind: "expense" | "income";
};

export type FinanceFactsPayload = {
  periodLabel: string;
  queryType: FinanceQueryType;
  totalExpenses: number;
  totalIncome: number;
  balance: number;
  expenseTransactionCount: number;
  incomeTransactionCount: number;
  totalTransactionCount: number;
  expenseByCategory: { category: string; total: number }[];
  incomeByCategory: { category: string; total: number }[];
  detailLevel: QueryDetailLevel;
  byCategoryRequested: boolean;
  transactions?: SpendingTransaction[];
};

export type AssistantRequest =
  | {
      variant: "transaction";
      originalMessage: string;
      parsedExpense: ParsedExpensePayload;
    }
  | {
      variant: "finance_query";
      originalMessage: string;
      facts: FinanceFactsPayload;
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
  return trimmed.length > 0 ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : "Movimento";
}

function formatRecordedTransactionReply(parsedExpense: ParsedExpensePayload): string {
  if (parsedExpense.kind === "income") {
    return `Anotei 💰 entrada de ${brl(parsedExpense.amount)} em ${titleCase(parsedExpense.description)}.`;
  }

  return `Anotei 💸 ${brl(parsedExpense.amount)} em ${titleCase(parsedExpense.description)}.`;
}

function formatNoDataReply(periodLabel: string, queryType: FinanceQueryType): string {
  if (queryType === "income") {
    return `No período “${periodLabel}” não encontrei entradas registradas 👀\n\nQuando receber, manda tipo: “recebi 500 no pix”.`;
  }

  if (queryType === "balance") {
    return `No período “${periodLabel}” ainda não encontrei movimentações suficientes para calcular saldo 👀`;
  }

  return `No período “${periodLabel}” não encontrei gastos registrados 👀\n\nQuando gastar, manda tipo: “gastei 20 no almoço”.`;
}

function formatSummaryReply(facts: FinanceFactsPayload): string {
  if (facts.queryType === "income") {
    return [
      `📊 ${facts.periodLabel}`,
      `Entradas: ${brl(facts.totalIncome)}`,
      `Lançamentos: ${facts.incomeTransactionCount}`
    ].join("\n");
  }

  if (facts.queryType === "balance") {
    return [
      `📊 ${facts.periodLabel}`,
      `Entradas: ${brl(facts.totalIncome)}`,
      `Saídas: ${brl(facts.totalExpenses)}`,
      `Saldo: ${brl(facts.balance)}`
    ].join("\n");
  }

  return [
    `📊 ${facts.periodLabel}`,
    `Saídas: ${brl(facts.totalExpenses)}`,
    `Lançamentos: ${facts.expenseTransactionCount}`
  ].join("\n");
}

function formatCategoryList(
  title: string,
  rows: { category: string; total: number }[]
): string[] {
  const lines: string[] = [title];

  for (const row of rows.slice(0, 10)) {
    lines.push(`• ${naturalCategoryLabel(row.category)}: ${brl(row.total)}`);
  }

  return lines;
}

function formatCategoryReply(facts: FinanceFactsPayload): string {
  const lines: string[] = [];

  if (facts.queryType === "income") {
    lines.push(`📊 ${facts.periodLabel}`);
    lines.push(`Entradas: ${brl(facts.totalIncome)}`);
    lines.push(`Lançamentos: ${facts.incomeTransactionCount}`);

    if (facts.incomeByCategory.length > 0) {
      lines.push(...formatCategoryList("Por categoria:", facts.incomeByCategory));
    }

    return lines.join("\n");
  }

  if (facts.queryType === "balance") {
    lines.push(`📊 ${facts.periodLabel}`);
    lines.push(`Entradas: ${brl(facts.totalIncome)}`);
    lines.push(`Saídas: ${brl(facts.totalExpenses)}`);
    lines.push(`Saldo: ${brl(facts.balance)}`);

    if (facts.incomeByCategory.length > 0) {
      lines.push(...formatCategoryList("Entradas por categoria:", facts.incomeByCategory));
    }

    if (facts.expenseByCategory.length > 0) {
      lines.push(...formatCategoryList("Saídas por categoria:", facts.expenseByCategory));
    }

    return lines.join("\n");
  }

  lines.push(`📊 ${facts.periodLabel}`);
  lines.push(`Saídas: ${brl(facts.totalExpenses)}`);
  lines.push(`Lançamentos: ${facts.expenseTransactionCount}`);

  if (facts.expenseByCategory.length > 0) {
    lines.push(...formatCategoryList("Por categoria:", facts.expenseByCategory));
  }

  return lines.join("\n");
}

function formatTransactionBlock(
  title: string,
  transactions: SpendingTransaction[],
  totalByCategory?: number
): string[] {
  const lines: string[] = [];

  if (typeof totalByCategory === "number") {
    lines.push(`${title} — ${brl(totalByCategory)}`);
  } else {
    lines.push(title);
  }

  for (const tx of transactions) {
    lines.push(`• ${titleCase(tx.description)} — ${brl(tx.amount)}`);
  }

  return lines;
}

function formatDetailedFinanceReply(facts: FinanceFactsPayload): string {
  const transactions = facts.transactions ?? [];
  const lines: string[] = [];

  if (facts.queryType === "income") {
    lines.push(`📊 ${facts.periodLabel}`);
    lines.push(`Entradas: ${brl(facts.totalIncome)}`);
    lines.push(`Lançamentos: ${facts.incomeTransactionCount}`);
  } else if (facts.queryType === "balance") {
    lines.push(`📊 ${facts.periodLabel}`);
    lines.push(`Entradas: ${brl(facts.totalIncome)}`);
    lines.push(`Saídas: ${brl(facts.totalExpenses)}`);
    lines.push(`Saldo: ${brl(facts.balance)}`);
  } else {
    lines.push(`📊 ${facts.periodLabel}`);
    lines.push(`Saídas: ${brl(facts.totalExpenses)}`);
    lines.push(`Lançamentos: ${facts.expenseTransactionCount}`);
  }

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

    const categories =
      facts.queryType === "income"
        ? facts.incomeByCategory
        : facts.queryType === "balance"
          ? [...facts.incomeByCategory, ...facts.expenseByCategory]
          : facts.expenseByCategory;

    for (const row of categories) {
      const txs = grouped.get(row.category) ?? [];
      if (txs.length === 0) continue;

      lines.push(...formatTransactionBlock(naturalCategoryLabel(row.category), txs, row.total));
    }

    return lines.join("\n");
  }

  lines.push("Lançamentos:");
  for (const tx of transactions.slice(0, 20)) {
    lines.push(`• ${titleCase(tx.description)} — ${brl(tx.amount)}`);
  }

  return lines.join("\n");
}

function formatFinanceReply(facts: FinanceFactsPayload): string {
  const noData =
    facts.queryType === "income"
      ? facts.incomeTransactionCount === 0
      : facts.queryType === "balance"
        ? facts.totalTransactionCount === 0
        : facts.expenseTransactionCount === 0;

  if (noData) {
    return formatNoDataReply(facts.periodLabel, facts.queryType);
  }

  if (facts.detailLevel === "transaction") {
    return formatDetailedFinanceReply(facts);
  }

  if (facts.detailLevel === "category") {
    return formatCategoryReply(facts);
  }

  return formatSummaryReply(facts);
}

export async function generateAssistantReply(
  input: AssistantRequest
): Promise<string> {
  if (input.variant === "transaction") {
    return formatRecordedTransactionReply(input.parsedExpense);
  }

  if (input.variant === "finance_query") {
    return formatFinanceReply(input.facts);
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
      '  - "recebi 500 no pix"',
      '  - "quanto gastei hoje"',
      '  - "quanto recebi hoje"',
      '  - "quanto sobrou no mês"',
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