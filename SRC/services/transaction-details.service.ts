import { supabase } from "../db/supabase";
import {
  normalizeCategoryKey,
  type ExpenseCategory
} from "./transaction-helpers";

export type SpendingTransaction = {
  amount: number;
  category: ExpenseCategory;
  description: string;
  createdAt: string;
};

type TxRow = {
  amount: string | number | null;
  category: string | null;
  description: string | null;
  created_at: string | null;
};

export async function fetchSpendingTransactions(
  userId: string,
  rangeStartUtc: string,
  rangeEndUtcExclusive: string
): Promise<SpendingTransaction[]> {
  const { data, error } = await supabase
    .from("transactions")
    .select("amount, category, description, created_at")
    .eq("user_id", userId)
    .gte("created_at", rangeStartUtc)
    .lt("created_at", rangeEndUtcExclusive)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch spending transactions: ${error.message}`);
  }

  const result: SpendingTransaction[] = [];

  for (const row of (data ?? []) as TxRow[]) {
    const amount = Number(row.amount ?? 0);

    if (!Number.isFinite(amount) || amount <= 0) {
      continue;
    }

    result.push({
      amount: Math.round(amount * 100) / 100,
      category: normalizeCategoryKey(row.category),
      description:
        typeof row.description === "string" && row.description.trim().length > 0
          ? row.description.trim()
          : "gasto",
      createdAt: typeof row.created_at === "string" ? row.created_at : ""
    });
  }

  return result;
}