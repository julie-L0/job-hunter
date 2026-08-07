import { createApp, HttpError } from "../http/app.js";
import { config } from "../config.js";
import { isMock } from "../llm/provider.js";
import { listFields } from "../storage/bitable.js";
import { JOB_STATUSES, RESUME_REQUIRED_STATUSES } from "../storage/schema.js";
import { companyRoutes } from "./companies.js";
import { jobRoutes } from "./jobs.js";
import { resumeRoutes } from "./resumes.js";
import { experienceRoutes } from "./experiences.js";
import { aiRoutes } from "./ai.js";

const systemRoutes = [
  {
    method: "GET",
    path: "/api/health",
    public: true,
    handler: () => ({
      llmMock: isMock(),
      larkMock: config.lark.mock,
      authRequired: Boolean(config.auth.password),
      larkConfigured: Boolean(config.lark.appId && config.lark.appSecret),
      // 前端的看板列和状态下拉都从这里取，避免在前端再硬编码一份中文选项
      jobStatuses: JOB_STATUSES,
      resumeRequiredStatuses: [...RESUME_REQUIRED_STATUSES],
    }),
  },
  {
    method: "POST",
    path: "/api/auth/check",
    public: true,
    handler: ({ body }) => {
      if (config.auth.password && body.password !== config.auth.password) {
        throw new HttpError(401, "口令错误");
      }
      return { token: config.auth.password || "" };
    },
  },
  {
    // 比对飞书里的真实字段类型和 schema.js，排查字段漂移
    method: "GET",
    path: "/api/debug/fields/:tableKey",
    handler: ({ params }) => listFields(params.tableKey),
  },
];

export const routes = [
  ...systemRoutes,
  ...companyRoutes,
  ...jobRoutes,
  ...resumeRoutes,
  ...experienceRoutes,
  ...aiRoutes,
];

export const handle = createApp(routes);
