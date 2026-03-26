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

function requestsCategoryBreakdown(message: string): boolean {
  const text = normalize(message);

  return (
    text.includes("por categoria") ||
    text.includes("por categorias") ||
    text.includes("separado por categoria") ||
    text.includes("separadas por categoria") ||
    text.includes("quais categorias")
  );
}

function requestsTransactionDetail(message: string): boolean {
  const text = normalize(message);

  return (
    text.includes("lancamento") ||
    text.includes("lancamentos") ||
    text.includes("lançamento") ||
    text.includes("lançamentos") ||
    text.includes("detalha") ||
    text.includes("detalhar") ||
    text.includes("abre os lancamentos") ||
    text.includes("abre os lançamentos") ||
    text.includes("abre por lancamento") ||
    text.includes("abre por lançamento") ||
    text.includes("abre pro lancamento") ||
    text.includes("abre pro lançamento") ||
    (text.includes("abre") && text.includes("lanc"))
  );
}

function resolveRequestedDetailLevel(message: string): QueryDetailLevel {
  if (requestsTransactionDetail(message)) {
    return "transaction";
  }

  if (requestsCategoryBreakdown(message)) {
    return "category";
  }

  return "summary";
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

function hasIncomeVerb(text: string): boolean {
  return (
    /\brecebi\b/.test(text) ||
    /\bentrou\b/.test(text) ||
    /\bcaiu\b/.test(text) ||
    /\bganhei\b/.test(text) ||
    /\bfaturei\b/.test(text) ||
    /\bfaturou\b/.test(text)
  );
}

function hasBalanceVerb(text: string): boolean {
  return (
    /\bsaldo\b/.test(text) ||
    /\bsobrou\b/.test(text) ||
    /\brestou\b/.test(text) ||
    /\bresultado\b/.test(text)
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

function detectQueryType(message: string): QueryType | null {
  const text = normalize(message);

  if (hasBalanceVerb(text) || text.includes("quanto sobrou")) {
    return "balance";
  }

  if (
    hasIncomeVerb(text) ||
    text.includes("quanto recebi") ||
    text.includes("quanto entrou") ||
    text.includes("quanto caiu")
  ) {
    return "income";
  }

  if (
    hasExpenseVerb(text) ||
    text.includes("quanto gastei") ||
    text.includes("quanto saiu") ||
    text.includes("meus gastos")
  ) {
    return "expense";
  }

  return null;
}

function hasFinanceInquiryIntent(message: string): boolean {
  const text = normalize(message);

  if (
    /\brelatorio\b/.test(text) ||
    /\brelatorios\b/.test(text) ||
    /relatório/.test(message.toLowerCase()) ||
    /relatórios/.test(message.toLowerCase())
  ) {
    return false;
  }

  return (
    detectQueryType(text) !== null ||
    (hasTotalLanguage(text) && hasPeriodLanguage(text))
  );
}

function isContextualFollowUp(message: string): boolean {
  const text = normalize(message);

  return (
    requestsCategoryBreakdown(text) ||
    requestsTransactionDetail(text) ||
    text.includes("detalha isso") ||
    text.includes("abre isso") ||
    text.includes("separa isso")
  );
}

export type InboundResolution =
  | { kind: "report_settings"; result: Extract<ReportCommandResult, { handled: true }> }
  | {
      kind: "spending_query";
      queryType: QueryType;
      period: ResolvedPeriod;
      byCategory: boolean;
      detailLevel: QueryDetailLevel;
    }
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

  const explicitPeriod = resolvePeriodFromMessage(trimmed);
  const requestedDetailLevel = resolveRequestedDetailLevel(trimmed);
  const queryType = detectQueryType(trimmed);

  if (
    explicitPeriod &&
    !parsedExpense &&
    (queryType !== null || hasTotalLanguage(normalized))
  ) {
    return {
      kind: "spending_query",
      queryType: queryType ?? "expense",
      period: explicitPeriod,
      byCategory: requestedDetailLevel !== "summary",
      detailLevel: requestedDetailLevel
    };
  }

  if (hasFinanceInquiryIntent(trimmed)) {
    return {
      kind: "spending_query",
      queryType: queryType ?? "expense",
      period: explicitPeriod ?? defaultMonthPeriod(),
      byCategory: requestedDetailLevel !== "summary",
      detailLevel: requestedDetailLevel
    };
  }

  if (explicitPeriod && !parsedExpense) {
    const context = await getQueryContext(userId);

    if (
      context &&
      context.kind === "spending_period" &&
      (normalized.startsWith("e ") || normalized.startsWith("e,") || hasPeriodLanguage(normalized))
    ) {
      return {
        kind: "spending_query",
        queryType: context.query_type,
        period: explicitPeriod,
        byCategory: context.by_category,
        detailLevel: context.detail_level
      };
    }
  }

  if (isContextualFollowUp(trimmed)) {
    const context = await getQueryContext(userId);

    if (
      context &&
      context.kind === "spending_period" &&
      context.period_start_utc &&
      context.period_end_utc &&
      context.period_label
    ) {
      const nextDetailLevel =
        requestedDetailLevel === "summary"
          ? context.detail_level
          : requestedDetailLevel;

      const nextByCategory =
        nextDetailLevel === "summary"
          ? false
          : requestsCategoryBreakdown(trimmed) ||
            context.by_category ||
            nextDetailLevel === "transaction";

      return {
        kind: "spending_query",
        queryType: context.query_type,
        period: {
          rangeStartUtc: context.period_start_utc,
          rangeEndUtc: context.period_end_utc,
          label: context.period_label
        },
        byCategory: nextByCategory,
        detailLevel: nextDetailLevel
      };
    }
  }

  if (parsedExpense) {
    return { kind: "expense", parsed: parsedExpense };
  }

  return { kind: "generic" };
}