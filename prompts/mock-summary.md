下面是一场模拟面试的完整对话记录。请生成复盘材料。

候选人经历库标题列表（用于把追问归到对应经历）：
{{experience_titles}}

对话记录：
{{transcript}}

输出 JSON，格式：
{
  "summary": "本场面试摘要，200字内，指出暴露的薄弱点",
  "followups": [
    {"experience_title": "必须是上面列表里的原文标题", "note": "面试官追问了什么 + 更好的回答方向"}
  ]
}

要求：
- followups 只写确实被追问到、且能归到某条经历的内容，宁少勿多
- experience_title 必须逐字来自上面的列表，不要新造标题
- note 写成可以直接追加进经历库的完整句子
