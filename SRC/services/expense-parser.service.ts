import type { ParsedExpense } from "../core/types";
import { inferExpenseCategoryFromText } from "./transaction-helpers";

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

function isClearlyNotExpense(text: string): boolean {
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
  return withoutNumber.length > 0 ? withoutNumber : "gasto";
}

function looksLikeShortExpense(text: string): boolean {
  const words = text.split(" ");

  return (
    words.length <= 3 && // curto tipo "uber 37"
    /\d/.test(text)      // tem número
  );
}

export function parseExpense(message: string): ParsedExpense | null {
  const text = normalize(message);

  // 🚫 bloqueia comandos
  if (isClearlyNotExpense(text)) {
    return null;
  }

  const amount = extractAmount(text);
  if (amount == null) {
    return null;
  }

  // ✅ aceita se:
  // - tem verbo
  // - OU parece gasto curto (uber 20, pizza 30)
  if (!hasExpenseVerb(text) && !looksLikeShortExpense(text)) {
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