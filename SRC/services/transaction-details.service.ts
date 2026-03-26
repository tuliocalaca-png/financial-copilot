import { supabase } from "../db/supabase";
import {
  isIncomeCategory,
  normalizeCategoryKey
} from "./transaction-helpers";
import type { TransactionKind } from "../core/types";
import type { FinanceQueryType } from "./spending-query.service";

export type SpendingTransaction = {
  amount: number;
  category: string;
  description: string;
  createdAt: string;
  kind: TransactionKind;
};

type TxRow = {
  amount: string | number | null;
  category: string | null;
  description: string | null;
  created_at: string | null;
};

export async function fetchFinanceTransactions(
  userId: string,
  rangeStartUtc: string,
  rangeEndUtcExclusive: string,
  queryType: FinanceQueryType
): Promise<SpendingTransaction[]> {
  const { data, error } = await supabase
    .from("transactions")
    .select("amount, category, description, created_at")
    .eq("user_id", userId)
    .gte("created_at", rangeStartUtc)
    .lt("created_at", rangeEndUtcExclusive)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch finance transactions: ${error.message}`);
  }

  const result: SpendingTransaction[] = [];

  for (const row of (data ?? []) as TxRow[]) {
    const amount = Number(row.amount ?? 0);

    if (!Number.isFinite(amount) || amount <= 0) {
      continue;
    }

    const category = normalizeCategoryKey(row.category);
    const kind: TransactionKind = isIncomeCategory(category) ? "income" : "expense";

    if (queryType === "expense" && kind !== "expense") {
      continue;
    }

    if (queryType === "income" && kind !== "income") {
      continue;
    }

    result.push({
      amount: Math.round(amount * 100) / 100,
      category,
      description:
        typeof row.description === "string" && row.description.trim().length > 0
          ? row.description.trim()
          : "movimento",
      createdAt: typeof row.created_at === "string" ? row.created_at : "",
      kind
    });
  }

  return result;
}

export async function fetchSpendingTransactions(
  userId: string,
  rangeStartUtc: string,
  rangeEndUtcExclusive: string
): Promise<SpendingTransaction[]> {
  return fetchFinanceTransactions(
    userId,
    rangeStartUtc,
    rangeEndUtcExclusive,
    "expense"
  );
}