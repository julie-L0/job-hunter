// LARK_MOCK=1 时的内存假数据源（判定见 config.lark.mock，带 !process.env.VERCEL 保险）。
// 走同一套 toFields / fromRecord，所以 schema 映射和序列化逻辑照样被这条路径验证到。
// 只在进程内存里，重启即清空，永远不碰真实飞书。
import { LarkError } from "./lark-client.js";
import { EXPERIENCE_TAGS, JOB_STATUSES, SCHEMAS, fromRecord, toFields } from "./schema.js";

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

function insert(tableKey, patch) {
  if (!tables.has(tableKey)) tables.set(tableKey, new Map());
  const record = { record_id: nextRecordId(), fields: toFields(tableKey, patch) };
  tables.get(tableKey).set(record.record_id, record);
  return record;
}

function mustGet(tableKey, recordId) {
  const record = tableOf(tableKey).get(recordId);
  // 1254043 = 飞书的 RecordIdNotFound，保持和真实链路一致的错误形态
  if (!record) throw new LarkError(1254043, `记录不存在：${recordId}`);
  return record;
}

export function listRecords(tableKey) {
  return [...tableOf(tableKey).values()].map((record) => fromRecord(tableKey, record));
}

export function getRecord(tableKey, recordId) {
  return fromRecord(tableKey, mustGet(tableKey, recordId));
}

export function createRecord(tableKey, patch) {
  tableOf(tableKey);
  return fromRecord(tableKey, insert(tableKey, patch));
}

export function updateRecord(tableKey, recordId, patch) {
  const record = mustGet(tableKey, recordId);
  Object.assign(record.fields, toFields(tableKey, patch));
  return fromRecord(tableKey, record);
}

export function deleteRecord(tableKey, recordId) {
  mustGet(tableKey, recordId);
  tableOf(tableKey).delete(recordId);
  return { recordId, deleted: true };
}

export function batchCreateRecords(tableKey, patches) {
  tableOf(tableKey);
  return patches.map((patch) => fromRecord(tableKey, insert(tableKey, patch)));
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
      field.type === "select" ? [...JOB_STATUSES] : field.type === "multiselect" ? [...EXPERIENCE_TAGS] : null,
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
  { company: "阿里巴巴", position: "产品专员", status: "待投", deadline: null,
    duty: "电商中台产品的需求梳理与流程优化", note: "官网还没开放投递，先建个坑位" },
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
    star: "S：学校每年毕业季有大量教材被当废纸卖掉，学弟学妹又在各个群里零散求书。\nT：想做一个能自动匹配供需的轻量工具，目标是一个学期内跑到 3000 注册。\nA：先在 6 个院系群做了 40 份问卷确认真实需求；用小程序模板搭出最小版本，只做「发书-找书-站内联系」三个功能；毕业季前在宿舍楼下摆了两周收书点解决冷启动供给。\nR：一个学期累计注册 4200 人，成交 1800 单，次月留存 38%，现在由下一届学生会接手运营。",
    short50: "做了个校园二手书小程序，用线下收书点解决冷启动供给，一学期注册 4200 人、成交 1800 单。",
    short100: "毕业季教材被当废纸卖、学弟学妹又在群里零散求书，我做了个小程序把供需自动匹配起来。先用 40 份问卷确认需求，只做发书、找书、站内联系三个功能保证能快速上线，冷启动阶段在宿舍楼下摆了两周收书点解决供给不足。一学期注册 4200 人、成交 1800 单，次月留存 38%，现已交接给下一届继续运营。",
    tags: ["产品设计", "项目管理"],
    links: "需求文档 | https://example.feishu.cn/docx/demo-prd\n上线小程序 | https://example.com/bookswap",
    followups: "【2026-07-28 腾讯 一面】追问了冷启动阶段供给不足具体怎么解决的，我答得太笼统，下次要把「线下收书点两周收了多少本」这个数摆出来\n【2026-08-02 字节跳动 Mock】追问留存口径怎么定义，次月留存的分母是哪批用户没说清",
  },
  {
    title: "AI 简历润色工具的用户调研",
    star: "S：团队做的简历润色工具上线两个月，日活卡在 200 上不去，但没人知道用户到底卡在哪。\nT：我作为产品实习生负责搞清楚流失原因，两周内给出可执行的改进方向。\nA：拉了近 30 天的漏斗数据，发现 62% 的用户在「上传简历」这一步就走了；接着约了 23 位用户做访谈，发现大部分人怕简历里的隐私信息被存下来。\nR：推动上线了「本地解析、不落库」的说明和开关，上传完成率从 38% 提到 71%，日活两周内翻到 480。",
    tags: ["用户研究", "AI应用"],
  },
  {
    title: "社区话题运营带来 30% 互动增长",
    star: "S：负责的垂类社区周互动量连续三周下滑，运营手段还是靠人工挑帖子推首页。\nT：需要找到可复用的选题方法，把互动量拉回来。\nA：把过去半年 200 个话题按「参与门槛」和「情绪强度」两个维度打标，发现低门槛+高共鸣的话题互动量是平均值的 2.4 倍；据此重做了选题清单，并搭了个看板每天跟踪。\nR：连续四周互动量回升，最高单话题带来 30% 互动增长，选题方法被写进组内 SOP。",
    short50: "垂类社区互动量下滑，我把半年 200 个话题按参与门槛和情绪强度打标，找出选题规律，单话题最高带来 30% 互动增长。",
    short100: "负责的垂类社区周互动量连续三周下滑，运营还靠人工挑帖。我把过去半年 200 个话题按参与门槛和情绪强度两个维度打标，发现低门槛加高共鸣的话题互动是平均值的 2.4 倍，据此重做选题清单并搭了每日看板跟踪。连续四周互动量回升，单话题最高带来 30% 互动增长，方法被写进组内 SOP。",
    tags: ["内容运营", "数据分析"],
    followups: "【2026-07-19 小红书 一面】追问打标的两个维度是怎么定出来的，是否有主观性",
  },
  {
    title: "跨部门推动结算流程自动化",
    star: "S：创作者激励金每月靠运营手工核对 Excel 再发财务，一轮要 3 天且常出错。\nT：我主动提出把这条流程产品化，目标是把人工环节压到半天以内。\nA：先把运营、财务、研发三方的口径差异列成一张表，发现争议集中在「跨月发布内容归哪个月」；组织三方对齐后定下规则，再推研发排期做了自动核算 + 差异清单。\nR：单轮结算从 3 天压到 2 小时，错误率从每月平均 5 笔降到 0，运营同学不再需要碰 Excel。",
    short50: "创作者激励金原本手工核对 Excel 要 3 天，我对齐三方口径后推动自动核算上线，单轮压到 2 小时、错误归零。",
    tags: ["跨团队协作", "商业分析"],
  },
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
  for (const { duty, ...job } of SEED_JOBS) {
    insert("main", { ...job, jd: jd(job.company, job.position, duty) });
  }
  for (const resume of SEED_RESUMES) insert("resume", resume);
  for (const experience of SEED_EXPERIENCES) insert("experience", experience);
}
