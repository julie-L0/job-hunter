import { parseStatusHistory } from "./status-history.js";

const INTERVIEW_STATUSES = new Set(["一面", "二面", "三面"]);

function dayKey(value) {
  const date = new Date(Number(value));
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function dailyJobStats(jobs, now = Date.now()) {
  const targetDay = dayKey(now);
  const stats = { date: targetDay, newJobs: 0, applied: 0, assessments: 0, interviews: 0 };
  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (dayKey(job?.createdAt) === targetDay) stats.newJobs += 1;
    for (const event of parseStatusHistory(job?.statusHistory)) {
      if (dayKey(event?.at) !== targetDay) continue;
      if (event.to === "已投") stats.applied += 1;
      if (event.to === "笔试") stats.assessments += 1;
      if (INTERVIEW_STATUSES.has(event.to)) stats.interviews += 1;
    }
  }
  return stats;
}

export function formatStatsDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${Number(match[2])}月${Number(match[3])}日` : "今天";
}
