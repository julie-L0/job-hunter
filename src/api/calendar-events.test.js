import test from "node:test";
import assert from "node:assert/strict";

import { config } from "../config.js";
import { fromRecord, toFields } from "../storage/schema.js";
import { calendarEventRoutes } from "./calendar-events.js";

function route(method, path) {
  return calendarEventRoutes.find((candidate) => candidate.method === method && candidate.path === path);
}

test("calendar event fields map to the Feishu calendar table", () => {
  assert.deepEqual(toFields("calendar", {
    title: "腾讯一面",
    jobRecordId: "job-1",
    type: "interview1",
    startsAt: 1787061600000,
    endsAt: null,
    targetStatus: "一面",
    note: "视频面试",
    clientId: "calendar:local",
  }), {
    "标题": "腾讯一面",
    "岗位记录ID": "job-1",
    "类型": "interview1",
    "开始时间": 1787061600000,
    "结束时间": null,
    "绑定状态": "一面",
    "备注": "视频面试",
    "客户端ID": "calendar:local",
  });

  const record = fromRecord("calendar", {
    record_id: "event-1",
    fields: {
      "标题": "腾讯一面",
      "岗位记录ID": "job-1",
      "类型": "interview1",
      "开始时间": 1787061600000,
    },
  });
  assert.equal(record.recordId, "event-1");
  assert.equal(record.jobRecordId, "job-1");
  assert.equal(record.type, "interview1");
});

test("calendar event routes create, update, list, and delete events", async () => {
  const originalMock = config.lark.mock;
  config.lark.mock = true;
  try {
    const created = await route("POST", "/api/calendar-events").handler({
      body: {
        id: "calendar:local-1",
        recordId: "job-1",
        type: "interview1",
        title: "腾讯一面",
        startsAt: 1787061600000,
        endsAt: 1787065200000,
        targetStatus: "一面",
        note: "视频会议",
      },
    });
    assert.match(created.id, /^recMOCK/);
    assert.equal(created.clientId, "calendar:local-1");
    assert.equal(created.recordId, "job-1");
    assert.equal(created.targetStatus, "一面");

    const listed = await route("GET", "/api/calendar-events").handler({});
    assert.ok(listed.some((event) => event.id === created.id));

    const patched = await route("PATCH", "/api/calendar-events/:recordId").handler({
      params: { recordId: created.id },
      body: { statusAppliedAt: 1787065300000, note: "已写回状态" },
    });
    assert.equal(patched.statusAppliedAt, 1787065300000);
    assert.equal(patched.note, "已写回状态");

    const deleted = await route("DELETE", "/api/calendar-events/:recordId").handler({
      params: { recordId: created.id },
    });
    assert.deepEqual(deleted, { recordId: created.id, deleted: true });
  } finally {
    config.lark.mock = originalMock;
  }
});

test("calendar event route rejects invalid ranges and statuses", async () => {
  const originalMock = config.lark.mock;
  config.lark.mock = true;
  try {
    await assert.rejects(
      () => route("POST", "/api/calendar-events").handler({
        body: {
          type: "interview1",
          startsAt: 1787065200000,
          endsAt: 1787061600000,
          targetStatus: "一面",
        },
      }),
      /结束时间不能早于开始时间/,
    );
    await assert.rejects(
      () => route("POST", "/api/calendar-events").handler({
        body: { type: "interview1", startsAt: 1787061600000, targetStatus: "四面" },
      }),
      /绑定状态必须是/,
    );
  } finally {
    config.lark.mock = originalMock;
  }
});
