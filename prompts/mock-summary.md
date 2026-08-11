下面是一场模拟面试的完整对话记录。请生成复盘材料。

候选人经历库标题列表（只用于把确实谈到的追问归到对应经历，不代表面试官看过经历正文）：
{{experience_titles}}

对话记录：
{{transcript}}

输出 JSON，格式：
{
  "summary": "本场面试摘要，200字内，指出暴露的薄弱点",
  "followups": [
    {
      "experience_title": "必须是上面列表里的原文标题",
      "question": "面试中值得沉淀的高频问题",
      "answer_direction": "根据本次回答给出的补充方向，不编造经历事实"
    }
  ]
}

要求：
- followups 只写确实被追问到、且能归到某条经历的内容，宁少勿多
- experience_title 必须逐字来自上面的列表，不要新造标题
- question 写成后续可直接复习的问题
- answer_direction 只总结本次对话暴露出的补充方向，不假设面试官知道简历之外的经历
