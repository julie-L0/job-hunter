function clean(value) {
  return String(value || "").trim();
}

function jobLabel(job, recordId) {
  if (!job) return `岗位 ${recordId}`;
  return [job.company, job.position].filter(Boolean).join(" · ") || `岗位 ${recordId}`;
}

function needsResume(status, statusRequiresResume) {
  return clean(status) && statusRequiresResume(clean(status));
}

export function ensureRequiredResume(patch, nextJob, statusRequiresResume) {
  const next = { ...patch };
  if ("status" in next && needsResume(next.status, statusRequiresResume) && !clean(next.resumeId)) {
    const resumeId = clean(nextJob?.resumeId);
    if (resumeId) next.resumeId = resumeId;
  }
  return next;
}

export function mergeOutboxItem(items, entry, statusRequiresResume, options = {}) {
  const lockedIds = new Set(options.lockedIds || []);
  const next = items.map((item) => ({
    ...item,
    patch: { ...(item.patch || {}) },
    statusChange: item.statusChange ? { ...item.statusChange } : item.statusChange,
  }));
  const canMergeInto = (item) => !lockedIds.has(item.id);
  let target = null;

  if (!entry.statusChange && "resumeId" in entry.patch) {
    target = [...next].reverse().find((item) =>
      item.kind === "job.patch" &&
      canMergeInto(item) &&
      item.recordId === entry.recordId &&
      needsResume(item.patch?.status, statusRequiresResume) &&
      !clean(item.patch?.resumeId),
    );
  }

  if (!target && !entry.statusChange) {
    target = [...next].reverse().find((item) =>
      item.kind === "job.patch" &&
      canMergeInto(item) &&
      item.recordId === entry.recordId &&
      !item.statusChange &&
      !item.blocked,
    );
  }

  if (!target) return [...next, entry];

  target.patch = { ...target.patch, ...entry.patch };
  target.updatedAt = entry.updatedAt;
  if (target.statusChange && "resumeId" in entry.patch) {
    target.statusChange.resumeId = clean(entry.patch.resumeId);
  }
  if (!needsResume(target.patch.status, statusRequiresResume) || clean(target.patch.resumeId)) {
    target.blocked = false;
    target.error = "";
  }
  return next;
}

export function repairOutboxItems(items, jobs, statusRequiresResume) {
  const byId = new Map((jobs || []).map((job) => [job.recordId, job]));
  const next = (items || []).map((item) => ({
    ...item,
    patch: { ...(item.patch || {}) },
    statusChange: item.statusChange ? { ...item.statusChange } : item.statusChange,
  }));
  let changed = false;

  for (let index = 0; index < next.length; index += 1) {
    const item = next[index];
    if (item.kind !== "job.patch" || !needsResume(item.patch?.status, statusRequiresResume)) continue;
    if (clean(item.patch.resumeId)) {
      if (item.blocked || item.error) {
        item.blocked = false;
        item.error = "";
        changed = true;
      }
      continue;
    }

    const job = byId.get(item.recordId);
    const laterResume = next.slice(index + 1).find((candidate) =>
      candidate.kind === "job.patch" && candidate.recordId === item.recordId && clean(candidate.patch?.resumeId),
    );
    const resumeId = clean(job?.resumeId) || clean(laterResume?.patch?.resumeId);
    if (resumeId) {
      item.patch.resumeId = resumeId;
      if (item.statusChange) item.statusChange.resumeId = resumeId;
      item.blocked = false;
      item.error = "";
      changed = true;
      continue;
    }

    const error = `${jobLabel(job, item.recordId)}：状态为「${clean(item.patch.status)}」时必须选择简历`;
    if (!item.blocked || item.error !== error) {
      item.blocked = true;
      item.error = error;
      changed = true;
    }
  }

  const blocked = next.filter((item) => item.blocked);
  return {
    items: next,
    changed,
    blockedCount: blocked.length,
    firstBlockedError: blocked[0]?.error || "",
  };
}
