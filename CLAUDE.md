# job-hunter

秋招管理系统。飞书 bitable 为数据中心，网页前端（本地 / Vercel）。

权威文档：`docs/PRD.md`。交接现状：`docs/handoff.md`。

## 技术栈

- Node.js >= 22，ESM，**零依赖**（原生 fetch + `--env-file`）
- 前端：Vue 3 全量构建，本地 `public/vendor/` 固定版本，无构建步骤、无 CDN
- 后端：`src/dev-server.js`（本地）/ `api/[...path].js`（Vercel），共用 `src/api/index.js`
- 存储：飞书 bitable REST OpenAPI + 自建应用 `tenant_access_token`
- AI：DeepSeek（OpenAI 兼容），无 key 时自动走 MOCK 占位

## 目录约定

```
src/
  config.js        — 环境变量集中读取
  http/app.js      — 路由匹配、口令校验、错误包装
  api/             — 路由表和处理函数
  storage/         — lark-client.js（token + 请求）/ schema.js（字段映射）/ bitable.js（CRUD）
  services/        — 确定性逻辑：resume.js（编号分配 + 投递记录重算）/ prep-doc.js / context.js
  llm/             — provider.js（DeepSeek + mock）/ prompts.js（模板加载）
  scripts/         — check.js（自检）/ init-tags.js / recompute.js
  dev-server.js    — 本地服务器 + 静态文件
prompts/           — prompt 模板 md
public/
  index.html       — 只有 #app + vendor/vue + 一个 module 入口
  style.css        — 设计变量 + 全部样式
  vendor/          — vue.global.prod.js（固定版本，classic script）
  js/
    api.js         — fetch 封装 + 错误分型
    persist.js     — localStorage：离线快照 / AI 草稿 / 当前岗位
    store.js       — 全局 reactive 状态、载入、离线降级
    ui.js          — 共用件（DraftBox / FieldRow / TagPicker / Confirm / JobPicker）
    main.js        — createApp + 登录闸门 + 侧边栏 + 顶部当前岗位条 + hash 路由
    views/         — 一个侧边栏入口一个文件，八个
api/[...path].js   — Vercel catch-all 入口
```

## 前端约定

- **一个侧边栏入口一个 view 文件**，改一个功能只动一个文件
- 模板写成 JS 模板字符串，靠 `vue.global.prod.js` 自带的运行时编译器；`vendor/` 是 classic script，必须在 module 入口之前加载，`window.Vue` 才就绪
- **当前岗位是全局状态**（`store.currentJobId`，持久化）。看板、速查列表、顶部下拉三处都能设置它；岗位相关的四个功能页只读它，不再各自选一次岗位
- hash 路由（`#/board`、`#/job/forms`、`#/lib/resumes`），刷新停在原地
- 错误分四型（`api.js`）：`AuthError` 回登录页 / `ConfigError` 常驻横幅 / `NetError` 进离线快照模式 / `ApiError` 就地显示在触发它的控件旁。混成一个 message 就只能一律弹窗
- **AI 草稿一律落 localStorage**（`useDraft(kind, scopeRef, blank)`），只在明确写回或丢弃时清。刷新或误关标签页不该让一次真实 API 花费白付
- 写操作在离线模式下全部 disabled，读用快照

## 命令

```
npm run check      # 自检：环境变量、飞书字段类型是否与 schema.js 一致、LLM 连通性
npm run dev        # 本地开发，http://localhost:3000
LLM_MOCK=1 npm run dev            # 没有可用 LLM key 时联调前端
LARK_MOCK=1 LLM_MOCK=1 npm run dev  # 完全不碰飞书、不花钱，用内存假数据验收前端
npm run init-tags  # 一次性初始化经历库技能标签选项（需 --yes）
npm run recompute  # 手动全量重算简历库投递记录
```

`LARK_MOCK=1` 走 `src/storage/mock-store.js` 的内存假数据（重启即清空），并且 `prep-doc.js` 也会短路成假文档——文档走的是 docx 接口而不是 bitable，不在那里也挡一道，本地点一次「建准备文档」就会在她云空间里留一个真文档。判定带 `&& !process.env.VERCEL`，线上不可能被假数据污染。

## 开发规范

- 字段名不许硬编码中文，一律走 `src/storage/schema.js` 的英文 key
- 记录一律用 `record_id` 定位，不用公司名/岗位名等业务字段
- 结构化字段写回 bitable 必须由用户在前端确认；追加写飞书文档不需确认
- 确定性逻辑放 `src/services/`，不要交给 AI
- prompt 只用 `{{变量}}`，条件分支在调用方拼好
- 新增接口同时加到 `src/api/*.js` 的路由数组，两个入口自动生效

### 故障隔离（别退化掉）

系统有三个独立的失败源：飞书、DeepSeek、网络。任何一个挂了，不能连带把别的功能弄死。

- **派生数据的失败不能让主写入看起来失败。** 改岗位状态 → 重算简历投递记录，重算失败要降级成返回里的 `recompute.error`，岗位状态本身已经存进去了。同理建准备文档：文档建出来了但链接回填失败，也要把 URL 返回给前端，否则文档就找不回来。
- **AI 已经产出的内容不能因为后续副作用失败而丢掉。** 面试准备材料生成成功、追加写文档失败，要返回材料 + `appended.error`。那是一次真实的 API 花费。
- **不依赖飞书的 AI 接口不要去读飞书。** `fill-form/split`、`fill-form/revise`、`mock/chat`、`mock/export` 都不碰 bitable，飞书挂了它们照常可用。
- **只重试可恢复的错误。** `lark-client.js` 只对 token 失效（清缓存重取）和并发/限流（退避）重试；权限、字段、参数错误立刻抛出。`provider.js` 只重试 5xx，4xx 直接抛。
- **能用脚本的不要用 AI**（PRD 原则 2）。编号分配、投递记录重算、Mock 对话导出都是纯脚本。AI 的输出不要当机器 key 用——`mock/end` 靠标题字符串匹配经历记录，匹配不上时必须让用户在前端手选。

## 飞书

| 项 | 值 |
|----|-----|
| base | https://mcn6uafh559t.feishu.cn/base/B3jqb8GDCa0oBQsckY9chlFTn6f |
| 主表 | tblKAcj7wrYoNk7V |
| 经历库 | tblPVjAP0AJzYmKt |
| 简历库 | tblK5eg0TEcC8jJp |
| 应用 | cli_aa9fe5cc7ce49cd7（已加为 base 协作者 full_access） |

已实测的坑：
- 飞书不支持 `url` 字段类型，「官网链接」「准备文档链接」实际是 text
- 单选读回可能是数组 `["待投"]`；长文本在 search 接口下是 `[{type,text}]`
- datetime 写入用毫秒时间戳
- 多选写入不存在的选项报 `800030005`，不会自动建选项
- 应用创建的文档默认用户看不见，必须给她本人授权，否则她打开自己的链接 403
- docx 文本块的 `elements` 传空数组会报 `1770001 invalid param`。空行也得带一个 `content` 为空串的 `text_run`
- 授权接口 `/drive/v1/permissions/:token/members` 需要云文档类权限（`docs:permission.member:create` / `drive:drive` 任一）。2026-08-06 已开通并实测通过；开通前会报 `99991672`，症状是文档建得出来但她打开自己的链接 403。以后再遇到这个码，先查开放平台的权限有没有重新发布版本
- 应用私有空间里会攒下测试文档（`GET /drive/v1/files` 能列出来）。它们默认只有应用看得见，要显式授权给她才删得掉

## 自主边界（红线）

以下操作必须先问 lijue：
- bitable 表结构变更（新增/删除/重命名字段、增删选项）
- 飞书文档覆盖写（追加写不受限）
- Vercel 部署或环境变量变更
- 修改 `.env`
- 批量调用 DeepSeek（如批量生成经历库短版本）
- 删除 bitable 记录
