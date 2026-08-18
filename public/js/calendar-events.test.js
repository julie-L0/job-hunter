import assert from "node:assert/strict";
import test from "node:test";

import {
  dateKey,
  eventsForDate,
  formatEventTime,
  localDateTimeMillis,
  markStatusApplied,
  monthCells,
  normalizeCalendarEvent,
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
