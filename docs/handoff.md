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
6. 运行 `npm run migrate-jobs -- --yes` 补齐 `main.星标` 和 `main.状态记录` 字段。
7. 运行 `npm run migrate-preferences -- --yes --write-env`、`npm run migrate-calendar -- --yes --write-env`、`npm run migrate-reviews -- --yes --write-env` 创建偏好、日程和复盘三张表。三个脚本默认都是 dry-run，先不带参数跑一次确认输出再加 `--yes`。
8. 如需技能标签，在 `experience.技能标签` 中预先创建允许的多选项。
9. 在开放平台为应用开启 Bitable 读写权限；准备文档和复盘文档都走云文档 API，需额外开启云文档的创建、编辑和授权权限。

字段概要：

| 表 | 主字段 | 其他字段 |
|---|---|---|
| company | 公司名（文本） | 官网链接、公司背景备注、备注 |
| main | 公司名（文本） | 公司ID、岗位名、JD、官网链接、投递DDL、内推码、状态、星标、状态记录、简历编号、准备文档链接、四种自我介绍、公司背景备注、备注 |
| experience | 经历标题（文本） | 经历摘要、技能标签、经历正文、相关链接、追问记录 |
| resume | 编号（文本） | 版本名、适用方向、正文内容、投递记录、创建时间 |
| review | 复盘标题（文本） | 岗位记录ID、公司名、岗位名、面试轮次、面试时间、内容来源、复盘文档链接、录音文件名、录音时长秒、转写字数、一句话结论、点评状态、更新时间 |

其中 `投递DDL`、`创建时间`、`面试时间`、`更新时间` 是日期字段，`状态` 是单选，`技能标签` 是多选，`录音时长秒` 和 `转写字数` 是数字，其余为文本。复盘表的`面试轮次`、`内容来源`、`点评状态` 虽然是枚举，但故意用文本存（select 写入不存在的选项会直接报错）。以 `src/storage/schema.js` 为最终准则。

## 环境变量

在项目根目录创建 `.env`（仓库里如果有 `.env.example`，复制它再填），只在本机填写：

```env
BITABLE_APP_TOKEN=
BITABLE_TABLE_COMPANY=
BITABLE_TABLE_MAIN=
BITABLE_TABLE_EXPERIENCE=
BITABLE_TABLE_RESUME=
BITABLE_TABLE_PREFERENCE=
BITABLE_TABLE_CALENDAR=
BITABLE_TABLE_REVIEW=

LARK_APP_ID=
LARK_APP_SECRET=
LARK_USER_OPEN_ID=
LARK_DOC_FOLDER_TOKEN=
LARK_DOC_URL_BASE=https://your-tenant.feishu.cn/docx/

DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat

APP_PASSWORD=

# 本地语音转写（可选，不填就只能粘贴转写文本）
ASR_PYTHON=
ASR_SCRIPT=
ASR_MODEL_DIR=
ASR_MAX_UPLOAD_MB=1024
```

`LARK_USER_OPEN_ID`、文档目录和文档 URL 在创建准备文档和复盘文档时都需要——没配 `LARK_USER_OPEN_ID` 时应用建出的文档只有应用本人能看，你自己打开链接会 403。`.env` 已被 Git 忽略，不要把真实值写进示例文件、文档、日志或 commit。

## 本地语音转写（可选）

面试复盘可以导入音频或 MP4 自动转写。**这一段只在本地有效**：Vercel 无状态、请求体上限 4.5MB、跑不了 Python，线上 `/api/health` 的 `transcribeEnabled` 恒为 `false`，前端会禁用本地上传入口，只保留「粘贴/上传转写文本」可用。不配这一段也不影响其他功能。

转写引擎是仓库**外部工具**，跑在自己的 venv 里，Node 侧仍然零 npm 依赖。

1. 装 ffmpeg（用来解码各种录音格式）：
   ```powershell
   winget install --id Gyan.FFmpeg -e
   ```
   装完必须**新开一个终端**再确认 `ffmpeg -version`：winget 把可执行文件放在 `%LOCALAPPDATA%\Microsoft\WinGet\Links`，已经开着的终端不会刷新 PATH。dev server 也要在新终端里重启，否则子进程继承的还是旧 PATH，转写会报找不到 ffmpeg。
2. 建独立 venv 并装依赖：
   ```powershell
   python -m venv tools\transcribe\.venv
   tools\transcribe\.venv\Scripts\pip install sherpa-onnx numpy
   ```
3. 下载模型到 `tools/transcribe/models/`，具体文件名和解压步骤见 `tools/transcribe/README.md`。需要 SenseVoice 的 `model.int8.onnx` + `tokens.txt`，以及 `silero_vad.onnx`。
4. 把路径写进 `.env`（用绝对路径）：
   ```env
   ASR_PYTHON=C:\path\to\job-hunter\tools\transcribe\.venv\Scripts\python.exe
   ASR_SCRIPT=C:\path\to\job-hunter\tools\transcribe\transcribe.py
   ASR_MODEL_DIR=C:\path\to\job-hunter\tools\transcribe\models
   ASR_MAX_UPLOAD_MB=1024
   ```
   三个路径必须都存在，否则录音入口不会出现（这是有意的：宁可隐藏入口，也不要让用户上传完才报错）。
5. 重启 `npm run dev`，在岗位的 Mock 面试页切到「真实面试复盘」，应能看到「选择音频 / MP4 文件」。

实测参考：16 逻辑核笔记本 CPU、int8 模型、默认 8 线程，5 分钟音频转写耗时 7.9 秒（约 38 倍实时），一小时录音大致 2–5 分钟。这个数字是用干净语音循环拼接的样本测的，真实面试录音有底噪和长段连续说话，会慢一些，但量级不变。转写期间浏览器页面不能关（job 存在服务进程内存里，只保留 30 分钟）。

安全约束：录音只临时落盘到系统 temp 目录，转写完成或失败后立即删除；转写文本不进日志；`tools/transcribe/` 下的 venv、模型和录音已全部加入 `.gitignore`，不得提交入仓。

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

新增复盘表（面试复盘功能依赖）：

```bash
npm run migrate-reviews
```

默认 dry-run，列出将创建的表和字段。确认后执行：

```bash
npm run migrate-reviews -- --yes --write-env
```

`--write-env` 会把 `BITABLE_TABLE_REVIEW` 写回本地 `.env`。已存在的字段如果类型不符，脚本报错退出而不会覆盖。

## Vercel 部署

Vercel 使用 `api/[...path].js` 作为 Serverless 入口，并直接托管 `public/`。

1. 在 Vercel 创建项目。
2. 把上面环境变量清单中除 `PORT`、`LARK_MOCK`、`LLM_MOCK`、`ASR_*` 外的实际配置写入 Vercel Environment Variables。`ASR_*` 在线上没意义，转写路由不注册。
3. 为 `APP_PASSWORD` 设置高强度随机值。
4. 先部署 Preview，验证登录、公司库、岗位详情和四个 AI 页面。
5. Preview 通过后再发布 Production。

不要把 `.env` 上传到 Vercel 构建源。不要在公网环境启用 mock 数据。

## 安全检查

- 除 `/api/health` 和 `/api/auth/check` 外，所有 API 都必须要求 `X-Auth-Token`。
- 公网部署必须设置 `APP_PASSWORD`，否则所有受保护接口返回 503，不会默认放行。
- 登录成功只签发 12 小时有效的 HMAC 会话；浏览器将会话保存在 `sessionStorage`，关闭标签页后清除，原始口令不作为 token 返回。
- 单实例会按客户端地址限制连续登录失败。Vercel Functions 的内存不跨实例共享，这层限速只能降低常规尝试，不能替代高强度随机口令或平台级 WAF 限速。
- 日志不得输出访问口令、会话 token、请求头、飞书凭证、JD、简历或面试内容（包括转写文本）。
- 录音上传走的是 `POST /api/reviews/audio`，它不经过 JSON 路由表，但**必须**显式调 `assertAuthorized(req.headers)`；改这条路径时不得因为「跑不通 JSON 路由」就跳过口令校验。
- 发布前检查当前树和完整 Git 历史，确认没有真实 token、ID、用户路径或业务数据。
- 真实表结构修改、数据迁移、环境变量变更和生产部署应分开确认并逐步验证。
