# job-hunter

一个面向单用户的秋招管理工具。它使用飞书多维表格保存公司、岗位、简历和经历数据，通过网页完成岗位跟踪、申请材料生成与面试准备。

## 功能

- 公司库：长期维护公司信息，并在同一公司下创建多个岗位
- 岗位看板：按投递状态管理岗位、DDL、JD 和使用的简历版本
- 简历库：保存不同方向的简历内容，并自动维护投递记录
- 经历库：管理 STAR 经历、精简版本、技能标签和追问记录
- 申请表助手：从网页文本中拆分问题并逐题生成草稿
- 面试准备：结合公司、JD 和简历生成准备材料
- 自我介绍：生成 1 分钟、3 分钟、5 分钟和英文版本
- Mock 面试：进行多轮模拟面试并生成总结
- 准备文档：创建飞书文档并追加面试准备内容

## 技术架构

```text
浏览器（Vue 3，无构建步骤）
  └─ /api/*
      ├─ Node.js HTTP 路由
      ├─ 飞书 Bitable REST OpenAPI
      ├─ 飞书 Docx / Drive OpenAPI
      └─ DeepSeek OpenAI 兼容接口
```

- Node.js 22 或更高版本
- ESM，后端零第三方依赖
- Vue 3 固定版本随仓库提供，不依赖 CDN
- 本地 Node 服务与 Vercel Functions 共用同一套路由
- 数据保存在使用者自己的飞书空间中，仓库不包含业务数据

## 快速体验

项目提供内存 mock 数据，不需要飞书或模型账号即可运行：

```bash
git clone <repository-url>
cd job-hunter
LARK_MOCK=1 LLM_MOCK=1 APP_PASSWORD=x npm run dev
```

打开终端显示的本地地址，输入口令 `x`。mock 数据仅保存在当前进程内，重启后恢复初始状态。

运行完整 mock 检查：

```bash
LARK_MOCK=1 LLM_MOCK=1 APP_PASSWORD=x npm run check -- --allow-mock
npm test
```

项目没有第三方 npm 依赖，无需运行 `npm install`。

## 连接自己的飞书数据

1. 创建飞书企业自建应用，并开通 Bitable、Docx 和 Drive 所需权限。
2. 创建一个飞书多维表格，准备 `company`、`main`、`experience`、`resume` 四张表。
3. 将飞书应用添加为该多维表格的协作者。
4. 以 `.env.example` 为模板创建本地 `.env`，填写自己的应用凭证、Base token 和四张表的 table ID。
5. 运行检查，确认字段名和字段类型与代码契约一致。
6. 启动本地服务。

```bash
npm run check
npm start
```

四张表的字段清单、准备文档授权方式和旧数据迁移流程见 [安装与运维说明](docs/handoff.md)。产品行为与数据约束见 [PRD](docs/PRD.md)。

## 数据与写入规则

- 公司是独立的长期对象；岗位通过飞书 `record_id` 关联公司
- 创建岗位必须填写岗位名和 JD
- 岗位进入“已投”及后续状态时必须选择有效简历
- AI 生成的结构化内容必须由用户确认后写回飞书
- 飞书文档内容只追加、不覆盖，因此追加写入不要求二次确认
- 空 JD 会在调用模型前被服务端拒绝

## 安全说明

- 不要提交 `.env`、访问口令、飞书凭证、模型密钥或真实业务数据
- 公网运行必须设置高强度随机 `APP_PASSWORD`；未配置时受保护接口会拒绝访问
- 登录成功后浏览器只保存 12 小时有效的签名会话，不保存原始口令
- 登录失败限速是单实例保护；公网部署仍应结合平台级限速和访问控制
- 这是单用户工具，不提供多用户账号、权限分级或公开注册能力
- 正式部署前应先使用 Preview 环境验证登录、数据访问和 AI 调用

## 项目结构

```text
api/                 Vercel Functions 入口
public/              浏览器前端与固定版本 Vue
prompts/             AI prompt 模板
src/api/             API 路由
src/http/            HTTP 与认证逻辑
src/llm/             模型调用
src/services/        业务服务
src/storage/         飞书访问、schema 与 mock 数据
docs/                PRD、安装和运维说明
```

## 常用命令

```bash
npm run dev                  # 本地开发，监听文件变化
npm start                    # 启动本地服务
npm test                     # 运行测试
npm run check                # 检查环境和飞书表结构
npm run migrate-companies    # 旧数据迁移 dry-run
```

`migrate-companies` 默认只分析，不写入；只有显式增加 `--apply` 才会修改飞书数据。执行真实迁移前应先备份并核对 dry-run 输出。
