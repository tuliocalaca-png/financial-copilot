import { supabase } from "../db/supabase";
import {
  isExpenseCategory,
  normalizeCategoryKey
} from "./transaction-helpers";

export type CategoryTotal = {
  category: string;
  total: number;
};

export type SpendingAggregate = {
  total: number;
  transactionCount: number;
  byCategory: CategoryTotal[];
};

type TxRow = {
  amount: string | number | null;
  category: string | null;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function sumExpenseRows(rows: TxRow[]): SpendingAggregate {
  const byCategoryMap = new Map<string, number>();
  let total = 0;
  let transactionCount = 0;

  for (const row of rows) {
    const categoryKey = normalizeCategoryKey(row.category);

    if (!isExpenseCategory(categoryKey)) {
      continue;
    }

    const amount = Number(row.amount ?? 0);

    if (!Number.isFinite(amount) || amount <= 0) {
      continue;
    }

    total += amount;
    transactionCount += 1;

    byCategoryMap.set(categoryKey, (byCategoryMap.get(categoryKey) ?? 0) + amount);
  }

  const byCategory: CategoryTotal[] = [...byCategoryMap.entries()]
    .map(([category, categoryTotal]) => ({
      category,
      total: round2(categoryTotal)
    }))
    .sort((a, b) => b.total - a.total);

  return {
    total: round2(total),
    transactionCount,
    byCategory
  };
}

export async function fetchSpendingAggregate(
  userId: string,
  rangeStartUtc: string,
  rangeEndUtcExclusive: string
): Promise<SpendingAggregate> {
  const { data, error } = await supabase
    .from("transactions")
    .select("amount, category")
    .eq("user_id", userId)
    .gte("created_at", rangeStartUtc)
    .lt("created_at", rangeEndUtcExclusive);

  if (error) {
    throw new Error(`Failed to fetch spending aggregate: ${error.message}`);
  }

  return sumExpenseRows((data ?? []) as TxRow[]);
}