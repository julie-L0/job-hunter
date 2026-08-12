import { api } from "../api.js";
import { dropExperience, experienceTypes, handleError, loadAll, mergeExperience, state, toast } from "../store.js";
import { TagPicker, confirmDialog, useDraft } from "../ui.js";

const { computed, reactive, ref } = window.Vue;

const HEADER_KEYS = {
  经历标题: "title",
  标题: "title",
  title: "title",
  经历类型: "type",
  类型: "type",
  type: "type",
  经历摘要: "summary",
  摘要: "summary",
  summary: "summary",
  技能标签: "tags",
  标签: "tags",
  tags: "tags",
  经历正文: "content",
  正文: "content",
  content: "content",
  相关链接: "links",
  链接: "links",
  links: "links",
  追问记录: "followups",
  追问: "followups",
  followups: "followups",
};

const CONTENT_TEMPLATE = [
  "## Overview",
  "",
  "",
  "## What I Did",
  "",
  "- ",
  "",
  "## Key Challenges",
  "",
  "",
  "## Reflection",
  "",
  "",
  "## Possible Interview Questions",
  "",
  "Q：",
  "",
  "A：",
].join("\n");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (quoted) throw new Error("CSV 引号没有闭合");
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  if (rows.length < 2) throw new Error("CSV 至少需要表头和一条经历");

  const headers = rows.shift().map((header) => HEADER_KEYS[header.trim().toLocaleLowerCase()] || "");
  if (!headers.includes("title")) throw new Error("CSV 表头缺少经历标题/title");
  return rows.map((values) => Object.fromEntries(
    headers.map((key, index) => [key, values[index] || ""]).filter(([key]) => key),
  ));
}

function unwrapCodeFence(text) {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function escapeJsonStringLineBreaks(text) {
  let out = "";
  let quoted = false;
  let escaped = false;

  for (const char of text) {
    if (!quoted) {
      if (char === '"') quoted = true;
      out += char;
      continue;
    }

    if (escaped) {
      out += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      out += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      quoted = false;
      out += char;
      continue;
    }
    if (char === "\n") out += "\\n";
    else if (char === "\r") out += "\\r";
    else if (char === "\t") out += "\\t";
    else out += char;
  }

  return out;
}

function fromJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    try {
      parsed = JSON.parse(escapeJsonStringLineBreaks(text));
    } catch {
      throw new Error(`JSON 格式不合法：${error.message}`);
    }
  }
  const list = Array.isArray(parsed) ? parsed : parsed.items;
  if (!Array.isArray(list)) throw new Error("JSON 必须是数组或 {items:[…]}");
  return list;
}

function canonicalize(raw) {
  const mapped = {};
  for (const [key, value] of Object.entries(raw || {})) {
    const target = HEADER_KEYS[String(key).trim().toLocaleLowerCase()];
    if (target) mapped[target] = value;
  }
  return mapped;
}

function normalizeItem(raw) {
  const item = canonicalize(raw);
  const tags = Array.isArray(item.tags)
    ? item.tags
    : String(item.tags || "").split(/[、,，;；/|]+/);
  const content = Array.isArray(item.content) ? item.content.join("\n") : item.content;
  const links = Array.isArray(item.links) ? item.links.join("\n") : item.links;
  const followups = Array.isArray(item.followups) ? item.followups.join("\n") : item.followups;
  return {
    title: String(item.title || "").trim(),
    type: String(item.type || "").trim(),
    summary: String(item.summary || "").trim(),
    tags: tags.map((tag) => String(tag).trim()).filter(Boolean),
    content: String(content || "").trim(),
    links: String(links || "").trim(),
    followups: String(followups || "").trim(),
  };
}

function blankExperience() {
  return { title: "", type: "", summary: "", tags: [], content: "", links: "", followups: "" };
}

export const Experiences = {
  components: { TagPicker },
  setup() {
    const open = ref("");
    const error = ref("");
    const importing = ref(false);
    const creating = ref(false);
    const saving = reactive({});
    const deleting = reactive({});
    const summaryBusy = reactive({});
    const edits = reactive({});
    const summaries = reactive({});
    const fresh = reactive(blankExperience());
    const scope = ref("all");
    const { data: bulk, clear: clearBulk } = useDraft("exp-import", scope, { text: "" });

    const parsed = computed(() => {
      const text = unwrapCodeFence(bulk.text);
      if (!text) return { items: [], error: "" };
      try {
        const source = text.startsWith("[") || text.startsWith("{") ? fromJson : parseCsv;
        const items = source(text).map(normalizeItem);
        const missing = items.findIndex((item) => !item.title);
        if (missing >= 0) return { items: [], error: `第 ${missing + 1} 条没有标题` };
        return { items, error: "" };
      } catch (failure) {
        return { items: [], error: failure.message };
      }
    });

    const badTags = computed(() => {
      const allowed = new Set(state.tags);
      return [...new Set(parsed.value.items.flatMap((item) => item.tags))]
        .filter((tag) => !allowed.has(tag));
    });

    const badTypes = computed(() => {
      const allowed = new Set(experienceTypes.value);
      return [...new Set(parsed.value.items.map((item) => item.type).filter(Boolean))]
        .filter((type) => !allowed.has(type));
    });

    function beginEdit(row) {
      if (open.value === row.recordId) {
        open.value = "";
        return;
      }
      edits[row.recordId] = {
        title: row.title || "",
        type: row.type || "",
        summary: row.summary || "",
        tags: [...(row.tags || [])],
        content: row.content || "",
        links: row.links || "",
        followups: row.followups || "",
      };
      delete summaries[row.recordId];
      open.value = row.recordId;
    }

    async function saveEdit(row) {
      const draft = edits[row.recordId];
      if (!draft?.title.trim() || saving[row.recordId]) return;
      saving[row.recordId] = true;
      error.value = "";
      try {
        mergeExperience(await api.patchExperience(row.recordId, draft));
        toast("经历已保存");
        open.value = "";
      } catch (failure) {
        if (!handleError(failure)) error.value = failure.message;
      } finally {
        saving[row.recordId] = false;
      }
    }

    async function deleteExperience(row) {
      if (deleting[row.recordId]) return;
      const ok = await confirmDialog({
        title: `删除经历「${row.title || '未命名'}」？`,
        body: "会从飞书经历库删除这条记录，相关链接、追问记录和正文都会一起删除。这个操作不可恢复。",
        danger: true,
      });
      if (!ok) return;
      deleting[row.recordId] = true;
      error.value = "";
      try {
        await api.deleteExperience(row.recordId);
        dropExperience(row.recordId);
        delete edits[row.recordId];
        delete summaries[row.recordId];
        open.value = "";
        toast("经历已删除");
      } catch (failure) {
        if (!handleError(failure)) error.value = failure.message;
      } finally {
        deleting[row.recordId] = false;
      }
    }

    async function generateSummary(row) {
      const draft = edits[row.recordId];
      if (!draft?.content.trim() || summaryBusy[row.recordId]) return;
      summaryBusy[row.recordId] = true;
      error.value = "";
      try {
        const result = await api.generateExperienceSummary(row.recordId, draft.content);
        summaries[row.recordId] = { text: result.draft, mock: Boolean(result.mock) };
      } catch (failure) {
        if (!handleError(failure)) error.value = failure.message;
      } finally {
        summaryBusy[row.recordId] = false;
      }
    }

    function applySummary(row) {
      const result = summaries[row.recordId];
      if (!result) return;
      edits[row.recordId].summary = result.text;
      delete summaries[row.recordId];
    }

    async function createExperience() {
      if (!fresh.title.trim() || creating.value) return;
      const ok = await confirmDialog({
        title: `新建经历「${fresh.title.trim()}」？`,
        body: "将写入飞书经历库。创建后仍可继续编辑正文和摘要。",
      });
      if (!ok) return;
      creating.value = true;
      error.value = "";
      try {
        mergeExperience(await api.createExperience(fresh));
        Object.assign(fresh, blankExperience());
        toast("经历已新建");
      } catch (failure) {
        if (!handleError(failure)) error.value = failure.message;
      } finally {
        creating.value = false;
      }
    }

    async function runImport() {
      const items = parsed.value.items;
      if (!items.length || badTags.value.length || badTypes.value.length || importing.value) return;
      const ok = await confirmDialog({
        title: `将写入 ${items.length} 条经历？`,
        body: "会直接新建记录，同名不会自动合并，请先确认没有重复条目。",
      });
      if (!ok) return;
      importing.value = true;
      error.value = "";
      try {
        await api.importExperiences(items);
        await loadAll({ silent: true });
        clearBulk();
        toast(`已导入 ${items.length} 条`);
      } catch (failure) {
        if (!handleError(failure)) error.value = failure.message;
      } finally {
        importing.value = false;
      }
    }

    const fillTemplate = (target) => {
      if (!target.content.trim()) target.content = CONTENT_TEMPLATE;
    };

    return {
      state,
      experienceTypes,
      open,
      error,
      importing,
      creating,
      saving,
      deleting,
      summaryBusy,
      edits,
      summaries,
      fresh,
      bulk,
      parsed,
      badTags,
      badTypes,
      rows: computed(() => state.experiences),
      beginEdit,
      saveEdit,
      deleteExperience,
      generateSummary,
      applySummary,
      createExperience,
      runImport,
      clearBulk,
      fillTemplate,
    };
  },
  template: `
    <div class="page experience-page">
      <header class="pagehead">
        <div>
          <h2 class="ptitle">经历库</h2>
          <p class="muted">每条记录是一段完整经历；类型决定网申填表归档，摘要用于经历类字段复制，正文保留完整上下文。</p>
        </div>
      </header>

      <p v-if="error" class="notice bad">{{ error }}</p>

      <details class="experience-create">
        <summary>新建经历</summary>
        <div class="experience-form">
          <label><span class="flabel">经历标题</span><input v-model="fresh.title" :disabled="state.offline" /></label>
          <label><span class="flabel">经历类型</span><select v-model="fresh.type" :disabled="state.offline">
            <option value="">待确认</option>
            <option v-for="type in experienceTypes" :key="type" :value="type">{{ type }}</option>
          </select></label>
          <label class="wide"><span class="flabel">经历摘要</span><textarea rows="4" v-model="fresh.summary" :disabled="state.offline"></textarea></label>
          <div class="wide"><span class="flabel">技能标签</span><TagPicker v-model="fresh.tags" :options="state.tags" :disabled="state.offline" /></div>
          <label class="wide"><span class="flabel">相关链接</span><textarea rows="3" v-model="fresh.links" :disabled="state.offline" placeholder="材料名称 | https://..."></textarea></label>
          <label class="wide">
            <span class="flabel">经历正文（Markdown）</span>
            <button type="button" class="link" @click="fillTemplate(fresh)">填入结构模板</button>
            <textarea class="experience-content" v-model="fresh.content" :disabled="state.offline"></textarea>
          </label>
          <label class="wide"><span class="flabel">追问记录</span><textarea rows="5" v-model="fresh.followups" :disabled="state.offline"></textarea></label>
          <div class="wide actions"><button class="primary" :disabled="state.offline || creating || !fresh.title.trim()" @click="createExperience">{{ creating ? '新建中…' : '确认新建' }}</button></div>
        </div>
      </details>

      <table v-if="rows.length" class="grid experience-grid">
        <thead><tr><th>经历标题</th><th>经历类型</th><th>经历摘要</th><th>技能标签</th><th></th></tr></thead>
        <tbody v-for="row in rows" :key="row.recordId">
          <tr :class="{ on: open === row.recordId }">
            <td><strong>{{ row.title }}</strong></td>
            <td><span :class="row.type ? 'pill' : 'pill warn'">{{ row.type || '待确认' }}</span></td>
            <td class="experience-summary-cell">{{ row.summary || '—' }}</td>
            <td class="muted">{{ (row.tags || []).join('、') || '—' }}</td>
            <td><button class="link" @click="beginEdit(row)">{{ open === row.recordId ? '收起' : '编辑' }}</button></td>
          </tr>
          <tr v-if="open === row.recordId" class="editrow">
            <td colspan="5">
              <div class="experience-form">
                <label><span class="flabel">经历标题</span><input v-model="edits[row.recordId].title" :disabled="state.offline" /></label>
                <label><span class="flabel">经历类型</span><select v-model="edits[row.recordId].type" :disabled="state.offline || saving[row.recordId]">
                  <option value="">待确认</option>
                  <option v-for="type in experienceTypes" :key="type" :value="type">{{ type }}</option>
                </select></label>
                <label class="wide"><span class="flabel">经历摘要</span><textarea rows="4" v-model="edits[row.recordId].summary" :disabled="state.offline"></textarea></label>
                <div class="wide"><span class="flabel">技能标签</span><TagPicker v-model="edits[row.recordId].tags" :options="state.tags" :disabled="state.offline || saving[row.recordId]" /></div>
                <label class="wide"><span class="flabel">相关链接</span><textarea rows="3" v-model="edits[row.recordId].links" :disabled="state.offline"></textarea></label>
                <label class="wide">
                  <span class="flabel">经历正文（Markdown）</span>
                  <button type="button" class="link" @click="fillTemplate(edits[row.recordId])">填入结构模板</button>
                  <textarea class="experience-content" v-model="edits[row.recordId].content" :disabled="state.offline"></textarea>
                </label>
                <label class="wide"><span class="flabel">追问记录</span><textarea rows="5" v-model="edits[row.recordId].followups" :disabled="state.offline"></textarea></label>
                <div class="wide experience-actions">
                  <button class="danger" :disabled="state.offline || deleting[row.recordId]" @click="deleteExperience(row)">{{ deleting[row.recordId] ? '删除中…' : '删除经历' }}</button>
                  <button :disabled="state.offline || summaryBusy[row.recordId] || !edits[row.recordId].content.trim()" @click="generateSummary(row)">{{ summaryBusy[row.recordId] ? '生成中…' : '根据正文生成摘要' }}</button>
                  <button class="primary" :disabled="state.offline || saving[row.recordId] || !edits[row.recordId].title.trim()" @click="saveEdit(row)">{{ saving[row.recordId] ? '保存中…' : '保存经历' }}</button>
                </div>
                <div v-if="summaries[row.recordId]" class="wide summary-draft">
                  <span v-if="summaries[row.recordId].mock" class="pill warn">MOCK 占位内容</span>
                  <span class="flabel">摘要草稿</span>
                  <textarea rows="5" v-model="summaries[row.recordId].text"></textarea>
                  <button class="primary" @click="applySummary(row)">采用到摘要栏</button>
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted experience-empty">经历库还是空的，可在上方新建或在下方批量导入。</p>

      <section class="newbox">
        <h3>批量导入</h3>
        <p class="muted">粘贴 JSON 数组或 CSV。字段为经历标题、经历类型、经历摘要、技能标签、经历正文、相关链接、追问记录；JSON 英文字段为 title、type、summary、tags、content、links、followups。标签和类型必须来自飞书当前可选项，同名不会自动合并。</p>
        <textarea rows="12" v-model="bulk.text" :disabled="state.offline" placeholder='[{"title":"项目名称","type":"项目经历","summary":"职责与结果摘要","tags":["产品设计"],"content":"## Overview\\n\\n……","links":"材料 | https://...","followups":"Q：后续可追问的问题"}]'></textarea>
        <p v-if="parsed.error" class="bad">{{ parsed.error }}</p>
        <p v-if="badTags.length" class="bad">飞书中没有这些标签：{{ badTags.join('、') }}</p>
        <p v-if="badTypes.length" class="bad">不支持这些经历类型：{{ badTypes.join('、') }}</p>
        <p v-if="parsed.items.length && !parsed.error" class="muted">已识别 {{ parsed.items.length }} 条经历。</p>
        <div class="actions">
          <button class="primary" :disabled="state.offline || importing || !parsed.items.length || badTags.length || badTypes.length" @click="runImport">{{ importing ? '导入中…' : '确认导入' }}</button>
          <button :disabled="!bulk.text" @click="clearBulk">清空</button>
        </div>
      </section>
    </div>`,
};
