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
    docUrlBase: process.env.LARK_DOC_URL_BASE || "https://mcn6uafh559t.feishu.cn/docx/",
    // 内存假数据，仅供本地开发。VERCEL 由平台自动注入，所以线上不可能命中，哪怕后台误填 LARK_MOCK
    mock: process.env.LARK_MOCK === "1" && !process.env.VERCEL,
    tables: {
      main: process.env.BITABLE_TABLE_MAIN || "",
      experience: process.env.BITABLE_TABLE_EXPERIENCE || "",
      resume: process.env.BITABLE_TABLE_RESUME || "",
    },
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
  for (const [key, value] of Object.entries(config.lark.tables)) {
    if (!value) missing.push(`BITABLE_TABLE_${key.toUpperCase()}`);
  }
  if (missing.length) {
    throw new Error(`缺少环境变量：${missing.join(", ")}（见 .env.example）`);
  }
}
