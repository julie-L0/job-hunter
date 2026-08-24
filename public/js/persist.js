// localStorage 用途：离线快照、AI 草稿暂存、当前岗位、本地日历。
// 草稿必须落盘——AI 生成过的内容是花过钱的，不能因为刷新或误关标签页就没了。

const PREFIX = "jh.";

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    // 手改坏了或换了版本的旧格式，当作没有，不要让整个应用起不来
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // 配额满了不该让保存操作看起来失败：数据已经在服务端了，本地缓存丢了无所谓
  }
}

function remove(key) {
  localStorage.removeItem(PREFIX + key);
}

export const snapshot = {
  load: () => read("snapshot", null),
  save: (data) => write("snapshot", { at: Date.now(), ...data }),
};

export const outbox = {
  load: () => read("outbox", []),
  save: (items) => write("outbox", Array.isArray(items) ? items : []),
  clear: () => remove("outbox"),
};

export const currentJob = {
  load: () => read("currentJobId", null),
  save: (recordId) => (recordId ? write("currentJobId", recordId) : remove("currentJobId")),
};

export const calendarEvents = {
  load: () => read("calendarEvents", []),
  save: (items) => write("calendarEvents", Array.isArray(items) ? items : []),
  clear: () => remove("calendarEvents"),
};

/** 草稿按 `${kind}:${scopeId}` 分槽，换岗位不会串味。 */
export const draft = {
  key: (kind, scopeId) => `draft.${kind}.${scopeId || "global"}`,
  load: (kind, scopeId) => read(draft.key(kind, scopeId), null),
  save: (kind, scopeId, value) => write(draft.key(kind, scopeId), value),
  clear: (kind, scopeId) => remove(draft.key(kind, scopeId)),
};
