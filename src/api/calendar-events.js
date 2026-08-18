import { HttpError, requireBody } from "../http/app.js";
import { createRecord, deleteRecord, getRecord, listRecords, updateRecord } from "../storage/bitable.js";
import { CALENDAR_EVENT_TYPES, JOB_STATUSES } from "../storage/schema.js";

const clean = (value) => String(value ?? "").trim();

function fallbackTitle(type) {
  return ({
    written: "笔试截止",
    interview1: "一面",
    interview2: "二面",
    interview3: "三面",
    interview: "面试",
    deadline: "截止日期",
    other: "日程",
  })[type] || "日程";
}

function asMillis(value, fieldName) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return number;
  const parsed = Date.parse(String(value));
  if (!Number.isNaN(parsed)) return parsed;
  throw new HttpError(400, `${fieldName} 不是有效时间`);
}

function pickCalendarPatch(body, { requireStart = false } = {}) {
  if (requireStart) requireBody(body, ["startsAt"]);
  const patch = {};
  if (body.title !== undefined) patch.title = clean(body.title);
  if (body.recordId !== undefined) patch.jobRecordId = clean(body.recordId);
  if (body.jobRecordId !== undefined) patch.jobRecordId = clean(body.jobRecordId);
  if (body.type !== undefined) patch.type = clean(body.type) || "other";
  if (body.startsAt !== undefined) patch.startsAt = asMillis(body.startsAt, "开始时间");
  if (body.endsAt !== undefined) patch.endsAt = asMillis(body.endsAt, "结束时间");
  if (body.targetStatus !== undefined) patch.targetStatus = clean(body.targetStatus);
  if (body.note !== undefined) patch.note = clean(body.note);
  if (body.statusAppliedAt !== undefined) patch.statusAppliedAt = asMillis(body.statusAppliedAt, "状态写回时间");
  if (body.clientId !== undefined) patch.clientId = clean(body.clientId);
  else if (body.id !== undefined && String(body.id).startsWith("calendar:")) patch.clientId = clean(body.id);
  return patch;
}

function validateCalendarPatch(patch, current = {}) {
  const next = { ...current, ...patch };
  const type = clean(next.type) || "other";
  if (!CALENDAR_EVENT_TYPES.includes(type)) {
    throw new HttpError(400, `日程类型必须是：${CALENDAR_EVENT_TYPES.join("/")}`);
  }
  if (!next.startsAt) throw new HttpError(400, "开始时间要填");
  if (next.endsAt && next.endsAt < next.startsAt) throw new HttpError(400, "结束时间不能早于开始时间");
  const targetStatus = clean(next.targetStatus);
  if (targetStatus && !JOB_STATUSES.includes(targetStatus)) {
    throw new HttpError(400, `绑定状态必须是：${JOB_STATUSES.join("/")}`);
  }

  return {
    ...patch,
    type,
    title: clean(next.title) || fallbackTitle(type),
    updatedAt: Date.now(),
  };
}

export function hydrateCalendarEvent(record) {
  return {
    id: record.recordId,
    clientId: record.clientId || "",
    recordId: record.jobRecordId || "",
    type: record.type || "other",
    title: record.title || fallbackTitle(record.type),
    startsAt: record.startsAt,
    endsAt: record.endsAt || null,
    targetStatus: record.targetStatus || "",
    note: record.note || "",
    statusAppliedAt: record.statusAppliedAt || null,
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null,
  };
}

export const calendarEventRoutes = [
  {
    method: "GET",
    path: "/api/calendar-events",
    handler: async () => (await listRecords("calendar")).map(hydrateCalendarEvent),
  },
  {
    method: "POST",
    path: "/api/calendar-events",
    handler: async ({ body }) => {
      const patch = validateCalendarPatch(pickCalendarPatch(body, { requireStart: true }));
      return hydrateCalendarEvent(await createRecord("calendar", patch));
    },
  },
  {
    method: "PATCH",
    path: "/api/calendar-events/:recordId",
    handler: async ({ params, body }) => {
      const current = await getRecord("calendar", params.recordId);
      const patch = pickCalendarPatch(body);
      if (!Object.keys(patch).length) throw new HttpError(400, "没有可写字段");
      return hydrateCalendarEvent(
        await updateRecord("calendar", params.recordId, validateCalendarPatch(patch, current)),
      );
    },
  },
  {
    method: "DELETE",
    path: "/api/calendar-events/:recordId",
    handler: ({ params }) => deleteRecord("calendar", params.recordId),
  },
];
