// 所有 fetch 都走这里。错误分型是稳定性的基础：调用方要能区分「口令失效」（回登录页）、
// 「环境变量没配」（常驻横幅，不要每个请求弹一次）、「网络不通」（进离线模式用快照）和
// 「这一次操作本身失败」（就地显示在触发它的控件旁）。混成一个 message 就只能一律弹窗。

const TOKEN_KEY = "jh.session";
const LEGACY_TOKEN_KEY = "jh.token";
const TIMEOUT_MS = 60_000; // AI 接口慢，给足；飞书接口后端自己 20s 超时
const UPLOAD_TIMEOUT_MS = 10 * 60_000; // 上百 MB 的录音走本地网卡也要几分钟

localStorage.removeItem(LEGACY_TOKEN_KEY);

export class AuthError extends Error {}
export class ConfigError extends Error {}
export class NetError extends Error {}
export class ApiError extends Error {
  constructor(message, detail) {
    super(message);
    this.detail = detail;
  }
}

export const token = {
  get: () => sessionStorage.getItem(TOKEN_KEY) || "",
  set: (value) => sessionStorage.setItem(TOKEN_KEY, value),
  clear: () => sessionStorage.removeItem(TOKEN_KEY),
};

function classify(status, error, detail) {
  if (status === 401) return new AuthError(error || "口令失效");
  if (typeof error === "string" && error.includes("缺少环境变量")) return new ConfigError(error);
  return new ApiError(error || `请求失败（${status}）`, detail);
}

async function request(method, path, body, options = {}) {
  const timeoutMs = options.timeoutMs || TIMEOUT_MS;
  const networkAsOffline = options.networkAsOffline !== false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(path, {
      method,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": token.get(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (!networkAsOffline) throw new ApiError("comparison request failed");
    // fetch 只在网络层失败时 reject，HTTP 4xx/5xx 不会走到这里
    throw new NetError(error.name === "AbortError" ? "请求超时" : "连不上服务器");
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new ApiError(`服务器返回的不是 JSON（${response.status}）`, text.slice(0, 300));
  }
  if (!response.ok || payload.ok === false) {
    throw classify(response.status, payload.error, payload.detail);
  }
  return payload.data;
}

/**
 * 录音上传单独一条：发二进制而不是 JSON（通用 request 固定 Content-Type: application/json），
 * 而且上百 MB 的文件 60s 传不完。只负责上传 + 拿 jobId，转写本身靠轮询。
 */
async function uploadAudio(file) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`/api/reviews/audio?name=${encodeURIComponent(file.name)}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Auth-Token": token.get(),
      },
      body: file,
    });
  } catch (error) {
    throw new NetError(error.name === "AbortError" ? "上传超时" : "连不上服务器");
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new ApiError(`上传返回的不是 JSON（${response.status}）`, text.slice(0, 300));
  }
  if (!response.ok || payload.ok === false) throw classify(response.status, payload.error, payload.detail);
  return payload.data;
}

const COMPARISON_TIMEOUT_MS = 4 * 60_000;

export const api = {
  get: (path) => request("GET", path),
  post: (path, body) => request("POST", path, body ?? {}),
  patch: (path, body) => request("PATCH", path, body),
  del: (path) => request("DELETE", path),

  health: () => request("GET", "/api/health"),
  login: (password) => request("POST", "/api/auth/check", { password }),

  companies: () => request("GET", "/api/companies"),
  createCompany: (patch) => request("POST", "/api/companies", patch),
  patchCompany: (recordId, patch) => request("PATCH", `/api/companies/${recordId}`, patch),
  deleteCompany: (recordId) => request("DELETE", `/api/companies/${recordId}`),

  comparisonPreference: () => request("GET", "/api/preferences/comparison"),
  patchComparisonPreference: (patch) => request("PATCH", "/api/preferences/comparison", patch),

  jobs: () => request("GET", "/api/jobs"),
  createJob: (patch) => request("POST", "/api/jobs", patch),
  patchJob: (recordId, patch) => request("PATCH", `/api/jobs/${recordId}`, patch),
  deleteJob: (recordId) => request("DELETE", `/api/jobs/${recordId}`),
  prepDoc: (recordId) => request("POST", `/api/jobs/${recordId}/prep-doc`, {}),

  calendarEvents: () => request("GET", "/api/calendar-events"),
  createCalendarEvent: (patch) => request("POST", "/api/calendar-events", patch),
  patchCalendarEvent: (recordId, patch) => request("PATCH", `/api/calendar-events/${recordId}`, patch),
  deleteCalendarEvent: (recordId) => request("DELETE", `/api/calendar-events/${recordId}`),

  resumes: () => request("GET", "/api/resumes"),
  generateResume: (jd) => request("POST", "/api/resumes/generate", { jd }),
  createResume: (patch) => request("POST", "/api/resumes", patch),
  patchResume: (recordId, patch) => request("PATCH", `/api/resumes/${recordId}`, patch),
  recomputeApply: () => request("POST", "/api/resumes/recompute-apply-record", {}),

  experiences: () => request("GET", "/api/experiences"),
  tags: () => request("GET", "/api/experiences/tags"),
  createExperience: (item) => request("POST", "/api/experiences", item),
  importExperiences: (items) => request("POST", "/api/experiences/import", { items }),
  generateExperienceSummary: (recordId, content) =>
    request("POST", "/api/experiences/generate-summary", { recordId, content }),
  patchExperience: (recordId, patch) => request("PATCH", `/api/experiences/${recordId}`, patch),
  deleteExperience: (recordId) => request("DELETE", `/api/experiences/${recordId}`),
  addInterviewQuestion: (recordId, payload) =>
    request("POST", `/api/experiences/${recordId}/interview-question`, payload),

  compareJobs: (payload) => request("POST", "/api/job-comparison", payload, {
    timeoutMs: COMPARISON_TIMEOUT_MS,
    networkAsOffline: false,
  }),
  fillFormLibrary: () => request("GET", "/api/fill-form/library"),
  splitForm: (rawText) => request("POST", "/api/fill-form/split", { rawText }),
  answerForm: (payload) => request("POST", "/api/fill-form/answer", payload),
  reviseForm: (payload) => request("POST", "/api/fill-form/revise", payload),
  intro: (payload) => request("POST", "/api/intro/generate", payload),
  interviewPrep: (payload) => request("POST", "/api/interview-prep", payload),
  mockStart: (payload) => request("POST", "/api/mock/start", payload),
  mockChat: (payload) => request("POST", "/api/mock/chat", payload),
  mockEnd: (payload) => request("POST", "/api/mock/end", payload),
  mockExport: (payload) => request("POST", "/api/mock/export", payload),

  // 复盘按岗位按需加载，不进 loadAll（和 calendarEvents 一致）
  reviews: (jobRecordId) =>
    request("GET", `/api/reviews?jobRecordId=${encodeURIComponent(jobRecordId || "")}`),
  uploadReviewAudio: (file) => uploadAudio(file),
  transcribeStatus: (jobId) => request("GET", `/api/reviews/transcribe/${jobId}`),
  reviewComment: (payload) => request("POST", "/api/reviews/comment", payload),
  createReview: (payload) => request("POST", "/api/reviews", payload),
  appendReview: (recordId, payload) => request("POST", `/api/reviews/${recordId}/append`, payload),
};
