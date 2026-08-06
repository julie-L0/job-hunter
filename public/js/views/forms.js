// 网申填表（F5）。三步：粘原文 → 拆题核对 → 逐题生成和改稿。
// 不写回 bitable（PRD F5 明确），整个会话存 localStorage：网申填一半被打断是常事。
import { api } from "../api.js";
import { currentJobRef, handleError, jobReady, state } from "../store.js";
import { NeedJob, confirmDialog, copyText, useDraft } from "../ui.js";

const { computed, reactive, ref } = window.Vue;

let seq = 0;
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

export const Forms = {
  components: { NeedJob },
  setup() {
    const job = currentJobRef;
    const error = ref("");
    const splitting = ref(false);
    // 逐题的进行中状态。故意不放进 session：刷新后残留一个 true 会把按钮永久锁死
    const busy = reactive({});

    const scope = computed(() => state.currentJobId);
    const { data: session, clear } = useDraft("forms", scope, { rawText: "", questions: [] });

    const kept = computed(() => session.questions.filter((q) => q.keep && q.question.trim()));
    const pending = computed(() => kept.value.filter((q) => !q.answer));
    const anyBusy = computed(() => Object.values(busy).some(Boolean));

    async function split() {
      if (splitting.value) return;
      const raw = session.rawText.trim();
      if (!raw) {
        error.value = "先把申请表页面的文字粘进来";
        return;
      }
      splitting.value = true;
      error.value = "";
      try {
        const result = await api.splitForm(raw);
        const list = Array.isArray(result.questions) ? result.questions : [];
        if (!list.length) {
          error.value = "没拆出题目，检查一下粘的是不是申请表正文";
          return;
        }
        session.questions = list.map((item) => newQuestion(item.question || "", item.limit ?? null));
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
    async function reset() {
      const ok = await confirmDialog({
        title: "清空这份表？",
        body: "题目和已经生成的答案都会从浏览器里删掉，没有别处备份。",
        danger: true,
      });
      if (ok) clear();
    }

    return {
      state,
      job,
      jobReady,
      error,
      splitting,
      busy,
      session,
      kept,
      pending,
      anyBusy,
      split,
      answer,
      answerAll,
      revise,
      reset,
      copyText,
      add: () => session.questions.push(newQuestion()),
      remove: (question) => {
        session.questions = session.questions.filter((item) => item.id !== question.id);
      },
    };
  },
  template: `
    <NeedJob v-if="!jobReady" what="网申填表" :job="job" />
    <div v-else class="page">
      <h2 class="ptitle">网申填表 · {{ job.company }} {{ job.position }}</h2>
      <p class="muted">把申请表页面的文字整段粘进来，AI 拆成题目，核对后逐题生成。
        答案不写回飞书，只存在这台浏览器里，刷新不丢。</p>

      <details class="paste" :open="!session.questions.length">
        <summary>第 1 步 · 粘原文（{{ session.rawText.length }} 字）</summary>
        <textarea rows="8" v-model="session.rawText" :disabled="state.offline"
          placeholder="全选申请表页面复制，粘到这里。导航、按钮、隐私声明这些噪音不用手动删。"></textarea>
        <div class="drow">
          <button class="primary" :disabled="splitting || state.offline" @click="split">
            {{ splitting ? '拆题中…' : (session.questions.length ? '重新拆题' : '拆出题目') }}
          </button>
          <span v-if="session.questions.length" class="muted">重新拆题会覆盖下面所有题目和答案。</span>
        </div>
      </details>

      <p v-if="error" class="notice bad">{{ error }}</p>

      <template v-if="session.questions.length">
        <div class="strip">
          <span class="flabel">第 2 步 · 核对题目</span>
          <span class="muted">保留 {{ kept.length }} 题，{{ pending.length }} 题还没答案</span>
          <span class="grow"></span>
          <button class="ghost" @click="add">加一题</button>
          <button class="primary" :disabled="!pending.length || anyBusy || state.offline"
            @click="answerAll">全部生成（{{ pending.length }} 次调用）</button>
          <button class="ghost" @click="reset">清空</button>
        </div>
        <article v-for="q in session.questions" :key="q.id" class="qcard" :class="{ off: !q.keep }">
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
    </div>`,
};
