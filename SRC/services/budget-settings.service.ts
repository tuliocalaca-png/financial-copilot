import { supabase } from "../db/supabase";
import { normalizeFreeText, parseLooseAmount } from "./transaction-helpers";

export type DailyLimitMode = "manual" | "auto";

export type UserBudgetSettingsRow = {
  user_id: string;
  monthly_budget: number;
  is_enabled: boolean;
  is_daily_limit_enabled: boolean;
  daily_limit_mode: DailyLimitMode;
  manual_daily_limit: number | null;
  created_at: string;
  updated_at: string;
};

export type BudgetCommandResult =
  | {
      handled: true;
      reply: string;
      patch: Partial<{
        monthly_budget: number;
        is_enabled: boolean;
        is_daily_limit_enabled: boolean;
        daily_limit_mode: DailyLimitMode;
        manual_daily_limit: number | null;
      }>;
    }
  | { handled: false };

function mapRow(data: Record<string, unknown>): UserBudgetSettingsRow {
  return {
    user_id: String(data.user_id),
    monthly_budget:
      typeof data.monthly_budget === "number"
        ? data.monthly_budget
        : typeof data.monthly_budget === "string"
          ? Number(data.monthly_budget)
          : 0,
    is_enabled: Boolean(data.is_enabled),
    is_daily_limit_enabled: Boolean(data.is_daily_limit_enabled),
    daily_limit_mode:
      data.daily_limit_mode === "manual" ? "manual" : "auto",
    manual_daily_limit:
      typeof data.manual_daily_limit === "number"
        ? data.manual_daily_limit
        : typeof data.manual_daily_limit === "string"
          ? Number(data.manual_daily_limit)
          : null,
    created_at: String(data.created_at ?? ""),
    updated_at: String(data.updated_at ?? "")
  };
}

export function parseBudgetSettingsCommand(message: string): BudgetCommandResult {
  const text = normalizeFreeText(message);
  if (!text) return { handled: false };

  // ── orçamento mensal ───────────────────────────────────────────────────────
  const hasOrcamento =
    text.includes("orcamento") ||
    text.includes("orçamento") ||
    text.includes("budget mensal") ||
    text.includes("meu mes custa");

  if (hasOrcamento) {
    const isDisable =
      text.includes("desativ") ||
      text.includes("remover orcamento") ||
      text.includes("cancelar orcamento") ||
      text.includes("sem orcamento");

    if (isDisable) {
      return {
        handled: true,
        reply: "Orçamento mensal removido 👍\nVocê pode definir um novo quando quiser: \"meu orçamento é 3000\".",
        patch: { is_enabled: false, monthly_budget: 0 }
      };
    }

    const amount = parseLooseAmount(text);
    if (amount != null && amount > 0) {
      const formatted = amount.toFixed(2).replace(".", ",");
      return {
        handled: true,
        reply: `Orçamento mensal definido: R$ ${formatted} ✅\n\nAgora você pode perguntar "quanto posso gastar hoje" a qualquer momento.`,
        patch: { is_enabled: true, monthly_budget: amount }
      };
    }

    // mentioned "orçamento" but no valid amount
    return {
      handled: true,
      reply: "Qual o valor do seu orçamento mensal?\n\nEx.: \"meu orçamento é 3000\"",
      patch: {}
    };
  }

  // ── limite diário (comandos legados) ──────────────────────────────────────
  if (text.includes("desativar limite diario") || text.includes("desligar limite diario")) {
    return {
      handled: true,
      reply: "Limite diário desligado 👍",
      patch: { is_daily_limit_enabled: false }
    };
  }

  if (text.includes("ativar limite diario") || text.includes("ligar limite diario")) {
    return {
      handled: true,
      reply: "Limite diário ligado no modo automático ✅",
      patch: { is_daily_limit_enabled: true, daily_limit_mode: "auto", manual_daily_limit: null }
    };
  }

  if (text.includes("limite diario automatico") || text.includes("limite diario automático") || text.includes("usar limite automatico") || text.includes("usar limite automático")) {
    return {
      handled: true,
      reply: "Limite diário ajustado para o modo automático ✅",
      patch: { is_daily_limit_enabled: true, daily_limit_mode: "auto", manual_daily_limit: null }
    };
  }

  if (text.includes("limite diario") || text.includes("limite diário")) {
    const amount = parseLooseAmount(text);
    if (amount != null) {
      return {
        handled: true,
        reply: `Limite diário manual ajustado para R$ ${amount.toFixed(2).replace('.', ',')} ✅`,
        patch: {
          is_daily_limit_enabled: true,
          daily_limit_mode: "manual",
          manual_daily_limit: amount
        }
      };
    }
  }

  return { handled: false };
}

export async function getBudgetSettings(userId: string): Promise<UserBudgetSettingsRow | null> {
  const { data, error } = await supabase
    .from("user_budget_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load budget settings: ${error.message}`);
  }

  return data ? mapRow(data as Record<string, unknown>) : null;
}

export async function upsertBudgetSettings(
  userId: string,
  patch: Partial<{
    monthly_budget: number;
    is_enabled: boolean;
    is_daily_limit_enabled: boolean;
    daily_limit_mode: DailyLimitMode;
    manual_daily_limit: number | null;
  }>
): Promise<UserBudgetSettingsRow> {
  const existing = await getBudgetSettings(userId);
  const payload = {
    user_id: userId,
    monthly_budget: patch.monthly_budget ?? existing?.monthly_budget ?? 0,
    is_enabled: patch.is_enabled ?? existing?.is_enabled ?? false,
    is_daily_limit_enabled: patch.is_daily_limit_enabled ?? existing?.is_daily_limit_enabled ?? false,
    daily_limit_mode: patch.daily_limit_mode ?? existing?.daily_limit_mode ?? "auto",
    manual_daily_limit:
      patch.manual_daily_limit !== undefined ? patch.manual_daily_limit : existing?.manual_daily_limit ?? null,
    updated_at: new Date().toISOString(),
    created_at: existing?.created_at ?? new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("user_budget_settings")
    .upsert(payload, { onConflict: "user_id" })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to save budget settings: ${error?.message ?? "unknown"}`);
  }

  return mapRow(data as Record<string, unknown>);
}
