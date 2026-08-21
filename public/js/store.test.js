import test from "node:test";
import assert from "node:assert/strict";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  };
}

globalThis.localStorage = memoryStorage();
globalThis.sessionStorage = memoryStorage();
globalThis.location = { hash: "" };
globalThis.window = {
  Vue: {
    reactive: (value) => value,
    computed: (getter) => ({ get value() { return getter(); } }),
  },
  addEventListener: () => {},
};

const {
  JOB_STAR_VALUE,
  dropJob,
  flushOutbox,
  mergeJob,
  state,
} = await import(`./store.js?test=${Date.now()}`);
const { api, NetError } = await import("./api.js");

function resetStore() {
  state.health = { resumeRequiredStatuses: ["已投", "笔试", "一面", "二面", "三面", "挂", "offer"] };
  state.jobs = [];
  state.outbox = [];
  state.currentJobId = null;
  state.syncError = "";
  state.offline = false;
  state.syncing = false;
  state.authed = true;
}

test("mergeJob keeps queued local patches over older backend responses", () => {
  resetStore();
  state.jobs = [{ recordId: "job-queued", company: "旧公司", position: "旧岗位", starred: JOB_STAR_VALUE }];
  state.outbox = [{
    id: "clear-star",
    kind: "job.patch",
    recordId: "job-queued",
    patch: { starred: "" },
    statusChange: null,
  }];

  mergeJob({
    recordId: "job-queued",
    company: "新公司",
    position: "新岗位",
    starred: JOB_STAR_VALUE,
  });

  assert.equal(state.jobs[0].company, "新公司");
  assert.equal(state.jobs[0].position, "新岗位");
  assert.equal(state.jobs[0].starred, "");
  assert.equal(state.jobs[0].pendingSync, true);
});

test("mergeJob replays queued reverse status changes by removing the latest history entry", () => {
  resetStore();
  state.jobs = [{ recordId: "job-status", company: "示例公司", position: "产品经理", status: "已投", statusHistory: "" }];
  state.outbox = [
    {
      id: "to-written",
      kind: "job.patch",
      recordId: "job-status",
      patch: { status: "笔试" },
      statusChange: { at: 1, from: "已投", to: "笔试", resumeId: "R1" },
    },
    {
      id: "back-to-applied",
      kind: "job.patch",
      recordId: "job-status",
      patch: { status: "已投" },
      statusChange: { at: 2, from: "笔试", to: "已投", resumeId: "R1" },
    },
  ];

  mergeJob({ recordId: "job-status", status: "已投", statusHistory: "" });

  assert.equal(state.jobs[0].status, "已投");
  assert.deepEqual(JSON.parse(state.jobs[0].statusHistory), []);
  assert.equal(state.jobs[0].pendingSync, true);
});

test("mergeJob ignores stale responses for a deleted job", () => {
  resetStore();
  state.jobs = [{ recordId: "job-deleted", company: "示例公司", position: "产品经理" }];
  state.outbox = [{
    id: "pending-job-delete",
    kind: "job.patch",
    recordId: "job-deleted",
    patch: { starred: JOB_STAR_VALUE },
    statusChange: null,
  }];
  state.currentJobId = "job-deleted";

  dropJob("job-deleted");
  mergeJob({ recordId: "job-deleted", company: "示例公司", position: "产品经理", starred: JOB_STAR_VALUE });

  assert.equal(state.jobs.some((job) => job.recordId === "job-deleted"), false);
  assert.equal(state.outbox.some((item) => item.recordId === "job-deleted"), false);
  assert.equal(state.currentJobId, null);
});

test("flushOutbox does not replay remaining reverse status patches twice", async () => {
  resetStore();
  const originalPatchJob = api.patchJob;
  const firstHistory = JSON.stringify([{ at: 1, from: "已投", to: "笔试", resumeId: "R1" }]);
  state.jobs = [{ recordId: "job-sync", company: "示例公司", position: "产品经理", status: "已投", resumeId: "R1", statusHistory: "" }];
  state.outbox = [
    {
      id: "to-written",
      kind: "job.patch",
      recordId: "job-sync",
      patch: { status: "笔试", resumeId: "R1" },
      statusChange: { at: 1, from: "已投", to: "笔试", resumeId: "R1" },
    },
    {
      id: "back-to-applied",
      kind: "job.patch",
      recordId: "job-sync",
      patch: { status: "已投", resumeId: "R1" },
      statusChange: { at: 2, from: "笔试", to: "已投", resumeId: "R1" },
    },
  ];
  let calls = 0;
  api.patchJob = async () => {
    calls += 1;
    if (calls === 1) {
      return { job: { recordId: "job-sync", status: "笔试", resumeId: "R1", statusHistory: firstHistory } };
    }
    throw new NetError("网络中断");
  };

  try {
    await flushOutbox();

    assert.equal(calls, 2);
    assert.equal(state.jobs[0].status, "已投");
    assert.deepEqual(JSON.parse(state.jobs[0].statusHistory), []);
    assert.equal(state.outbox.length, 1);
    assert.equal(state.outbox[0].id, "back-to-applied");
    assert.equal(state.offline, true);
  } finally {
    api.patchJob = originalPatchJob;
  }
});
