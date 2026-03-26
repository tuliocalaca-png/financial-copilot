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
import { getQueryContext } from "./query-context.service";

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalize(text: string): string {
  return stripAccents(text.toLowerCase()).replace(/\s+/g, " ").trim();
}

function countNumericAmountLikeTokens(message: string): number {
  const normalized = message.toLowerCase();
  const numbers = normalized.match(/\d+([.,]\d+)?/g);
  return numbers?.length ?? 0;
}

export function messageRequestsCategoryBreakdown(message: string): boolean {
  const text = normalize(message);

  return (
    text.includes("por categoria") ||
    text.includes("por categorias") ||
    text.includes("separado por categoria") ||
    text.includes("separadas por categoria") ||
    text.includes("separado por categorias") ||
    text.includes("separadas por categorias")
  );
}

function hasExpenseVerb(text: string): boolean {
  return (
    /\bgastei\b/.test(text) ||
    /\bgaste\b/.test(text) ||
    /\bgastou\b/.test(text) ||
    /\bgasto\b/.test(text) ||
    /\bgastos\b/.test(text)
  );
}

function hasTotalLanguage(text: string): boolean {
  return (
    /\bquanto\b/.test(text) ||
    /\bqnt\b/.test(text) ||
    /\bqnto\b/.test(text) ||
    /\btotal\b/.test(text) ||
    /\bsoma\b/.test(text) ||
    /\bdeu quanto\b/.test(text) ||
    /\bquanto foi\b/.test(text) ||
    /\bquanto saiu\b/.test(text) ||
    /\bqual foi\b/.test(text) ||
    /\bme mostra\b/.test(text) ||
    /\bmostrar\b/.test(text)
  );
}

function hasPeriodLanguage(text: string): boolean {
  return (
    /\bhoje\b/.test(text) ||
    /\bhj\b/.test(text) ||
    /\bontem\b/.test(text) ||
    /\bsemana\b/.test(text) ||
    /\bmes\b/.test(text) ||
    /\bm[eê]s\b/.test(text) ||
    /\bpassad[ao]\b/.test(text) ||
    /\banterior\b/.test(text) ||
    /\batual\b/.test(text) ||
    /\b\d{1,2}\/\d{1,2}(?:\/(?:19\d{2}|20\d{2}))?\b/.test(text) ||
    /\b\d{1,2}\s+de\s+[a-zç]+\b/.test(text)
  );
}

export function hasSpendingInquiryIntent(message: string): boolean {
  const text = normalize(message);

  if (
    /\brelatorio\b/.test(text) ||
    /\brelatorios\b/.test(text) ||
    /relatório/.test(message.toLowerCase()) ||
    /relatórios/.test(message.toLowerCase())
  ) {
    return false;
  }

  return Boolean(
    (hasTotalLanguage(text) && hasExpenseVerb(text)) ||
      (hasPeriodLanguage(text) && hasExpenseVerb(text)) ||
      /\bdeu quanto\b/.test(text) ||
      /\bquanto foi\b/.test(text) ||
      /\bquanto saiu\b/.test(text) ||
      /\bmeu gasto\b/.test(text) ||
      /\bmeus gastos\b/.test(text) ||
      /\btotal de gastos\b/.test(text) ||
      /\btotal gasto\b/.test(text)
  );
}

function isContextualCategoryFollowUp(message: string): boolean {
  const text = normalize(message);

  return (
    text.includes("categoria") ||
    text.includes("categorias") ||
    text.includes("por categoria") ||
    text.includes("por categorias") ||
    text.includes("detalha isso") ||
    text.includes("detalha") ||
    text.includes("abre isso") ||
    text.includes("abre os lancamentos") ||
    text.includes("abra os lancamentos") ||
    text.includes("separa isso") ||
    text.includes("separa por categoria") ||
    text.includes("quebra por categoria") ||
    text.includes("quais categorias")
  );
}

export type InboundResolution =
  | { kind: "report_settings"; result: Extract<ReportCommandResult, { handled: true }> }
  | { kind: "spending_query"; period: ResolvedPeriod; byCategory: boolean }
  | { kind: "expense"; parsed: ParsedExpense }
  | { kind: "multi_expense_warning" }
  | { kind: "generic" };

export async function resolveInboundMessage(
  userId: string,
  message: string
): Promise<InboundResolution> {
  const trimmed = message.trim();
  const normalized = normalize(trimmed);

  const reportCmd = parseReportSettingsCommand(trimmed);
  if (reportCmd.handled) {
    return { kind: "report_settings", result: reportCmd };
  }

  const parsedExpense = parseExpense(trimmed);

  if (countNumericAmountLikeTokens(trimmed) > 1 && !parsedExpense) {
    return { kind: "multi_expense_warning" };
  }

  const periodFromText = resolvePeriodFromMessage(trimmed);

  if (
    periodFromText &&
    !parsedExpense &&
    (hasExpenseVerb(normalized) || hasTotalLanguage(normalized))
  ) {
    return {
      kind: "spending_query",
      period: periodFromText,
      byCategory: messageRequestsCategoryBreakdown(trimmed)
    };
  }

  if (hasSpendingInquiryIntent(trimmed)) {
    return {
      kind: "spending_query",
      period: resolvePeriodFromMessage(trimmed) ?? defaultMonthPeriod(),
      byCategory: messageRequestsCategoryBreakdown(trimmed)
    };
  }

  if (isContextualCategoryFollowUp(trimmed)) {
    const context = await getQueryContext(userId);

    if (
      context &&
      context.kind === "spending_period" &&
      context.period_start_utc &&
      context.period_end_utc &&
      context.period_label
    ) {
      return {
        kind: "spending_query",
        period: {
          rangeStartUtc: context.period_start_utc,
          rangeEndUtc: context.period_end_utc,
          label: context.period_label
        },
        byCategory: true
      };
    }
  }

  if (parsedExpense) {
    return { kind: "expense", parsed: parsedExpense };
  }

  return { kind: "generic" };
}