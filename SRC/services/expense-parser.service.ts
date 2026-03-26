import type { ParsedExpense } from "../core/types";
import { inferExpenseCategoryFromText } from "./transaction-helpers";

function normalize(text: string): string {
  return text.toLowerCase().trim();
}

function hasExpenseIntent(text: string): boolean {
  return (
    text.includes("gastei") ||
    text.includes("gasto") ||
    text.includes("paguei") ||
    text.includes("pagar") ||
    text.includes("custou") ||
    text.includes("comprei")
  );
}

function isClearlyNotExpense(text: string): boolean {
  return (
    text.includes("relatorio") ||
    text.includes("relatório") ||
    text.includes("lembrete") ||
    text.includes("todo dia") ||
    text.includes("todo dia") ||
    text.includes("às") ||
    text.includes("agenda") ||
    text.includes("configurar")
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
  const parts = message.split(/\d+([.,]\d+)?/);

  if (parts.length > 1) {
    return parts[parts.length - 1].trim() || "gasto";
  }

  return "gasto";
}

export function parseExpense(message: string): ParsedExpense | null {
  const text = normalize(message);

  // 🚫 trava forte
  if (isClearlyNotExpense(text)) {
    return null;
  }

  // 🚫 exige intenção
  if (!hasExpenseIntent(text)) {
    return null;
  }

  const amount = extractAmount(text);
  if (amount == null) {
    return null;
  }

  const description = extractDescription(message);
  const category = inferExpenseCategoryFromText(message);

  return {
    amount,
    description,
    category
  };
}