// 全局状态。三件事：数据、当前岗位、降级。
// 降级的核心约定：飞书不通时不清空已有数据，用 localStorage 快照继续渲染，只禁掉写操作。
// 「看不到今天要投哪几个」比「看到的是 8 分钟前的」严重得多。
import { AuthError, ConfigError, NetError, api, token } from "./api.js";
import { currentJob, snapshot } from "./persist.js";

const { reactive, computed } = window.Vue;

export const state = reactive({
  ready: false,
  authed: false,
  authRequired: true,
  health: {},
  jobs: [],
  resumes: [],
  experiences: [],
  tags: [],
  currentJobId: currentJob.load(),

  loading: false,
  offline: false,
  snapshotAt: null,
  configError: "",
  toast: "",
});

export const statuses = computed(() => state.health.jobStatuses || []);
export const ACTIVE_STATUSES = computed(() => statuses.value.filter((s) => !isClosed(s)));

const CLOSED = new Set(["挂", "offer"]);
export const isClosed = (status) => CLOSED.has(status);

export const currentJobRef = computed(
  () => state.jobs.find((job) => job.recordId === state.currentJobId) || null,
);

export function setCurrentJob(recordId) {
  state.currentJobId = recordId || null;
  currentJob.save(recordId);
}

export function toast(message) {
  state.toast = message;
  if (message) setTimeout(() => (state.toast === message ? (state.toast = "") : null), 4000);
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
    state.jobs = cached.jobs || [];
    state.resumes = cached.resumes || [];
    state.experiences = cached.experiences || [];
    state.tags = cached.tags || [];
    state.snapshotAt = cached.at || null;
  }

  if (!silent) state.loading = true;
  try {
    const [jobs, resumes, experiences, tags] = await Promise.all([
      api.jobs(),
      api.resumes(),
      api.experiences(),
      api.tags(),
    ]);
    state.jobs = jobs;
    state.resumes = resumes;
    state.experiences = experiences;
    state.tags = tags;
    state.offline = false;
    state.snapshotAt = Date.now();
    snapshot.save({ jobs, resumes, experiences, tags });
  } catch (error) {
    handleError(error);
  } finally {
    state.loading = false;
  }
}

/** 单条岗位改完后就地替换，不重拉整表。 */
export function mergeJob(job) {
  const index = state.jobs.findIndex((item) => item.recordId === job.recordId);
  if (index >= 0) state.jobs[index] = { ...state.jobs[index], ...job };
  else state.jobs.push(job);
  snapshot.save({
    jobs: state.jobs,
    resumes: state.resumes,
    experiences: state.experiences,
    tags: state.tags,
  });
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

export function dropJob(recordId) {
  state.jobs = state.jobs.filter((job) => job.recordId !== recordId);
  if (state.currentJobId === recordId) setCurrentJob(null);
}

/** 状态推进到下一档；已是最后一档或已结束则返回 null。 */
export function nextStatus(status) {
  const flow = ACTIVE_STATUSES.value;
  const index = flow.indexOf(status);
  if (index < 0 || index === flow.length - 1) return null;
  return flow[index + 1];
}

export const resumeCodes = computed(() =>
  state.resumes.map((resume) => resume.code).filter(Boolean).sort(),
);
