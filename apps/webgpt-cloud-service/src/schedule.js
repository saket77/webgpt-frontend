const DEFAULT_TIMEZONE = "Asia/Kolkata";
const DAILY_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function pad(value) {
  return String(value).padStart(2, "0");
}

function getZonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function zonedTimeToUtc({ year, month, day, hour, minute }, timeZone) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const guessParts = getZonedParts(new Date(utcGuess), timeZone);
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const guessAsUtc = Date.UTC(
    guessParts.year,
    guessParts.month - 1,
    guessParts.day,
    guessParts.hour,
    guessParts.minute,
    guessParts.second,
    0,
  );

  return new Date(utcGuess + (targetAsUtc - guessAsUtc));
}

function addLocalDays(parts, days) {
  const next = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + days, 0, 0, 0, 0),
  );

  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

export function validateDailySchedule(schedule) {
  if (!schedule || typeof schedule !== "object" || Array.isArray(schedule)) {
    return { ok: false, error: "schedule must be an object." };
  }

  if (schedule.type !== "daily") {
    return { ok: false, error: "Only daily schedules are supported in v0." };
  }

  if (typeof schedule.time !== "string" || !DAILY_TIME_PATTERN.test(schedule.time)) {
    return { ok: false, error: "schedule.time must use HH:mm in 24-hour time." };
  }

  const timezone = schedule.timezone || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch {
    return { ok: false, error: `Unsupported timezone: ${String(timezone)}.` };
  }

  return {
    ok: true,
    value: {
      type: "daily",
      time: schedule.time,
      timezone,
    },
  };
}

export function computeNextDailyRunAt(schedule, { now = new Date() } = {}) {
  const validation = validateDailySchedule(schedule);
  if (!validation.ok) throw new Error(validation.error);

  const normalized = validation.value;
  const [hour, minute] = normalized.time.split(":").map(Number);
  const today = getZonedParts(now, normalized.timezone);
  let localDate = {
    year: today.year,
    month: today.month,
    day: today.day,
  };
  let candidate = zonedTimeToUtc(
    {
      ...localDate,
      hour,
      minute,
    },
    normalized.timezone,
  );

  if (candidate.getTime() <= now.getTime()) {
    localDate = addLocalDays(localDate, 1);
    candidate = zonedTimeToUtc(
      {
        ...localDate,
        hour,
        minute,
      },
      normalized.timezone,
    );
  }

  return candidate.toISOString();
}

export function formatDailySchedule(schedule) {
  const validation = validateDailySchedule(schedule);
  if (!validation.ok) return "";
  return `${validation.value.time} ${validation.value.timezone}`;
}

export function localDateKey(date, timeZone = DEFAULT_TIMEZONE) {
  const parts = getZonedParts(date, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}
