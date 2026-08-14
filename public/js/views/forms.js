// 网申填表（F5）。主路径：固定资料架 → 按经历类型整理条目 → 逐字段复制。
// 开放题仍保留原来的逐题生成兜底。
// 不写回 bitable（PRD F5 明确），整个会话存 localStorage：网申填一半被打断是常事。
import { api } from "../api.js";
import { currentJobRef, handleError, jobReady, state } from "../store.js";
import { NeedJob, PageJobPicker, confirmDialog, copyText, useDraft } from "../ui.js";

const { computed, reactive, ref } = window.Vue;

let seq = 0;
const SELF_REVIEW_QUESTION = "请根据岗位 JD、指定简历和经历库，写一段网申表可用的自我评价/个人优势。要求像候选人本人填写，结合岗位需要的能力和已有经历事实，不要空泛套话。";

const newQuestion = (question = "", limit = null) => ({
  id: `q${Date.now().toString(36)}${seq++}`,
  question,
  limit,
  keep: true,
  answer: "",
  history: [],
  mock: false,
  revise: "",
});

function normalizeSelfReview(value = {}) {
  return {
    limit: Number(value.limit) || 300,
    answer: value.answer || "",
    history: Array.isArray(value.history) ? value.history : [],
    mock: Boolean(value.mock),
    revise: value.revise || "",
  };
}

function normalizeSection(section) {
  const fields = Array.isArray(section.fields) ? section.fields : [];
  return {
    id: section.id || section.kind || `section${seq++}`,
    title: section.title || "经历条目",
    kind: section.kind || "experience",
    fields,
    entries: (Array.isArray(section.entries) ? section.entries : []).map((entry) => ({
      ...entry,
      fields: entry.fields || {},
      missingFields: Array.isArray(entry.missingFields) ? entry.missingFields : [],
    })),
    empty: Boolean(section.empty),
  };
}

function entryDate(entry) {
  const fields = entry.fields || {};
  return fields.period || [fields.startDate, fields.endDate].filter(Boolean).join(" - ");
}

function fieldValue(entry, field) {
  return String(entry.fields?.[field.key] || "").trim();
}

function entryLines(section, entry) {
  return section.fields.map((field) => `${field.label}：${fieldValue(entry, field) || "待补充"}`);
}

export const Forms = {
  components: { NeedJob, PageJobPicker },
  setup() {
    const job = currentJobRef;
    const error = ref("");
    const splitting = ref(false);
    const loadingLibrary = ref(false);
    const selfReviewBusy = ref(false);
    // 逐题的进行中状态。故意不放进 session：刷新后残留一个 true 会把按钮永久锁死
    const busy = reactive({});

    const scope = computed(() => state.currentJobId);
    const { data: session } = useDraft("forms", scope, {
      openText: "",
      libraryVersion: 0,
      sections: [],
      questions: [],
      selfReview: normalizeSelfReview(),
      warnings: [],
    });

    if (session.openText === undefined) session.openText = session.rawText || "";
    if (session.libraryVersion === undefined) session.libraryVersion = 0;

    if (!Array.isArray(session.sections)) session.sections = [];
    if (!Array.isArray(session.questions)) session.questions = [];
    if (!Array.isArray(session.warnings)) session.warnings = [];
    session.selfReview = normalizeSelfReview(session.selfReview);

    const sectionList = computed(() => (Array.isArray(session.sections) ? session.sections : []));
    const questionList = computed(() => (Array.isArray(session.questions) ? session.questions : []));
    const kept = computed(() => questionList.value.filter((q) => q.keep && q.question.trim()));
    const pending = computed(() => kept.value.filter((q) => !q.answer));
    const anyBusy = computed(() => selfReviewBusy.value || Object.values(busy).some(Boolean));
    const entryCount = computed(() => sectionList.value.reduce((sum, section) => sum + section.entries.length, 0));

    async function loadLibrary(force = false) {
      if (loadingLibrary.value) return;
      loadingLibrary.value = true;
      error.value = "";
      try {
        const result = await api.fillFormLibrary();
        if (force || !sectionList.value.length || session.libraryVersion !== result.version) {
          session.sections = (Array.isArray(result.sections) ? result.sections : []).map(normalizeSection);
          session.libraryVersion = result.version || 0;
        }
        session.warnings = Array.isArray(result.warnings) ? result.warnings : [];
      } catch (failure) {
        if (!handleError(failure)) error.value = failure.message;
      } finally {
        loadingLibrary.value = false;
      }
    }

    loadLibrary(false);

    async function split() {
      if (splitting.value) return;
      const raw = session.openText.trim();
      if (!raw) {
        error.value = "先把开放题粘进来";
        return;
      }
      splitting.value = true;
      error.value = "";
      try {
        const result = await api.splitForm(raw);
        const questions = Array.isArray(result.questions) ? result.questions : [];
        const warnings = Array.isArray(result.warnings) ? result.warnings : [];
        if (warnings.length) session.warnings = warnings;
        if (!questions.length) {
          error.value = warnings[0] || "没识别出开放题。经历类字段不用粘，直接用上面的固定资料架。";
          return;
        }
        session.questions = questions.map((item) => newQuestion(item.question || "", item.limit ?? null));
        session.warnings = [];
      } catch (failure) {
        if (!handleError(failure)) error.value = failure.message;
      } finally {
        splitting.value = false;
      }
    }
    async function answer(question) {
      if (busy[question.id]) return;
      busy[question.id] = true;
      error.value = "";
      try {
        const result = await api.answerForm({
          recordId: job.value.recordId,
          question: question.question,
          limit: question.limit || "",
        });
        question.answer = result.answer;
        question.history = result.history;
        question.mock = Boolean(result.mock);
      } catch (failure) {
        if (!handleError(failure)) error.value = failure.message;
      } finally {
        busy[question.id] = false;
      }
    }

    async function answerAll() {
      const list = pending.value;
      if (!list.length) return;
      const ok = await confirmDialog({
        title: `一次生成 ${list.length} 题？`,
        body: `将调用 ${list.length} 次 DeepSeek，按 token 计费。已经有答案的题不会重复生成。`,
      });
      if (!ok) return;
      // 串行：一次失败不至于把整批钱都花掉，掉线就立刻停
      for (const question of list) {
        await answer(question);
        if (state.offline) break;
      }
    }

    async function revise(question) {
      const instruction = question.revise.trim();
      if (!instruction || busy[question.id]) return;
      busy[question.id] = true;
      error.value = "";
      try {
        const result = await api.reviseForm({ history: question.history, instruction });
        question.answer = result.answer;
        question.history = result.history;
        question.revise = "";
      } catch (failure) {
        if (!handleError(failure)) error.value = failure.message;
      } finally {
        busy[question.id] = false;
      }
    }

    async function generateSelfReview() {
      if (selfReviewBusy.value) return;
      selfReviewBusy.value = true;
      error.value = "";
      try {
        const result = await api.answerForm({
          recordId: job.value.recordId,
          question: SELF_REVIEW_QUESTION,
          limit: session.selfReview.limit || "",
        });
        session.selfReview.answer = result.answer;
        session.selfReview.history = result.history;
        session.selfReview.mock = Boolean(result.mock);
      } catch (failure) {
        if (!handleError(failure)) error.value = failure.message;
      } finally {
        selfReviewBusy.value = false;
      }
    }

    async function reviseSelfReview() {
      const instruction = session.selfReview.revise.trim();
      if (!instruction || selfReviewBusy.value || !session.selfReview.history.length) return;
      selfReviewBusy.value = true;
      error.value = "";
      try {
        const result = await api.reviseForm({ history: session.selfReview.history, instruction });
        session.selfReview.answer = result.answer;
        session.selfReview.history = result.history;
        session.selfReview.revise = "";
        session.selfReview.mock = Boolean(result.mock);
      } catch (failure) {
        if (!handleError(failure)) error.value = failure.message;
      } finally {
        selfReviewBusy.value = false;
      }
    }

    async function reset() {
      const ok = await confirmDialog({
        title: "清空开放题？",
        body: "开放题和已经生成的答案会从浏览器里删掉；上面的固定经历资料架会保留。",
        danger: true,
      });
      if (ok) {
        session.openText = "";
        session.questions = [];
      }
    }

    function copyEntry(section, entry) {
      return copyText(entryLines(section, entry).join("\n"));
    }

    function copySection(section) {
      const text = section.entries
        .map((entry, index) => [`#${index + 1} ${entry.sourceTitle || section.title}`, ...entryLines(section, entry)].join("\n"))
        .join("\n\n");
      return copyText(text);
    }

    return {
      state,
      job,
      jobReady,
      error,
      splitting,
      loadingLibrary,
      busy,
      selfReviewBusy,
      session,
      sectionList,
      questionList,
      kept,
      pending,
      anyBusy,
      entryCount,
      split,
      loadLibrary,
      answer,
      answerAll,
      revise,
      generateSelfReview,
      reviseSelfReview,
      reset,
      copyText,
      copyEntry,
      copySection,
      entryDate,
      fieldValue,
      add: () => session.questions.push(newQuestion()),
      remove: (question) => {
        session.questions = questionList.value.filter((item) => item.id !== question.id);
      },
    };
  },
  template: `
    <PageJobPicker />
    <NeedJob v-if="!jobReady" what="网申填表" :job="job" />
    <div v-else class="page">
      <h2 class="ptitle">网申填表 · {{ job.company }} {{ job.position }}</h2>
      <p class="muted">先处理企业页面里的自定义开放题，再生成自我评价，最后从经历资料架逐条复制经历字段。</p>

      <p v-if="error" class="notice bad">{{ error }}</p>
      <p v-for="warning in session.warnings" :key="warning" class="notice bad">{{ warning }}</p>

      <details class="paste" :open="!questionList.length">
        <summary>自定义问题 / 开放题粘贴（{{ session.openText.length }} 字）</summary>
        <textarea rows="6" v-model="session.openText" :disabled="state.offline"
          placeholder="只粘开放题，例如：为什么选择这个岗位？请描述一次你解决复杂问题的经历。实习/校园/项目经历字段不用粘。"></textarea>
        <div class="drow">
          <button class="primary" :disabled="splitting || state.offline" @click="split">
            {{ splitting ? '拆题中…' : (questionList.length ? '重新拆开放题' : '拆开放题') }}
          </button>
          <span v-if="questionList.length" class="muted">重新拆题会覆盖下面开放题和答案。</span>
        </div>
      </details>

      <template v-if="questionList.length">
        <div class="strip">
          <span class="flabel">开放题 · 核对后生成</span>
          <span class="muted">保留 {{ kept.length }} 题，{{ pending.length }} 题还没答案</span>
          <span class="grow"></span>
          <button class="ghost" @click="add">加一题</button>
          <button class="primary" :disabled="!pending.length || anyBusy || state.offline"
            @click="answerAll">全部生成（{{ pending.length }} 次调用）</button>
          <button class="ghost" @click="reset">清空开放题</button>
        </div>
        <article v-for="q in questionList" :key="q.id" class="qcard" :class="{ off: !q.keep }">
          <div class="qhead">
            <label class="check"><input type="checkbox" v-model="q.keep">保留</label>
            <span class="grow"></span>
            <span class="muted">字数上限</span>
            <input class="limit" type="number" min="0" v-model.number="q.limit" placeholder="无">
            <button class="link" @click="remove(q)">删掉</button>
          </div>
          <textarea rows="2" v-model="q.question" placeholder="题目原文"></textarea>

          <div v-if="q.keep" class="drow">
            <button class="primary" :disabled="busy[q.id] || state.offline || !q.question.trim()"
              @click="answer(q)">
              {{ busy[q.id] ? '生成中…' : (q.answer ? '重新生成' : '生成答案') }}
            </button>
            <span v-if="q.mock" class="pill warn">MOCK 占位内容</span>
          </div>

          <div v-if="q.answer" class="qans">
            <div class="dhead">
              <span class="dtitle">答案</span>
              <span class="grow"></span>
              <span :class="q.limit && q.answer.length > q.limit ? 'bad' : 'muted'">
                {{ q.answer.length }}{{ q.limit ? ' / ' + q.limit : '' }} 字
              </span>
              <button class="link" @click="copyText(q.answer)">复制</button>
            </div>
            <textarea rows="8" v-model="q.answer"></textarea>
            <div class="drow">
              <input v-model="q.revise" :disabled="state.offline" @keyup.enter="revise(q)"
                placeholder="要改哪里：再短一点、换个例子、别用「赋能」……">
              <button class="ghost" :disabled="busy[q.id] || state.offline || !q.revise.trim()"
                @click="revise(q)">{{ busy[q.id] ? '改稿中…' : '让 AI 改' }}</button>
            </div>
          </div>
        </article>
      </template>

      <section class="draftbox self-review-box">
        <div class="dhead">
          <div>
            <span class="dtitle">自我评价</span>
            <p class="muted">根据当前 JD、指定简历和经历库综合生成，适合粘到「自我评价 / 个人优势」字段。</p>
          </div>
          <span class="grow"></span>
          <span class="muted">字数上限</span>
          <input class="limit" type="number" min="80" v-model.number="session.selfReview.limit">
          <button class="primary" :disabled="selfReviewBusy || state.offline" @click="generateSelfReview">
            {{ selfReviewBusy ? '生成中…' : (session.selfReview.answer ? '重新生成' : '生成自我评价') }}
          </button>
          <span v-if="session.selfReview.mock" class="pill warn">MOCK 占位内容</span>
        </div>

        <div v-if="session.selfReview.answer" class="qans">
          <div class="dhead">
            <span class="dtitle">草稿</span>
            <span class="grow"></span>
            <span :class="session.selfReview.limit && session.selfReview.answer.length > session.selfReview.limit ? 'bad' : 'muted'">
              {{ session.selfReview.answer.length }}{{ session.selfReview.limit ? ' / ' + session.selfReview.limit : '' }} 字
            </span>
            <button class="link" @click="copyText(session.selfReview.answer)">复制</button>
          </div>
          <textarea rows="7" v-model="session.selfReview.answer"></textarea>
          <div class="drow">
            <input v-model="session.selfReview.revise" :disabled="state.offline" @keyup.enter="reviseSelfReview"
              placeholder="要改哪里：更像本人、更具体、少一点套话……">
            <button class="ghost" :disabled="selfReviewBusy || state.offline || !session.selfReview.revise.trim() || !session.selfReview.history.length"
              @click="reviseSelfReview">{{ selfReviewBusy ? '改稿中…' : '让 AI 改' }}</button>
          </div>
        </div>
      </section>

      <div class="strip">
        <span class="flabel">经历资料架</span>
        <span class="muted">{{ sectionList.length }} 个栏目，{{ entryCount }} 条可复制内容，最近时间在前</span>
        <span v-if="loadingLibrary" class="muted">加载中…</span>
        <span class="grow"></span>
        <button class="ghost" :disabled="loadingLibrary || state.offline" @click="loadLibrary(true)">刷新经历库</button>
      </div>

      <template v-if="sectionList.length">
        <details v-for="section in sectionList" :key="section.id" class="form-section" :open="section.entries.length > 0">
          <summary>
            <span>{{ section.title }}</span>
            <small>{{ section.entries.length }} 条</small>
          </summary>

          <div class="dhead">
            <div>
              <p class="muted">字段：{{ section.fields.map((field) => field.label).join(' / ') }}</p>
            </div>
            <span class="grow"></span>
            <button class="ghost" :disabled="!section.entries.length" @click="copySection(section)">复制本组</button>
          </div>

          <p v-if="!section.entries.length" class="notice bad">经历库里暂时没有可用于这个栏目复制的条目。</p>

          <article v-for="entry in section.entries" :key="entry.id" class="fill-entry">
            <div class="qhead">
              <strong>{{ entry.sourceTitle }}</strong>
              <span v-if="entryDate(entry)" class="pill">{{ entryDate(entry) }}</span>
              <span v-if="entry.missingFields.length" class="pill warn">有字段待补</span>
              <span class="muted">{{ entry.matchReason }}</span>
              <span class="grow"></span>
              <button class="link" @click="copyEntry(section, entry)">复制整条</button>
            </div>

            <div class="fill-grid">
              <label v-for="field in section.fields" :key="field.key" class="fill-field"
                :class="{ missing: !fieldValue(entry, field), wide: field.key === 'description' && !['award', 'certificate', 'needs-confirmation'].includes(section.kind) }">
                <span>
                  <b>{{ field.label }}</b>
                  <button type="button" class="link" @click="copyText(fieldValue(entry, field))">复制</button>
                </span>
                <textarea v-if="field.key === 'description' && !['award', 'certificate', 'needs-confirmation'].includes(section.kind)" rows="5" v-model="entry.fields[field.key]"
                  placeholder="待补充"></textarea>
                <input v-else v-model="entry.fields[field.key]" placeholder="待补充">
              </label>
            </div>
          </article>
        </details>
      </template>
    </div>`,
};
