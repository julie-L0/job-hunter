import { EXPERIENCE_TYPES } from "../storage/schema.js";

const FIELD_DEFS = [
  {
    key: "startDate",
    label: "开始日期",
    patterns: [/开始(?:日期|时间|年月)?/, /起始(?:日期|时间|年月)?/, /入职时间/],
  },
  {
    key: "endDate",
    label: "结束日期",
    patterns: [/结束(?:日期|时间|年月)?/, /截止(?:日期|时间|年月)?/, /离职时间/],
  },
  {
    key: "period",
    label: "起止时间",
    patterns: [/起止时间/, /时间区间/, /任职时间/, /实习时间/, /项目时间/, /经历时间/],
  },
  {
    key: "organization",
    label: "公司/组织名称",
    patterns: [/公司名称/, /单位名称/, /组织名称/, /机构名称/, /社团名称/, /学校名称/],
  },
  {
    key: "role",
    label: "职位/角色名称",
    patterns: [/职位名称/, /岗位名称/, /职务名称/, /担任职务/, /担任角色/, /项目角色/, /角色名称/],
  },
  {
    key: "name",
    label: "经历名称",
    patterns: [/经历名称/, /项目名称/, /活动名称/, /作品名称/, /竞赛名称/],
  },
  {
    key: "description",
    label: "经历描述",
    patterns: [/工作描述/, /职责描述/, /项目描述/, /经历描述/, /实践描述/, /主要工作/, /工作内容/, /描述/],
  },
];

const SECTION_DEFS = [
  {
    kind: "internship",
    title: "实习经历",
    patterns: [/实习经历/, /工作经历/, /任职经历/, /实践经历/],
    defaultFields: ["startDate", "endDate", "organization", "role", "description"],
  },
  {
    kind: "campus",
    title: "校园经历",
    patterns: [/校园经历/, /社团经历/, /学生工作/, /社会实践/, /校内经历/],
    defaultFields: ["startDate", "endDate", "organization", "role", "description"],
  },
  {
    kind: "project",
    title: "项目经历",
    patterns: [/项目经历/, /项目经验/, /作品经历/, /课程项目/, /活动项目/],
    defaultFields: ["startDate", "endDate", "name", "role", "description"],
  },
  {
    kind: "research",
    title: "科研经历",
    patterns: [/科研经历/, /研究经历/, /论文经历/],
    defaultFields: ["startDate", "endDate", "name", "role", "description"],
  },
  {
    kind: "award",
    title: "荣誉/获奖经历",
    patterns: [/竞赛经历/, /获奖经历/, /荣誉奖励/, /比赛经历/],
    defaultFields: ["name", "period", "description"],
  },
  {
    kind: "certificate",
    title: "语言/证书",
    patterns: [/语言能力/, /语言证书/, /证书/, /资格证书/, /英语水平/],
    defaultFields: ["name", "period", "description"],
  },
];

const FIXED_SECTION_DEFS = [
  SECTION_DEFS.find((section) => section.kind === "internship"),
  SECTION_DEFS.find((section) => section.kind === "project"),
  SECTION_DEFS.find((section) => section.kind === "campus"),
  SECTION_DEFS.find((section) => section.kind === "award"),
  SECTION_DEFS.find((section) => section.kind === "certificate"),
].filter(Boolean);

const CONFIRM_SECTION_DEF = {
  kind: "needs-confirmation",
  title: "待确认分类",
  patterns: [],
  defaultFields: ["name", "period", "description"],
};

const [TYPE_INTERNSHIP, TYPE_PROJECT, TYPE_CAMPUS, TYPE_AWARD, TYPE_CERTIFICATE, TYPE_OTHER] = EXPERIENCE_TYPES;
const TYPE_TO_KIND = new Map([
  [TYPE_INTERNSHIP, "internship"],
  [TYPE_PROJECT, "project"],
  [TYPE_CAMPUS, "campus"],
  [TYPE_AWARD, "award"],
  [TYPE_CERTIFICATE, "certificate"],
  [TYPE_OTHER, "needs-confirmation"],
]);

const NOISE_PATTERNS = [
  /^(添加|删除|保存|下一步|上一步|提交|请输入|请选择|必填|选填)$/,
  /隐私|协议|验证码|登录|注册|招聘问题请点|JoyHR/i,
];

const QUESTION_HINT = /[?？]|为什么|为何|请.{0,6}(描述|说明|介绍|谈谈|填写)|如何|能否|是否|有什么|你认为/;
const DATE_RANGE_RE = /((?:19|20)\d{2}\s*(?:[.\-/年]\s*\d{1,2}\s*月?)?)\s*(?:-|–|—|~|～|至|到)\s*((?:(?:19|20)\d{2}\s*(?:[.\-/年]\s*\d{1,2}\s*月?)?)|至今|现在|目前|present|current)/i;
const DATE_SINGLE_RE = /((?:19|20)\d{2})\s*(?:[.\-/年]\s*(\d{1,2})\s*月?)?/;
const CONTENT_HEADING_RE = /^(?:Possible Interview Questions|Overview|What I Did|Key Challenges|Reflection)[:：]?$/i;
const QA_LINE_RE = /^[QA][:：]/i;

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

function compact(value, limit = 260) {
  const text = cleanText(value);
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function linesOf(rawText) {
  return String(rawText || "")
    .replace(/\r/g, "\n")
    .split(/[\n\t]+/)
    .map(cleanText)
    .filter(Boolean)
    .filter((line) => !NOISE_PATTERNS.some((pattern) => pattern.test(line)));
}

function parseMonth(token, fallbackYear = null) {
  const value = cleanText(token).toLowerCase();
  if (/^(至今|现在|目前|present|current)$/.test(value)) {
    return { text: "至今", sort: 999999 };
  }
  const match = DATE_SINGLE_RE.exec(value);
  if (!match) return null;
  const year = Number(match[1] || fallbackYear);
  const month = match[2] ? Math.min(12, Math.max(1, Number(match[2]))) : null;
  if (!year) return null;
  return {
    text: month ? `${year}.${String(month).padStart(2, "0")}` : String(year),
    sort: year * 100 + (month || 0),
  };
}

export function extractDateRange(text) {
  const value = String(text || "");
  const range = DATE_RANGE_RE.exec(value);
  if (range) {
    const start = parseMonth(range[1]);
    const end = parseMonth(range[2], start?.text.slice(0, 4));
    if (start || end) {
      return {
        startDate: start?.text || "",
        endDate: end?.text || "",
        period: [start?.text, end?.text].filter(Boolean).join(" - "),
        startSort: start?.sort ?? -1,
        endSort: end?.sort ?? start?.sort ?? -1,
      };
    }
  }
  const single = parseMonth(value);
  if (!single) return { startDate: "", endDate: "", period: "", startSort: -1, endSort: -1 };
  return {
    startDate: single.text,
    endDate: "",
    period: single.text,
    startSort: single.sort,
    endSort: single.sort,
  };
}

function extractOrgRole(experience) {
  const text = [experience.title, experience.summary, experience.content].filter(Boolean).join("\n");
  const lines = linesOf(text).slice(0, 12);
  const dateLine = lines.find((line) => DATE_RANGE_RE.test(line));
  const candidates = uniqueBy([dateLine, ...lines].filter(Boolean), (line) => line);
  const roleWords = "实习生|经理|助理|专员|顾问|分析师|研究员|运营|产品|策划|负责人|成员|工程师|设计师|志愿者";
  const pairPatterns = [
    new RegExp(`^([^，。；;（）()]{2,32})[\\s　·|｜-]+([^，。；;（）()]{2,32}(?:${roleWords}))$`),
    new RegExp(`(?:在|于)([^，。；;（）()]{2,32}?)(?:担任|任|作为|做)([^，。；;（）()]{2,32}(?:${roleWords})?)`),
    new RegExp(`(?:公司|单位|组织|机构)[:：]\\s*([^，。；;（）()]{2,32}).*?(?:职位|岗位|职务|角色)[:：]\\s*([^，。；;（）()]{2,32})`),
  ];
  for (const line of candidates) {
    const withoutDate = line.replace(DATE_RANGE_RE, "").replace(/[（）()]/g, " ").trim();
    for (const pattern of pairPatterns) {
      const match = pattern.exec(withoutDate);
      if (match) return { organization: cleanText(match[1]), role: cleanText(match[2]) };
    }
  }
  return { organization: "", role: "" };
}

function contentLines(experience) {
  return String(experience.content || "")
    .replace(/^#{1,6}\s*/gm, "")
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, ""))
    .map(cleanText)
    .filter(Boolean)
    .filter((line) => !QA_LINE_RE.test(line) && !CONTENT_HEADING_RE.test(line));
}

function fallbackBulletDescription(experience, limit = 4) {
  const sourceLines = contentLines(experience)
    .filter((line) => !DATE_RANGE_RE.test(line) || line.length > 32)
    .filter((line) => !/^\d{4}[.\-/年]/.test(line) || line.length > 32);
  let lines = sourceLines;
  if (!lines.length) lines = [cleanText(experience.title)];
  return uniqueBy(lines, (line) => line)
    .slice(0, limit)
    .map((line) => `- ${compact(line, 120)}`)
    .join("\n");
}

function summaryBullets(value) {
  const summary = String(value || "").trim();
  if (!summary) return "";
  const normalized = /\n/.test(summary) ? summary : summary.replace(/([。！？!?；;])\s*/g, "$1\n");
  return normalized
    .split(/\n+/)
    .map((line) => cleanText(line).replace(/^[-*•]\s*/, ""))
    .filter(Boolean)
    .map((line) => `- ${line}`)
    .join("\n");
}

function summaryItems(value) {
  return String(value || "")
    .replace(/([。！？!?；;])\s*/g, "$1\n")
    .split(/\n+/)
    .map((line) => cleanText(line).replace(/^[-*•]\s*/, ""))
    .filter(Boolean);
}

function descriptionFromSummary(experience) {
  const bullets = summaryBullets(experience.summary);
  if (bullets) return bullets;
  return fallbackBulletDescription(experience);
}

function compactDescription(experience) {
  const bullets = summaryBullets(experience.summary);
  if (bullets) return bullets;
  const text = contentLines(experience).join("；");
  return summaryBullets(compact(text || experience.title, 180));
}

function simpleItemLines(value) {
  const text = String(value || "");
  const section = /(?:^|\n)##\s*What I Did\s*\n([\s\S]*?)(?=\n##\s|$)/i.exec(text)?.[1] || text;
  return section
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/([。！？!?；;])\s*/g, "$1\n")
    .split(/\n+/)
    .map((line) => cleanText(line).replace(/^[-*•]\s*/, ""))
    .filter(Boolean)
    .filter((line) => !QA_LINE_RE.test(line) && !CONTENT_HEADING_RE.test(line));
}

function originalSimpleItems(experience) {
  const contentItems = simpleItemLines(experience.content);
  if (contentItems.length) return uniqueBy(contentItems, (line) => line);
  return uniqueBy([...simpleItemLines(experience.summary), ...simpleItemLines(experience.title)], (line) => line);
}

function fieldDefsFor(rawText, sectionDef) {
  const detected = FIELD_DEFS.filter((field) => hasAny(rawText, field.patterns)).map((field) => field.key);
  let keys = detected.length ? detected : [...sectionDef.defaultFields];
  if (keys.includes("period") && (keys.includes("startDate") || keys.includes("endDate"))) {
    keys = keys.filter((key) => key !== "period");
  }
  if (!keys.includes("description")) keys.push("description");
  return uniqueBy(keys, (key) => key).map((key) => FIELD_DEFS.find((field) => field.key === key));
}

function fixedFieldsFor(sectionDef) {
  const fields = fieldDefsFor(sectionDef.title, sectionDef);
  if (!["award", "certificate", "needs-confirmation"].includes(sectionDef.kind)) return fields;
  const labels = { name: "条目", period: "时间", description: "说明" };
  return fields.map((field) => ({ ...field, label: labels[field.key] || field.label }));
}

function sectionScore(experience, sectionDef, rawText) {
  const haystack = [experience.title, experience.summary, experience.content, ...(experience.tags || [])]
    .join("\n")
    .toLowerCase();
  const raw = rawText.toLowerCase();
  let score = 0;
  if (sectionDef.kind === "internship") {
    if (/实习|实习生|公司|部门|业务|岗位/.test(haystack)) score += 55;
    if (/运营|产品|分析|研发|财务|商业/.test(haystack)) score += 15;
  } else if (sectionDef.kind === "campus") {
    if (/校园|学校|学生会|社团|院系|志愿|实践|二手书/.test(haystack)) score += 55;
  } else if (sectionDef.kind === "project") {
    if (/项目|小程序|工具|系统|看板|上线|0\s*[-到]?\s*1|调研/.test(haystack)) score += 50;
  } else if (sectionDef.kind === "research") {
    if (/科研|研究|论文|课题|实验/.test(haystack)) score += 55;
  } else if (sectionDef.kind === "award") {
    if (/竞赛|比赛|大赛|获奖|奖项|奖学金|一等奖|二等奖|三等奖|荣誉|挑战杯|建模/.test(haystack)) score += 55;
  } else if (sectionDef.kind === "certificate") {
    if (/语言|英语|雅思|托福|gre|gmat|cet|四六级|六级|四级|证书|资格|普通话/.test(haystack)) score += 55;
  } else {
    score += 20;
  }

  const tokens = uniqueBy(raw.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,}/g) || [], (token) => token)
    .filter((token) => !/^(请输入|请选择|开始日期|结束日期|添加|删除|描述|名称)$/.test(token))
    .slice(0, 20);
  for (const token of tokens) {
    if (haystack.includes(token.toLowerCase())) score += 4;
  }
  if (extractDateRange(haystack).period) score += 8;
  return score;
}

function classifyExperience(experience) {
  const type = cleanText(Array.isArray(experience.type) ? experience.type[0] : experience.type);
  const kind = TYPE_TO_KIND.get(type);
  if (kind && kind !== "needs-confirmation") return { kind, reason: `经历类型：${type}` };
  if (type === TYPE_OTHER) return { kind: "needs-confirmation", reason: "经历类型为其他，请确认放哪一类" };
  if (type) return { kind: "needs-confirmation", reason: `未知经历类型「${type}」，请确认归类` };
  return { kind: "needs-confirmation", reason: "缺少经历类型，请确认分类并在经历库补充" };
}

function normalizeExperience(experience, sectionDef, rawText, sourceOrder = 0) {
  const date = extractDateRange([experience.title, experience.summary, experience.content].join("\n"));
  const { organization, role } = extractOrgRole(experience);
  const simpleSection = ["award", "certificate", "needs-confirmation"].includes(sectionDef.kind);
  const description = simpleSection ? compactDescription(experience) : descriptionFromSummary(experience);
  const fields = {
    startDate: date.startDate,
    endDate: date.endDate,
    period: date.period,
    organization,
    role,
    name: cleanText(experience.title),
    description,
  };
  const score = sectionScore(experience, sectionDef, rawText);
  const missingFields = Object.entries(fields)
    .filter(([key, value]) => ["startDate", "endDate", "period", "organization", "role", "description"].includes(key) && !value)
    .map(([key]) => key);
  return {
    id: experience.recordId || cleanText(experience.title),
    sourceTitle: cleanText(experience.title),
    fields,
    score,
    sort: { start: date.startSort, end: date.endSort, sourceOrder },
    matchReason: score >= 50 ? "关键词匹配度高" : score > 0 ? "部分关键词匹配" : "未识别到明确关键词",
    missingFields,
  };
}

function normalizeSimpleItem(experience, sectionDef, itemText, index, sourceOrder = index) {
  const date = extractDateRange(itemText || [experience.title, experience.summary, experience.content].join("\n"));
  const cleaned = cleanText(itemText) || cleanText(experience.title);
  const withoutDate = cleanText(cleaned
    .replace(DATE_RANGE_RE, "")
    .replace(/[（(]\s*(?:19|20)\d{2}(?:\s*[.\-/年]\s*\d{1,2}\s*月?)?\s*[）)]/g, "")
    .replace(DATE_SINGLE_RE, "")
    .replace(/^[\s:：|｜·,，;；\-~～—–]+/, "")
    .replace(/[\s:：|｜·,，;；\-~～—–]+$/, "")
    .replace(/[。；;]+$/, "")) || cleaned;
  return {
    id: `${experience.recordId || cleanText(experience.title)}:${index}`,
    sourceTitle: withoutDate,
    fields: {
      name: withoutDate,
      period: date.period,
      description: cleaned,
    },
    score: 100,
    sort: { start: date.startSort, end: date.endSort, sourceOrder },
    matchReason: sectionDef.kind === "certificate" ? "按原文拆出的语言/证书条目" : "按原文拆出的荣誉/获奖条目",
    missingFields: [date.period ? null : "period"].filter(Boolean),
  };
}

function detectSections(rawText) {
  const matched = SECTION_DEFS.filter((section) => hasAny(rawText, section.patterns));
  if (matched.length) return matched;
  if (/经历|经验|项目|实践|实习/.test(rawText)) {
    return [{
      kind: "experience",
      title: "经历条目",
      patterns: [/经历/],
      defaultFields: ["startDate", "endDate", "name", "role", "description"],
    }];
  }
  return [];
}

export function hasRepeatableFormFields(rawText) {
  const lines = linesOf(rawText);
  const sectionLike = lines.some((line) => line.length <= 24 && SECTION_DEFS.some((section) => hasAny(line, section.patterns)));
  const fieldLineCount = lines.filter((line) => {
    const label = line.split(/[：:]/)[0];
    return FIELD_DEFS.some((field) => hasAny(label, field.patterns));
  }).length;
  return fieldLineCount >= 2 || (sectionLike && fieldLineCount >= 1);
}

function sortEntries(a, b) {
  return b.sort.end - a.sort.end
    || b.sort.start - a.sort.start
    || (a.sort.sourceOrder ?? 0) - (b.sort.sourceOrder ?? 0)
    || a.sourceTitle.localeCompare(b.sourceTitle, "zh-Hans-CN");
}

function buildSection(sectionDef, usableExperiences, rawText = sectionDef.title, { fallback = false } = {}) {
  const fields = fieldDefsFor(rawText, sectionDef);
  const normalized = usableExperiences.map((experience) => normalizeExperience(experience, sectionDef, rawText));
  const threshold = sectionDef.kind === "experience" ? 0 : 18;
  let entries = normalized.filter((entry) => entry.score >= threshold).sort(sortEntries);
  let usedFallback = false;
  if (!entries.length && fallback && normalized.length) {
    entries = normalized.sort(sortEntries);
    usedFallback = true;
  }
  return {
    id: sectionDef.kind,
    kind: sectionDef.kind,
    title: sectionDef.title,
    fields,
    entries,
    empty: !entries.length,
    usedFallback,
  };
}

export function buildFixedFillFormLibrary(experiences) {
  const usableExperiences = (Array.isArray(experiences) ? experiences : [])
    .filter((experience) => cleanText(experience.title))
    .filter((experience) => cleanText(experience.summary || experience.content || experience.title));

  const sectionDefs = [...FIXED_SECTION_DEFS, CONFIRM_SECTION_DEF];
  const sections = sectionDefs.map((sectionDef) => ({
    id: sectionDef.kind,
    kind: sectionDef.kind,
    title: sectionDef.title,
    fields: fixedFieldsFor(sectionDef),
    entries: [],
    empty: true,
  }));
  const byKind = new Map(sections.map((section) => [section.kind, section]));

  for (const [experienceIndex, experience] of usableExperiences.entries()) {
    const classification = classifyExperience(experience);
    const sectionDef = sectionDefs.find((item) => item.kind === classification.kind) || CONFIRM_SECTION_DEF;
    if (["award", "certificate"].includes(sectionDef.kind)) {
      const items = originalSimpleItems(experience);
      const sourceItems = items.length ? items : summaryItems(experience.summary || experience.content || experience.title);
      sourceItems.forEach((item, index) => byKind.get(sectionDef.kind).entries.push(
        normalizeSimpleItem(experience, sectionDef, item, index, experienceIndex * 1000 + index),
      ));
    } else {
      const entry = normalizeExperience(experience, sectionDef, sectionDef.title, experienceIndex * 1000);
      entry.matchReason = classification.reason;
      byKind.get(sectionDef.kind).entries.push(entry);
    }
  }

  for (const section of sections) {
    section.entries.sort(sortEntries);
    section.empty = !section.entries.length;
  }

  return {
    mode: "library",
    version: 2,
    sections,
    warnings: usableExperiences.length ? [] : ["经历库为空或缺少正文，暂时没有可复制条目。"],
  };
}

export function parseOpenQuestions(rawText) {
  return uniqueBy(
    linesOf(rawText)
      .filter((line) => line.length >= 6 && QUESTION_HINT.test(line))
      .filter((line) => {
        const label = line.split(/[：:]/)[0];
        const fieldLike = FIELD_DEFS.some((field) => hasAny(label, field.patterns));
        const placeholderLike = /请输入|请选择|请填写|开始日期|结束日期|工作描述|项目描述|经历描述/.test(line);
        return !(fieldLike || placeholderLike);
      })
      .map((line, index) => {
        const limit = /(\d{2,4})\s*字/.exec(line)?.[1];
        return { index: index + 1, question: line, limit: limit ? Number(limit) : null };
      }),
    (item) => item.question,
  );
}

export function buildFillFormPlan(rawText, experiences) {
  const raw = String(rawText || "").trim();
  const usableExperiences = (Array.isArray(experiences) ? experiences : [])
    .filter((experience) => cleanText(experience.title))
    .filter((experience) => cleanText(experience.summary || experience.content || experience.title));
  const warnings = [];
  const sections = detectSections(raw).map((sectionDef) => {
    const section = buildSection(sectionDef, usableExperiences, raw, { fallback: true });
    if (section.usedFallback) {
      warnings.push(`${sectionDef.title}没有找到强匹配，已先按时间列出全部经历供你挑选。`);
    }
    delete section.usedFallback;
    return section;
  });

  if (sections.length && !usableExperiences.length) warnings.push("经历库为空或缺少正文，无法生成可复制条目。");

  return {
    mode: sections.length ? "entries" : "questions",
    sections,
    questions: sections.length ? [] : parseOpenQuestions(raw),
    warnings,
  };
}
