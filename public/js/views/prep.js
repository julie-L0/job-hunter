// 面试准备（F7）。材料区独立于「追加到准备文档」的结果显示：
// 追加写文档失败不该把已经花过钱生成出来的材料一起丢掉。
import { api } from "../api.js";
import { currentJobRef, handleError, jobReady, state } from "../store.js";
import { DraftBox, NeedJob, useDraft } from "../ui.js";

const { computed, ref } = window.Vue;

export const Prep = {
  components: { DraftBox, NeedJob },
  setup() {
    const job = currentJobRef;
    const busy = ref(false);
    const error = ref("");
    const append = ref(true);

    const scope = computed(() => state.currentJobId);
    const { data: drafted, clear } = useDraft("prep", scope, {
      text: "",
      mock: false,
      appendNote: "",
      appendFailed: false,
    });

    const canAppend = computed(() => Boolean(job.value?.prepDocUrl));

    async function generate() {
      if (busy.value) return;
      busy.value = true;
      error.value = "";
      try {
        const wantAppend = append.value && canAppend.value;
        const result = await api.interviewPrep({
          recordId: job.value.recordId,
          appendToDoc: wantAppend,
        });
        drafted.text = result.material;
        drafted.mock = Boolean(result.mock);
        if (!result.appended) {
          drafted.appendNote = wantAppend ? "" : "没有追加到文档";
          drafted.appendFailed = false;
        } else if (result.appended.error) {
          drafted.appendNote = `追加到准备文档失败：${result.appended.error}。材料还在下面，自己复制一份。`;
          drafted.appendFailed = true;
        } else {
          drafted.appendNote = "已追加到准备文档";
          drafted.appendFailed = false;
        }
      } catch (failure) {
        if (!handleError(failure)) error.value = failure.message;
      } finally {
        busy.value = false;
      }
    }

    return { state, job, jobReady, busy, error, append, canAppend, drafted, generate, clear };
  },
  template: `
    <NeedJob v-if="!jobReady" what="面试准备" :job="job" />
    <div v-else class="page">
      <h2 class="ptitle">面试准备 · {{ job.company }} {{ job.position }}</h2>
      <p class="muted">按 JD 和当前简历生成：可能被问的问题、要准备的例子、反问清单。不写回主表，只可选追加到准备文档。</p>

      <div class="strip">
        <button class="primary" :disabled="busy || state.offline || !job.jd" @click="generate">
          {{ busy ? '生成中…' : (drafted.text ? '重新生成' : '生成准备材料') }}
        </button>
        <label class="check" :class="{ off: !canAppend }">
          <input type="checkbox" v-model="append" :disabled="!canAppend">
          同时追加到准备文档
        </label>
        <span v-if="!canAppend" class="muted">
          还没建准备文档，先去<a href="#/job/info">岗位信息</a>建一个。
        </span>
        <span v-if="!job.jd" class="muted">这个岗位还没填 JD，AI 没东西可依据。</span>
      </div>

      <p v-if="error" class="notice bad">{{ error }}</p>
      <p v-if="drafted.appendNote" class="notice" :class="{ bad: drafted.appendFailed }">
        {{ drafted.appendNote }}
        <a v-if="!drafted.appendFailed && job.prepDocUrl" :href="job.prepDocUrl" target="_blank"
          rel="noreferrer">打开文档</a>
      </p>

      <DraftBox v-if="drafted.text" v-model="drafted.text" :mock="drafted.mock"
        title="准备材料" :rows="24">
        <button class="ghost" @click="clear">清空</button>
        <span class="muted">改动只留在浏览器里，不写回飞书主表。</span>
      </DraftBox>
    </div>`,
};
