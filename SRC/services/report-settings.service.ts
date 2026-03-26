import { supabase } from "../db/supabase";

export type ReportFrequency = "daily" | "weekly" | "monthly";

export type UserReportSettingsRow = {
  user_id: string;
  is_enabled: boolean;
  frequencies: ReportFrequency[];
  time_of_day: string;
  timezone: string;
  include_categories: boolean;
  last_run_daily: string | null;
  last_run_weekly: string | null;
  last_run_monthly: string | null;
  created_at: string;
  updated_at: string;
};

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function normalizeTimeOfDay(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}

function parseTimeFromText(text: string): string | null {
  // 20:30
  const hhmm = text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (hhmm) {
    const hour = Number(hhmm[1]);
    const minute = Number(hhmm[2]);

    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return normalizeTimeOfDay(hour, minute);
    }
  }

  // 20h30 / às 20h30
  const hCompact = text.match(/\b(?:as|às|a)?\s*(\d{1,2})h(\d{2})\b/);
  if (hCompact) {
    const hour = Number(hCompact[1]);
    const minute = Number(hCompact[2]);

    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return normalizeTimeOfDay(hour, minute);
    }
  }

  // às 20h / as 20 h
  const hOnly = text.match(/\b(?:as|às|a)\s*(\d{1,2})\s*h(?:oras)?\b/);
  if (hOnly) {
    const hour = Number(hOnly[1]);

    if (hour >= 0 && hour <= 23) {
      return normalizeTimeOfDay(hour, 0);
    }
  }

  // 20 horas
  const horas = text.match(/\b(\d{1,2})\s+horas\b/);
  if (horas) {
    const hour = Number(horas[1]);

    if (hour >= 0 && hour <= 23) {
      return normalizeTimeOfDay(hour, 0);
    }
  }

  return null;
}

function uniqFrequencies(list: ReportFrequency[]): ReportFrequency[] {
  const ordered: ReportFrequency[] = ["daily", "weekly", "monthly"];
  const set = new Set(list);
  return ordered.filter((freq) => set.has(freq));
}

export type ReportCommandPatch = Partial<{
  is_enabled: boolean;
  frequencies: ReportFrequency[];
  time_of_day: string;
  include_categories: boolean;
}>;

export type ReportCommandResult =
  | {
      handled: true;
      reply: string;
      patch: ReportCommandPatch;
    }
  | { handled: false };

/**
 * Parser determinístico de comandos de relatório em PT-BR.
 * Não inventa horário nem periodicidade ausentes na frase.
 */
export function parseReportSettingsCommand(message: string): ReportCommandResult {
  const raw = message.trim();
  if (!raw) {
    return { handled: false };
  }

  const lower = raw.toLowerCase();
  const text = stripAccents(lower).replace(/\s+/g, " ");

  const mentionsReport =
    /\brelatorio\b/.test(text) ||
    /\brelatorios\b/.test(text) ||
    lower.includes("relatório") ||
    lower.includes("relatórios");

  const mentionsScheduleWord =
    mentionsReport ||
    /\bdiario\b/.test(text) ||
    /\bsemanal\b/.test(text) ||
    /\bmensal\b/.test(text);

  if (!mentionsScheduleWord) {
    return { handled: false };
  }

  const parsedTime = parseTimeFromText(text);

  const wantsTimeChange =
    parsedTime != null &&
    (
      /\bmude\b/.test(text) ||
      /\bajusta\b/.test(text) ||
      /\baltera\b/.test(text) ||
      /\btroca\b/.test(text) ||
      /\bhorario\b/.test(text) ||
      lower.includes("horário")
    );

  if (wantsTimeChange && parsedTime) {
    return {
      handled: true,
      reply: `Horário dos relatórios atualizado para ${parsedTime} (America/Sao_Paulo) ✅`,
      patch: { time_of_day: parsedTime }
    };
  }

  const disable =
    /\bdesativ/.test(text) ||
    /\bparar\b.*\brel/.test(text) ||
    /\bcancela\b.*\brel/.test(text) ||
    /\bnao quero\b.*\brel/.test(text) ||
    /\bnão quero\b.*\brel/.test(text);

  if (disable && mentionsReport) {
    return {
      handled: true,
      reply:
        "Relatórios automáticos desligados 👍\n\nQuando quiser de novo, é só pedir com horário e tipo (diário, semanal ou mensal).",
      patch: { is_enabled: false, frequencies: [] }
    };
  }

  const onlyWeekly = /\b(só|so|somente|apenas)\b/.test(text) && /\bsemanal\b/.test(text);
  const onlyDaily = /\b(só|so|somente|apenas)\b/.test(text) && /\bdiario\b/.test(text);
  const onlyMonthly = /\b(só|so|somente|apenas)\b/.test(text) && /\bmensal\b/.test(text);

  const wantDaily = /\bdiario\b/.test(text) || lower.includes("diário");
  const wantWeekly = /\bsemanal\b/.test(text);
  const wantMonthly = /\bmensal\b/.test(text);

  let frequencies: ReportFrequency[] = [];

  if (onlyWeekly) {
    frequencies = ["weekly"];
  } else if (onlyDaily) {
    frequencies = ["daily"];
  } else if (onlyMonthly) {
    frequencies = ["monthly"];
  } else {
    if (wantDaily) frequencies.push("daily");
    if (wantWeekly) frequencies.push("weekly");
    if (wantMonthly) frequencies.push("monthly");
  }

  frequencies = uniqFrequencies(frequencies);

  if (frequencies.length === 0 && mentionsReport && !disable) {
    return {
      handled: true,
      reply:
        "Beleza — quer diário, semanal, mensal ou mais de um?\n\nEx.: “quero relatório diário às 20h” ou “quero semanal e mensal às 9h”.",
      patch: {}
    };
  }

  const includeCategories =
    /\bpor categoria\b/.test(text) ||
    /\bpor categorias\b/.test(text) ||
    /\bcom categoria\b/.test(text) ||
    /\bcom categorias\b/.test(text);

  const excludeCategories =
    /\bsem categoria\b/.test(text) ||
    /\bsem categorias\b/.test(text);

  if (frequencies.length === 0) {
    return { handled: false };
  }

  const freqLabel = frequencies
    .map((freq) =>
      freq === "daily" ? "diário" : freq === "weekly" ? "semanal" : "mensal"
    )
    .join(", ");

  const replyLines = [
    "Config atualizada ✅",
    `Relatórios: ${freqLabel}`,
    parsedTime
      ? `Horário: ${parsedTime} (America/Sao_Paulo)`
      : "Horário: 09:00 (padrão, America/Sao_Paulo)",
    includeCategories
      ? "Inclui resumo por categoria."
      : excludeCategories
        ? "Sem quebra por categoria."
        : ""
  ].filter(Boolean);

  const patch: ReportCommandPatch = {
    is_enabled: true,
    frequencies,
    include_categories: includeCategories
      ? true
      : excludeCategories
        ? false
        : undefined
  };

  if (parsedTime) {
    patch.time_of_day = parsedTime;
  }

  return {
    handled: true,
    reply: replyLines.join("\n"),
    patch
  };
}

export function mapReportSettingsRow(data: Record<string, unknown>): UserReportSettingsRow {
  const rawFrequencies = Array.isArray(data.frequencies) ? (data.frequencies as string[]) : [];
  const frequencies = rawFrequencies.filter(
    (value): value is ReportFrequency =>
      value === "daily" || value === "weekly" || value === "monthly"
  );

  return {
    user_id: String(data.user_id),
    is_enabled: Boolean(data.is_enabled),
    frequencies,
    time_of_day: typeof data.time_of_day === "string" ? data.time_of_day : "09:00",
    timezone: typeof data.timezone === "string" ? data.timezone : "America/Sao_Paulo",
    include_categories: Boolean(data.include_categories),
    last_run_daily: data.last_run_daily != null ? String(data.last_run_daily) : null,
    last_run_weekly: data.last_run_weekly != null ? String(data.last_run_weekly) : null,
    last_run_monthly: data.last_run_monthly != null ? String(data.last_run_monthly) : null,
    created_at: String(data.created_at ?? ""),
    updated_at: String(data.updated_at ?? "")
  };
}

export async function getReportSettings(userId: string): Promise<UserReportSettingsRow | null> {
  const { data, error } = await supabase
    .from("user_report_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load report settings: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapReportSettingsRow(data as Record<string, unknown>);
}

export async function upsertReportSettings(
  userId: string,
  patch: Partial<{
    is_enabled: boolean;
    frequencies: ReportFrequency[];
    time_of_day: string;
    timezone: string;
    include_categories: boolean;
  }>
): Promise<UserReportSettingsRow> {
  const existing = await getReportSettings(userId);

  const next = {
    user_id: userId,
    is_enabled: patch.is_enabled ?? existing?.is_enabled ?? false,
    frequencies: patch.frequencies ?? existing?.frequencies ?? [],
    time_of_day: patch.time_of_day ?? existing?.time_of_day ?? "09:00",
    timezone: patch.timezone ?? existing?.timezone ?? "America/Sao_Paulo",
    include_categories: patch.include_categories ?? existing?.include_categories ?? false,
    last_run_daily: existing?.last_run_daily ?? null,
    last_run_weekly: existing?.last_run_weekly ?? null,
    last_run_monthly: existing?.last_run_monthly ?? null,
    updated_at: new Date().toISOString()
  };

  if (next.is_enabled && next.frequencies.length === 0) {
    next.is_enabled = false;
  }

  const { data, error } = await supabase
    .from("user_report_settings")
    .upsert(next, { onConflict: "user_id" })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to save report settings: ${error?.message ?? "unknown"}`);
  }

  return mapReportSettingsRow(data as Record<string, unknown>);
}

export function formatReportSettingsSummary(row: UserReportSettingsRow): string {
  if (!row.is_enabled || row.frequencies.length === 0) {
    return "Relatórios automáticos: desligados.";
  }

  const freqLabel = row.frequencies
    .map((freq) =>
      freq === "daily" ? "diário" : freq === "weekly" ? "semanal" : "mensal"
    )
    .join(", ");

  return `Relatórios: ${freqLabel}, ${row.time_of_day}, ${row.timezone}${row.include_categories ? ", com categorias" : ""}.`;
}
