// 环境变量由 node --env-file=.env 注入（见 package.json scripts）；Vercel 上由平台注入。
// 项目零依赖，不需要 npm install。
export const config = {
  port: Number(process.env.PORT || 3000),

  lark: {
    appId: process.env.LARK_APP_ID || "",
    appSecret: process.env.LARK_APP_SECRET || "",
    apiBase: process.env.LARK_API_BASE || "https://open.feishu.cn/open-apis",
    baseToken: process.env.BITABLE_APP_TOKEN || "",
    userOpenId: process.env.LARK_USER_OPEN_ID || "",
    docFolderToken: process.env.LARK_DOC_FOLDER_TOKEN || "",
    docUrlBase: process.env.LARK_DOC_URL_BASE || "https://feishu.cn/docx/",
    // 内存假数据，仅供本地开发。VERCEL 由平台自动注入，所以线上不可能命中，哪怕后台误填 LARK_MOCK
    mock: process.env.LARK_MOCK === "1",
    tables: {
      company: process.env.BITABLE_TABLE_COMPANY || "",
      main: process.env.BITABLE_TABLE_MAIN || "",
      experience: process.env.BITABLE_TABLE_EXPERIENCE || "",
      resume: process.env.BITABLE_TABLE_RESUME || "",
      preference: process.env.BITABLE_TABLE_PREFERENCE || "",
      calendar: process.env.BITABLE_TABLE_CALENDAR || "",
      review: process.env.BITABLE_TABLE_REVIEW || "",
    },
  },

  // 本地语音转写。引擎是仓库外部的 Python 工具（tools/transcribe/），Node 侧只用 child_process 调，
  // 所以这里全是路径而不是 npm 包。三项都没配就等于关闭该功能，见 services/transcribe.js。
  asr: {
    pythonPath: process.env.ASR_PYTHON || "",
    scriptPath: process.env.ASR_SCRIPT || "",
    modelDir: process.env.ASR_MODEL_DIR || "",
    maxUploadMb: Number(process.env.ASR_MAX_UPLOAD_MB || 1024),
  },

  llm: {
    apiKey: process.env.DEEPSEEK_API_KEY || "",
    baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
    mock: process.env.LLM_MOCK === "1",
  },

  auth: {
    password: process.env.APP_PASSWORD || "",
  },
};

export function assertLarkConfig() {
  const missing = [];
  if (!config.lark.appId) missing.push("LARK_APP_ID");
  if (!config.lark.appSecret) missing.push("LARK_APP_SECRET");
  if (!config.lark.baseToken) missing.push("BITABLE_APP_TOKEN");
  if (missing.length) {
    throw new Error(`缺少环境变量：${missing.join(", ")}（见 .env.example）`);
  }
}
