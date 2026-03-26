import { supabase } from "../db/supabase";
import {
  isExpenseCategory,
  isIncomeCategory,
  normalizeCategoryKey
} from "./transaction-helpers";

export type CategoryTotal = {
  category: string;
  total: number;
};

export type FinanceQueryType = "expense" | "income" | "balance";

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

function buildCategoryList(map: Map<string, number>): CategoryTotal[] {
  return [...map.entries()]
    .map(([category, total]) => ({
      category,
      total: round2(total)
    }))
    .sort((a, b) => b.total - a.total);
}

function sumRows(rows: TxRow[]): FinanceAggregate {
  const expenseByCategoryMap = new Map<string, number>();
  const incomeByCategoryMap = new Map<string, number>();

  let totalExpenses = 0;
  let totalIncome = 0;
  let expenseTransactionCount = 0;
  let incomeTransactionCount = 0;

  for (const row of rows) {
    const categoryKey = normalizeCategoryKey(row.category);
    const amount = Number(row.amount ?? 0);

    if (!Number.isFinite(amount) || amount <= 0) {
      continue;
    }

    if (isIncomeCategory(categoryKey)) {
      totalIncome += amount;
      incomeTransactionCount += 1;
      incomeByCategoryMap.set(
        categoryKey,
        (incomeByCategoryMap.get(categoryKey) ?? 0) + amount
      );
      continue;
    }

    if (isExpenseCategory(categoryKey)) {
      totalExpenses += amount;
      expenseTransactionCount += 1;
      expenseByCategoryMap.set(
        categoryKey,
        (expenseByCategoryMap.get(categoryKey) ?? 0) + amount
      );
    }
  }

  return {
    totalExpenses: round2(totalExpenses),
    totalIncome: round2(totalIncome),
    balance: round2(totalIncome - totalExpenses),
    expenseTransactionCount,
    incomeTransactionCount,
    totalTransactionCount: expenseTransactionCount + incomeTransactionCount,
    expenseByCategory: buildCategoryList(expenseByCategoryMap),
    incomeByCategory: buildCategoryList(incomeByCategoryMap)
  };
}

export async function fetchFinanceAggregate(
  userId: string,
  rangeStartUtc: string,
  rangeEndUtcExclusive: string
): Promise<FinanceAggregate> {
  const { data, error } = await supabase
    .from("transactions")
    .select("amount, category")
    .eq("user_id", userId)
    .gte("created_at", rangeStartUtc)
    .lt("created_at", rangeEndUtcExclusive);

  if (error) {
    throw new Error(`Failed to fetch finance aggregate: ${error.message}`);
  }

  return sumRows((data ?? []) as TxRow[]);
}

export async function fetchSpendingAggregate(
  userId: string,
  rangeStartUtc: string,
  rangeEndUtcExclusive: string
): Promise<SpendingAggregate> {
  const aggregate = await fetchFinanceAggregate(
    userId,
    rangeStartUtc,
    rangeEndUtcExclusive
  );

  return {
    total: aggregate.totalExpenses,
    transactionCount: aggregate.expenseTransactionCount,
    byCategory: aggregate.expenseByCategory
  };
}