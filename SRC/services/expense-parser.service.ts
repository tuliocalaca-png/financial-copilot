import type { ParsedExpense } from "../core/types";
import {
  inferExpenseCategoryFromText,
  inferIncomeCategoryFromText
} from "./transaction-helpers";

function normalize(text: string): string {
  return text.toLowerCase().trim();
}

function hasExpenseVerb(text: string): boolean {
  return (
    text.includes("gastei") ||
    text.includes("gasto") ||
    text.includes("paguei") ||
    text.includes("pagar") ||
    text.includes("custou") ||
    text.includes("comprei")
  );
}

function hasIncomeVerb(text: string): boolean {
  return (
    text.includes("recebi") ||
    text.includes("entrou") ||
    text.includes("caiu") ||
    text.includes("ganhei") ||
    text.includes("faturei") ||
    text.includes("faturou") ||
    text.includes("faturamento")
  );
}

function isClearlyNotTransaction(text: string): boolean {
  return (
    text.includes("relatorio") ||
    text.includes("relatório") ||
    text.includes("lembrete") ||
    text.includes("agenda") ||
    text.includes("configurar") ||
    text.includes("todo dia") ||
    text.includes("às")
  );
}

function extractAmount(message: string): number | null {
  const match = message.match(/\d+([.,]\d+)?/);
  if (!match) return null;

  const value = Number(match[0].replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return null;

  return Math.round(value * 100) / 100;
}

function extractDescription(message: string): string {
  const withoutNumber = message.replace(/\d+([.,]\d+)?/, "").trim();
  return withoutNumber.length > 0 ? withoutNumber : "movimento";
}

function looksLikeShortTransaction(text: string): boolean {
  const words = text.split(" ");

  return words.length <= 3 && /\d/.test(text);
}

function looksLikeShortIncome(text: string): boolean {
  return (
    looksLikeShortTransaction(text) &&
    (text.includes("salario") ||
      text.includes("salário") ||
      text.includes("pix") ||
      text.includes("reembolso"))
  );
}

export function parseExpense(message: string): ParsedExpense | null {
  const text = normalize(message);

  if (isClearlyNotTransaction(text)) {
    return null;
  }

  const amount = extractAmount(text);
  if (amount == null) {
    return null;
  }

  const isIncome =
    hasIncomeVerb(text) || looksLikeShortIncome(text);

  const isExpense =
    hasExpenseVerb(text) || looksLikeShortTransaction(text);

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