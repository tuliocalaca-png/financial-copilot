import { supabase } from "../db/supabase";
import type { TransactionKind } from "../core/types";
import {
  inferExpenseCategoryFromText,
  inferIncomeCategoryFromText,
  normalizeFreeText,
  parseLooseAmount
} from "./transaction-helpers";
import { DEFAULT_TIMEZONE } from "./period-resolver.service";
import { DateTime } from "luxon";

export type PlannedTransaction = {
  id?: string;
  user_id?: string;
  amount: number;
  description: string;
  category: string;
  kind: TransactionKind;
  dueDate: string;
  status?: "pending" | "done" | "cancelled";
};

export type PlannedTransactionParseResult =
  | { kind: "parsed"; transaction: PlannedTransaction }
  | { kind: "missing_amount"; reply: string }
  | { kind: "no_match" };

export type PlannedForecastSummary = {
  totalReceivable: number;
  totalPayable: number;
  projectedBalance: number;
  receivables: PlannedTransaction[];
  payables: PlannedTransaction[];
};

function resolveDueDate(day: number, explicitMonth?: number, explicitYear?: number): string {
  const now = DateTime.now().setZone(DEFAULT_TIMEZONE);
  let year = explicitYear ?? now.year;
  let month = explicitMonth ?? now.month;

  if (explicitMonth == null && day < now.day) {
    const next = now.plus({ months: 1 });
    year = next.year;
    month = next.month;
  }

  return DateTime.fromObject({ year, month, day }, { zone: DEFAULT_TIMEZONE }).toISODate()!;
}

function parseDueDate(text: string): string | null {
  const slash = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    const year = slash[3] ? Number(slash[3]) : undefined;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return resolveDueDate(day, month, year);
    }
  }

  const dayOnly = text.match(/\b(?:dia|vence dia|entra dia)\s*(\d{1,2})\b/);
  if (dayOnly) {
    const day = Number(dayOnly[1]);
    if (day >= 1 && day <= 31) {
      return resolveDueDate(day);
    }
  }

  return null;
}

function inferKind(text: string): TransactionKind | null {
  if (["vou receber", "receberei", "entra", "cai", "receber", "a receber"].some((token) => text.includes(token))) {
    return "income";
  }

  if (["vou pagar", "pagarei", "vence", "vencimento", "a pagar", "tenho que pagar"].some((token) => text.includes(token))) {
    return "expense";
  }

  return null;
}

function extractDescription(message: string): string {
  return message
    .replace(/r?\$?\s*\d+[\d.,]*k?/i, " ")
    .replace(/\b(vou receber|receberei|entra|entra dia|vou pagar|pagarei|vence|vence dia|tenho que pagar|a pagar|a receber)\b/gi, " ")
    .replace(/\bdia\s*\d{1,2}\b/gi, " ")
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{4})?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "movimento futuro";
}

export function parsePlannedTransaction(message: string): PlannedTransactionParseResult {
  const text = normalizeFreeText(message);
  if (!text) return { kind: "no_match" };

  const transactionKind = inferKind(text);
  const dueDate = parseDueDate(text);

  if (!transactionKind || !dueDate) {
    return { kind: "no_match" };
  }

  const amount = parseLooseAmount(text);
  if (amount == null) {
    return {
      kind: "missing_amount",
      reply: "Peguei que isso é um compromisso futuro 👍\n\nPra eu projetar direito, me manda também o valor. Ex.: ‘vou pagar 300 dia 12’."
    };
  }

  return {
    kind: "parsed",
    transaction: {
      amount,
      description: extractDescription(message),
      category:
        transactionKind === "income"
          ? inferIncomeCategoryFromText(message)
          : inferExpenseCategoryFromText(message),
      kind: transactionKind,
      dueDate,
      status: "pending"
    }
  };
}

export async function savePlannedTransaction(userId: string, tx: PlannedTransaction): Promise<void> {
  const { error } = await supabase.from("planned_transactions").insert({
    user_id: userId,
    amount: tx.amount,
    description: tx.description,
    category: tx.category,
    type: tx.kind,
    due_date: tx.dueDate,
    status: tx.status ?? "pending"
  });

  if (error) {
    throw new Error(`Failed to save planned transaction: ${error.message}`);
  }
}

export async function fetchPlannedTransactions(
  userId: string,
  startDate: string,
  endDate: string
): Promise<PlannedTransaction[]> {
  const { data, error } = await supabase
    .from("planned_transactions")
    .select("id, amount, description, category, type, due_date, status")
    .eq("user_id", userId)
    .eq("status", "pending")
    .gte("due_date", startDate)
    .lte("due_date", endDate)
    .order("due_date", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch planned transactions: ${error.message}`);
  }

  return (data ?? []).map((row: any) => ({
    id: row.id,
    amount: Number(row.amount ?? 0),
    description: String(row.description ?? "movimento futuro"),
    category: String(row.category ?? "outros"),
    kind: row.type === "income" ? "income" : "expense",
    dueDate: String(row.due_date),
    status: row.status ?? "pending"
  }));
}

export async function fetchPlannedForecastSummary(
  userId: string,
  startDate: string,
  endDate: string
): Promise<PlannedForecastSummary> {
  const items = await fetchPlannedTransactions(userId, startDate, endDate);
  const receivables = items.filter((item) => item.kind === "income");
  const payables = items.filter((item) => item.kind === "expense");

  const totalReceivable = receivables.reduce((sum, item) => sum + item.amount, 0);
  const totalPayable = payables.reduce((sum, item) => sum + item.amount, 0);

  return {
    totalReceivable: Math.round(totalReceivable * 100) / 100,
    totalPayable: Math.round(totalPayable * 100) / 100,
    projectedBalance: Math.round((totalReceivable - totalPayable) * 100) / 100,
    receivables,
    payables
  };
}
