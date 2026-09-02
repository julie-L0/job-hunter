// 真实面试复盘（F10）。流程：轮次/时间 → 转写来源（录音或粘贴）→ 校对整篇转写文档 →
// 我的补充 → AI 点评 → 保存（建飞书文档 + 建 review 记录）。
//
// 三个关键约束体现在这里：
// 1. 上传入口常驻；只有 state.health.transcribeEnabled 为真时才可选文件（线上恒 false，跑不了 Python）。
// 2. 转写结果就是一整篇带时间戳和角色前缀的纯文本，不做逐段输入框。半小时面试有上百段，
//    一句一个框既读不成篇也改不动；用户真正要改的是少数几个角色前缀，在文本里直接改最快。
// 3. 「保存到飞书」这一次点击就是 PRD 原则 4 要求的写回确认，之前所有内容都只在浏览器草稿里。
import { api } from "../api.js";
import { currentJobRef, handleError, jobReady, state, toast } from "../store.js";
import { confirmDialog, useDraft, NeedJob } from "../ui.js";

const { computed, ref, onUnmounted } = window.Vue;

const ROUNDS = ["笔试", "一面", "二面", "三面", "HR面", "其他"];
const POLL_MS = 2000;
const MB = 1024 * 1024;

// 和 src/storage/schema.js 的 REVIEW_ROLES 一致。「其他面试者」给群面/多人面试用，
// 规则预标猜不出第三个人，只能由用户在文档里手写。
const ROLE_NAMES = ["面试官", "其他面试者", "我"];
const ROLE_GROUP = ROLE_NAMES.join("|");
// 三个角色名互不为前缀，交替顺序不影响匹配结果
const TIMED_LINE = new RegExp(`^\\[?(\\d{1,2}):(\\d{2})(?::(\\d{2}))?\\]?\\s*(?:(${ROLE_GROUP})\\s*[:：])?\\s*(.*)$`);
const ROLE_LINE = new RegExp(`^(${ROLE_GROUP})\\s*[:：]\\s*(.*)$`);

function roleOf(segment) {
  return ROLE_NAMES.includes(segment?.role) ? segment.role : "";
}

function appendText(left, right) {
  const a = String(left || "").trim();
  const b = String(right || "").trim();
  if (!a) return b;
  if (!b) return a;
  return `${a}${/[A-Za-z0-9]$/.test(a) && /^[A-Za-z0-9]/.test(b) ? " " : ""}${b}`;
}

function todayLocal() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function timestamp(sec) {
  const total = Math.max(0, Math.floor(Number(sec) || 0));
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

/**
 * 分段 → 一整篇文档文本。这是编辑面的唯一形态，用户改完再由 parsePastedTranscript 解析回来。
 * 没有角色的段不写前缀，解析回来仍是空角色，交给后端规则补。
 */
export function segmentsToDoc(segments) {
  const turns = [];
  for (const segment of Array.isArray(segments) ? segments : []) {
    const text = String(segment?.text ?? "").trim();
    if (!text) continue;
    const role = roleOf(segment);
    const start = Number(segment?.start) || 0;
    const end = Number(segment?.end) || start;
    const previous = turns[turns.length - 1];
    if (previous && previous.role === role && start - previous.end <= 12) {
      previous.text = appendText(previous.text, text);
      previous.end = Math.max(previous.end, end);
    } else {
      turns.push({ start, end, role, text });
    }
  }

  return turns
    .map((turn) => {
      const role = turn.role ? `${turn.role}：` : "";
      return `[${timestamp(turn.start)}] ${role}${turn.text}`;
    })
    .join("\n");
}

/**
 * 文档文本切回分段。支持 `[00:03:12] 面试官：内容`（segmentsToDoc 的输出，也是别处导出的
 * 常见格式），也支持纯文本一行一段。没有时间戳就按行序估一个，只为让顺序稳定。
 *
 * end 一律给成 start + 5 而不是下一段的 start：后端 normalizeSegments 会把不足 1.5 秒的段
 * 并进上一段，而这里的分行已经是用户确认过的，再被合并会连角色一起丢掉。
 */
export function parsePastedTranscript(text) {
  const lines = String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line, index) => {
    const match = line.match(TIMED_LINE);
    if (match && match[5]) {
      const [, a, b, c, role, body] = match;
      const start = c ? Number(a) * 3600 + Number(b) * 60 + Number(c) : Number(a) * 60 + Number(b);
      return { start, end: start + 5, text: body, role: role || "" };
    }
    const roleMatch = line.match(ROLE_LINE);
    return {
      start: index * 10,
      end: index * 10 + 9,
      text: roleMatch ? roleMatch[2] : line,
      role: roleMatch ? roleMatch[1] : "",
    };
  }).filter((segment) => segment.text);
}

export const RealReview = {
  components: { NeedJob },
  setup() {
    const job = currentJobRef;
    const busy = ref(false);
    const error = ref("");
    const reviews = ref([]);
    const loadingList = ref(false);
    const uploading = ref(false);
    const transcribing = ref(false);
    const progress = ref(0);
    const pasteText = ref("");
    let timer = null;

    const scope = computed(() => state.currentJobId);
    const { data: draft, clear } = useDraft("review", scope, {
      round: "一面",
      day: todayLocal(),
      source: "",
      audioName: "",
      durationSec: 0,
      transcript: "",
      truncated: false,
      myNote: "",
      comment: null,
      mock: false,
      savedDocUrl: "",
      savedRecordId: "",
    });

    const canTranscribe = computed(() => Boolean(state.health.transcribeEnabled));
    const uploadLimitMb = computed(() => Number(state.health.asrMaxUploadMb) || 1024);
    const hasTranscript = computed(() => draft.transcript.trim().length > 0);
    const saved = computed(() => Boolean(draft.savedRecordId || draft.savedDocUrl));
    // 行数/字数按真正会提交的分段算，而不是文本框里的原始字符，否则时间戳和前缀也会被计进字数
    const docStats = computed(() => {
      const segments = parsePastedTranscript(draft.transcript);
      return {
        lines: segments.length,
        chars: segments.reduce((sum, item) => sum + item.text.length, 0),
      };
    });

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

    async function loadReviews() {
      if (!state.currentJobId) return;
      loadingList.value = true;
      try {
        reviews.value = await api.reviews(state.currentJobId);
      } catch (failure) {
        if (!handleError(failure)) error.value = failure.message;
      } finally {
        loadingList.value = false;
      }
    }
    loadReviews();

    function stopPolling() {
      if (timer) clearInterval(timer);
      timer = null;
      transcribing.value = false;
    }
    onUnmounted(stopPolling);

    function poll(jobId) {
      transcribing.value = true;
      timer = setInterval(async () => {
        try {
          const result = await api.transcribeStatus(jobId);
          progress.value = result.progress || 0;
          if (result.status === "failed") {
            stopPolling();
            error.value = result.error || "转写失败";
            return;
          }
          if (result.status !== "done") return;
          stopPolling();
          const segments = result.segments || [];
          draft.transcript = segmentsToDoc(segments);
          draft.truncated = Boolean(result.truncated);
          draft.durationSec = result.durationSec || 0;
          draft.source = "本地转写";
          toast(`转写完成，${segments.length} 段`);
        } catch (failure) {
          stopPolling();
          if (!handleError(failure)) error.value = failure.message;
        }
      }, POLL_MS);
    }

    async function pickAudio(event) {
      const file = event.target.files?.[0];
      event.target.value = ""; // 允许重选同一个文件
      if (!file) return;
      if (file.size > uploadLimitMb.value * MB) {
        error.value = `文件 ${Math.ceil(file.size / MB)}MB，超过本地上传上限 ${uploadLimitMb.value}MB。可以调大 ASR_MAX_UPLOAD_MB 后重启服务。`;
        return;
      }
      uploading.value = true;
      error.value = "";
      progress.value = 0;
      try {
        const { jobId } = await api.uploadReviewAudio(file);
        draft.audioName = file.name;
        poll(jobId);
      } catch (failure) {
        if (!handleError(failure)) error.value = failure.message;
      } finally {
        uploading.value = false;
      }
    }

    function usePaste() {
      const text = pasteText.value.trim();
      if (!parsePastedTranscript(text).length) {
        error.value = "没解析出任何内容";
        return;
      }
      draft.transcript = text;
      draft.source = "粘贴文本";
      draft.audioName = "";
      draft.durationSec = 0;
      draft.truncated = false;
      pasteText.value = "";
      error.value = "";
    }

    async function pickTxt(event) {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      pasteText.value = await file.text();
      usePaste();
    }

    function changeTranscript() {
      stopPolling();
      draft.source = "";
      draft.audioName = "";
      draft.durationSec = 0;
      draft.transcript = "";
      draft.truncated = false;
      draft.comment = null;
      draft.mock = false;
      error.value = "";
    }

    const payloadBase = () => ({
      jobRecordId: state.currentJobId,
      round: draft.round,
      source: draft.source,
      // 文本才是真源，每次提交现解析；没写角色前缀的行会在后端被规则补上
      segments: parsePastedTranscript(draft.transcript),
      myNote: draft.myNote,
    });

    const generateComment = () =>
      run(async () => {
        const result = await api.reviewComment(payloadBase());
        draft.comment = result.comment;
        draft.mock = Boolean(result.mock);
      });

    const save = () =>
      run(async () => {
        const result = await api.createReview({
          ...payloadBase(),
          interviewedAt: draft.day ? Date.parse(`${draft.day}T09:00:00`) : Date.now(),
          audioName: draft.audioName,
          durationSec: draft.durationSec,
          comment: draft.comment,
        });
        draft.savedDocUrl = result.docUrl || "";
        draft.savedRecordId = result.review?.recordId || "";
        if (result.writeBackError) {
          // 文档已经建好了，只是表没写上。绝不能让用户以为内容丢了
          error.value = `文档已建好，但复盘表没写上：${result.writeBackError}`;
        } else {
          toast("已保存到飞书");
        }
        if (result.truncated) toast("内容过长已截断，文档里只有前 6 万字");
        await loadReviews();
      });

    const appendTo = (review) =>
      run(async () => {
        if (!draft.myNote.trim() && !draft.comment) {
          error.value = "先写点补充或生成点评，再追加";
          return;
        }
        await api.appendReview(review.recordId, { myNote: draft.myNote, comment: draft.comment });
        toast("已追加到复盘文档");
        await loadReviews();
      });

    async function reset() {
      const ok = await confirmDialog({
        title: "清空这次复盘草稿？",
        body: "转写文档、补充和点评都会从浏览器里删掉。已经保存到飞书的复盘不受影响。",
        danger: true,
      });
      if (ok) {
        stopPolling();
        clear();
        pasteText.value = "";
        error.value = "";
      }
    }

    return {
      state, job, jobReady, busy, error, draft, reviews, loadingList, uploading, transcribing,
      progress, pasteText, canTranscribe, uploadLimitMb, hasTranscript, saved, docStats, ROUNDS, ROLE_NAMES,
      timestamp, dayStr: (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : "—"),
      progressText: computed(() => `${Math.round(progress.value * 100)}%`),
      pickAudio, usePaste, pickTxt, changeTranscript, generateComment, save, appendTo, reset,
      loadReviews,
    };
  },
  template: `
    <NeedJob v-if="!jobReady" what="真实面试复盘" :job="job" />
    <div v-else class="page">
      <div class="strip">
        <span class="muted">面试结束后把录音或转写文本放进来，生成结构化点评，保存成一份飞书文档。</span>
        <span class="grow"></span>
        <button class="ghost" @click="reset">清空草稿</button>
      </div>

      <div class="fields">
        <div class="field">
          <div class="fhead"><span class="flabel">面试轮次</span></div>
          <select v-model="draft.round">
            <option v-for="r in ROUNDS" :key="r" :value="r">{{ r }}</option>
          </select>
        </div>
        <div class="field">
          <div class="fhead"><span class="flabel">面试时间</span></div>
          <input type="date" v-model="draft.day">
        </div>
      </div>

      <section v-if="!hasTranscript" class="review-source">
        <div class="qcard" :class="{ off: !canTranscribe }">
          <p class="dtitle">导入音频 / MP4（本地转写）</p>
          <p class="muted">支持音频和 MP4 视频，文件会先流式写入本机临时目录，本地上限 {{ uploadLimitMb }}MB，转写完成或失败后立即删除。一小时文件可能需要几分钟，期间别关页面。</p>
          <label class="ghost filepick">
            <input type="file" accept="audio/*,video/mp4,.mp4,.m4a,.mp3,.wav,.aac,.flac,.ogg"
              :disabled="!canTranscribe || uploading || transcribing || state.offline" @change="pickAudio">
            {{ uploading ? '上传中…' : (transcribing ? '转写中…' : '选择音频 / MP4 文件') }}
          </label>
          <p v-if="!canTranscribe" class="muted">当前环境未启用本地 ASR，配置 ASR_PYTHON / ASR_SCRIPT / ASR_MODEL_DIR 后重启即可上传转写。</p>
          <div v-if="transcribing" class="review-progress">
            <div class="review-progress-bar"><span :style="{ width: progressText }"></span></div>
            <span class="muted">{{ draft.audioName }} · {{ progressText }}</span>
          </div>
        </div>

        <div class="qcard">
          <p class="dtitle">粘贴转写文本</p>
          <p class="muted">一行一段。带 <code>[00:03:12] 面试官：</code> 前缀的会自动识别时间和角色。</p>
          <textarea rows="6" v-model="pasteText" :disabled="state.offline"
            placeholder="[00:00:12] 面试官：先自我介绍一下&#10;[00:00:20] 我：我是……"></textarea>
          <div class="drow">
            <button class="primary" :disabled="!pasteText.trim()" @click="usePaste">用这段文本</button>
            <label class="ghost filepick">
              <input type="file" accept=".txt,.md,text/plain" @change="pickTxt">
              上传 txt
            </label>
          </div>
        </div>
      </section>

      <template v-else>
        <div class="strip">
          <span class="pill">{{ draft.source }}</span>
          <span class="muted">{{ docStats.lines }} 行 · {{ docStats.chars }} 字<template v-if="draft.durationSec"> · 时长 {{ timestamp(draft.durationSec) }}</template></span>
          <span v-if="draft.truncated" class="pill warn">内容过长已截断</span>
          <span class="grow"></span>
          <button class="ghost" @click="changeTranscript">换一份转写</button>
        </div>
        <p class="muted">直接校对整篇文档即可。每行可写成 <code>[00:03:12] 面试官：内容</code>，角色支持 <span v-for="role in ROLE_NAMES" :key="role" class="pill">{{ role }}</span>；没写角色的行保存时会按规则补成「面试官」或「我」。</p>

        <textarea class="review-doc" rows="22" v-model="draft.transcript" :disabled="state.offline" spellcheck="false"
          placeholder="[00:00:12] 面试官：先自我介绍一下&#10;[00:00:20] 我：我是……&#10;[00:08:10] 其他面试者：我补充一个问题……"></textarea>

        <h3 class="review-h">我的补充</h3>
        <textarea rows="4" v-model="draft.myNote" :disabled="state.offline"
          placeholder="录音听不出来的东西：面试官的表情、我当时慌在哪、事后想到的更好答案……"></textarea>

        <div class="strip">
          <button class="primary" :disabled="busy || state.offline" @click="generateComment">
            {{ busy ? '生成中…' : (draft.comment ? '重新生成点评' : '生成 AI 点评') }}
          </button>
          <span v-if="draft.mock" class="pill warn">MOCK 占位内容</span>
        </div>

        <p v-if="error" class="notice bad">{{ error }}</p>

        <section v-if="draft.comment" class="review">
          <h3>亮点</h3>
          <ul class="review-list"><li v-for="(item, i) in draft.comment.highlights" :key="i">{{ item }}</li></ul>
          <p v-if="!draft.comment.highlights?.length" class="muted">没写亮点。</p>

          <h3>问题</h3>
          <article v-for="(item, i) in draft.comment.problems || []" :key="i" class="fu">
            <p class="futext"><strong>{{ item.point }}</strong></p>
            <p class="muted">原话：{{ item.evidence }}</p>
            <p class="muted">怎么改：{{ item.fix }}</p>
          </article>

          <h3>更好的回答</h3>
          <article v-for="(item, i) in draft.comment.answerRewrites || []" :key="i" class="fu">
            <p class="futext"><strong>Q：</strong>{{ item.question }}</p>
            <p class="muted">{{ item.betterAnswer }}</p>
          </article>

          <h3>下一步</h3>
          <ul class="review-list"><li v-for="(item, i) in draft.comment.nextActions || []" :key="i">{{ item }}</li></ul>

          <p v-if="draft.comment.takeaway" class="notice">{{ draft.comment.takeaway }}</p>
        </section>

        <div class="strip">
          <button class="primary" :disabled="busy || state.offline || saved" @click="save">
            {{ saved ? '已保存' : (busy ? '保存中…' : '保存到飞书') }}
          </button>
          <a v-if="draft.savedDocUrl" :href="draft.savedDocUrl" target="_blank" rel="noopener">打开复盘文档</a>
          <span v-else class="muted">保存时会新建一份飞书文档写正文，并在复盘表里记一条。</span>
        </div>
      </template>

      <section class="review">
        <h3>这个岗位已有的复盘
          <button class="link" :disabled="loadingList" @click="loadReviews">{{ loadingList ? '加载中…' : '刷新' }}</button>
        </h3>
        <p v-if="!reviews.length" class="muted">还没有。</p>
        <article v-for="item in reviews" :key="item.recordId" class="fu">
          <p class="futext">
            <strong>{{ item.round || '未填轮次' }}</strong>
            <span class="muted"> · {{ dayStr(item.interviewedAt) }} · {{ item.source || '—' }}</span>
            <span class="pill" :class="item.commentStatus === '已点评' ? 'ok' : ''">{{ item.commentStatus }}</span>
          </p>
          <p v-if="item.takeaway" class="muted">{{ item.takeaway }}</p>
          <div class="furow">
            <a v-if="item.docUrl" :href="item.docUrl" target="_blank" rel="noopener">打开文档</a>
            <span v-else class="muted">这条没有文档</span>
            <button class="ghost" :disabled="busy || state.offline || !item.docUrl" @click="appendTo(item)">
              把当前补充/点评追加进去
            </button>
          </div>
        </article>
      </section>
    </div>`,
};
