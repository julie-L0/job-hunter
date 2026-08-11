// Mock 面试（F8）。对话流 + 每个面试官气泡上实时标记。
// 追问建议里的经历必须用下拉选：后端靠标题字符串精确匹配经历记录（src/api/ai.js:157），
// 模型把标题写歪一个字 recordId 就是 null。AI 的输出不该当机器 key 用。
import { api } from "../api.js";
import { currentJobRef, handleError, jobReady, mergeExperience, state, toast } from "../store.js";
import { NeedJob, PageJobPicker, confirmDialog, copyText, useDraft } from "../ui.js";

const { computed, ref } = window.Vue;

/** AI 写回来的标题不一定和经历库一字不差，宽松匹配一次做预选，最终仍由用户确认。 */
function matchExperience(title) {
  if (!title) return "";
  const norm = (text) => String(text || "").replace(/\s+/g, "").toLowerCase();
  const want = norm(title);
  const list = state.experiences;
  const hit =
    list.find((exp) => exp.title === title) ||
    list.find((exp) => norm(exp.title) === want) ||
    list.find((exp) => norm(exp.title).includes(want) || want.includes(norm(exp.title)));
  return hit?.recordId || "";
}

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export const Mock = {
  components: { NeedJob, PageJobPicker },
  setup() {
    const job = currentJobRef;
    const busy = ref(false);
    const error = ref("");
    const input = ref("");

    const scope = computed(() => state.currentJobId);
    const { data: session, clear } = useDraft("mock", scope, {
      history: [],
      marks: {},
      summary: "",
      followups: [],
      mock: false,
      endedAt: 0,
    });

    const started = computed(() => session.history.length > 0);
    const ended = computed(() => Boolean(session.endedAt));
    // system 消息不展示，但必须留在 history 里原样带回后端（后端无状态，上下文靠前端带）
    const bubbles = computed(() =>
      session.history
        .map((message, index) => ({ ...message, index }))
        .filter((message) => message.role !== "system"),
    );
    const markedCount = computed(() => Object.keys(session.marks).length);

    async function run(action) {
      if (busy.value) return null;
      busy.value = true;
      error.value = "";
      try {
        return await action();
      } catch (failure) {
        if (!handleError(failure)) error.value = failure.message;
        return null;
      } finally {
        busy.value = false;
      }
    }

    const start = () =>
      run(async () => {
        const result = await api.mockStart({ recordId: job.value.recordId });
        session.history = result.history;
        session.mock = Boolean(result.mock);
      });

    const send = () =>
      run(async () => {
        const message = input.value.trim();
        if (!message) return;
        input.value = "";
        const result = await api.mockChat({ history: session.history, message });
        session.history = result.history;
      });

    const end = () =>
      run(async () => {
        const result = await api.mockEnd({ history: session.history });
        session.summary = result.summary;
        session.followups = (result.followups || []).map((item) => ({
          title: item.experience_title || "",
          question: item.question || "",
          answerDirection: item.answer_direction || "",
          chosen: item.recordId || matchExperience(item.experience_title),
          written: false,
        }));
        session.endedAt = Date.now();
      });

    function toggleMark(index) {
      if (session.marks[index] === undefined) session.marks[index] = "";
      else delete session.marks[index];
    }

    async function writeFollowup(item) {
      try {
        const record = await api.addInterviewQuestion(item.chosen, {
          question: item.question || item.note,
          answerDirection: item.answerDirection,
          source: `Mock 面试 ${job.value.company}`,
        });
        mergeExperience(record);
        item.written = true;
        toast("已写入追问记录");
      } catch (failure) {
        if (!handleError(failure)) error.value = failure.message;
      }
    }

    async function exportMd() {
      const result = await run(() => api.mockExport({ history: session.history }));
      if (!result) return;
      const marks = bubbles.value
        .filter((bubble) => session.marks[bubble.index] !== undefined)
        .map((bubble) => {
          const note = session.marks[bubble.index];
          return `- ${bubble.content}${note ? `\n  → ${note}` : ""}`;
        });
      const extra =
        (marks.length ? `\n## 标记的问题\n${marks.join("\n")}\n` : "") +
        (session.summary ? `\n## 复盘摘要\n${session.summary}\n` : "");
      const day = new Date().toISOString().slice(0, 10);
      download(`mock-${job.value.company}-${day}.md`, result.markdown + extra);
    }

    async function reset() {
      const ok = await confirmDialog({
        title: "清空这次 Mock 记录？",
        body: "对话、标记和复盘摘要都会从浏览器里删掉。已经写进追问记录的面试问题不受影响。",
        danger: true,
      });
      if (ok) clear();
    }

    return {
      state, job, jobReady, busy, error, input, session, started, ended, bubbles, markedCount,
      start, send, end, toggleMark, writeFollowup, exportMd, reset,
      copySummary: () => copyText(session.summary),
    };
  },
  template: `
    <PageJobPicker />
    <NeedJob v-if="!jobReady" what="Mock 面试" :job="job" />
    <div v-else class="page">
      <h2 class="ptitle">Mock 面试 · {{ job.company }} {{ job.position }}</h2>

      <div v-if="!started" class="empty">
        <p class="etitle">还没开始</p>
        <p class="muted">AI 扮演面试官，按这个岗位的 JD 和你的简历提问。答得不好的问题随时点气泡上的
          「标记」，结束后一起复盘，并给出该补哪条经历的建议。对话存在浏览器里，刷新不丢。</p>
        <button class="primary" :disabled="busy || state.offline || !job.jd" @click="start">
          {{ busy ? '准备中…' : '开始面试' }}
        </button>
        <p v-if="!job.jd" class="muted">这个岗位还没填 JD，先去<a href="#/job/info">岗位信息</a>补上。</p>
        <p v-if="error" class="bad">{{ error }}</p>
      </div>

      <template v-else>
        <div class="strip">
          <span v-if="session.mock" class="pill warn">MOCK 占位内容</span>
          <span class="muted">{{ bubbles.length }} 条消息 · 标记 {{ markedCount }} 处</span>
          <span class="grow"></span>
          <button class="ghost" :disabled="busy || state.offline || ended" @click="end">
            {{ ended ? '已复盘' : '结束并复盘' }}
          </button>
          <button class="ghost" :disabled="busy" @click="exportMd">导出 markdown</button>
          <button class="ghost" @click="reset">清空</button>
        </div>

        <div class="chat">
          <div v-for="bubble in bubbles" :key="bubble.index" class="bubble"
            :class="[bubble.role, { marked: session.marks[bubble.index] !== undefined }]">
            <div class="bhead">
              <span class="who">{{ bubble.role === 'assistant' ? '面试官' : '我' }}</span>
              <span class="grow"></span>
              <button v-if="bubble.role === 'assistant'" class="link" @click="toggleMark(bubble.index)">
                {{ session.marks[bubble.index] !== undefined ? '取消标记' : '标记' }}
              </button>
            </div>
            <p class="btext">{{ bubble.content }}</p>
            <input v-if="session.marks[bubble.index] !== undefined" class="marknote"
              v-model="session.marks[bubble.index]"
              placeholder="为什么标它：答得空、没有例子、要回去补 STAR……">
          </div>
        </div>

        <p v-if="error" class="notice bad">{{ error }}</p>

        <div v-if="!ended" class="sendrow">
          <textarea rows="3" v-model="input" :disabled="busy || state.offline"
            placeholder="回答面试官。⌘/Ctrl + Enter 发送。"
            @keydown.enter.meta="send" @keydown.enter.ctrl="send"></textarea>
          <button class="primary" :disabled="busy || state.offline || !input.trim()" @click="send">
            {{ busy ? '等面试官…' : '发送' }}
          </button>
        </div>

        <section v-if="ended" class="review">
          <h3>复盘摘要 <button class="link" @click="copySummary">复制</button></h3>
          <pre class="jd">{{ session.summary || '（没生成摘要）' }}</pre>

          <h3>追问建议</h3>
          <p v-if="!session.followups.length" class="muted">这次没有产生追问建议。</p>
          <article v-for="(item, i) in session.followups" :key="i" class="fu">
            <p class="futext"><strong>Q：</strong>{{ item.question || item.note }}</p>
            <p class="muted"><strong>回答方向：</strong>{{ item.answerDirection || '待补充' }}</p>
            <div class="furow">
              <span class="flabel">写进哪条经历</span>
              <select v-model="item.chosen" :disabled="state.offline || item.written">
                <option value="">（不写入）</option>
                <option v-for="exp in state.experiences" :key="exp.recordId" :value="exp.recordId">
                  {{ exp.title }}
                </option>
              </select>
              <button class="primary" :disabled="state.offline || !item.chosen || item.written"
                @click="writeFollowup(item)">{{ item.written ? '已写入' : '写入追问记录' }}</button>
              <span v-if="item.title && !item.chosen" class="muted">
                AI 说的是「{{ item.title }}」，经历库里没对上，自己选一条。
              </span>
            </div>
          </article>
        </section>
      </template>
    </div>`,
};
