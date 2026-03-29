import { DailyLimitResult } from "../core/types";

type Aggregate = {
  totalExpenses: number;
  totalIncome: number;
  balance: number;
};

export function formatSpendingResponse(params: {
  periodLabel: string;
  aggregate: Aggregate;
  details?: any[] | null;
  byCategory?: boolean;
}): string {
  const { periodLabel, aggregate } = params;

  return `📊 ${periodLabel}
Entradas: R$ ${aggregate.totalIncome.toFixed(2)}
Saídas: R$ ${aggregate.totalExpenses.toFixed(2)}
Saldo: R$ ${aggregate.balance.toFixed(2)}`;
}

// =========================
// 🆕 DAILY LIMIT
// =========================
export function formatDailyLimitResponse(
  result: DailyLimitResult
): string {
  if (!result.isEnabled) {
    return "Você não tem limite diário ativo.";
  }

  return `📊 Limite diário
Modo: ${result.mode}
Restante no mês: R$ ${result.remainingMonthBudget.toFixed(2)}
Dias restantes: ${result.remainingDaysInMonth}
Pode gastar hoje: R$ ${result.dailyLimit.toFixed(2)}`;
}

// =========================
// 🆕 FORECAST
// =========================
export function formatForecastResponse(params: {
  queryType: "payable" | "receivable" | "projected_balance";
  planned: any[];
  periodLabel: string;
}): string {
  const { queryType, planned, periodLabel } = params;

  const totalIncome = planned
    .filter((p) => p.type === "income")
    .reduce((sum, p) => sum + p.amount, 0);

  const totalExpense = planned
    .filter((p) => p.type === "expense")
    .reduce((sum, p) => sum + p.amount, 0);

  if (queryType === "receivable") {
    return `📅 A receber (${periodLabel})
Total: R$ ${totalIncome.toFixed(2)}`;
  }

  if (queryType === "payable") {
    return `📅 A pagar (${periodLabel})
Total: R$ ${totalExpense.toFixed(2)}`;
  }

  if (queryType === "projected_balance") {
    const balance = totalIncome - totalExpense;

    return `📊 Saldo projetado (${periodLabel})
Entradas futuras: R$ ${totalIncome.toFixed(2)}
Saídas futuras: R$ ${totalExpense.toFixed(2)}
Saldo: R$ ${balance.toFixed(2)}`;
  }

  return "Não consegui calcular.";
}