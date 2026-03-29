import { DateTime } from "luxon";
import { DailyLimitResult } from "../core/types";
import { fetchFinanceAggregate } from "./spending-query.service";
import { getBudgetSettings } from "./budget-settings.service";
import { fetchPlannedForecastSummary } from "./planned-transaction.service";
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

export async function calculateDailyLimit(userId: string): Promise<DailyLimitResult> {
  const settings = await getBudgetSettings(userId);
  const { now, monthStart, monthEnd } = getMonthBounds();

  const aggregate = await fetchFinanceAggregate(
    userId,
    monthStart.toUTC().toISO()!,
    monthEnd.toUTC().toISO()!
  );

  const planned = await fetchPlannedForecastSummary(
    userId,
    now.toISODate()!,
    monthEnd.minus({ days: 1 }).toISODate()!
  );

  const remainingDaysInMonth = calculateRemainingDays(now);
  const baseRemaining = aggregate.balance + planned.projectedBalance;

  if (!settings || !settings.is_daily_limit_enabled) {
    return {
      totalSpentMonth: aggregate.totalExpenses,
      remainingMonthBudget: baseRemaining,
      remainingDaysInMonth,
      dailyLimit: 0,
      mode: settings?.daily_limit_mode ?? "auto",
      isEnabled: false
    };
  }

  if (settings.daily_limit_mode === "manual" && (settings.manual_daily_limit ?? 0) > 0) {
    return {
      totalSpentMonth: aggregate.totalExpenses,
      remainingMonthBudget: baseRemaining,
      remainingDaysInMonth,
      dailyLimit: settings.manual_daily_limit ?? 0,
      mode: "manual",
      isEnabled: true
    };
  }

  const dailyLimit = baseRemaining / remainingDaysInMonth;

  return {
    totalSpentMonth: aggregate.totalExpenses,
    remainingMonthBudget: baseRemaining,
    remainingDaysInMonth,
    dailyLimit: Math.round(dailyLimit * 100) / 100,
    mode: "auto",
    isEnabled: true
  };
}
