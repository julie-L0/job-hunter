// 全局状态。三件事：数据、当前岗位、降级。
// 降级的核心约定：飞书不通时不清空已有数据，用 localStorage 快照继续渲染，岗位改动先进 outbox。
// 「看不到今天要投哪几个」比「看到的是 8 分钟前的」严重得多。
import { AuthError, ConfigError, NetError, api, token } from "./api.js";
import { ensureRequiredResume, mergeOutboxItem, repairOutboxItems } from "./outbox.js";
import { currentJob, outbox, snapshot } from "./persist.js";
import { appendStatusHistory } from "./status-history.js";

const { reactive, computed } = window.Vue;

export const state = reactive({
  ready: false,
  authed: false,
  authRequired: true,
  health: {},
  companies: [],
  jobs: [],
  resumes: [],
  experiences: [],
  tags: [],
  currentJobId: currentJob.load(),
  currentCompanyId: null,
  boardTab: "全部",

  loading: false,
  offline: false,
  snapshotAt: null,
  outbox: outbox.load(),
  syncing: false,
  syncError: "",
  configError: "",
  toast: "",
});

export const statuses = computed(() => state.health.jobStatuses || []);
export const experienceTypes = computed(() => state.health.experienceTypes || []);
export const comparisonStages = computed(() => state.health.comparisonStages || []);
export const ACTIVE_STATUSES = computed(() => statuses.value.filter((s) => !isClosed(s)));
export const pendingSyncCount = computed(() => state.outbox.length);

export const JOB_STAR_VALUE = "星标";
const CLOSED = new Set(["挂", "offer"]);
export const isClosed = (status) => CLOSED.has(status);
export const isStarredJob = (job) => Boolean(job?.starred);
export const statusRequiresResume = (status) =>
  (state.health.resumeRequiredStatuses || []).includes(status);

export const currentJobRef = computed(
  () => state.jobs.find((job) => job.recordId === state.currentJobId) || null,
);

export const jobReady = computed(() =>
  Boolean(currentJobRef.value && String(currentJobRef.value.jd || "").trim()),
);

export function setCurrentJob(recordId) {
  state.currentJobId = recordId || null;
  currentJob.save(recordId);
}

export function openCompanyLibrary(recordId) {
  state.currentCompanyId = recordId || null;
  state.boardTab = "公司库";
  location.hash = "#/board";
}

export function toast(message) {
  state.toast = message;
  if (message) setTimeout(() => (state.toast === message ? (state.toast = "") : null), 4000);
}

function saveSnapshot() {
  snapshot.save({
    companies: state.companies,
    jobs: state.jobs,
    resumes: state.resumes,
    experiences: state.experiences,
    tags: state.tags,
  });
}

function persistOutbox(items) {
  state.outbox = Array.isArray(items) ? items : [];
  outbox.save(state.outbox);
}

function repairOutbox() {
  const result = repairOutboxItems(state.outbox, state.jobs, statusRequiresResume);
  if (result.changed) persistOutbox(result.items);
  state.syncError = result.firstBlockedError;
  return result;
}

function pendingForJob(recordId) {
  return state.outbox.some((item) => item.kind === "job.patch" && item.recordId === recordId);
}

function applyQueuedJobPatches() {
  repairOutbox();
  for (const item of state.outbox) {
    if (item.kind !== "job.patch") continue;
    const index = state.jobs.findIndex((job) => job.recordId === item.recordId);
    if (index < 0) continue;
    const localPatch = item.statusChange
      ? {
        ...item.patch,
        statusHistory: appendStatusHistory(state.jobs[index].statusHistory, item.statusChange),
      }
      : item.patch;
    state.jobs[index] = { ...state.jobs[index], ...localPatch, pendingSync: true };
  }
}

/** 把 AuthError / ConfigError / NetError 收敛成全局状态，其余原样抛给调用方就地显示。 */
export function handleError(error) {
  if (error instanceof AuthError) {
    token.clear();
    state.authed = false;
    state.toast = "口令失效，请重新输入";
    return true;
  }
  if (error instanceof ConfigError) {
    state.configError = error.message;
    return true;
  }
  if (error instanceof NetError) {
    state.offline = true;
    return true;
  }
  return false;
}

/** 包住所有写操作：全局类错误进状态栏，业务错误交还调用方（它知道该显示在哪个控件旁）。 */
export async function guard(action) {
  try {
    const result = await action();
    if (state.offline) state.offline = false;
    return result;
  } catch (error) {
    if (handleError(error)) return undefined;
    throw error;
  }
}

export async function loadHealth() {
  try {
    state.health = await api.health();
    state.authRequired = state.health.authRequired !== false;
    if (!state.authRequired) state.authed = true;
    else if (token.get()) state.authed = true; // 真伪由第一次拉数据时的 401 判定
  } catch (error) {
    handleError(error);
  }
  state.ready = true;
}

export async function loadAll({ silent = false } = {}) {
  const cached = snapshot.load();
  if (cached && !state.jobs.length) {
    state.companies = cached.companies || [];
    state.jobs = cached.jobs || [];
    state.resumes = cached.resumes || [];
    state.experiences = cached.experiences || [];
    state.tags = cached.tags || [];
    state.snapshotAt = cached.at || null;
    applyQueuedJobPatches();
  }

  if (!silent) state.loading = true;
  try {
    const [companies, jobs, resumes, experiences, tags] = await Promise.all([
      api.companies(),
      api.jobs(),
      api.resumes(),
      api.experiences(),
      api.tags(),
    ]);
    state.companies = companies;
    state.jobs = jobs;
    state.resumes = resumes;
    state.experiences = experiences;
    state.tags = tags;
    applyQueuedJobPatches();
    state.offline = false;
    state.snapshotAt = Date.now();
    saveSnapshot();
    scheduleOutboxSync();
  } catch (error) {
    handleError(error);
  } finally {
    state.loading = false;
  }
}

export function mergeCompany(company) {
  const index = state.companies.findIndex((item) => item.recordId === company.recordId);
  if (index >= 0) state.companies[index] = { ...state.companies[index], ...company };
  else state.companies.push(company);
  state.jobs = state.jobs.map((job) => job.companyId === company.recordId ? {
    ...job,
    company: company.name,
    siteUrl: company.siteUrl || "",
    companyBackground: company.companyBackground || "",
    companyNote: company.note || "",
  } : job);
  saveSnapshot();
}

export function dropCompany(recordId) {
  state.companies = state.companies.filter((company) => company.recordId !== recordId);
  if (state.currentCompanyId === recordId) state.currentCompanyId = state.companies[0]?.recordId || null;
  saveSnapshot();
}

/** 单条岗位改完后就地替换，不重拉整表。 */
export function mergeJob(job) {
  const index = state.jobs.findIndex((item) => item.recordId === job.recordId);
  const next = { ...job, pendingSync: pendingForJob(job.recordId) };
  if (index >= 0) state.jobs[index] = { ...state.jobs[index], ...next };
  else state.jobs.push(next);
  saveSnapshot();
}

function cleanedPatch(patch) {
  return Object.fromEntries(Object.entries(patch || {}).filter(([, value]) => value !== undefined));
}

const syncingOutboxIds = new Set();

function enqueueJobPatch(recordId, patch, statusChange = null) {
  const now = Date.now();
  const items = mergeOutboxItem(
    state.outbox,
    {
      id: `job.patch:${recordId}:${now}:${Math.random().toString(36).slice(2, 8)}`,
      kind: "job.patch",
      recordId,
      patch,
      statusChange,
      createdAt: now,
      updatedAt: now,
      attempts: 0,
      error: "",
      blocked: false,
    },
    statusRequiresResume,
    { lockedIds: syncingOutboxIds },
  );
  persistOutbox(items);
  repairOutbox();
}

export async function saveJobPatch(recordId, patch) {
  const current = state.jobs.find((item) => item.recordId === recordId);
  if (!current) throw new Error("岗位不存在，请刷新后重试");
  const cleanPatch = ensureRequiredResume(cleanedPatch(patch), { ...current, ...patch }, statusRequiresResume);
  if (!Object.keys(cleanPatch).length) return { queued: false };

  const next = { ...current, ...cleanPatch };
  if (statusRequiresResume(next.status) && !String(next.resumeId || "").trim()) {
    throw new Error(`状态为「${next.status}」时必须选择简历`);
  }

  const statusChange = "status" in cleanPatch && cleanPatch.status !== current.status
    ? {
      at: Date.now(),
      from: current.status || "",
      to: cleanPatch.status || "",
      resumeId: "resumeId" in cleanPatch ? cleanPatch.resumeId : current.resumeId || "",
    }
    : null;
  const localPatch = statusChange
    ? { ...cleanPatch, statusHistory: appendStatusHistory(current.statusHistory, statusChange) }
    : cleanPatch;

  enqueueJobPatch(recordId, cleanPatch, statusChange);
  mergeJob({ recordId, ...localPatch, pendingSync: true });
  scheduleOutboxSync();
  return { queued: true };
}

let syncTimer = null;

export function scheduleOutboxSync(delay = 0) {
  if (!state.outbox.some((item) => !item.blocked)) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void flushOutbox();
  }, delay);
}

async function syncOutboxItem(item) {
  if (item.kind !== "job.patch") throw new Error(`未知同步任务：${item.kind}`);
  const job = state.jobs.find((candidate) => candidate.recordId === item.recordId);
  const payload = ensureRequiredResume(item.patch, { ...job, ...item.patch }, statusRequiresResume);
  if (item.statusChange) payload.statusChangedAt = item.statusChange.at;
  syncingOutboxIds.add(item.id);
  try {
    const result = await api.patchJob(item.recordId, payload);
    const remaining = state.outbox.filter((candidate) => candidate.id !== item.id);
    persistOutbox(remaining);
    mergeJob(result.job);
    applyQueuedJobPatches();
    saveSnapshot();
    if (result.warning) toast(result.warning);
  } finally {
    syncingOutboxIds.delete(item.id);
  }
}

export async function flushOutbox() {
  if (state.syncing || !state.outbox.length || !state.authed) return;
  state.syncing = true;
  repairOutbox();
  if (!state.outbox.some((item) => !item.blocked)) {
    state.syncing = false;
    return;
  }
  state.syncError = "";
  try {
    while (state.outbox.some((item) => !item.blocked)) {
      const item = state.outbox.find((candidate) => !candidate.blocked);
      try {
        await syncOutboxItem(item);
        state.offline = false;
      } catch (error) {
        const items = [...state.outbox];
        const failed = items.find((candidate) => candidate.id === item.id);
        if (failed) {
          failed.attempts = (failed.attempts || 0) + 1;
          failed.error = error.message || "同步失败";
          failed.updatedAt = Date.now();
          failed.blocked = !(error instanceof NetError);
          persistOutbox(items);
        }
        if (error instanceof NetError) {
          state.offline = true;
          state.syncError = error.message || "同步失败";
          break;
        }
        handleError(error);
        state.syncError = error.message || "同步失败";
      }
    }
    repairOutbox();
  } finally {
    state.syncing = false;
  }
}

export function mergeResume(resume) {
  const index = state.resumes.findIndex((item) => item.recordId === resume.recordId);
  if (index >= 0) state.resumes[index] = { ...state.resumes[index], ...resume };
  else state.resumes.push(resume);
}

export function mergeExperience(experience) {
  const index = state.experiences.findIndex((item) => item.recordId === experience.recordId);
  if (index >= 0) state.experiences[index] = { ...state.experiences[index], ...experience };
  else state.experiences.push(experience);
}

export function dropExperience(recordId) {
  state.experiences = state.experiences.filter((experience) => experience.recordId !== recordId);
  saveSnapshot();
}

export function dropJob(recordId) {
  state.jobs = state.jobs.filter((job) => job.recordId !== recordId);
  if (state.currentJobId === recordId) setCurrentJob(null);
  persistOutbox(state.outbox.filter((item) => item.recordId !== recordId));
  saveSnapshot();
}

export const resumeCodes = computed(() =>
  state.resumes.map((resume) => resume.code).filter(Boolean).sort(),
);

if (typeof window !== "undefined") {
  window.addEventListener("online", () => scheduleOutboxSync(250));
}
