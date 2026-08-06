// 经历库（F4）。行内编辑 + 短版本确定性拆分 + 批量导入。
// 短版本不额外调一次 AI：接口返回的是一整段【50字版】/【100字版】，用规则切开预填，
// 用户核对后分别写回。能用规则做的事不该再花一次 token。
import { api } from "../api.js";
import { handleError, loadAll, mergeExperience, state, toast } from "../store.js";
import { FieldRow, TagPicker, confirmDialog, useDraft } from "../ui.js";

const { computed, reactive, ref } = window.Vue;

// 导入表头别名，比较前统一小写
const HEADER_KEYS = {
  经历标题: "title",
  标题: "title",
  title: "title",
  "star全文": "star",
  star: "star",
  全文: "star",
  "50字版": "short50",
  short50: "short50",
  "100字版": "short100",
  short100: "short100",
  技能标签: "tags",
  标签: "tags",
  tags: "tags",
  相关链接: "links",
  links: "links",
};

/** 追问记录按写入时的【日期 来源】前缀切条；不带前缀的行归到上一条。 */
function parseFollowups(text) {
  const out = [];
  for (const line of String(text || "").split("\n")) {
    const match = /^【([^】]*)】(.*)$/.exec(line.trim());
    if (match) out.push({ head: match[1], body: match[2] });
    else if (out.length) out[out.length - 1].body += `\n${line}`;
    else if (line.trim()) out.push({ head: "", body: line });
  }
  return out;
}

/** 把一整段短版本切成两段。认不出就整段交还给用户手剪，不猜。 */
function splitShort(raw) {
  const text = String(raw || "").trim();
  const at50 = text.search(/【?\s*50\s*字/);
  const at100 = text.search(/【?\s*100\s*字/);
  if (at50 < 0 || at100 <= at50) return { short50: "", short100: "", ok: false };
  const clean = (chunk) =>
    chunk
      .replace(/^【[^】]*】/, "")
      .replace(/^\s*\d+\s*字版?\s*[:：]?/, "")
      .trim();
  return { short50: clean(text.slice(at50, at100)), short100: clean(text.slice(at100)), ok: true };
}
/** 手写 CSV 解析：STAR 全文里带逗号和换行是常态，split(",") 会把数据切碎。 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else quoted = false;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows.filter((cells) => cells.some((value) => value.trim()));
}

function fromCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("CSV 至少要有表头和一行数据");
  const keys = rows[0].map((name) => HEADER_KEYS[name.trim().toLowerCase()] || "");
  if (!keys.includes("title")) throw new Error("表头里找不到「经历标题」这一列");
  return rows.slice(1).map((cells) => {
    const item = {};
    keys.forEach((key, i) => {
      if (key) item[key] = cells[i] || "";
    });
    return item;
  });
}

function fromJson(text) {
  const parsed = JSON.parse(text);
  const list = Array.isArray(parsed) ? parsed : parsed.items;
  if (!Array.isArray(list)) throw new Error("JSON 要么是数组，要么是 {items:[…]}");
  return list;
}

function linkText(links) {
  if (!links) return "";
  if (typeof links === "string") return links.trim();
  return (Array.isArray(links) ? links : [links])
    .map((item) =>
      typeof item === "string" ? item : [item.label, item.url].filter(Boolean).join(" | "),
    )
    .filter(Boolean)
    .join("\n");
}

function normalizeItem(raw) {
  const tags = Array.isArray(raw.tags) ? raw.tags : String(raw.tags || "").split(/[、,，;；/|]+/);
  return {
    title: String(raw.title || "").trim(),
    star: String(raw.star || "").trim(),
    short50: String(raw.short50 || "").trim(),
    short100: String(raw.short100 || "").trim(),
    links: linkText(raw.links),
    tags: tags.map((tag) => String(tag).trim()).filter(Boolean),
  };
}
export const Experiences = {
  components: { FieldRow, TagPicker },
  setup() {
    const open = ref("");
    const error = ref("");
    const importing = ref(false);
    const tagBusy = reactive({});
    const shortBusy = reactive({});

    const scope = ref("all");
    const { data: shorts } = useDraft("exp-short", scope, { byId: {} });
    const { data: bulk, clear: clearBulk } = useDraft("exp-import", scope, { text: "" });

    // 解析纯前端做，错误就地显示。等提交才知道 CSV 少一列太晚了
    const parsed = computed(() => {
      const text = bulk.text.trim();
      if (!text) return { items: [], error: "" };
      try {
        const source = text.startsWith("[") || text.startsWith("{") ? fromJson : fromCsv;
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
      const bad = new Set();
      for (const item of parsed.value.items) {
        for (const tag of item.tags) if (!allowed.has(tag)) bad.add(tag);
      }
      return [...bad];
    });

    async function runImport() {
      const items = parsed.value.items;
      if (!items.length || badTags.value.length || importing.value) return;
      const ok = await confirmDialog({
        title: `将写入 ${items.length} 条经历？`,
        body: "会直接在飞书经历库里新建这些记录。同名不会自动合并，先确认没有和现有条目重复。",
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
    async function makeShort(row) {
      if (shortBusy[row.recordId]) return;
      shortBusy[row.recordId] = true;
      error.value = "";
      try {
        const result = await api.generateShort(row.recordId);
        const split = splitShort(result.draft);
        shorts.byId[row.recordId] = {
          short50: split.short50,
          short100: split.short100,
          raw: split.ok ? "" : result.draft,
          mock: Boolean(result.mock),
        };
      } catch (failure) {
        if (!handleError(failure)) error.value = failure.message;
      } finally {
        shortBusy[row.recordId] = false;
      }
    }

    async function writeShort(row, key) {
      const entry = shorts.byId[row.recordId];
      if (!entry || !entry[key].trim()) return;
      try {
        mergeExperience(await api.patchExperience(row.recordId, { [key]: entry[key] }));
        toast(key === "short50" ? "已写回 50 字版" : "已写回 100 字版");
      } catch (failure) {
        if (!handleError(failure)) error.value = failure.message;
      }
    }

    async function saveTags(row, next) {
      tagBusy[row.recordId] = true;
      error.value = "";
      try {
        mergeExperience(await api.patchExperience(row.recordId, { tags: next }));
      } catch (failure) {
        if (!handleError(failure)) error.value = failure.message;
      } finally {
        tagBusy[row.recordId] = false;
      }
    }

    const saver = (recordId, key) => async (value) => {
      mergeExperience(await api.patchExperience(recordId, { [key]: value }));
    };

    return {
      state, open, error, importing, tagBusy, shortBusy, shorts, bulk,
      parsed, badTags, runImport, makeShort, writeShort, saveTags, saver,
      parseFollowups, clearBulk,
      rows: computed(() => state.experiences),
      lines: (text) => String(text || "").split("\n").map((line) => line.trim()).filter(Boolean),
      urlOf: (line) => (/(https?:\/\/\S+)/.exec(line) || [])[1] || "",
      labelOf: (line) => line.split("|")[0].trim() || line,
      toggle: (recordId) => (open.value = open.value === recordId ? "" : recordId),
      dropShort: (row) => delete shorts.byId[row.recordId],
    };
  },
  template: `
    <div class="page">
      <h2 class="ptitle">经历库</h2>
      <p class="muted">简历、自我介绍、Mock 面试都从这里取素材。STAR 全文写全，50/100 字版可以让 AI 压缩后核对。</p>

      <p v-if="error" class="notice bad">{{ error }}</p>

      <table v-if="rows.length" class="grid">
        <thead>
          <tr><th>经历标题</th><th>技能标签</th><th>50字</th><th>100字</th><th>链接</th><th>追问</th><th></th></tr>
        </thead>
        <tbody v-for="row in rows" :key="row.recordId">
          <tr :class="{ on: open === row.recordId }">
            <td>{{ row.title }}</td>
            <td class="muted">{{ (row.tags || []).join('、') || '—' }}</td>
            <td :class="row.short50 ? 'ok' : 'muted'">{{ row.short50 ? '✓' : '—' }}</td>
            <td :class="row.short100 ? 'ok' : 'muted'">{{ row.short100 ? '✓' : '—' }}</td>
            <td class="muted">{{ lines(row.links).length || '—' }}</td>
            <td class="muted">{{ parseFollowups(row.followups).length || '—' }}</td>
            <td>
              <button class="link" @click="toggle(row.recordId)">
                {{ open === row.recordId ? '收起' : '编辑' }}
              </button>
            </td>
          </tr>
          <tr v-if="open === row.recordId" class="editrow">
            <td colspan="7">
              <div class="fields">
                <FieldRow label="经历标题" :value="row.title || ''" :disabled="state.offline"
                  :save="saver(row.recordId, 'title')" />
                <FieldRow label="STAR 全文" type="textarea" :rows="12" wide :value="row.star || ''"
                  placeholder="S 背景 / T 目标 / A 行动 / R 结果，数据写具体"
                  :disabled="state.offline" :save="saver(row.recordId, 'star')" />
                <FieldRow label="50 字版" type="textarea" :rows="3" wide :value="row.short50 || ''"
                  :disabled="state.offline" :save="saver(row.recordId, 'short50')" />
                <FieldRow label="100 字版" type="textarea" :rows="4" wide :value="row.short100 || ''"
                  :disabled="state.offline" :save="saver(row.recordId, 'short100')" />
                <FieldRow label="相关链接" type="textarea" :rows="4" wide :value="row.links || ''"
                  placeholder="每行一条：说明 | https://……（技术文档、上线页面、复盘文章）"
                  :disabled="state.offline" :save="saver(row.recordId, 'links')" />
              </div>

              <div class="strip">
                <span class="flabel">技能标签</span>
                <TagPicker :model-value="row.tags || []" :options="state.tags"
                  :disabled="state.offline || tagBusy[row.recordId]"
                  @update:model-value="(next) => saveTags(row, next)" />
                <span v-if="tagBusy[row.recordId]" class="fstate">保存中…</span>
              </div>

              <div v-if="lines(row.links).length" class="strip">
                <span class="flabel">打开链接</span>
                <template v-for="line in lines(row.links)" :key="line">
                  <a v-if="urlOf(line)" class="ghost" :href="urlOf(line)" target="_blank"
                    rel="noreferrer">{{ labelOf(line) }}</a>
                  <span v-else class="muted">{{ line }}</span>
                </template>
              </div>

              <div class="strip">
                <span class="flabel">短版本</span>
                <button class="ghost" :disabled="shortBusy[row.recordId] || state.offline || !row.star"
                  @click="makeShort(row)">
                  {{ shortBusy[row.recordId] ? '生成中…' : '让 AI 压缩出 50/100 字版' }}
                </button>
                <span v-if="!row.star" class="muted">先写 STAR 全文。</span>
              </div>

              <div v-if="shorts.byId[row.recordId]" class="shortbox">
                <span v-if="shorts.byId[row.recordId].mock" class="pill warn">MOCK 占位内容</span>
                <span class="flabel">50 字版草稿（{{ shorts.byId[row.recordId].short50.length }} 字）</span>
                <textarea rows="3" v-model="shorts.byId[row.recordId].short50"></textarea>
                <span class="flabel">100 字版草稿（{{ shorts.byId[row.recordId].short100.length }} 字）</span>
                <textarea rows="4" v-model="shorts.byId[row.recordId].short100"></textarea>
                <div v-if="shorts.byId[row.recordId].raw" class="notice">
                  没自动认出两段，下面是原文，自己剪一下贴进上面两栏：
                  <pre class="jd">{{ shorts.byId[row.recordId].raw }}</pre>
                </div>
                <div class="drow">
                  <button class="primary" :disabled="state.offline"
                    @click="writeShort(row, 'short50')">写回 50 字版</button>
                  <button class="primary" :disabled="state.offline"
                    @click="writeShort(row, 'short100')">写回 100 字版</button>
                  <button class="ghost" @click="dropShort(row)">丢弃草稿</button>
                </div>
              </div>

              <details v-if="parseFollowups(row.followups).length" class="fups">
                <summary>追问记录 {{ parseFollowups(row.followups).length }} 条</summary>
                <article v-for="(item, i) in parseFollowups(row.followups)" :key="i">
                  <span class="pill">{{ item.head || '未标日期' }}</span>
                  <p>{{ item.body }}</p>
                </article>
              </details>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted">经历库还是空的，下面可以粘 CSV 或 JSON 批量导入。</p>
      <section class="newbox">
        <h3>批量导入</h3>
        <p class="muted">粘 CSV（第一行是表头）或 JSON 数组。表头认这些列名：经历标题、STAR全文、50字版、
          100字版、技能标签（用「、」分隔）、相关链接（每行「说明 | URL」）。只新建，不合并同名。</p>
        <textarea rows="10" v-model="bulk.text" :disabled="state.offline"
          placeholder="经历标题,STAR全文,50字版,100字版,技能标签,相关链接&#10;校园二手书小程序,&quot;S：……&#10;T：……&quot;,,,产品设计、项目管理,需求文档 | https://……"></textarea>

        <p v-if="parsed.error" class="notice bad">{{ parsed.error }}</p>
        <p v-if="badTags.length" class="notice bad">
          这些标签不在飞书的选项里：{{ badTags.join('、') }}。
          加选项属于表结构变更，得先在飞书的「技能标签」字段里加，或者改成已有的标签。
        </p>

        <template v-if="parsed.items.length">
          <div class="strip">
            <span class="muted">解析出 {{ parsed.items.length }} 条</span>
            <span class="grow"></span>
            <button class="primary" :disabled="importing || state.offline || badTags.length"
              @click="runImport">
              {{ importing ? '写入中…' : '导入这 ' + parsed.items.length + ' 条' }}
            </button>
            <button class="ghost" @click="clearBulk">清空</button>
          </div>
          <table class="grid">
            <thead>
              <tr><th>经历标题</th><th>技能标签</th><th>STAR</th><th>50字</th><th>100字</th><th>链接</th></tr>
            </thead>
            <tbody>
              <tr v-for="(item, i) in parsed.items" :key="i">
                <td>{{ item.title }}</td>
                <td>
                  <template v-for="tag in item.tags" :key="tag">
                    <span :class="state.tags.includes(tag) ? 'pill' : 'pill warn'">{{ tag }}</span>
                  </template>
                  <span v-if="!item.tags.length" class="muted">—</span>
                </td>
                <td class="muted">{{ item.star.length || '—' }}</td>
                <td class="muted">{{ item.short50 ? '✓' : '—' }}</td>
                <td class="muted">{{ item.short100 ? '✓' : '—' }}</td>
                <td class="muted">{{ lines(item.links).length || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </section>
    </div>`,
};
