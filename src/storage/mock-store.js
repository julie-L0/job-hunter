// LARK_MOCK=1 时的内存假数据源（判定见 config.lark.mock，带 !process.env.VERCEL 保险）。
// 走同一套 toFields / fromRecord，所以 schema 映射和序列化逻辑照样被这条路径验证到。
// 只在进程内存里，重启即清空，永远不碰真实飞书。
import { LarkError } from "./lark-client.js";
import {
  COMPARISON_STAGES,
  EXPERIENCE_TAGS,
  EXPERIENCE_TYPES,
  JOB_STAR_VALUE,
  JOB_STATUSES,
  SCHEMAS,
  fromRecord,
  toFields,
} from "./schema.js";

// schema.js 的类型名 → 飞书字段类型枚举，check.js 靠这个比对
const TYPE_CODES = { text: 1, number: 2, select: 3, multiselect: 4, datetime: 5 };

let seq = 0;
const nextRecordId = () => `recMOCK${String(++seq).padStart(4, "0")}`;

/** tableKey → Map(record_id → 飞书原始形态 { record_id, fields }) */
const tables = new Map();
let seeded = false;

function tableOf(tableKey) {
  if (!SCHEMAS[tableKey]) throw new Error(`未知表：${tableKey}`);
  if (!seeded) {
    seeded = true;
    seed();
  }
  if (!tables.has(tableKey)) tables.set(tableKey, new Map());
  return tables.get(tableKey);
}

function insert(tableKey, patch, ageDays = 0) {
  if (!tables.has(tableKey)) tables.set(tableKey, new Map());
  // created_time 跟真实飞书一样是毫秒。ageDays 只给预置数据用，好让「躺了多久」这条催办规则测得出来
  const record = {
    record_id: nextRecordId(),
    fields: toFields(tableKey, patch),
    created_time: Date.now() - ageDays * 86_400_000,
  };
  tables.get(tableKey).set(record.record_id, record);
  return record;
}

function mustGet(tableKey, recordId) {
  const record = tableOf(tableKey).get(recordId);
  // 1254043 = 飞书的 RecordIdNotFound，保持和真实链路一致的错误形态
  if (!record) throw new LarkError(1254043, `记录不存在：${recordId}`);
  return record;
}

function writeResult(tableKey, record) {
  const result = fromRecord(tableKey, record);
  delete result.createdAt;
  return result;
}

export function listRecords(tableKey) {
  return [...tableOf(tableKey).values()].map((record) => fromRecord(tableKey, record));
}

export function getRecord(tableKey, recordId) {
  return fromRecord(tableKey, mustGet(tableKey, recordId));
}

export function createRecord(tableKey, patch) {
  tableOf(tableKey);
  return writeResult(tableKey, insert(tableKey, patch));
}

export function updateRecord(tableKey, recordId, patch) {
  const record = mustGet(tableKey, recordId);
  Object.assign(record.fields, toFields(tableKey, patch));
  return writeResult(tableKey, record);
}

export function deleteRecord(tableKey, recordId) {
  mustGet(tableKey, recordId);
  tableOf(tableKey).delete(recordId);
  return { recordId, deleted: true };
}

export function batchCreateRecords(tableKey, patches) {
  tableOf(tableKey);
  return patches.map((patch) => writeResult(tableKey, insert(tableKey, patch)));
}

export function batchUpdateRecords(tableKey, updates) {
  return updates.map(({ recordId, patch }) => updateRecord(tableKey, recordId, patch));
}

export function listFields(tableKey) {
  tableOf(tableKey);
  return Object.values(SCHEMAS[tableKey].fields).map((field, index) => ({
    id: `fldMOCK${index}`,
    name: field.name,
    type: TYPE_CODES[field.type] || 1,
    options:
      field.name === "状态" ? [...JOB_STATUSES]
        : field.name === "星标" ? [JOB_STAR_VALUE]
        : field.name === "阶段策略" ? [...COMPARISON_STAGES]
        : field.name === "经历类型" ? [...EXPERIENCE_TYPES]
          : field.type === "multiselect" ? [...EXPERIENCE_TAGS]
            : null,
  }));
}

const DAY = 86_400_000;
const inDays = (n) => Date.now() + n * DAY;

const SEED_JOBS = [
  { company: "字节跳动", position: "产品运营", status: "待投", deadline: inDays(2),
    duty: "抖音内容生态的活动策划、效果复盘与运营机制迭代",
    siteUrl: "https://example.com/careers/bytedance", referralCode: "BD7K2P",
    note: "学姐内推，投完记得跟她说一声" },
  { company: "腾讯", position: "产品经理-社交", status: "待投", deadline: inDays(1),
    duty: "社交产品新功能的需求调研与方案设计",
    siteUrl: "https://example.com/careers/tencent" },
  { company: "美团", position: "产品运营-到家", status: "待投", deadline: inDays(9),
    duty: "到家业务商家侧运营策略的制定与执行" },
  { company: "阿里巴巴", position: "产品专员", status: "待投", deadline: null, age: 12,
    duty: "电商中台产品的需求梳理与流程优化", note: "官网还没开放投递，先建个坑位" },
  { company: "蔚来", position: "用户运营", status: "待投", deadline: null, age: 3,
    duty: "车主社区的活动策划与用户分层运营", note: "招满为止，没有截止日期" },
  { company: "小红书", position: "社区运营", status: "已投", deadline: inDays(14), resumeId: "R1",
    duty: "垂类社区的内容招募、话题运营与创作者激励",
    siteUrl: "https://example.com/careers/xiaohongshu", referralCode: "XHS88" },
  { company: "网易", position: "产品策划", status: "已投", deadline: null, resumeId: "R2",
    duty: "游戏内容玩法的策划与体验打磨" },
  { company: "快手", position: "产品运营", status: "笔试", deadline: null, resumeId: "R1",
    duty: "本地生活业务的增长活动设计与投放复盘", note: "笔试 8/12 晚上 19:00，两小时" },
  { company: "百度", position: "产品经理-AI", status: "一面", deadline: null, resumeId: "R2",
    duty: "大模型对话产品的功能定义与效果评估",
    siteUrl: "https://example.com/careers/baidu" },
  { company: "京东", position: "产品运营", status: "一面", deadline: null, resumeId: "R1",
    duty: "自营商品的会员权益运营与转化提升" },
  { company: "拼多多", position: "商业化产品", status: "二面", deadline: null, resumeId: "R2",
    duty: "广告投放平台的产品能力建设与商家侧体验优化" },
  { company: "滴滴", position: "产品经理", status: "三面", deadline: null, resumeId: "R1",
    duty: "网约车派单策略的产品化与司乘体验平衡" },
  { company: "蔚来", position: "用户运营", status: "挂", deadline: null, resumeId: "R1",
    duty: "车主社区的活动运营与口碑传播", note: "二面挂，面试官说缺硬件行业理解" },
  { company: "哔哩哔哩", position: "商业产品", status: "offer", deadline: null, resumeId: "R2",
    duty: "UP 主商业化工具的产品设计与收入分成机制", note: "已发意向书，9/15 前答复" },
];

const SEED_RESUMES = [
  { code: "R1", versionName: "互联网运营-通用版", direction: "内容运营 / 社区运营", createdAt: inDays(-30),
    content: "## 教育背景\n某大学 新闻传播学 2027 届\n\n## 实习经历\n某内容平台 社区运营实习生（2025.07-2025.10）\n- 负责垂类话题策划，单话题最高带来 30% 互动增长\n\n## 项目\n校园二手书小程序 0-1，累计注册 4200 人\n\n## 技能\nSQL / 数据看板 / 用户访谈" },
  { code: "R2", versionName: "AI产品-强化版", direction: "AI 产品经理", createdAt: inDays(-12),
    content: "## 教育背景\n某大学 新闻传播学 2027 届\n\n## 实习经历\n某 AI 创业公司 产品实习生（2026.03-2026.06）\n- 负责简历润色工具的需求定义，完成 23 场用户访谈\n\n## 项目\nAI 简历润色工具：从调研到上线，首月留存 41%\n\n## 技能\nPrompt 设计 / 效果评测 / SQL" },
  { code: "R3", versionName: "数据分析方向", direction: "商业分析 / 数据", createdAt: inDays(-3),
    content: "## 教育背景\n某大学 新闻传播学 2027 届\n\n## 实习经历\n某内容平台 社区运营实习生（2025.07-2025.10）\n- 搭建话题效果看板，替代原来的人工周报\n\n## 技能\nSQL / Python 基础 / A/B 实验" },
];

const SEED_EXPERIENCES = [
  {
    title: "校园二手书小程序从 0 到 1",
    type: "项目经历",
    content: "## Overview\n学校每年毕业季有大量教材被当废纸卖掉，学弟学妹又在各个群里零散求书。我想做一个能自动匹配供需的轻量工具，目标是一个学期内跑到 3000 注册。\n\n## What I Did\n- 在 6 个院系群做了 40 份问卷确认真实需求。\n- 用小程序模板搭出最小版本，只做发书、找书、站内联系三个功能。\n- 毕业季前在宿舍楼下摆了两周收书点解决冷启动供给。\n\n## Key Challenges\n冷启动阶段最大问题是供给不足，所以先用线下收书点保证第一批可交易商品。\n\n## Reflection\n一个学期累计注册 4200 人，成交 1800 单，次月留存 38%，现在由下一届学生会接手运营。\n\n## Possible Interview Questions\nQ：为什么没有一开始就做担保交易？\n\nA：说明资源约束和先验证供需匹配的取舍。",
    summary: "毕业季教材被当废纸卖、学弟学妹又在群里零散求书，我做了个小程序把供需自动匹配起来。先用 40 份问卷确认需求，只做发书、找书、站内联系三个功能保证能快速上线，冷启动阶段在宿舍楼下摆了两周收书点解决供给不足。一学期注册 4200 人、成交 1800 单，次月留存 38%，现已交接给下一届继续运营。",
    tags: ["产品设计", "项目管理"],
    links: "项目复盘 | https://example.com/book-swap",
    followups: "### 2026-08-10 · Mock 面试\n\nQ：如何验证小程序真的解决了交易效率问题？\n\nA：补充匹配耗时、成交转化率和用户回访反馈。",
  },
  {
    title: "AI 简历润色工具的用户调研",
    type: "项目经历",
    content: "## Overview\n团队做的简历润色工具上线两个月，日活卡在 200 上不去，但没人知道用户到底卡在哪。\n\n## What I Did\n- 拉了近 30 天的漏斗数据，定位到 62% 的用户在上传简历步骤流失。\n- 约了 23 位用户访谈，发现核心顾虑是简历隐私信息会不会被存下来。\n- 推动上线本地解析、不落库的说明和开关。\n\n## Key Challenges\n用户不是不需要润色，而是不信任上传链路；改文案前必须先把真实顾虑讲清楚。\n\n## Reflection\n上传完成率从 38% 提到 71%，日活两周内翻到 480。\n\n## Possible Interview Questions\nQ：你怎么判断隐私顾虑比功能效果更关键？\n\nA：结合漏斗数据和访谈原话说明判断依据。",
    tags: ["用户研究", "AI应用"],
    links: "访谈提纲 | https://example.com/resume-ai-research",
    followups: "",
  },
  {
    title: "社区话题运营带来 30% 互动增长",
    type: "实习经历",
    content: "## Overview\n负责的垂类社区周互动量连续三周下滑，运营手段还是靠人工挑帖子推首页。\n\n## What I Did\n- 把过去半年 200 个话题按参与门槛和情绪强度两个维度打标。\n- 发现低门槛加高共鸣的话题互动量是平均值的 2.4 倍。\n- 据此重做选题清单，并搭了一个每日看板跟踪效果。\n\n## Key Challenges\n不能只靠爆款直觉，需要把选题变成能复用、能交接的方法。\n\n## Reflection\n连续四周互动量回升，最高单话题带来 30% 互动增长，选题方法被写进组内 SOP。\n\n## Possible Interview Questions\nQ：话题打标是否存在主观偏差？\n\nA：说明打标规则、复核方式和后续看板验证。",
    summary: "负责的垂类社区周互动量连续三周下滑，运营还靠人工挑帖。我把过去半年 200 个话题按参与门槛和情绪强度两个维度打标，发现低门槛加高共鸣的话题互动是平均值的 2.4 倍，据此重做选题清单并搭了每日看板跟踪。连续四周互动量回升，单话题最高带来 30% 互动增长，方法被写进组内 SOP。",
    tags: ["内容运营", "数据分析"],
    links: "选题看板 | https://example.com/topic-dashboard",
    followups: "",
  },
  {
    title: "跨部门推动结算流程自动化",
    type: "实习经历",
    content: "## Overview\n创作者激励金每月靠运营手工核对 Excel 再发财务，一轮要 3 天且常出错。\n\n## What I Did\n- 主动提出把结算流程产品化，目标是把人工环节压到半天以内。\n- 把运营、财务、研发三方的口径差异列成一张表。\n- 发现争议集中在跨月发布内容归属，组织三方对齐规则后推动研发排期。\n- 上线自动核算和差异清单。\n\n## Key Challenges\n难点不是计算公式，而是三方对同一笔内容收益的归属口径不一致。\n\n## Reflection\n单轮结算从 3 天压到 2 小时，错误率从每月平均 5 笔降到 0，运营同学不再需要碰 Excel。\n\n## Possible Interview Questions\nQ：如果财务和运营对规则仍然不一致，你会怎么推进？\n\nA：说明争议记录、决策人确认和灰度验证机制。",
    summary: "创作者激励金原本靠运营手工核对 Excel，一轮要 3 天且常出错。我梳理运营、财务、研发三方口径，定位到跨月发布内容归属争议，组织对齐规则后推动自动核算和差异清单上线。单轮结算压到 2 小时，错误率从每月平均 5 笔降到 0。",
    tags: ["跨团队协作", "商业分析"],
    links: "口径对齐表 | https://example.com/settlement-rules",
    followups: "",
  },
];

// 挂在前两条 SEED_JOBS 上，让 LARK_MOCK=1 能走通复盘列表和详情。正文不在这里——
// 正文只存在 docUrl 指向的飞书文档里，mock 下那个链接是假的，打不开是预期行为。
const SEED_REVIEWS = [
  { round: "一面", interviewedAt: inDays(-4), source: "本地转写",
    docUrl: "https://feishu.cn/docx/docMOCKreview1", audioName: "字节一面.m4a",
    durationSec: 3120, transcriptChars: 8600, commentStatus: "已点评",
    takeaway: "活动复盘讲得清楚，但被追问北极星指标怎么定时答得含糊",
    updatedAt: inDays(-4) },
  { round: "笔试", interviewedAt: inDays(-1), source: "粘贴文本",
    docUrl: "", audioName: "", durationSec: 0, transcriptChars: 2400,
    commentStatus: "未点评", takeaway: "", updatedAt: inDays(-1) },
];

function jd(company, position, duty) {
  return [
    `【${company} · ${position}】`,
    "",
    "岗位职责：",
    `1. ${duty}；`,
    "2. 跟踪核心指标，输出周期性数据复盘并提出改进方案；",
    "3. 与设计、研发、市场多方协作，推动方案落地上线。",
    "",
    "任职要求：",
    "1. 本科及以上学历，2027 届毕业生，专业不限；",
    "2. 有互联网产品或运营实习经历，熟悉常用数据工具；",
    "3. 逻辑清晰，沟通表达能力强，能在快节奏中推动多方协作。",
  ].join("\n");
}

function seed() {
  const companyIds = new Map();
  const jobRefs = [];
  for (const { duty, age, ...job } of SEED_JOBS) {
    if (!companyIds.has(job.company)) {
      const company = insert("company", {
        name: job.company,
        siteUrl: job.siteUrl || "",
        companyBackground: job.companyBackground || "",
        note: job.note || "",
      });
      companyIds.set(job.company, company.record_id);
    }
    const record = insert("main", {
      ...job,
      companyId: companyIds.get(job.company),
      jd: jd(job.company, job.position, duty),
    }, age || 0);
    jobRefs.push({ recordId: record.record_id, company: job.company, position: job.position });
  }
  for (const resume of SEED_RESUMES) insert("resume", resume);
  for (const experience of SEED_EXPERIENCES) insert("experience", experience);
  SEED_REVIEWS.forEach((review, index) => {
    const job = jobRefs[index];
    if (!job) return;
    const day = new Date(review.interviewedAt).toISOString().slice(0, 10);
    insert("review", {
      ...review,
      jobRecordId: job.recordId,
      company: job.company,
      position: job.position,
      title: `${job.company}-${job.position} ${review.round} ${day}`,
    });
  });
}
