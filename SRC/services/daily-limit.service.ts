import { DateTime } from "luxon";
import { DailyLimitResult } from "../core/types";
import { fetchFinanceAggregate } from "./spending-query.service";
import { getBudgetSettings } from "./budget-settings.service";
import { DEFAULT_TIMEZONE } from "./period-resolver.service";

function getMonthBounds() {
  const now = DateTime.now().setZone(DEFAULT_TIMEZONE);
  const monthStart = now.startOf("month");
  const monthEnd = monthStart.plus({ months: 1 });
  return { now, monthStart, monthEnd };
}

function calculateRemainingDays(now: DateTime): number {
  return Math.max(now.endOf("month").day - now.day + 1, 1);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function calculateDailyLimit(userId: string): Promise<DailyLimitResult> {
  const settings = await getBudgetSettings(userId);
  const { now, monthStart, monthEnd } = getMonthBounds();

  const todayStart = now.startOf("day");
  const todayEnd = todayStart.plus({ days: 1 });

  const [monthAggregate, todayAggregate] = await Promise.all([
    fetchFinanceAggregate(userId, monthStart.toUTC().toISO()!, monthEnd.toUTC().toISO()!),
    fetchFinanceAggregate(userId, todayStart.toUTC().toISO()!, todayEnd.toUTC().toISO()!)
  ]);

  const remainingDaysInMonth = calculateRemainingDays(now);
  const spentToday = todayAggregate.totalExpenses;
  const totalSpentMonth = monthAggregate.totalExpenses;

  // Sem orçamento configurado
  if (!settings || !settings.is_enabled || settings.monthly_budget <= 0) {
    return {
      totalSpentMonth,
      spentToday,
      remainingMonthBudget: 0,
      remainingDaysInMonth,
      dailyLimit: 0,
      monthlyBudget: 0,
      mode: "off",
      isEnabled: false,
      noBudgetSet: true
    };
  }

  // Fórmula: (orçamento - gasto no mês) / dias restantes
  const remainingMonthBudget = Math.max(settings.monthly_budget - totalSpentMonth, 0);
  const dailyLimit = remainingDaysInMonth > 0
    ? round2(remainingMonthBudget / remainingDaysInMonth)
    : 0;

  return {
    totalSpentMonth: round2(totalSpentMonth),
    spentToday: round2(spentToday),
    remainingMonthBudget: round2(remainingMonthBudget),
    remainingDaysInMonth,
    dailyLimit,
    monthlyBudget: settings.monthly_budget,
    mode: "manual",
    isEnabled: true,
    noBudgetSet: false
  };
}
