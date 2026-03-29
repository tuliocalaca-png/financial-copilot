import { supabase } from "../db/supabase";
import {
  normalizeCategoryKey
} from "./transaction-helpers";

export type CategoryTotal = {
  category: string;
  total: number;
};

export type FinanceAggregate = {
  totalExpenses: number;
  totalIncome: number;
  balance: number;
  expenseTransactionCount: number;
  incomeTransactionCount: number;
  totalTransactionCount: number;
  expenseByCategory: CategoryTotal[];
  incomeByCategory: CategoryTotal[];
};

type TxRow = {
  amount: string | number | null;
  category: string | null;
  type: string | null;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function aggregateRows(rows: TxRow[]): FinanceAggregate {
  const expenseMap = new Map<string, number>();
  const incomeMap = new Map<string, number>();

  let totalExpenses = 0;
  let totalIncome = 0;
  let expenseCount = 0;
  let incomeCount = 0;

  for (const row of rows) {
    const amount = Number(row.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const category = normalizeCategoryKey(row.category);
    const type = row.type === "income" ? "income" : "expense";

    if (type === "income") {
      totalIncome += amount;
      incomeCount += 1;
      incomeMap.set(category, (incomeMap.get(category) ?? 0) + amount);
    } else {
      totalExpenses += amount;
      expenseCount += 1;
      expenseMap.set(category, (expenseMap.get(category) ?? 0) + amount);
    }
  }

  const mapToList = (map: Map<string, number>): CategoryTotal[] =>
    [...map.entries()]
      .map(([category, total]) => ({
        category,
        total: round2(total)
      }))
      .sort((a, b) => b.total - a.total);

  return {
    totalExpenses: round2(totalExpenses),
    totalIncome: round2(totalIncome),
    balance: round2(totalIncome - totalExpenses),
    expenseTransactionCount: expenseCount,
    incomeTransactionCount: incomeCount,
    totalTransactionCount: expenseCount + incomeCount,
    expenseByCategory: mapToList(expenseMap),
    incomeByCategory: mapToList(incomeMap)
  };
}

export async function fetchFinanceAggregate(
  userId: string,
  rangeStartUtc: string,
  rangeEndUtcExclusive: string
): Promise<FinanceAggregate> {
  const { data, error } = await supabase
    .from("transactions")
    .select("amount, category, type")
    .eq("user_id", userId)
    .gte("created_at", rangeStartUtc)
    .lt("created_at", rangeEndUtcExclusive);

  if (error) {
    throw new Error(`Failed to fetch finance aggregate: ${error.message}`);
  }

  return aggregateRows((data ?? []) as TxRow[]);
}