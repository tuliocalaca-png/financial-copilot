import type { ParsedExpense } from "../core/types";
import { inferExpenseCategoryFromText } from "./transaction-helpers";

function countNumericAmountLikeTokens(message: string): number {
  const numbers = message.match(/\d+([.,]\d+)?/g);
  return numbers?.length ?? 0;
}

function parseAmountToken(raw: string): number | null {
  const normalized = raw.replace(/\./g, "").replace(",", ".");
  const value = Number(normalized);

  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Math.round(value * 100) / 100;
}

function extractFirstAmount(message: string): number | null {
  const match = message.match(/\d+([.,]\d+)?/);
  if (!match) {
    return null;
  }

  return parseAmountToken(match[0]);
}

function cleanDescription(description: string): string {
  return description
    .replace(/^(no|na|em|do|da|pro|pra|para|o|a)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractDescription(message: string): string {
  const firstNumber = message.match(/\d+([.,]\d+)?/);
  if (!firstNumber || firstNumber.index == null) {
    return "gasto";
  }

  const afterAmount = message.slice(firstNumber.index + firstNumber[0].length).trim();
  const cleaned = cleanDescription(afterAmount);

  if (cleaned.length > 0) {
    return cleaned;
  }

  const beforeAmount = message.slice(0, firstNumber.index).trim();
  const fallback = cleanDescription(
    beforeAmount
      .replace(/\bgastei\b/gi, "")
      .replace(/\bgasto\b/gi, "")
      .replace(/\bpaguei\b/gi, "")
      .trim()
  );

  return fallback.length > 0 ? fallback : "gasto";
}

export function parseExpense(message: string): ParsedExpense | null {
  const trimmed = message.trim();

  if (!trimmed) {
    return null;
  }

  if (countNumericAmountLikeTokens(trimmed) !== 1) {
    return null;
  }

  const amount = extractFirstAmount(trimmed);
  if (amount == null) {
    return null;
  }

  const description = extractDescription(trimmed);
  const category = inferExpenseCategoryFromText(trimmed);

  return {
    amount,
    description,
    category
  };
}