import { DateTime } from "luxon";

export const DEFAULT_TIMEZONE = "America/Sao_Paulo";

export type ResolvedPeriod = {
  /** ISO UTC, inclusive */
  rangeStartUtc: string;
  /** ISO UTC, exclusive */
  rangeEndUtc: string;
  /** Rótulo estável para resposta */
  label: string;
};

const MONTH_NAMES: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  março: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12
};

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function nowInTz(nowUtc: Date, tz: string): DateTime {
  return DateTime.fromJSDate(nowUtc, { zone: "utc" }).setZone(tz);
}

function startOfIsoWeekMonday(dt: DateTime): DateTime {
  const day = dt.startOf("day");
  return day.minus({ days: day.weekday - 1 });
}

function monthStart(year: number, month: number, tz: string): DateTime {
  return DateTime.fromObject({ year, month, day: 1 }, { zone: tz }).startOf("day");
}

function monthEndExclusive(year: number, month: number, tz: string): DateTime {
  return monthStart(year, month, tz).plus({ months: 1 });
}

function toResolved(start: DateTime, endExclusive: DateTime, label: string): ResolvedPeriod {
  return {
    rangeStartUtc: start.toUTC().toISO()!,
    rangeEndUtc: endExclusive.toUTC().toISO()!,
    label
  };
}

function extractMonthNameToken(text: string): string | null {
  for (const name of Object.keys(MONTH_NAMES)) {
    if (text.includes(name)) {
      return name;
    }
  }
  return null;
}

function monthNumberFromToken(token: string): number | null {
  return MONTH_NAMES[token] ?? null;
}

function pickYearForMonth(now: DateTime, month: number, explicitYear?: number): number {
  if (explicitYear != null) return explicitYear;

  let year = now.year;
  const candidate = monthStart(year, month, now.zoneName || DEFAULT_TIMEZONE);

  // Se o mês ainda está no futuro em relação a hoje, assume ano anterior
  if (candidate > now.endOf("day")) {
    year -= 1;
  }

  return year;
}

function parseDayMonthYear(
  day: number,
  month: number,
  year: number,
  tz: string
): DateTime | null {
  const dt = DateTime.fromObject({ year, month, day }, { zone: tz }).startOf("day");
  return dt.isValid ? dt : null;
}

function resolveNamedDay(
  dayNum: number,
  monthToken: string,
  now: DateTime,
  tz: string,
  explicitYear?: number
): ResolvedPeriod | null {
  const monthNum = monthNumberFromToken(monthToken);
  if (!monthNum || dayNum < 1 || dayNum > 31) return null;

  const year = pickYearForMonth(now, monthNum, explicitYear);
  const start = parseDayMonthYear(dayNum, monthNum, year, tz);
  if (!start) return null;

  const end = start.plus({ days: 1 });
  const label =
    explicitYear != null
      ? `dia ${dayNum} de ${monthToken} de ${year}`
      : `dia ${dayNum} de ${monthToken}`;

  return toResolved(start, end, label);
}

function resolveSlashDate(
  dayNum: number,
  monthNum: number,
  now: DateTime,
  tz: string,
  explicitYear?: number
): ResolvedPeriod | null {
  if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) {
    return null;
  }

  const year = explicitYear ?? pickYearForMonth(now, monthNum);
  const start = parseDayMonthYear(dayNum, monthNum, year, tz);
  if (!start) return null;

  const end = start.plus({ days: 1 });
  const label =
    explicitYear != null
      ? `dia ${dayNum}/${monthNum}/${year}`
      : `dia ${dayNum}/${monthNum}`;

  return toResolved(start, end, label);
}

function tryResolveExplicitDay(text: string, now: DateTime, tz: string): ResolvedPeriod | null {
  const dayMonthPatterns = [
    /(?:\bno dia\b|\bdia\b)\s+(\d{1,2})\s+de\s+([a-zç]+)(?:\s+de\s+(19\d{2}|20\d{2}))?\b/,
    /\b(\d{1,2})\s+de\s+([a-zç]+)(?:\s+de\s+(19\d{2}|20\d{2}))?\b/
  ];

  for (const pattern of dayMonthPatterns) {
    const match = text.match(pattern);
    if (!match) continue;

    const dayNum = Number(match[1]);
    const monthToken = match[2];
    const explicitYear = match[3] ? Number(match[3]) : undefined;

    const resolved = resolveNamedDay(dayNum, monthToken, now, tz, explicitYear);
    if (resolved) return resolved;
  }

  const slash = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(19\d{2}|20\d{2}))?\b/);
  if (slash) {
    const dayNum = Number(slash[1]);
    const monthNum = Number(slash[2]);
    const explicitYear = slash[3] ? Number(slash[3]) : undefined;

    return resolveSlashDate(dayNum, monthNum, now, tz, explicitYear);
  }

  return null;
}

function tryResolveExplicitMonth(text: string, now: DateTime, tz: string): ResolvedPeriod | null {
  const explicitYearMatch = text.match(/\b(19\d{2}|20\d{2})\b/);
  const explicitYear = explicitYearMatch ? Number(explicitYearMatch[0]) : undefined;

  const noMesDe = text.match(/\bno\s+mes\s+de\s+([a-zç]+)\b/);
  if (noMesDe) {
    const monthNum = monthNumberFromToken(noMesDe[1]);
    if (monthNum) {
      const year = pickYearForMonth(now, monthNum, explicitYear);
      return toResolved(
        monthStart(year, monthNum, tz),
        monthEndExclusive(year, monthNum, tz),
        `mês de ${noMesDe[1]} de ${year}`
      );
    }
  }

  const emMonth = text.match(/\bem\s+([a-zç]+)\b/);
  if (emMonth) {
    const monthNum = monthNumberFromToken(emMonth[1]);
    if (monthNum) {
      const year = pickYearForMonth(now, monthNum, explicitYear);
      return toResolved(
        monthStart(year, monthNum, tz),
        monthEndExclusive(year, monthNum, tz),
        explicitYear != null ? `mês de ${emMonth[1]} de ${year}` : `mês de ${emMonth[1]}`
      );
    }
  }

  const monthTokenOnly = extractMonthNameToken(text);
  if (
    monthTokenOnly &&
    (/\bmes\b/.test(text) || /\bm[eê]s\b/.test(text)) &&
    (/\bde\b/.test(text) || /\bem\b/.test(text) || /\bno\b/.test(text))
  ) {
    const monthNum = monthNumberFromToken(monthTokenOnly);
    if (monthNum) {
      const year = pickYearForMonth(now, monthNum, explicitYear);
      return toResolved(
        monthStart(year, monthNum, tz),
        monthEndExclusive(year, monthNum, tz),
        explicitYear != null
          ? `mês de ${monthTokenOnly} de ${year}`
          : `mês de ${monthTokenOnly}`
      );
    }
  }

  return null;
}

function tryResolveSimpleRange(text: string, now: DateTime, tz: string): ResolvedPeriod | null {
  const rangeMatch = text.match(
    /\bde\s+(\d{1,2})\/(\d{1,2})(?:\/(19\d{2}|20\d{2}))?\s+(?:ate|até)\s+(\d{1,2})\/(\d{1,2})(?:\/(19\d{2}|20\d{2}))?\b/
  );

  if (!rangeMatch) return null;

  const d1 = Number(rangeMatch[1]);
  const m1 = Number(rangeMatch[2]);
  const y1 = rangeMatch[3] ? Number(rangeMatch[3]) : pickYearForMonth(now, m1);

  const d2 = Number(rangeMatch[4]);
  const m2 = Number(rangeMatch[5]);
  const y2 = rangeMatch[6] ? Number(rangeMatch[6]) : pickYearForMonth(now, m2);

  const start = parseDayMonthYear(d1, m1, y1, tz);
  const endDay = parseDayMonthYear(d2, m2, y2, tz);

  if (!start || !endDay) return null;

  const endExclusive = endDay.plus({ days: 1 });

  if (endExclusive <= start) return null;

  return toResolved(start, endExclusive, `de ${d1}/${m1} até ${d2}/${m2}`);
}

export function previousCalendarWeekRange(
  nowUtc: Date,
  tz: string = DEFAULT_TIMEZONE
): ResolvedPeriod {
  const now = nowInTz(nowUtc, tz);
  const thisMonday = startOfIsoWeekMonday(now);
  const prevMonday = thisMonday.minus({ weeks: 1 });

  return toResolved(prevMonday, thisMonday, "semana anterior (segunda a domingo)");
}

export function previousCalendarMonthRange(
  nowUtc: Date,
  tz: string = DEFAULT_TIMEZONE
): ResolvedPeriod {
  const now = nowInTz(nowUtc, tz);
  const firstThisMonth = now.startOf("month");
  const firstPrevMonth = firstThisMonth.minus({ months: 1 });

  return toResolved(firstPrevMonth, firstThisMonth, "mês anterior");
}

export function todaySoFarRange(
  nowUtc: Date,
  tz: string = DEFAULT_TIMEZONE
): ResolvedPeriod {
  const now = nowInTz(nowUtc, tz);
  const start = now.startOf("day");

  return toResolved(start, now, "hoje até agora");
}

export function resolvePeriodFromMessage(
  message: string,
  nowUtc: Date = new Date()
): ResolvedPeriod | null {
  const tz = DEFAULT_TIMEZONE;
  const raw = stripAccents(message.toLowerCase());
  const text = raw.replace(/\s+/g, " ").trim();
  const now = nowInTz(nowUtc, tz);

  // intervalo explícito
  const range = tryResolveSimpleRange(text, now, tz);
  if (range) return range;

  // hoje
  if (/\bhoje\b/.test(text) || /\bhj\b/.test(text)) {
    if (/\bate agora\b/.test(text) || /\bate o momento\b/.test(text) || /\bat[eé] agora\b/.test(text)) {
      return todaySoFarRange(nowUtc, tz);
    }

    const start = now.startOf("day");
    const end = start.plus({ days: 1 });
    return toResolved(start, end, "hoje");
  }

  // ontem
  if (/\bontem\b/.test(text)) {
    const start = now.minus({ days: 1 }).startOf("day");
    const end = start.plus({ days: 1 });
    return toResolved(start, end, "ontem");
  }

  // semana anterior
  if (
    /\bsemana anterior\b/.test(text) ||
    /\bsemana passada\b/.test(text) ||
    /\bultima semana\b/.test(text) ||
    /\búltima semana\b/.test(text)
  ) {
    return previousCalendarWeekRange(nowUtc, tz);
  }

  // semana atual
  if (
    /\besta semana\b/.test(text) ||
    /\bnesta semana\b/.test(text) ||
    /\bsemana atual\b/.test(text) ||
    /\bnessa semana\b/.test(text)
  ) {
    const start = startOfIsoWeekMonday(now);
    const end = /\bate agora\b/.test(text) || /\bat[eé] agora\b/.test(text)
      ? now
      : now.plus({ milliseconds: 1 });

    return toResolved(start, end, "esta semana até agora");
  }

  // mês anterior
  if (
    /\bmes anterior\b/.test(text) ||
    /\bmês anterior\b/.test(text) ||
    /\bmes passado\b/.test(text) ||
    /\bmês passado\b/.test(text) ||
    /\bultimo mes\b/.test(text) ||
    /\búltimo mês\b/.test(text)
  ) {
    return previousCalendarMonthRange(nowUtc, tz);
  }

  // mês atual
  if (
    /\bmes atual\b/.test(text) ||
    /\bmês atual\b/.test(text) ||
    /\beste mes\b/.test(text) ||
    /\beste mês\b/.test(text) ||
    /\bno mes atual\b/.test(text) ||
    /\bno mês atual\b/.test(text) ||
    /\bnesse mes\b/.test(text) ||
    /\bnesse mês\b/.test(text)
  ) {
    const start = now.startOf("month");
    const end =
      /\bate agora\b/.test(text) || /\bat[eé] agora\b/.test(text)
        ? now
        : start.plus({ months: 1 });

    return toResolved(start, end, "mês atual");
  }

  // dia explícito
  const explicitDay = tryResolveExplicitDay(text, now, tz);
  if (explicitDay) return explicitDay;

  // mês explícito
  const explicitMonth = tryResolveExplicitMonth(text, now, tz);
  if (explicitMonth) return explicitMonth;

  return null;
}

/**
 * Quando a consulta vier sem período explícito,
 * mantém a decisão atual de produto: usar o mês corrente.
 */
export function defaultMonthPeriod(nowUtc: Date = new Date()): ResolvedPeriod {
  const tz = DEFAULT_TIMEZONE;
  const now = nowInTz(nowUtc, tz);
  const start = now.startOf("month");
  const end = start.plus({ months: 1 });

  return toResolved(start, end, "mês atual");
}