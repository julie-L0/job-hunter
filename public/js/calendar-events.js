const DAY = 86_400_000;

export const CALENDAR_EVENT_TYPES = [
  { value: "written", label: "笔试截止", defaultStatus: "笔试" },
  { value: "interview1", label: "一面", defaultStatus: "一面" },
  { value: "interview2", label: "二面", defaultStatus: "二面" },
  { value: "interview3", label: "三面", defaultStatus: "三面" },
  { value: "interview", label: "面试", defaultStatus: "" },
  { value: "deadline", label: "截止日期", defaultStatus: "" },
  { value: "other", label: "其他", defaultStatus: "" },
];

export const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

function pad(number) {
  return String(number).padStart(2, "0");
}

function asDate(value) {
  const date = new Date(Number(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function clean(value) {
  return String(value || "").trim();
}

export function dateKey(value) {
  const date = value instanceof Date ? value : asDate(value);
  if (!date) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayKey(now = Date.now()) {
  return dateKey(now);
}

export function localDateTimeMillis(day, time = "09:00") {
  const date = clean(day);
  if (!date) return null;
  const clock = clean(time) || "09:00";
  const parsed = Date.parse(`${date}T${clock}`);
  return Number.isNaN(parsed) ? null : parsed;
}

export function splitLocalDateTime(value) {
  const date = asDate(value);
  if (!date) return { date: "", time: "" };
  return {
    date: dateKey(date),
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

export function eventTypeLabel(type) {
  return CALENDAR_EVENT_TYPES.find((item) => item.value === type)?.label || "日程";
}

export function defaultStatusForType(type) {
  return CALENDAR_EVENT_TYPES.find((item) => item.value === type)?.defaultStatus || "";
}

export function normalizeCalendarEvent(input, now = Date.now()) {
  const startsAt = Number(input?.startsAt);
  if (!Number.isFinite(startsAt) || startsAt <= 0) throw new Error("开始时间要填");

  const rawEndsAt = Number(input?.endsAt || 0);
  const endsAt = Number.isFinite(rawEndsAt) && rawEndsAt > 0 ? rawEndsAt : null;
  if (endsAt !== null && endsAt < startsAt) throw new Error("结束时间不能早于开始时间");

  const type = clean(input?.type) || "other";
  const fallbackTitle = eventTypeLabel(type);
  return {
    id: clean(input?.id) || `calendar:${now}:${Math.random().toString(36).slice(2, 8)}`,
    recordId: clean(input?.recordId),
    type,
    title: clean(input?.title) || fallbackTitle,
    startsAt,
    endsAt,
    targetStatus: clean(input?.targetStatus),
    note: clean(input?.note),
    statusAppliedAt: Number(input?.statusAppliedAt || 0) || null,
    createdAt: Number(input?.createdAt || 0) || now,
    updatedAt: now,
  };
}

export function sortCalendarEvents(events) {
  return [...(Array.isArray(events) ? events : [])]
    .map((event) => {
      try {
        return normalizeCalendarEvent(event, Number(event?.updatedAt || Date.now()));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.startsAt - b.startsAt || a.title.localeCompare(b.title, "zh-Hans-CN"));
}

export function eventEndAt(event) {
  return Number(event?.endsAt || event?.startsAt || 0);
}

export function eventsForDate(events, key) {
  return sortCalendarEvents(events).filter((event) => {
    const start = dateKey(event.startsAt);
    const end = dateKey(eventEndAt(event));
    return start && end && start <= key && key <= end;
  });
}

export function monthCells(monthKey, events = []) {
  const [year, month] = clean(monthKey).split("-").map(Number);
  const base = new Date(year, month - 1, 1);
  if (Number.isNaN(base.getTime())) return [];
  const mondayOffset = (base.getDay() + 6) % 7;
  const start = new Date(year, month - 1, 1 - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start.getTime() + index * DAY);
    const key = dateKey(date);
    return {
      key,
      day: date.getDate(),
      inMonth: date.getMonth() === base.getMonth(),
      events: eventsForDate(events, key),
    };
  });
}

export function formatEventTime(event) {
  const start = splitLocalDateTime(event?.startsAt);
  const end = event?.endsAt ? splitLocalDateTime(event.endsAt) : null;
  if (!start.date) return "";
  if (!end?.date) return start.time;
  if (end.date === start.date) return `${start.time}-${end.time}`;
  return `${start.date} ${start.time} - ${end.date} ${end.time}`;
}

export function shouldOfferStatusUpdate(event, job, now = Date.now()) {
  const target = clean(event?.targetStatus);
  if (!target || !job || event?.statusAppliedAt) return false;
  if (clean(job.status) === target) return false;
  return eventEndAt(event) <= now;
}

export function markStatusApplied(event, now = Date.now()) {
  return normalizeCalendarEvent({ ...event, statusAppliedAt: now }, now);
}
