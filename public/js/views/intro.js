// 自我介绍（F6）。四个版本各对应主表一个字段。
// AI 只出草稿，写回结构化字段必须点「写回」（PRD 原则 4）。草稿落 localStorage，刷新不丢。
import { api } from "../api.js";
import { currentJobRef, handleError, mergeJob, state, toast } from "../store.js";
import { DraftBox, FieldRow, NeedJob, useDraft } from "../ui.js";

const { computed, ref } = window.Vue;

const VARIANTS = [
  { key: "1min", label: "1 分钟", field: "intro1min" },
  { key: "3min", label: "3 分钟", field: "intro3min" },
  { key: "5min", label: "5 分钟", field: "intro5min" },
  { key: "en", label: "英文", field: "introEn" },
];

export const Intro = {
  components: { DraftBox, FieldRow, NeedJob },
  setup() {
    const job = currentJobRef;
    const active = ref("1min");
    const busy = ref(false);
    const error = ref("");

    const scope = computed(() => `${state.currentJobId}.${active.value}`);
    const { data: drafted, clear } = useDraft("intro", scope, { text: "", mock: false });

    const variant = computed(() => VARIANTS.find((item) => item.key === active.value));
    const saved = computed(() => job.value?.[variant.value.field] || "");

    async function generate() {
      if (busy.value) return;
      busy.value = true;
      error.value = "";
      try {
        const result = await api.intro({ recordId: job.value.recordId, variant: active.value });
        drafted.text = result.draft;
        drafted.mock = Boolean(result.mock);
      } catch (failure) {
        if (!handleError(failure)) error.value = failure.message;
      } finally {
        busy.value = false;
      }
    }

    async function writeBack() {
      try {
        const result = await api.patchJob(job.value.recordId, {
          [variant.value.field]: drafted.text,
        });
        mergeJob(result.job);
        clear();
        toast(`已写回「自我介绍-${variant.value.label}」`);
      } catch (failure) {
        if (!handleError(failure)) error.value = failure.message;
      }
    }

    return {
      state,
      job,
      active,
      busy,
      error,
      VARIANTS,
      variant,
      saved,
      drafted,
      generate,
      writeBack,
      clear,
      saveExisting: (value) =>
        api.patchJob(job.value.recordId, { [variant.value.field]: value }).then((result) => {
          mergeJob(result.job);
        }),
      done: (item) => Boolean(job.value?.[item.field]),
    };
  },
  template: `
    <NeedJob v-if="!job" what="自我介绍" />
    <div v-else class="page">
      <h2 class="ptitle">自我介绍 · {{ job.company }} {{ job.position }}</h2>
      <p class="muted">按 JD 和当前简历生成。已存过的版本标 ✓，重新生成不会直接覆盖，要点「写回」。</p>

      <nav class="tabs">
        <button v-for="item in VARIANTS" :key="item.key" :class="{ on: active === item.key }"
          @click="active = item.key">
          {{ item.label }}<span v-if="done(item)" class="tick">✓</span>
        </button>
      </nav>

      <div class="strip">
        <button class="primary" :disabled="busy || state.offline || !job.jd" @click="generate">
          {{ busy ? '生成中…' : (saved ? '重新生成' : '生成' + variant.label + '版') }}
        </button>
        <span v-if="!job.jd" class="muted">这个岗位还没填 JD，先去<a href="#/job/info">岗位信息</a>补上。</span>
        <span v-if="!job.resumeId" class="muted">没指定简历编号，AI 只能靠 JD 写，建议先选一版简历。</span>
      </div>

      <p v-if="error" class="notice bad">{{ error }}</p>

      <DraftBox v-if="drafted.text" v-model="drafted.text" :mock="drafted.mock"
        :title="'草稿 · ' + variant.label" :rows="14">
        <button class="primary" :disabled="state.offline" @click="writeBack">
          写回「自我介绍-{{ variant.label }}」
        </button>
        <button class="ghost" @click="clear">丢弃草稿</button>
      </DraftBox>

      <div class="fields">
        <FieldRow :label="'已保存的' + variant.label + '版'" type="textarea" :rows="10" wide
          :value="saved" :disabled="state.offline" :save="saveExisting"
          placeholder="还没有内容。生成草稿后点写回，或者直接在这里手写。" />
      </div>
    </div>`,
};

