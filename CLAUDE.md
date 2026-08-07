# job-hunter

单用户秋招管理系统。飞书多维表格作为数据源，网页前端可在本地或 Vercel 运行。

产品需求以 `docs/PRD.md` 为准，安装和运维说明见 `docs/handoff.md`。

## 技术栈

- Node.js >= 22，ESM，零第三方后端依赖
- 前端使用仓库内固定版本的 Vue 3 全量构建，无构建步骤、无 CDN
- 本地入口：`src/dev-server.js`
- Vercel 入口：`api/[...path].js`
- 存储：飞书 Bitable REST OpenAPI
- AI：DeepSeek OpenAI 兼容接口；无 key 时使用 mock 回复

## 目录约定

```text
api/                 Vercel Serverless 入口
public/              静态前端
prompts/             LLM prompt
src/api/             HTTP 路由
src/http/            路由、认证和错误处理
src/llm/             模型 provider
src/services/        业务逻辑
src/storage/         飞书适配、schema 和 mock store
src/scripts/         检查、重算和迁移脚本
docs/                产品与安装说明
```

## 数据约定

飞书字段映射的唯一来源是 `src/storage/schema.js`，业务代码只使用英文 key。

- `company`：永久公司主数据
- `main`：岗位记录，通过 `companyId` 保存 company 的 `record_id`
- `experience`：经历素材
- `resume`：简历版本

公司名称按 NFKC、首尾去空格、连续空白折叠和小写进行重复判断。岗位的公司名、官网、背景和备注是兼容旧表的快照；展示和 AI 上下文以 company 表为准。

## 运行命令

```bash
npm run dev
npm run check
npm run init-tags
npm run recompute
npm run migrate-companies
```

本地纯 mock 验收：

```bash
LARK_MOCK=1 LLM_MOCK=1 APP_PASSWORD=x npm run dev
LARK_MOCK=1 LLM_MOCK=1 APP_PASSWORD=x npm run check -- --allow-mock
```

`migrate-companies` 默认只输出 dry-run，只有显式 `--apply` 才写入。不得改变这一默认行为。

## 工程约束

- 保持 Node 22、ESM、零依赖和 Vue 浏览器直载架构
- 不引入构建工具、TypeScript、CSS 框架或状态管理库
- API 统一返回 `{ ok: true, data }` 或 `{ ok: false, error, detail }`
- 所有飞书读写经过 `src/storage/bitable.js`
- 所有模型调用经过 `src/llm/provider.js`
- 数据边界校验放在 API 或 service 层，不依赖前端校验
- 修改字段映射时同步更新 schema、mock store、检查脚本和文档
- 前端改动必须进行真实浏览器验收，覆盖桌面和 390px 视口
- 改完运行相关测试、`node --check` 和 `git diff --check`

## 安全约束

- `.env`、密钥、token、表 ID、用户 ID 和真实业务数据不得提交
- `.env.example` 只能保留空值或通用占位符
- 公网环境必须设置强 `APP_PASSWORD`
- `LARK_MOCK=1` 只用于本地；Vercel 环境不得读取 mock 数据
- 日志不得输出请求头、访问口令、飞书凭证、JD、简历或面试内容
- 不得在未确认时修改真实飞书表结构、迁移数据、部署或推送远端
- 不得通过关闭认证、跳过校验或硬编码凭证解决问题
