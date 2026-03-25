import { DailyLimitResult } from "../core/types";
import { supabase } from "../db/supabase";

/** Positive amounts with these categories count as income (same table as expenses; no schema change). */
const INCOME_CATEGORIES = new Set([
  "receita",
  "receitas",
  "income",
  "entrada",
  "entradas",
  "salario",
  "rendimento",
  "deposito"
]);

function normalizeCategoryKey(category: string): string {
  return category
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isIncomeCategory(category: string): boolean {
  return INCOME_CATEGORIES.has(normalizeCategoryKey(category));
}

function getMonthBounds() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { now, monthStart, monthEnd };
}

function calculateRemainingDays(now: Date): number {
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.max(lastDay - now.getDate() + 1, 1);
}

export async function calculateDailyLimit(userId: string): Promise<DailyLimitResult> {
  const { now, monthStart, monthEnd } = getMonthBounds();

  const { data, error } = await supabase
    .from("transactions")
    .select("amount, category")
    .eq("user_id", userId)
    .gte("created_at", monthStart.toISOString())
    .lt("created_at", monthEnd.toISOString());

  if (error) {
    throw new Error(`Failed to fetch monthly transactions: ${error.message}`);
  }

  let totalIncome = 0;
  let totalExpenses = 0;

  for (const row of data ?? []) {
    const amount = Number(row.amount ?? 0);
    const category = typeof row.category === "string" ? row.category : "";
    if (isIncomeCategory(category)) {
      totalIncome += amount;
    } else {
      totalExpenses += amount;
    }
  }

  const fallbackMonthlyBudget = 3000;
  const balance = totalIncome > 0 ? totalIncome - totalExpenses : fallbackMonthlyBudget - totalExpenses;
  const totalSpentMonth = totalExpenses;
  const remainingMonthBudget = balance;
  const remainingDaysInMonth = calculateRemainingDays(now);
  const dailyLimit = remainingMonthBudget / remainingDaysInMonth;

  return {
    totalSpentMonth,
    remainingMonthBudget,
    remainingDaysInMonth,
    dailyLimit
  };
}
