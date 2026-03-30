import { supabase } from "../db/supabase";

export type QueryContextKind = "spending_period";
export type QueryDetailLevel = "summary" | "category" | "transaction";
export type QueryType =
  | "expense"
  | "income"
  | "balance"
  | "payable"
  | "receivable"
  | "projected_balance"
  | "daily_limit"
  | "budget_amount_pending";

export type UserQueryContextRow = {
  user_id: string;
  kind: QueryContextKind;
  query_type: QueryType;
  period_start_utc: string | null;
  period_end_utc: string | null;
  period_label: string | null;
  by_category: boolean;
  detail_level: QueryDetailLevel;
  source: string;
  updated_at: string;
};

export type UpsertQueryContextInput = {
  kind: QueryContextKind;
  queryType?: QueryType;
  periodStartUtc: string;
  periodEndUtc: string;
  periodLabel: string;
  byCategory?: boolean;
  detailLevel?: QueryDetailLevel;
  source?: string;
};

function mapQueryType(value: unknown): QueryType {
  switch (value) {
    case "income":
    case "balance":
    case "payable":
    case "receivable":
    case "projected_balance":
    case "daily_limit":
    case "budget_amount_pending":
      return value;
    default:
      return "expense";
  }
}

function mapQueryContextRow(data: Record<string, unknown>): UserQueryContextRow {
  return {
    user_id: String(data.user_id),
    kind: "spending_period",
    query_type: mapQueryType(data.query_type),
    period_start_utc:
      typeof data.period_start_utc === "string" ? data.period_start_utc : null,
    period_end_utc:
      typeof data.period_end_utc === "string" ? data.period_end_utc : null,
    period_label:
      typeof data.period_label === "string" ? data.period_label : null,
    by_category: Boolean(data.by_category),
    detail_level:
      data.detail_level === "category" || data.detail_level === "transaction"
        ? (data.detail_level as QueryDetailLevel)
        : "summary",
    source: typeof data.source === "string" ? data.source : "query",
    updated_at: String(data.updated_at ?? "")
  };
}

export async function getQueryContext(
  userId: string
): Promise<UserQueryContextRow | null> {
  const { data, error } = await supabase
    .from("user_query_contexts")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load query context: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapQueryContextRow(data as Record<string, unknown>);
}

export async function upsertQueryContext(
  userId: string,
  input: UpsertQueryContextInput
): Promise<UserQueryContextRow> {
  const payload = {
    user_id: userId,
    kind: input.kind,
    query_type: input.queryType ?? "expense",
    period_start_utc: input.periodStartUtc,
    period_end_utc: input.periodEndUtc,
    period_label: input.periodLabel,
    by_category: input.byCategory ?? false,
    detail_level: input.detailLevel ?? "summary",
    source: input.source ?? "query",
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("user_query_contexts")
    .upsert(payload, { onConflict: "user_id" })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to save query context: ${error?.message ?? "unknown"}`);
  }

  return mapQueryContextRow(data as Record<string, unknown>);
}