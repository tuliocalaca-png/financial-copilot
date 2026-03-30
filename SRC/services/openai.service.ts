import { DailyLimitResult } from "../core/types";
import type { PlannedTransaction } from "./planned-transaction.service";

type Aggregate = {
  totalExpenses: number;
  totalIncome: number;
  balance: number;
};

function brl(value: number): string {
  return `R$ ${value.toFixed(2).replace(".", ",")}`;
}

function dueDateLabel(isoDate: string): string {
  // "2024-03-05" → "05/03"
  const parts = isoDate.split("-");
  if (parts.length < 3) return isoDate;
  return `${parts[2]}/${parts[1]}`;
}

export function formatSpendingResponse(params: {
  periodLabel: string;
  aggregate: Aggregate;
  details?: any[] | null;
  byCategory?: boolean;
}): string {
  const { periodLabel, aggregate } = params;

  return `📊 ${periodLabel}
Entradas: ${brl(aggregate.totalIncome)}
Saídas: ${brl(aggregate.totalExpenses)}
Saldo: ${brl(aggregate.balance)}`;
}

// =========================
// 💰 DAILY LIMIT
// =========================
export function formatDailyLimitResponse(result: DailyLimitResult): string {
  if (result.noBudgetSet) {
    return (
      "Ainda não configurei seu orçamento mensal 📋\n\n" +
      "Me manda o valor para eu calcular quanto você pode gastar por dia:\n" +
      "\"meu orçamento é 3000\""
    );
  }

  if (!result.isEnabled) {
    return "Você não tem orçamento mensal ativo.\n\nPara ativar: \"meu orçamento é 3000\"";
  }

  const availableToday = Math.max(result.dailyLimit - result.spentToday, 0);

  return [
    `💰 Limite diário`,
    `Orçamento mensal: ${brl(result.monthlyBudget)}`,
    `Gasto no mês: ${brl(result.totalSpentMonth)}`,
    `Restante no mês: ${brl(result.remainingMonthBudget)}`,
    `Dias restantes: ${result.remainingDaysInMonth}`,
    ``,
    `Pode gastar hoje: ${brl(result.dailyLimit)}`,
    `Gasto hoje: ${brl(result.spentToday)}`,
    `Disponível hoje: ${brl(availableToday)}`
  ].join("\n");
}

// =========================
// 📅 FORECAST
// =========================
export function formatForecastResponse(params: {
  queryType: "payable" | "receivable" | "projected_balance";
  planned: PlannedTransaction[];
  periodLabel: string;
  realBalance?: number;
}): string {
  const { queryType, planned, periodLabel, realBalance } = params;

  const receivables = planned.filter((p) => p.kind === "income");
  const payables = planned.filter((p) => p.kind === "expense");

  const totalReceivable = receivables.reduce((s, p) => s + p.amount, 0);
  const totalPayable = payables.reduce((s, p) => s + p.amount, 0);

  function itemLines(items: PlannedTransaction[]): string {
    if (items.length === 0) return "  (nenhuma)";
    return items
      .map((p) => `  • ${p.description} — ${brl(p.amount)} (vence ${dueDateLabel(p.dueDate)})`)
      .join("\n");
  }

  if (queryType === "receivable") {
    return [
      `📅 A receber (${periodLabel})`,
      itemLines(receivables),
      `Total: ${brl(totalReceivable)}`
    ].join("\n");
  }

  if (queryType === "payable") {
    return [
      `📅 A pagar (${periodLabel})`,
      itemLines(payables),
      `Total: ${brl(totalPayable)}`
    ].join("\n");
  }

  // projected_balance
  const real = realBalance ?? 0;
  const projected = real + totalReceivable - totalPayable;

  return [
    `📊 Saldo projetado (${periodLabel})`,
    `Saldo real: ${brl(real)}`,
    `+ A receber: ${brl(totalReceivable)}`,
    `- A pagar: ${brl(totalPayable)}`,
    `─────────────`,
    `Projeção: ${brl(projected)}`
  ].join("\n");
}
