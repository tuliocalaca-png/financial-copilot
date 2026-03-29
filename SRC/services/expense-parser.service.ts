import type { ParsedExpense } from "../core/types";
import {
  inferExpenseCategoryFromText,
  inferIncomeCategoryFromText,
  normalizeFreeText,
  parseLooseAmount
} from "./transaction-helpers";

function hasExpenseVerb(text: string): boolean {
  return ["gastei", "gasto", "paguei", "pagar", "custou", "comprei", "saidas", "saidas"].some((token) =>
    text.includes(token)
  );
}

function hasIncomeVerb(text: string): boolean {
  return ["recebi", "receber", "ganhei", "ganho", "entrou", "caiu", "faturei", "faturou"].some((token) =>
    text.includes(token)
  );
}

function isClearlyNotTransaction(text: string): boolean {
  return [
    "relatorio",
    "lembrete",
    "agenda",
    "configurar",
    "todo dia"
  ].some((token) => text.includes(token));
}

function extractAmount(message: string): number | null {
  const match = normalizeFreeText(message).match(/r?\$?\s*\d+[\d.,]*k?/);
  if (!match) return null;
  return parseLooseAmount(match[0]);
}

function extractDescription(message: string): string {
  const withoutNumber = message.replace(/r?\$?\s*\d+[\d.,]*k?/i, " ").trim();
  return withoutNumber.length > 0 ? withoutNumber : "movimento";
}

function looksLikeShortTransaction(text: string): boolean {
  const words = text.split(" ").filter(Boolean);
  return words.length <= 4 && /\d/.test(text);
}

function looksLikeShortIncome(text: string): boolean {
  return looksLikeShortTransaction(text) && ["salario", "pix", "reembolso", "entrou", "caiu"].some((token) => text.includes(token));
}

export function parseExpense(message: string): ParsedExpense | null {
  const text = normalizeFreeText(message);

  if (!text || isClearlyNotTransaction(text)) {
    return null;
  }

  const amount = extractAmount(message);
  if (amount == null) {
    return null;
  }

  const isIncome = hasIncomeVerb(text) || looksLikeShortIncome(text);
  const isExpense = hasExpenseVerb(text) || looksLikeShortTransaction(text);

  if (!isIncome && !isExpense) {
    return null;
  }

  const description = extractDescription(message);

  if (isIncome && !hasExpenseVerb(text)) {
    return {
      amount,
      description,
      category: inferIncomeCategoryFromText(message),
      kind: "income"
    };
  }

  return {
    amount,
    description,
    category: inferExpenseCategoryFromText(message),
    kind: "expense"
  };
}
