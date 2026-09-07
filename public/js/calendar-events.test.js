import assert from "node:assert/strict";
import test from "node:test";

import {
  dateKey,
  eventsForDate,
  formatEventTime,
  isCalendarEventCompleted,
  localDateTimeMillis,
  markStatusApplied,
  monthCells,
  normalizeCalendarEvent,
  setCalendarEventCompleted,
  shouldOfferStatusUpdate,
  splitLocalDateTime,
} from "./calendar-events.js";

test("normalizes point and range calendar events", () => {
  const startsAt = localDateTimeMillis("2026-08-18", "10:30");
  const endsAt = localDateTimeMillis("2026-08-18", "11:30");
  const point = normalizeCalendarEvent({ startsAt, type: "written" }, 123);
  const range = normalizeCalendarEvent({ startsAt, endsAt, title: "一面" }, 124);

  assert.equal(point.title, "笔试截止");
  assert.equal(point.endsAt, null);
  assert.equal(range.endsAt, endsAt);
  assert.equal(splitLocalDateTime(startsAt).date, "2026-08-18");
  assert.equal(dateKey(startsAt), "2026-08-18");
  assert.match(formatEventTime(range), /^10:30-11:30$/);
});

test("lists multi-day events on every covered day", () => {
  const event = normalizeCalendarEvent({
    startsAt: localDateTimeMillis("2026-08-18", "20:00"),
    endsAt: localDateTimeMillis("2026-08-19", "10:00"),
    title: "跨天面试任务",
  });

  assert.equal(eventsForDate([event], "2026-08-18").length, 1);
  assert.equal(eventsForDate([event], "2026-08-19").length, 1);
  assert.equal(eventsForDate([event], "2026-08-20").length, 0);
});

test("month grid starts on Monday and keeps 42 cells", () => {
  const cells = monthCells("2026-08", []);
  assert.equal(cells.length, 42);
  assert.equal(cells[0].key, "2026-07-27");
  assert.equal(cells.find((cell) => cell.key === "2026-08-18")?.day, 18);
});

test("status update is offered only after event time and only once", () => {
  const event = normalizeCalendarEvent({
    startsAt: localDateTimeMillis("2026-08-18", "10:00"),
    targetStatus: "一面",
  });
  const before = localDateTimeMillis("2026-08-18", "09:59");
  const after = localDateTimeMillis("2026-08-18", "10:01");

  assert.equal(shouldOfferStatusUpdate(event, { status: "笔试" }, before), false);
  assert.equal(shouldOfferStatusUpdate(event, { status: "笔试" }, after), true);
  assert.equal(shouldOfferStatusUpdate(event, { status: "一面" }, after), false);
  assert.equal(shouldOfferStatusUpdate(markStatusApplied(event, after), { status: "笔试" }, after), false);
});

test("calendar event completion follows the linked job status", () => {
  const event = normalizeCalendarEvent({
    startsAt: localDateTimeMillis("2026-08-18", "10:00"),
    targetStatus: "笔试",
  });

  assert.equal(isCalendarEventCompleted(event, { status: "已投" }), false);
  assert.equal(isCalendarEventCompleted(event, { status: "笔试" }), true);
  assert.equal(isCalendarEventCompleted(event, { status: "一面" }), true);
  assert.equal(isCalendarEventCompleted(event, { status: "挂" }), true);
  assert.equal(isCalendarEventCompleted(event, { status: "offer" }), true);
  assert.equal(isCalendarEventCompleted(event, null), false);
  assert.equal(isCalendarEventCompleted({ ...event, targetStatus: "" }, { status: "一面" }), false);
});

test("completed later stages are never offered a backwards status update", () => {
  const event = normalizeCalendarEvent({
    startsAt: localDateTimeMillis("2026-08-18", "10:00"),
    targetStatus: "笔试",
  });
  const after = localDateTimeMillis("2026-08-18", "10:01");

  assert.equal(shouldOfferStatusUpdate(event, { status: "一面" }, after), false);
  assert.equal(shouldOfferStatusUpdate(event, { status: "挂" }, after), false);
});

test("standalone todos can be completed and restored without a job", () => {
  const todo = normalizeCalendarEvent({
    type: "todo",
    title: "提交课程作业",
    startsAt: localDateTimeMillis("2026-08-18", "20:00"),
  });

  const completed = setCalendarEventCompleted(todo, true, 1787065300000);
  assert.equal(completed.recordId, "");
  assert.equal(completed.targetStatus, "");
  assert.equal(isCalendarEventCompleted(completed, null), true);

  const restored = setCalendarEventCompleted(completed, false, 1787065400000);
  assert.equal(restored.statusAppliedAt, null);
  assert.equal(isCalendarEventCompleted(restored, null), false);
});
