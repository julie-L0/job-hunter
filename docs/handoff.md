# 安装与运维

本项目是单用户秋招管理工具。每个使用者应创建自己的飞书应用、Bitable 和模型账号；仓库不提供或保存任何真实凭证与业务数据。

## 本地体验

Node.js 需要 22 或更高版本。项目零依赖，无需 `npm install`。

```bash
LARK_MOCK=1 LLM_MOCK=1 APP_PASSWORD=x npm run dev
```

打开终端输出的本地地址，口令输入 `x`。mock 数据只在内存中，进程重启后恢复初始状态，不访问飞书或 DeepSeek。

运行 mock 检查：

```bash
LARK_MOCK=1 LLM_MOCK=1 APP_PASSWORD=x npm run check -- --allow-mock
```

## 飞书准备

1. 在飞书开放平台创建企业自建应用。
2. 创建一个多维表格，并把应用添加为可管理该 Base 的协作者。
3. 创建 `company`、`main`、`experience`、`resume` 四张数据表。
4. 按 `src/storage/schema.js` 中的中文字段名和类型创建字段；每张表的第一个字段必须对应 schema 的 `primary`。
5. 给 `main.状态` 配置：`待投、已投、笔试、一面、二面、三面、挂、offer`。
6. 如需技能标签，在 `experience.技能标签` 中预先创建允许的多选项。
7. 在开放平台为应用开启 Bitable 读写权限；如需准备文档，再开启云文档创建、编辑和授权权限。

字段概要：

| 表 | 主字段 | 其他字段 |
|---|---|---|
| company | 公司名（文本） | 官网链接、公司背景备注、备注 |
| main | 公司名（文本） | 公司ID、岗位名、JD、官网链接、投递DDL、内推码、状态、简历编号、准备文档链接、四种自我介绍、公司背景备注、备注 |
| experience | 经历标题（文本） | 经历摘要、技能标签、经历正文、相关链接、追问记录 |
| resume | 编号（文本） | 版本名、适用方向、正文内容、投递记录、创建时间 |

其中 `投递DDL` 和 `创建时间` 是日期字段，`状态` 是单选，`技能标签` 是多选，其余为文本。以 `src/storage/schema.js` 为最终准则。

## 环境变量

复制 `.env.example` 为 `.env`，只在本机填写：

```env
BITABLE_APP_TOKEN=
BITABLE_TABLE_COMPANY=
BITABLE_TABLE_MAIN=
BITABLE_TABLE_EXPERIENCE=
BITABLE_TABLE_RESUME=

LARK_APP_ID=
LARK_APP_SECRET=
LARK_USER_OPEN_ID=
LARK_DOC_FOLDER_TOKEN=
LARK_DOC_URL_BASE=https://your-tenant.feishu.cn/docx/

DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat

APP_PASSWORD=
```

`LARK_USER_OPEN_ID`、文档目录和文档 URL 只在创建准备文档时需要。`.env` 已被 Git 忽略，不要把真实值写进 `.env.example`、文档、日志或 commit。

## 连接真实数据

先执行只读检查：

```bash
LLM_MOCK=1 npm run check -- --allow-mock
```

检查会读取四张表的字段和记录数量，但不会修改数据，也不会调用付费模型。字段名称或类型不匹配时应先修正表结构，不要绕过检查。

启动真实服务：

```bash
npm run dev
```

## 旧数据迁移

如果旧版把公司和岗位混在 `main` 表中，可运行：

```bash
npm run migrate-companies
```

默认只输出 dry-run，包括公司分组、空名称、字段冲突和预计更新数。确认无冲突后才执行：

```bash
npm run migrate-companies -- --apply
```

迁移只创建 company 记录并回填 `main.公司ID`，不会覆盖 JD、状态、简历、DDL、附件或备注，也不会删除旧记录。脚本可重复执行；迁移完成后的 dry-run 应显示新增和更新均为 0。

经历库旧字段迁移可运行：

```bash
npm run migrate-experiences
```

默认只输出 dry-run，包括缺失字段和预计迁移记录数。确认无误后才执行：

```bash
npm run migrate-experiences -- --yes
```

脚本会创建缺失的「经历摘要」「经历正文」「相关链接」「追问记录」文本字段，并将旧「100字版」或「50字版」迁移到「经历摘要」、旧「STAR全文」迁移到「经历正文」。旧「相关链接」「追问记录」继续作为正式字段保留，不会被合并进正文后删除。

## Vercel 部署

Vercel 使用 `api/[...path].js` 作为 Serverless 入口，并直接托管 `public/`。

1. 在 Vercel 创建项目。
2. 把 `.env.example` 中除 `PORT`、`LARK_MOCK`、`LLM_MOCK` 外的实际配置写入 Vercel Environment Variables。
3. 为 `APP_PASSWORD` 设置高强度随机值。
4. 先部署 Preview，验证登录、公司库、岗位详情和四个 AI 页面。
5. Preview 通过后再发布 Production。

不要把 `.env` 上传到 Vercel 构建源。不要在公网环境启用 mock 数据。

## 安全检查

- 除 `/api/health` 和 `/api/auth/check` 外，所有 API 都必须要求 `X-Auth-Token`。
- 公网部署必须设置 `APP_PASSWORD`，否则所有受保护接口返回 503，不会默认放行。
- 登录成功只签发 12 小时有效的 HMAC 会话；浏览器将会话保存在 `sessionStorage`，关闭标签页后清除，原始口令不作为 token 返回。
- 单实例会按客户端地址限制连续登录失败。Vercel Functions 的内存不跨实例共享，这层限速只能降低常规尝试，不能替代高强度随机口令或平台级 WAF 限速。
- 日志不得输出访问口令、会话 token、请求头、飞书凭证、JD、简历或面试内容。
- 发布前检查当前树和完整 Git 历史，确认没有真实 token、ID、用户路径或业务数据。
- 真实表结构修改、数据迁移、环境变量变更和生产部署应分开确认并逐步验证。
