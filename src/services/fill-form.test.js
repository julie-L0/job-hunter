import test from "node:test";
import assert from "node:assert/strict";
import { buildFixedFillFormLibrary, hasRepeatableFormFields, parseOpenQuestions } from "./fill-form.js";

const experiences = [
  {
    recordId: "exp-baidu",
    title: "百度智能家居产品运营（2026.04-至今）",
    type: "实习经历",
    summary: "负责智能家居场景需求梳理和用户反馈闭环。",
    tags: ["内容运营", "数据分析"],
    content: "2026.04-至今 百度 智能家居产品运营\n- 梳理智能家居用户反馈，沉淀高频问题清单。\n- 跟进产品迭代效果，输出数据复盘。",
  },
  {
    recordId: "exp-tv",
    title: "电视台新媒体运营（2025.07-2025.09）",
    type: "实习经历",
    summary: "参与栏目短视频选题和发布复盘。",
    tags: ["内容运营"],
    content: "2025.07-2025.09 电视台 新媒体运营\n- 参与短视频选题策划。\n- 整理发布数据并复盘内容表现。",
  },
  {
    recordId: "exp-ai",
    title: "AI 简历润色工具项目（2026.03-2026.06）",
    type: "项目经历",
    summary: "完成 23 场用户访谈，推动隐私说明上线，上传完成率从 38% 提到 71%。",
    tags: ["用户研究", "AI应用"],
    content: "2026.03-2026.06 AI 简历润色工具项目\n- 访谈 23 位用户，定位上传简历步骤的隐私顾虑。\n- 推动上线本地解析说明，上传完成率从 38% 提到 71%。",
  },
  {
    recordId: "exp-xiaoliu",
    title: "小柳校园助手（2025.03-2025.05）",
    type: "项目经历",
    summary: "完成校园问答助手原型和需求验证。",
    tags: [],
    content: "2025.03-2025.05 小柳校园助手\n- 梳理校园问答场景。",
  },
  {
    recordId: "exp-paper",
    title: "论文模拟器（2025.01-2025.02）",
    type: "项目经历",
    summary: "完成论文写作模拟器流程设计。",
    tags: [],
    content: "2025.01-2025.02 论文模拟器\n- 设计论文生成流程。",
  },
  {
    recordId: "exp-editorial",
    title: "学院编辑部内容负责人（2024.09-2025.01）",
    type: "校园经历",
    summary: "组织校园内容选题，协调 5 位同学完成采写和发布。",
    tags: ["项目管理", "跨团队协作"],
    content: "2024.09-2025.01 学院编辑部 内容负责人\n- 制定每周选题计划。\n- 协调采写、校对和发布流程。",
  },
  {
    recordId: "exp-tea",
    title: "硒都茶校园推广（2024.05-2024.06）",
    type: "校园经历",
    summary: "负责校园推广活动和摊位转化复盘。",
    tags: ["增长运营"],
    content: "2024.05-2024.06 硒都茶 校园推广\n- 设计校园摊位活动。\n- 记录转化数据并调整话术。",
  },
  {
    recordId: "exp-award",
    title: "全国大学生市场调研大赛二等奖（2024.06）",
    type: "荣誉/获奖",
    summary: "2026 AdventureX SuperRun 赛道二等奖；2024.06 全国大学生市场调研大赛二等奖；2023.12 校级一等奖学金。",
    tags: ["数据分析"],
    content: "2026 AdventureX SuperRun 赛道二等奖\n2024.06 全国大学生市场调研大赛二等奖\n2023.12 校级一等奖学金",
  },
  {
    recordId: "exp-cert",
    title: "英语六级证书（2024.03）",
    type: "语言/证书",
    summary: "2024.03 CET-6 通过；2023.11 普通话二级甲等。",
    tags: [],
    content: "2024.03 CET-6 通过\n2023.11 普通话二级甲等",
  },
  {
    recordId: "exp-unclear",
    title: "用户增长活动复盘（2024.02）",
    summary: "参与用户增长活动复盘，整理问题和改进方向。",
    tags: [],
    content: "2024.02 用户增长活动复盘",
  },
];

test("fixed fill-form library exposes standard expandable sections", () => {
  const result = buildFixedFillFormLibrary(experiences);
  const titles = result.sections.map((section) => section.title);

  assert.deepEqual(titles, ["实习经历", "项目经历", "校园经历", "荣誉/获奖经历", "语言/证书", "待确认分类"]);

  const internship = result.sections.find((section) => section.kind === "internship");
  assert.deepEqual(internship.entries.map((entry) => entry.sourceTitle), [
    "百度智能家居产品运营（2026.04-至今）",
    "电视台新媒体运营（2025.07-2025.09）",
  ]);
  assert.equal(internship.entries[0].fields.description, "- 负责智能家居场景需求梳理和用户反馈闭环。");

  const project = result.sections.find((section) => section.kind === "project");
  assert.deepEqual(project.entries.map((entry) => entry.sourceTitle), [
    "AI 简历润色工具项目（2026.03-2026.06）",
    "小柳校园助手（2025.03-2025.05）",
    "论文模拟器（2025.01-2025.02）",
  ]);

  const campus = result.sections.find((section) => section.kind === "campus");
  assert.deepEqual(campus.entries.map((entry) => entry.sourceTitle), [
    "学院编辑部内容负责人（2024.09-2025.01）",
    "硒都茶校园推广（2024.05-2024.06）",
  ]);

  const award = result.sections.find((section) => section.kind === "award");
  assert.deepEqual(award.fields.map((field) => field.label), ["条目", "时间", "说明"]);
  assert.deepEqual(award.entries.map((entry) => entry.fields.name), [
    "AdventureX SuperRun 赛道二等奖",
    "全国大学生市场调研大赛二等奖",
    "校级一等奖学金",
  ]);

  const certificate = result.sections.find((section) => section.kind === "certificate");
  assert.deepEqual(certificate.entries.map((entry) => entry.fields.name), ["CET-6 通过", "普通话二级甲等"]);

  const confirmation = result.sections.find((section) => section.kind === "needs-confirmation");
  assert.equal(confirmation.entries[0].sourceTitle, "用户增长活动复盘（2024.02）");
  assert.match(confirmation.entries[0].matchReason, /请确认/);
});

test("open question parser ignores repeatable experience form fields", () => {
  const pasted = [
    "实习经历",
    "起止时间：开始日期 ~ 结束日期",
    "公司名称：请输入",
    "职位名称：请输入",
    "工作描述：请填写工作描述，可用数据简要说明在本段实习中取得的工作成果",
    "+ 添加",
    "删除",
  ].join("\n");

  assert.deepEqual(parseOpenQuestions(pasted), []);
  assert.equal(hasRepeatableFormFields(pasted), true);
  assert.deepEqual(parseOpenQuestions("为什么选择这个岗位？300字以内")[0], {
    index: 1,
    question: "为什么选择这个岗位？300字以内",
    limit: 300,
  });
});
