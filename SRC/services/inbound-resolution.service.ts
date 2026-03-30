import type { ParsedExpense } from "../core/types";
import { parseExpense } from "./expense-parser.service";
import {
  defaultMonthPeriod,
  resolvePeriodFromMessage,
  type ResolvedPeriod
} from "./period-resolver.service";
import {
  parseReportSettingsCommand,
  type ReportCommandResult
} from "./report-settings.service";
import {
  getQueryContext,
  type QueryDetailLevel,
  type QueryType
} from "./query-context.service";

type ActualQueryType = "expense" | "income" | "balance" | "daily_limit";
type ForecastQueryType = "payable" | "receivable" | "projected_balance";
import { parseBudgetSettingsCommand, type BudgetCommandResult } from "./budget-settings.service";
import {
  parsePlannedTransaction,
  detectSettleIntent,
  type PlannedTransaction,
  type SettleIntent
} from "./planned-transaction.service";
import { normalizeFreeText } from "./transaction-helpers";

function countNumericAmountLikeTokens(message: string): number {
  const normalized = message.toLowerCase();
  const numbers = normalized.match(/\d+([.,]\d+)?/g);
  return numbers?.length ?? 0;
}

function requestsCategoryBreakdown(message: string): boolean {
  const text = normalizeFreeText(message);
  return (
    text.includes("por categoria") ||
    text.includes("por categorias") ||
    text.includes("separado por categoria") ||
    text.includes("separadas por categoria") ||
    text.includes("quais categorias")
  );
}

function requestsTransactionDetail(message: string): boolean {
  const text = normalizeFreeText(message);
  return (
    text.includes("lancamento") ||
    text.includes("lancamentos") ||
    text.includes("detalha") ||
    text.includes("detalhar") ||
    text.includes("abre os lancamentos") ||
    text.includes("abre por lancamento") ||
    text.includes("abre pro lancamento") ||
    (text.includes("abre") && text.includes("lanc"))
  );
}

function resolveRequestedDetailLevel(message: string): QueryDetailLevel {
  if (requestsTransactionDetail(message)) return "transaction";
  if (requestsCategoryBreakdown(message)) return "category";
  return "summary";
}

function detectActualQueryType(message: string): ActualQueryType | null {
  const text = normalizeFreeText(message);

  if (text.includes("quanto posso gastar hoje") || text.includes("meu limite diario") || text.includes("limite diario de hoje")) {
    return "daily_limit";
  }

  if (text.includes("quanto sobrou") || text.includes("qual meu saldo") || text.includes("quanto restou") || text.includes("saldo do mes") || text.includes("saldo do mês")) {
    return "balance";
  }

  if (text.includes("quanto recebi") || text.includes("quanto entrou") || text.includes("quanto caiu") || text.includes("quanto ganhei") || text.includes("entradas")) {
    return "income";
  }

  if (text.includes("quanto gastei") || text.includes("quanto saiu") || text.includes("meus gastos") || text.includes("saidas") || text.includes("saídas")) {
    return "expense";
  }

  return null;
}

function detectForecastQueryType(message: string): ForecastQueryType | null {
  const text = normalizeFreeText(message);

  if (text.includes("saldo projetado") || text.includes("saldo futuro") || text.includes("quanto vou ter") || text.includes("quanto terei")) {
    return "projected_balance";
  }

  if (text.includes("tenho a receber") || text.includes("vou receber") || text.includes("quanto entra") || text.includes("quanto vou receber")) {
    return "receivable";
  }

  if (text.includes("tenho a pagar") || text.includes("vou pagar") || text.includes("quanto vence") || text.includes("quanto vou pagar")) {
    return "payable";
  }

  return null;
}

function hasFinanceInquiryIntent(message: string): boolean {
  const text = normalizeFreeText(message);
  if (text.includes("relatorio") || text.includes("relatorios")) return false;
  return detectActualQueryType(message) !== null || detectForecastQueryType(message) !== null;
}

function isContextualFollowUp(message: string): boolean {
  const text = normalizeFreeText(message);
  return (
    requestsCategoryBreakdown(text) ||
    requestsTransactionDetail(text) ||
    text.includes("detalha isso") ||
    text.includes("abre isso") ||
    text.includes("separa isso") ||
    text.startsWith("e ")
  );
}

export type InboundResolution =
  | { kind: "report_settings"; result: Extract<ReportCommandResult, { handled: true }> }
  | { kind: "daily_limit_settings"; result: Extract<BudgetCommandResult, { handled: true }> }
  | { kind: "daily_limit_query" }
  | {
      kind: "planned_transaction";
      transaction: PlannedTransaction;
    }
  | {
      kind: "planned_transaction_missing_amount";
      reply: string;
    }
  | (SettleIntent & { kind: "planned_transaction_settle" })
  | {
      kind: "forecast_query";
      queryType: Extract<QueryType, "payable" | "receivable" | "projected_balance">;
      period: ResolvedPeriod;
      detailLevel: QueryDetailLevel;
    }
  | {
      kind: "spending_query";
      queryType: Extract<QueryType, "expense" | "income" | "balance">;
      period: ResolvedPeriod;
      byCategory: boolean;
      detailLevel: QueryDetailLevel;
    }
  | { kind: "expense"; parsed: ParsedExpense }
  | { kind: "multi_expense_warning" }
  | { kind: "generic" };

export async function resolveInboundMessage(userId: string, message: string): Promise<InboundResolution> {
  const trimmed = message.trim();
  const normalized = normalizeFreeText(trimmed);

  const reportCmd = parseReportSettingsCommand(trimmed);
  if (reportCmd.handled) {
    return { kind: "report_settings", result: reportCmd };
  }

  const budgetCmd = parseBudgetSettingsCommand(trimmed);
  if (budgetCmd.handled) {
    return { kind: "daily_limit_settings", result: budgetCmd };
  }

  if (detectActualQueryType(trimmed) === "daily_limit") {
    return { kind: "daily_limit_query" };
  }

  const settleIntent = detectSettleIntent(trimmed);
  if (settleIntent) {
    return { kind: "planned_transaction_settle", ...settleIntent };
  }

  const planned = parsePlannedTransaction(trimmed);
  if (planned.kind === "missing_amount") {
    return { kind: "planned_transaction_missing_amount", reply: planned.reply };
  }
  if (planned.kind === "parsed") {
    return { kind: "planned_transaction", transaction: planned.transaction };
  }

  const parsedExpense = parseExpense(trimmed);
  if (countNumericAmountLikeTokens(trimmed) > 1 && !parsedExpense) {
    return { kind: "multi_expense_warning" };
  }

  if (parsedExpense) {
    return { kind: "expense", parsed: parsedExpense };
  }

  const explicitPeriod = resolvePeriodFromMessage(trimmed) ?? defaultMonthPeriod();
  const requestedDetailLevel = resolveRequestedDetailLevel(trimmed);
  const actualQueryType = detectActualQueryType(trimmed);
  const forecastQueryType = detectForecastQueryType(trimmed);

  if (actualQueryType && actualQueryType !== "daily_limit") {
    return {
      kind: "spending_query",
      queryType: actualQueryType,
      period: explicitPeriod,
      byCategory: requestedDetailLevel !== "summary",
      detailLevel: requestedDetailLevel
    };
  }

  if (forecastQueryType) {
    return {
      kind: "forecast_query",
      queryType: forecastQueryType,
      period: explicitPeriod,
      detailLevel: requestedDetailLevel
    };
  }

  if (isContextualFollowUp(trimmed)) {
    const context = await getQueryContext(userId);
    if (context) {
      const nextDetailLevel = requestedDetailLevel === "summary" ? context.detail_level : requestedDetailLevel;
      const nextByCategory = nextDetailLevel !== "summary";

      if (context.query_type === "payable" || context.query_type === "receivable" || context.query_type === "projected_balance") {
        return {
          kind: "forecast_query",
          queryType: context.query_type,
          period: {
            rangeStartUtc: context.period_start_utc ?? explicitPeriod.rangeStartUtc,
            rangeEndUtc: context.period_end_utc ?? explicitPeriod.rangeEndUtc,
            label: context.period_label ?? explicitPeriod.label
          },
          detailLevel: nextDetailLevel
        };
      }

      if (context.query_type === "daily_limit") {
        return { kind: "daily_limit_query" };
      }

      return {
        kind: "spending_query",
        queryType: context.query_type as Extract<QueryType, "expense" | "income" | "balance">,
        period: {
          rangeStartUtc: context.period_start_utc ?? explicitPeriod.rangeStartUtc,
          rangeEndUtc: context.period_end_utc ?? explicitPeriod.rangeEndUtc,
          label: context.period_label ?? explicitPeriod.label
        },
        byCategory: nextByCategory,
        detailLevel: nextDetailLevel
      };
    }
  }

  if (hasFinanceInquiryIntent(trimmed)) {
    return {
      kind: "spending_query",
      queryType: "expense",
      period: explicitPeriod,
      byCategory: requestedDetailLevel !== "summary",
      detailLevel: requestedDetailLevel
    };
  }

  return { kind: "generic" };
}