// 所有 fetch 都走这里。错误分型是稳定性的基础：调用方要能区分「口令失效」（回登录页）、
// 「环境变量没配」（常驻横幅，不要每个请求弹一次）、「网络不通」（进离线模式用快照）和
// 「这一次操作本身失败」（就地显示在触发它的控件旁）。混成一个 message 就只能一律弹窗。

const TOKEN_KEY = "jh.session";
const LEGACY_TOKEN_KEY = "jh.token";
const TIMEOUT_MS = 60_000; // AI 接口慢，给足；飞书接口后端自己 20s 超时

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

async function request(method, path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
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

  jobs: () => request("GET", "/api/jobs"),
  createJob: (patch) => request("POST", "/api/jobs", patch),
  patchJob: (recordId, patch) => request("PATCH", `/api/jobs/${recordId}`, patch),
  deleteJob: (recordId) => request("DELETE", `/api/jobs/${recordId}`),
  prepDoc: (recordId) => request("POST", `/api/jobs/${recordId}/prep-doc`, {}),

  resumes: () => request("GET", "/api/resumes"),
  generateResume: (jd) => request("POST", "/api/resumes/generate", { jd }),
  createResume: (patch) => request("POST", "/api/resumes", patch),
  patchResume: (recordId, patch) => request("PATCH", `/api/resumes/${recordId}`, patch),
  recomputeApply: () => request("POST", "/api/resumes/recompute-apply-record", {}),

  experiences: () => request("GET", "/api/experiences"),
  tags: () => request("GET", "/api/experiences/tags"),
  importExperiences: (items) => request("POST", "/api/experiences/import", { items }),
  generateShort: (recordId) => request("POST", "/api/experiences/generate-short", { recordId }),
  patchExperience: (recordId, patch) => request("PATCH", `/api/experiences/${recordId}`, patch),
  followup: (recordId, note, source) =>
    request("POST", `/api/experiences/${recordId}/followup`, { note, source }),

  splitForm: (rawText) => request("POST", "/api/fill-form/split", { rawText }),
  answerForm: (payload) => request("POST", "/api/fill-form/answer", payload),
  reviseForm: (payload) => request("POST", "/api/fill-form/revise", payload),
  intro: (payload) => request("POST", "/api/intro/generate", payload),
  interviewPrep: (payload) => request("POST", "/api/interview-prep", payload),
  mockStart: (payload) => request("POST", "/api/mock/start", payload),
  mockChat: (payload) => request("POST", "/api/mock/chat", payload),
  mockEnd: (payload) => request("POST", "/api/mock/end", payload),
  mockExport: (payload) => request("POST", "/api/mock/export", payload),
};
