import { DateTime } from "luxon";
import { sendWhatsappMessage } from "../integrations/whatsapp.client";
import {
  previousCalendarMonthRange,
  previousCalendarWeekRange,
  todaySoFarRange,
  DEFAULT_TIMEZONE
} from "./period-resolver.service";
import {
  fetchSpendingAggregate,
  type SpendingAggregate
} from "./spending-query.service";
import {
  getReportSettings,
  mapReportSettingsRow,
  type UserReportSettingsRow
} from "./report-settings.service";
import { upsertQueryContext } from "./query-context.service";
import { naturalCategoryLabel } from "./transaction-helpers";
import { supabase } from "../db/supabase";
import { saveMessageEvent } from "./persistence.service";

function parseTimeParts(timeOfDay: string): { hour: number; minute: number } {
  const [hourRaw, minuteRaw] = timeOfDay.split(":").map((value) => Number(value));

  const hour = Number.isFinite(hourRaw) ? hourRaw : 9;
  const minute = Number.isFinite(minuteRaw) ? minuteRaw : 0;

  return { hour, minute };
}

function clockMatchesLocalMinute(now: DateTime, timeOfDay: string): boolean {
  const { hour, minute } = parseTimeParts(timeOfDay);
  return now.hour === hour && now.minute === minute;
}

function buildReportBody(
  title: string,
  aggregate: SpendingAggregate,
  includeCategories: boolean
): string {
  if (aggregate.transactionCount === 0) {
    return `📊 ${title}\nSem registros de gasto nesse período.`;
  }

  const lines = [
    `📊 ${title}`,
    `Total: R$${aggregate.total.toFixed(2)}`,
    `Lançamentos: ${aggregate.transactionCount}`
  ];

  if (includeCategories && aggregate.byCategory.length > 0) {
    lines.push("Por categoria:");

    for (const row of aggregate.byCategory.slice(0, 15)) {
      lines.push(`• ${naturalCategoryLabel(row.category)}: R$${row.total.toFixed(2)}`);
    }
  }

  return lines.join("\n");
}

type SettingsWithPhone = UserReportSettingsRow & {
  phone_number: string;
};

async function loadEnabledSettingsWithPhones(): Promise<SettingsWithPhone[]> {
  const { data: settings, error: settingsError } = await supabase
    .from("user_report_settings")
    .select("*")
    .eq("is_enabled", true);

  if (settingsError) {
    throw new Error(`Report scheduler: list settings failed: ${settingsError.message}`);
  }

  const rows = settings ?? [];
  if (rows.length === 0) {
    return [];
  }

  const userIds = [...new Set(rows.map((row) => row.user_id as string))];

  const { data: users, error: usersError } = await supabase
    .from("users")
    .select("id, phone_number")
    .in("id", userIds);

  if (usersError) {
    throw new Error(`Report scheduler: load users failed: ${usersError.message}`);
  }

  const phoneByUserId = new Map<string, string>();

  for (const user of users ?? []) {
    const id = user.id as string;
    const phone = user.phone_number as string;

    if (id && phone) {
      phoneByUserId.set(id, phone);
    }
  }

  const result: SettingsWithPhone[] = [];

  for (const raw of rows) {
    const row = mapReportSettingsRow(raw as Record<string, unknown>);
    const phone = phoneByUserId.get(row.user_id);

    if (!phone) continue;
    if (!row.frequencies.length) continue;

    result.push({
      ...row,
      phone_number: phone
    });
  }

  return result;
}

async function patchLastRuns(
  userId: string,
  patch: Partial<
    Pick<UserReportSettingsRow, "last_run_daily" | "last_run_weekly" | "last_run_monthly">
  >
): Promise<void> {
  const { error } = await supabase
    .from("user_report_settings")
    .update({
      ...patch,
      updated_at: new Date().toISOString()
    })
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to update report last_run: ${error.message}`);
  }
}

async function sendAndPersistReport(
  userId: string,
  phoneNumber: string,
  text: string,
  intent: string
): Promise<void> {
  await sendWhatsappMessage(phoneNumber, text);

  await saveMessageEvent({
    userId,
    direction: "outbound",
    messageText: text,
    intent
  });
}

export async function runScheduledReportsTick(nowUtc: Date = new Date()): Promise<void> {
  const settingsList = await loadEnabledSettingsWithPhones();

  for (const row of settingsList) {
    const timezone = row.timezone || DEFAULT_TIMEZONE;
    const localNow = DateTime.fromJSDate(nowUtc, { zone: "utc" }).setZone(timezone);

    if (!localNow.isValid) {
      continue;
    }

    if (!clockMatchesLocalMinute(localNow, row.time_of_day)) {
      continue;
    }

    const fresh = await getReportSettings(row.user_id);

    if (!fresh || !fresh.is_enabled || fresh.frequencies.length === 0) {
      continue;
    }

    for (const frequency of fresh.frequencies) {
      if (frequency === "daily") {
        const todayKey = localNow.toISODate();

        if (!todayKey || fresh.last_run_daily === todayKey) {
          continue;
        }

        const period = todaySoFarRange(nowUtc, timezone);
        const aggregate = await fetchSpendingAggregate(
          row.user_id,
          period.rangeStartUtc,
          period.rangeEndUtc
        );

        const text = buildReportBody(
          `Relatório diário — ${period.label}`,
          aggregate,
          fresh.include_categories
        );

        await sendAndPersistReport(row.user_id, row.phone_number, text, "report_daily");
        await upsertQueryContext(row.user_id, {
          kind: "spending_period",
          periodStartUtc: period.rangeStartUtc,
          periodEndUtc: period.rangeEndUtc,
          periodLabel: period.label,
          byCategory: fresh.include_categories,
          detailLevel: fresh.include_categories ? "category" : "summary",
          source: "report"
        });
        await patchLastRuns(row.user_id, { last_run_daily: todayKey });
      }

      if (frequency === "weekly") {
        if (localNow.weekday !== 1) {
          continue;
        }

        const thisMonday = localNow.startOf("day").minus({ days: localNow.weekday - 1 });
        const previousMondayKey = thisMonday.minus({ weeks: 1 }).toISODate();

        if (!previousMondayKey || fresh.last_run_weekly === previousMondayKey) {
          continue;
        }

        const period = previousCalendarWeekRange(nowUtc, timezone);
        const aggregate = await fetchSpendingAggregate(
          row.user_id,
          period.rangeStartUtc,
          period.rangeEndUtc
        );

        const text = buildReportBody(
          `Relatório semanal — ${period.label}`,
          aggregate,
          fresh.include_categories
        );

        await sendAndPersistReport(row.user_id, row.phone_number, text, "report_weekly");
        await upsertQueryContext(row.user_id, {
          kind: "spending_period",
          periodStartUtc: period.rangeStartUtc,
          periodEndUtc: period.rangeEndUtc,
          periodLabel: period.label,
          byCategory: fresh.include_categories,
          detailLevel: fresh.include_categories ? "category" : "summary",
          source: "report"
        });
        await patchLastRuns(row.user_id, { last_run_weekly: previousMondayKey });
      }

      if (frequency === "monthly") {
        if (localNow.day !== 1) {
          continue;
        }

        const previousMonthKey = localNow.minus({ months: 1 }).toFormat("yyyy-MM");

        if (fresh.last_run_monthly === previousMonthKey) {
          continue;
        }

        const period = previousCalendarMonthRange(nowUtc, timezone);
        const aggregate = await fetchSpendingAggregate(
          row.user_id,
          period.rangeStartUtc,
          period.rangeEndUtc
        );

        const text = buildReportBody(
          `Relatório mensal — ${period.label}`,
          aggregate,
          fresh.include_categories
        );

        await sendAndPersistReport(row.user_id, row.phone_number, text, "report_monthly");
        await upsertQueryContext(row.user_id, {
          kind: "spending_period",
          periodStartUtc: period.rangeStartUtc,
          periodEndUtc: period.rangeEndUtc,
          periodLabel: period.label,
          byCategory: fresh.include_categories,
          detailLevel: fresh.include_categories ? "category" : "summary",
          source: "report"
        });
        await patchLastRuns(row.user_id, { last_run_monthly: previousMonthKey });
      }
    }
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startReportScheduler(): void {
  const enabled = process.env.ENABLE_INTERNAL_REPORT_SCHEDULER === "true";

  if (!enabled) {
    return;
  }

  if (intervalHandle) {
    return;
  }

  intervalHandle = setInterval(() => {
    runScheduledReportsTick().catch((error) => {
      console.error("Report scheduler tick failed:", error);
    });
  }, 60_000);
}