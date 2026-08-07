# 交接文档 — 2026-08-07

## 一句话现状

公司库与结构化岗位创建已完成 mock 和真实数据验收。真实飞书现有 `company / main / experience / resume` 四张表；截至 2026-08-07 最新检查为 company 4 条公司、main 15 条岗位。本机 `.env` 已配置 company 表，当前代码已接管 3117 并通过真实浏览器验收；Vercel 尚未部署。

架构约定、目录结构、飞书 ID、已踩过的坑都在 `CLAUDE.md`，产品需求在 `docs/PRD.md`，本文不重复。

## 怎么在本地打开

```
LARK_MOCK=1 LLM_MOCK=1 APP_PASSWORD=x npm run dev
```

用内存假数据 + 占位 AI，不碰真实飞书、不花 DeepSeek 的钱，口令输 `x`。要打真实数据就去掉两个 MOCK，口令用 `.env` 里的 `APP_PASSWORD`。

真实公司库版本当前运行在 `http://localhost:3117`。迁移脚本默认只 dry-run；本次真实迁移已完成且二次 dry-run 为 0 变更。Vercel 部署仍需单独执行。

## 已经验证过的

公司库版本（2026-08-07，全部使用 `LARK_MOCK=1 LLM_MOCK=1`）：

- `npm run check -- --allow-mock` 通过：company 4 字段 13 条、main 16 字段 14 条、experience 7 字段 4 条、resume 6 字段 3 条
- 公司增改查、规范化重名 409；岗位缺公司/岗位名/JD、无效状态/简历、已投无简历、PATCH 分步绕过均被服务端拒绝
- 空 JD 的 AI 请求在模型调用前返回 400；公司改名后岗位 hydration 返回最新公司信息
- 迁移分析 fixture、mock dry-run 和重复 `--apply` 通过；重复执行新增公司 0、回填岗位 0，且不删除伪公司记录
- Chrome CDP 完成桌面和 `390x844` 主流程：新增/编辑公司、结构化创建岗位、创建后打开详情、状态/简历联动、四个 AI 页的“本页岗位”、刷新与离线旧快照
- 移动端正文无横向溢出或控件重叠；删除岗位后公司保留，重新读取时岗位不复活

真实公司迁移（2026-08-07）：

- 迁移前 main 11 条岗位、3 个公司分组、0 个伪公司、0 个冲突；company 初始为空
- 创建 company 四字段表，并给 main 新增“公司ID”文本字段；创表后 main 仍为 11 条且公司ID均为空
- `--apply` 创建百度、京东、bilibili 3 条公司记录，只回填 11 条岗位的公司ID
- 原始飞书记录逐条比较通过：除“公司ID”外，包括岗位名、JD、状态、附件、简历、DDL、备注在内的字段均未变化
- 迁移后二次 dry-run 为 `companiesToCreate=0 / jobsToUpdate=0`，11 个引用全部有效
- 当前代码在 3129 端口读取真实数据：公司岗位数 5 / 3 / 3，岗位详情和 AI 页岗位选择正常，控制台无错误

框架层（早期）：

- 口令中间件：无 token → 401；口令错 → 401；口令对 → 返回 token
- 静态文件服务 + 目录穿越防护（`/../.env` 拿不到东西）；404 / 405 / 非法 JSON 都有明确报错
- 飞书应用已被加为 base 协作者（`full_access`），写入权限实测通过

旧三表版本前端（历史基线，脚本验证）：

- **17 个模板全部用真实 Vue 3.5.41 编译器编译通过**，不会出现模板语法导致的白屏
- **12 个 ES 模块 link 通过**（Node 会在 link 期校验 named export，拼错的 import 会当场报错）
- `public/js/` 里出现的 116 个 class 名全部在 `style.css` 里有对应规则
- **59 项接口契约走查全过**（`/tmp/apicheck.mjs`，对 mock 服务跑一遍前端会用到的每个接口）：登录、错 token → 401、岗位增改删、**清空投递DDL**、自我介绍、面试准备、拆题/答题/改稿、Mock 全流程、短版本、追问追加不覆盖、经历批量导入、未定义标签被 400 拒、简历生成与编号分配、投递记录重算
- SPA 回落区分扩展名：`/js/nope.js` → 404 `text/plain`，`/board` → 200 `text/html`。模块路径拼错会得到诚实的 404，不会拿到一个伪装成 JS 的 index.html

## 还没验证的

- 真实飞书上清一次投递DDL（datetime 传 `null`）。mock 层验过序列化，真实飞书接不接受仍未实测——这是唯一没法提前验的点
- 准备文档整条路由（`getRecord` → 建文档 → 授权 → 回填链接）只在 mock 层跑过全链路。三个飞书调用（建文档、写块、授权）本身都已对真实飞书单独验过
- 视觉细节：截图看过 12 屏，字号、间距、状态点颜色都对，但没在你自己的屏幕上看过。真机上觉得哪里挤或哪里太淡，直接说

## 准备文档：一个已修的 bug 和一个待你操作的权限

对真实飞书逐步诊断的结果（`1770001` 已定位并修掉）：

| 步骤 | 结果 |
|---|---|
| 建文档（只传 title） | ✓ |
| 写非空文本块 | ✓ |
| 写空文本块（`elements: []`） | ✗ `1770001 invalid param` |
| 空行换成 `content: ""` 的 `text_run` | ✓ |
| `index` 传 `-1` / `0` / 不传 | 都 ✓ |
| 授权给你本人 | ✓（2026-08-06 你补开权限后复验通过；开通前是 `99991672`） |

- **已修**：`prep-doc.js` 的 `textBlock` 现在空行也带一个 `content` 为空串的 `text_run`。准备文档的内容里 `\n\n` 是常态，所以原来这个 bug 会让建文档 100% 失败。修完拿带空行的多段内容对真实飞书重写了一次，通过
- **权限已开**：应用 `cli_aa9fe5cc7ce49cd7` 的云文档权限 2026-08-06 生效，「把新建文档授权给你本人」这一步现在能过。界面上万一再失败会明说，并把 URL 留在页面上，不会让文档丢掉
- **三个孤儿文件已授权给你**：`job-hunter 诊断-可删`、`测试公司-测试岗 面试准备`、bitable `小柳数据`。前两个是我诊断时建的，你可以直接删；**`小柳数据` 是另一个项目的，我只授权没动它**

## 旧三表版本浏览器走查：56 项全过

原来这份是留给你手点的 10 步清单。后来我用 Chrome DevTools Protocol 直接驱动浏览器跑完了（零依赖，Node 自带 `WebSocket` + Chrome 的 `--remote-debugging-port`），脚本在 `/tmp/walk-{a,b,c,d,e}.mjs`，截图在 `/tmp/jh-shots/`。**每一步都是真浏览器里真点的**，不是脚本层调接口。

| 阶段 | 覆盖 | 结果 |
|---|---|---|
| a | 登录三种口令、看板六列、DDL 红边、已结束折叠、快速新增、状态 tab 速查、选中即全局当前岗位、8 个路由各刷新一次、token 改坏自动回登录页 | 21/21 |
| b | 自我介绍生成/刷新存活/写回打勾、建准备文档、面试准备+追加、Mock 全流程（标记备注 → 回答 → 摘要 → 追问建议手选经历 → 导出 md 落盘） | 11/11 |
| c | F5 拆题/改题/加题/逐题生成/改稿/「全部生成」次数确认、简历库行内改名、按当前岗位 JD 生成并存成新编号、手动重算 | 8/8 |
| d | 经历库 CSV 解析（引号内换行和逗号）、野标签标红且导入键禁用、条数确认后真写入、追问记录分组、短版本拆成两栏并写回、草稿刷新存活、**离线降级：kill 服务 → 快照横幅 + 联网按钮禁用 + 数据还看得见 → 重启点重试恢复** | 9/9 |
| e | 岗位信息逐字段独立保存状态、简历编号下拉（选项就是 R 编号）、DDL 填得进也清得掉、顶部状态推进两处同步、官网链接、删除岗位二次确认（取消不删 / 确认后回看板少一张） | 7/7 |

浏览器控制台除了 `favicon.ico` 404 全程干净。

走查里发现并修掉的：`LLM_MOCK` 的占位文本不照 prompt 约定的格式出，导致「拆题」「Mock 复盘」「短版本拆分」三条要解析返回结构的路径在不花钱的前提下根本走不到。`provider.js` 现在支持 `mockShape`（JSON）和 `mockText`（按格式的纯文本），占位内容照真实输出的形状出。

一个不算 bug 但值得知道的：自我介绍的草稿是按「岗位 + 版本」存的，刷新后 tab 回到默认的 1 分钟版，看着像草稿丢了——切回 3 分钟版就在。

## 补上真实飞书后还要实测

- **批量更新**（`batchUpdateRecords`，投递记录重算走这条路）
- **准备文档创建 + 授权给本人**（1770001 已修、权限已开，整条路由还没对真实飞书跑过）
- **如果把「官网链接」在飞书里改成「超链接」字段类型**（PRD 3.1 说了可以改），`schema.js` 里它还是 `text`，写入会报类型不符。`npm run check` 会先报字段类型漂移，看到就改 `schema.js`

`npm run check` 2026-08-06 全绿：环境四项 ✓、三张表字段类型与 `schema.js` 一致（main 16 字段 0 条、experience 7 字段 9 条、resume 6 字段 0 条）、DeepSeek 连通。

## 接口清单（已实现，可直接调）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/health | 公开，返回是否 mock / 是否需要口令 |
| POST | /api/auth/check | 公开，校验口令 |
| GET | /api/debug/fields/:tableKey | 查飞书真实字段类型，排查字段漂移 |
| GET | /api/companies | 公司库全量 |
| GET | /api/companies/:recordId | 单个公司 |
| POST | /api/companies | 新增公司；名称按规范化结果拒绝重复 |
| PATCH | /api/companies/:recordId | 编辑公司名、官网、背景与备注 |
| GET | /api/jobs | hydrated 岗位全量；排除历史空岗位伪公司记录 |
| GET | /api/jobs/:recordId | 单个 hydrated 岗位 |
| POST | /api/jobs | 结构化新增；必须有 companyId、岗位名和 JD |
| PATCH | /api/jobs/:recordId | 基于完整岗位校验状态/简历并重算投递记录 |
| DELETE | /api/jobs/:recordId | 删除岗位并重算投递记录，不删除公司 |
| POST | /api/jobs/:recordId/prep-doc | 建飞书准备文档 + 授权给本人 + 回填链接 |
| GET | /api/resumes | 简历库 |
| POST | /api/resumes/generate | AI 出简历草稿，不落库 |
| POST | /api/resumes | 保存，自动分配 R{n} 编号 |
| PATCH | /api/resumes/:recordId | 改版本名/方向/正文 |
| POST | /api/resumes/recompute-apply-record | 手动全量重算投递记录 |
| GET | /api/experiences | 经历库 |
| GET | /api/experiences/tags | 允许的技能标签 |
| POST | /api/experiences/import | 批量导入（items 数组） |
| POST | /api/experiences/generate-short | AI 出 50/100 字草稿，不落库 |
| PATCH | /api/experiences/:recordId | 保存标题/全文/短版本/标签/相关链接 |
| POST | /api/experiences/:recordId/followup | 追加追问记录（带日期和来源） |
| POST | /api/fill-form/split | 网页原文 → JSON 题目列表 |
| POST | /api/fill-form/answer | 逐题生成，返回 history |
| POST | /api/fill-form/revise | 带 history 多轮改稿 |
| POST | /api/interview-prep | 生成准备材料，`appendToDoc:true` 追加进准备文档 |
| POST | /api/intro/generate | 自我介绍草稿，variant = 1min/3min/5min/en |
| POST | /api/mock/start | 开始 Mock，返回 history |
| POST | /api/mock/chat | 带 history 对话 |
| POST | /api/mock/end | 出摘要 + 追问建议（已映射到经历 recordId） |
| POST | /api/mock/export | 导出对话 markdown |

统一返回 `{ok:true,data}` 或 `{ok:false,error,detail}`。除 health 和 auth/check 外都要 `X-Auth-Token` 请求头。

## 待办（按优先级）

### P0 公司库真实迁移（已完成）

- 真实表结构、公司记录和岗位 companyId 已迁移并核对
- 本机 `.env` 已增加 `BITABLE_TABLE_COMPANY`
- 没有历史空岗位伪公司记录需要处理

### P0 剩余发布（仍是红线）

- 本地 3117 已切换到公司库版本并完成真实验收
- Vercel 尚未配置项目及 `BITABLE_TABLE_COMPANY`，也未部署公司库版本

### P1 剩下的真实飞书验证

- 真实飞书上清一次投递DDL，确认 datetime 传 `null` 被接受。要在主表里造一条测试记录再删掉，**删 bitable 记录是红线，动之前问你**
- 准备文档整条路由对真实飞书跑一遍（会在你的云空间里建一个文档）

### P2 待 lijue 决定

- **git 已 init**（2026-08-06，`main` 分支，首个提交 52 文件 5168 行）。`.gitignore` 排除 `.env` / `.env.*` / `.claude/settings.local.json` / `.DS_Store`，已用 `git check-ignore` 逐个验过。**还没连 GitHub**：本机没装 `gh`，装全局依赖和 `git push` 都是红线，要等她点头，并且仓库必须是 private（`.env.example` 里有她的 `open_id` 和 bitable token，`docs/` 里有 JD 和简历上下文）
- 部署 Vercel（红线）。`vercel.json` 已配好 `includeFiles: prompts/**`，后台要填 10 个环境变量，`LLM_MOCK` / `LARK_MOCK` 一个都不能填
- 飞书云空间里那两个诊断文档（`job-hunter 诊断-可删`、`测试公司-测试岗 面试准备`）已经授权给你了，可以自己删。`小柳数据` 是另一个项目的，没动

### P3 经历库首次导入

- lijue 会给原始材料（STAR 全文）。技能标签选项已经在飞书里了，`npm run check` 能看到
- 批量生成短版本必须先在前端显示「将调用 N 次」让用户确认再执行——批量调 DeepSeek 是红线。经历库页面的「让 AI 压缩出 50/100 字版」是单条按钮，没有批量入口，就是这个原因

### P4 prompt 调优

`prompts/` 下 8 个模板都是初版，跑过真实数据后按效果改。模板只支持 `{{变量}}`，不要写 `{{#if}}`——加载器不支持，会原样输出。

### P5 其他

- 准备文档目前只写纯文本段落。`src/services/prep-doc.js` 把内容按行拆成飞书文本块，markdown 标记不会渲染成标题。要富文本得按 docx block 结构改
- 新增岗位后自动创建准备文档。现在只有岗位信息页的手动按钮，可以改成新增即异步创建，失败不阻塞，手动按钮保留作兜底
- `LARK_DOC_FOLDER_TOKEN` 没配。不配的话文档建在应用空间里，只能通过回填的链接访问（已授权给本人，能打开，但在飞书云文档列表里找不到）。配一个文件夹会更好找

## 参考

- 飞书 bitable REST 文档：开放平台 → 多维表格 → 记录/字段
- long-task-agent（旧的 lark-cli 接入方式，已弃用，仅作对照）：`/Users/julie/Desktop/long-task-agent/`
- 首版 PRD/Spec（原在 `/Users/julie/Desktop/临时/`）已删，以 `docs/PRD.md` 为准
