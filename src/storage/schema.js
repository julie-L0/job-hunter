import { config } from "../config.js";

// 代码里用英文 key，飞书表里是中文字段名。所有读写都经过这一层翻译。
// type 是已实测的真实飞书字段类型，不是 PRD 里期望的类型（如 url 不被支持，实际是 text）。
export const SCHEMAS = {
  company: {
    tableId: () => config.lark.tables.company,
    primary: "name",
    fields: {
      name: { name: "公司名", type: "text" },
      siteUrl: { name: "官网链接", type: "text" },
      companyBackground: { name: "公司背景备注", type: "text" },
      note: { name: "备注", type: "text" },
    },
  },
  main: {
    tableId: () => config.lark.tables.main,
    primary: "company",
    fields: {
      company: { name: "公司名", type: "text" },
      companyId: { name: "公司ID", type: "text" },
      position: { name: "岗位名", type: "text" },
      jd: { name: "JD", type: "text" },
      siteUrl: { name: "官网链接", type: "text" },
      deadline: { name: "投递DDL", type: "datetime" },
      referralCode: { name: "内推码", type: "text" },
      status: { name: "状态", type: "select" },
      starred: { name: "星标", type: "select" },
      statusHistory: { name: "状态记录", type: "text" },
      resumeId: { name: "简历编号", type: "text" },
      prepDocUrl: { name: "准备文档链接", type: "text" },
      intro1min: { name: "自我介绍-1min", type: "text" },
      intro3min: { name: "自我介绍-3min", type: "text" },
      intro5min: { name: "自我介绍-5min", type: "text" },
      introEn: { name: "自我介绍-英文版", type: "text" },
      companyBackground: { name: "公司背景备注", type: "text" },
      note: { name: "备注", type: "text" },
    },
  },

  experience: {
    tableId: () => config.lark.tables.experience,
    primary: "title",
    fields: {
      title: { name: "经历标题", type: "text" },
      type: { name: "经历类型", type: "select" },
      summary: { name: "经历摘要", type: "text" },
      tags: { name: "技能标签", type: "multiselect" },
      content: { name: "经历正文", type: "text" },
      links: { name: "相关链接", type: "text" },
      followups: { name: "追问记录", type: "text" },
    },
  },

  resume: {
    tableId: () => config.lark.tables.resume,
    primary: "code",
    fields: {
      code: { name: "编号", type: "text" },
      versionName: { name: "版本名", type: "text" },
      direction: { name: "适用方向", type: "text" },
      content: { name: "正文内容", type: "text" },
      applyRecord: { name: "投递记录", type: "text" },
      createdAt: { name: "创建时间", type: "datetime" },
    },
  },

  preference: {
    tableId: () => config.lark.tables.preference,
    primary: "configName",
    fields: {
      configName: { name: "配置名", type: "text" },
      stage: { name: "阶段策略", type: "select" },
      careerWeight: { name: "求职价值权重", type: "number" },
      practiceWeight: { name: "练手价值权重", type: "number" },
      fallbackWeight: { name: "兜底价值权重", type: "number" },
      valueOrientation: { name: "价值取向", type: "text" },
      updatedAt: { name: "更新时间", type: "datetime" },
    },
  },

  // 每场真实面试一条。逐字记录、我的补充和 AI 点评都写在 docUrl 指向的飞书文档里，
  // 表里只存元数据和链接——正文存两份就一定会出现两个权威版本。
  review: {
    tableId: () => config.lark.tables.review,
    primary: "title",
    fields: {
      title: { name: "复盘标题", type: "text" },
      jobRecordId: { name: "岗位记录ID", type: "text" },
      company: { name: "公司名", type: "text" },
      position: { name: "岗位名", type: "text" },
      round: { name: "面试轮次", type: "text" },
      interviewedAt: { name: "面试时间", type: "datetime" },
      source: { name: "内容来源", type: "text" },
      docUrl: { name: "复盘文档链接", type: "text" },
      audioName: { name: "录音文件名", type: "text" },
      durationSec: { name: "录音时长秒", type: "number" },
      transcriptChars: { name: "转写字数", type: "number" },
      takeaway: { name: "一句话结论", type: "text" },
      commentStatus: { name: "点评状态", type: "text" },
      updatedAt: { name: "更新时间", type: "datetime" },
    },
  },

  calendar: {
    tableId: () => config.lark.tables.calendar,
    primary: "title",
    fields: {
      title: { name: "标题", type: "text" },
      jobRecordId: { name: "岗位记录ID", type: "text" },
      type: { name: "类型", type: "text" },
      startsAt: { name: "开始时间", type: "datetime" },
      endsAt: { name: "结束时间", type: "datetime" },
      targetStatus: { name: "绑定状态", type: "text" },
      note: { name: "备注", type: "text" },
      statusAppliedAt: { name: "状态已写回时间", type: "datetime" },
      clientId: { name: "客户端ID", type: "text" },
      updatedAt: { name: "更新时间", type: "datetime" },
    },
  },
};

export const JOB_STATUSES = ["待投", "已投", "笔试", "一面", "二面", "三面", "挂", "offer"];
export const CALENDAR_EVENT_TYPES = ["written", "interview1", "interview2", "interview3", "interview", "deadline", "other"];
export const JOB_STAR_VALUE = "星标";
export const RESUME_REQUIRED_STATUSES = new Set(JOB_STATUSES.slice(1));
export const EXPERIENCE_TYPES = ["实习经历", "项目经历", "校园经历", "荣誉/获奖", "语言/证书", "其他"];
export const COMPARISON_STAGES = ["练手", "均衡", "冲刺", "兜底"];

// 复盘表的三个枚举字段都是 text，不是 select：飞书 select 写入不存在的选项会直接报错
// （和「技能标签」同一个坑），而 calendar.类型 已经有用 text 存枚举的先例。
// 取值合法性由 services/review.js 校验，不靠飞书字段类型兜。
export const INTERVIEW_ROUNDS = ["笔试", "一面", "二面", "三面", "HR面", "其他"];
export const REVIEW_SOURCES = ["本地转写", "粘贴文本", "Mock 面试"];
export const REVIEW_COMMENT_STATUSES = ["未点评", "已点评"];
export const REVIEW_ROLES = ["面试官", "其他面试者", "我"];

// 多选字段写入不存在的选项会报 800030005，新增选项属于表结构变更（红线）
export const EXPERIENCE_TAGS = [
  "产品设计",
  "数据分析",
  "用户研究",
  "AI应用",
  "项目管理",
  "增长运营",
  "技术理解",
  "商业分析",
  "内容运营",
  "跨团队协作",
];

export const RESUME_CODE_PATTERN = /^R(\d+)$/;

function toMillis(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  const normalized = String(value).trim().replace(" ", "T");
  const parsed = Date.parse(normalized.length === 10 ? `${normalized}T00:00:00+08:00` : normalized);
  if (Number.isNaN(parsed)) throw new Error(`无法解析日期：${value}`);
  return parsed;
}

// 空值要按字段类型给出各自的「清空」表示，不能一律跳过——否则用户删掉投递DDL会静默无效
function serialize(field, value) {
  const empty = value === null || value === undefined || value === "";
  switch (field.type) {
    case "datetime":
      return empty ? null : toMillis(value);
    case "number": {
      if (empty) return null;
      const number = Number(value);
      if (!Number.isFinite(number)) throw new Error(`无法解析数字：${value}`);
      return number;
    }
    case "multiselect":
      return empty ? [] : (Array.isArray(value) ? value : [value]).map(String).filter(Boolean);
    case "select":
      return empty ? null : Array.isArray(value) ? String(value[0] ?? "") : String(value);
    default:
      return empty ? "" : String(value);
  }
}

// 飞书返回值形态不稳定：单选可能是 ["待投"]，长文本在 search 接口下是 [{type,text}]
function normalize(field, raw) {
  if (raw === null || raw === undefined) return null;
  if (Array.isArray(raw)) {
    if (raw.length && typeof raw[0] === "object" && raw[0] !== null && "text" in raw[0]) {
      return raw.map((item) => item.text).join("");
    }
    if (field.type === "multiselect") return raw.map(String);
    return raw.length ? normalize(field, raw[0]) : null;
  }
  if (typeof raw === "object" && "text" in raw) return String(raw.text);
  if (field.type === "multiselect") return [String(raw)];
  if (field.type === "number") {
    const number = Number(raw);
    return Number.isFinite(number) ? number : null;
  }
  return raw;
}

export function tableIdOf(tableKey) {
  const schema = SCHEMAS[tableKey];
  if (!schema) throw new Error(`未知表：${tableKey}`);
  const id = schema.tableId();
  if (!id) throw new Error(`表 ${tableKey} 的 table_id 未配置`);
  return id;
}

/** 英文 key 对象 → 飞书 fields 载荷。未知 key 直接报错，避免静默丢字段。 */
export function toFields(tableKey, patch) {
  const { fields } = SCHEMAS[tableKey];
  const out = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue; // 调用方没提这个字段
    const field = fields[key];
    if (!field) throw new Error(`表 ${tableKey} 没有字段 ${key}`);
    out[field.name] = serialize(field, value);
  }
  return out;
}

/** 飞书记录 → 英文 key 对象，附带 recordId。表里多出来的字段（如未使用的「附件」）被忽略。 */
export function fromRecord(tableKey, record) {
  const { fields } = SCHEMAS[tableKey];
  const raw = record.fields || {};
  const out = { recordId: record.record_id };
  // 记录自带的创建时间，只有列表查询开了 automatic_fields 才返回。很多公司招满为止、
  // 没有投递DDL，看板改用「加进来多久还没投」催办就靠这个，不用为它加一个字段。
  // 单条写入的响应里没有这项，所以缺省时不写这个 key，让前端的浅合并保留原值。
  if (record.created_time) out.createdAt = Number(record.created_time);
  for (const [key, field] of Object.entries(fields)) {
    out[key] = normalize(field, raw[field.name]);
  }
  return out;
}
