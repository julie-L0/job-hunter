import { api } from "../api.js";
import { comparisonStages, handleError, state, statuses, toast } from "../store.js";
import { useDraft } from "../ui.js";

const { computed, reactive, ref } = window.Vue;

const MIN_JOBS = 2;
const MAX_JOBS = 20;
const MAX_CRITERION = 500;
const MAX_ORIENTATION = 1200;
const FALLBACK_STAGES = ["练手", "均衡", "冲刺", "兜底"];
const STAGE_TIPS = {
  练手: "优先找能带来面试训练的岗位，看能否练项目表达、JD 拆解、业务理解，失败成本是否低。",
  均衡: "同时看岗位本身价值和练手机会，适合不确定下一批投递重点时使用。",
  冲刺: "优先真正想去、长期方向匹配、值得认真准备的岗位。",
  兜底: "优先找更容易推进、门槛更友好、准备成本更低的岗位；不等于随便投。",
};
const STAGE_WEIGHTS = {
  练手: { career: 30, practice: 55, fallback: 15 },
  均衡: { career: 40, practice: 40, fallback: 20 },
  冲刺: { career: 70, practice: 20, fallback: 10 },
  兜底: { career: 20, practice: 25, fallback: 55 },
};
const DIMENSION_TIPS = {
  求职价值: "岗位本身是否值得认真投入，综合长期方向、个人偏好、公司/业务吸引力和简历匹配度。",
  练手价值: "这个岗位的面试是否能训练后续真正需要的能力，以及失败机会成本是否低。",
  兜底价值: "JD 门槛是否友好、简历证据是否直接、准备成本是否低、是否更可能推进到笔试/面试。",
  冲突提示: "简历契合、个人意愿、公司文化、当前阶段之间不一致的地方。",
};
const TECHNICAL_LEVELS = {
  none: "无相关要求",
  preferred: "优先项",
  required: "必需要求",
};
const STRENGTH_LABELS = {
  strong: "强证据",
  medium: "中等证据",
  weak: "弱证据",
};
const CHECK_STATUS_LABELS = {
  fit: "符合",
  partial: "部分符合",
  gap: "缺口",
  unclear: "信息不足",
};
const BACKGROUND_FIT_LABELS = {
  none: "无专业要求",
  match: "专业匹配",
  adjacent: "相邻背景",
  mismatch: "背景不符",
  unclear: "信息不足",
};

function blankPreference() {
  return {
    recordId: null,
    stage: "练手",
    careerWeight: 30,
    practiceWeight: 55,
    fallbackWeight: 15,
    valueOrientation: "",
    updatedAt: null,
  };
}

function fingerprint(recordIds, criterion, preference) {
  return JSON.stringify([
    6,
    recordIds,
    criterion.trim(),
    preference.stage,
    preference.careerWeight,
    preference.practiceWeight,
    preference.fallbackWeight,
    preference.valueOrientation.trim(),
  ]);
}

function hasDetailedResult(result) {
  return Array.isArray(result?.jobs)
    && result.jobs.every((job) => Number.isInteger(job.careerValueScore)
      && Number.isInteger(job.practiceValueScore)
      && Number.isInteger(job.fallbackValueScore)
      && job.quickTake
      && Array.isArray(job.scoreBreakdown || job.scoreRationale));
}

export const JobComparison = {
  setup() {
    const search = ref("");
    const statusFilter = ref("全部");
    const busy = ref(false);
    const error = ref("");
    const preferenceBusy = ref(false);
    const preferenceSaving = ref(false);
    const preferenceError = ref("");
    const preference = reactive(blankPreference());
    const preferenceDraft = reactive({ stage: "练手", valueOrientation: "" });
    const scope = computed(() => "main");
    const { data: session } = useDraft("job-comparison", scope, {
      selectedIds: [],
      criterion: "",
      result: null,
      resultFingerprint: "",
    });

    if (session.result && !hasDetailedResult(session.result)) {
      session.result = null;
      session.resultFingerprint = "";
    }

    function applyPreference(next) {
      Object.assign(preference, blankPreference(), next || {});
      preferenceDraft.stage = preference.stage;
      preferenceDraft.valueOrientation = preference.valueOrientation || "";
    }

    async function loadPreference() {
      preferenceBusy.value = true;
      preferenceError.value = "";
      try {
        applyPreference(await api.comparisonPreference());
      } catch (failure) {
        if (!handleError(failure)) preferenceError.value = failure.message;
      } finally {
        preferenceBusy.value = false;
      }
    }
    loadPreference();

    const stageOptions = computed(() => comparisonStages.value.length ? comparisonStages.value : FALLBACK_STAGES);
    const preferenceDirty = computed(() =>
      preferenceDraft.stage !== preference.stage
      || preferenceDraft.valueOrientation.trim() !== String(preference.valueOrientation || "").trim(),
    );
    const activePreference = computed(() => ({
      ...preference,
      stage: preferenceDraft.stage,
      valueOrientation: preferenceDraft.valueOrientation,
    }));
    const weightLabel = computed(() => {
      const weights = STAGE_WEIGHTS[preferenceDraft.stage] || {
        career: preference.careerWeight,
        practice: preference.practiceWeight,
        fallback: preference.fallbackWeight,
      };
      return `求职 ${weights.career}% · 练手 ${weights.practice}% · 兜底 ${weights.fallback}%`;
    });

    const jobsById = computed(() => new Map(state.jobs.map((job) => [job.recordId, job])));
    const selectedJobs = computed(() => session.selectedIds
      .map((recordId) => jobsById.value.get(recordId))
      .filter(Boolean));
    const groups = computed(() => {
      const query = search.value.trim().toLocaleLowerCase();
      const grouped = new Map();
      for (const job of state.jobs) {
        if (statusFilter.value !== "全部" && job.status !== statusFilter.value) continue;
        const haystack = `${job.company || ""} ${job.position || ""}`.toLocaleLowerCase();
        if (query && !haystack.includes(query)) continue;
        const key = job.companyId;
        if (!grouped.has(key)) grouped.set(key, { companyId: key, name: job.company, jobs: [] });
        grouped.get(key).jobs.push(job);
      }
      return [...grouped.values()]
        .map((group) => ({
          ...group,
          jobs: group.jobs.sort((a, b) => String(a.position).localeCompare(String(b.position), "zh-CN")),
        }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name), "zh-CN"));
    });
    const currentFingerprint = computed(() => fingerprint(
      selectedJobs.value.map((job) => job.recordId),
      session.criterion,
      preference,
    ));
    const stale = computed(() => Boolean(
      session.result && session.resultFingerprint !== currentFingerprint.value,
    ));
    const selectionHint = computed(() => {
      const count = selectedJobs.value.length;
      if (count < MIN_JOBS) return `至少再选 ${MIN_JOBS - count} 个岗位`;
      if (count > MAX_JOBS) return `已超过单次上限 ${MAX_JOBS} 个，请取消 ${count - MAX_JOBS} 个`;
      return `已选 ${count} 个，可以开始比较`;
    });
    const compareBlockReason = computed(() => {
      const count = selectedJobs.value.length;
      if (state.offline) return "离线状态不能发起 AI 比较";
      if (busy.value) return "正在比较中";
      if (preferenceBusy.value) return "正在读取比较偏好";
      if (preferenceSaving.value) return "正在保存比较偏好";
      if (count < MIN_JOBS) return `至少选择 ${MIN_JOBS} 个岗位`;
      if (count > MAX_JOBS) return `单次最多比较 ${MAX_JOBS} 个岗位，请先取消 ${count - MAX_JOBS} 个`;
      if (!state.experiences.length) return "经历库为空或尚未加载完成";
      if (session.criterion.trim().length > MAX_CRITERION) return `本次补充标准不能超过 ${MAX_CRITERION} 字`;
      if (preferenceDraft.valueOrientation.trim().length > MAX_ORIENTATION) return `价值取向不能超过 ${MAX_ORIENTATION} 字`;
      return "";
    });
    const canCompare = computed(() => !compareBlockReason.value);
    const overviewJobs = computed(() => (session.result?.jobs || []).map((item) => ({
      ...item,
      firstConflict: item.conflictNotes?.[0] || "暂无明确冲突",
      firstEvidence: item.matchedExperiences?.[0]?.experienceTitle || item.experienceEvidence?.[0]?.experienceTitle || "暂无直接经历证据",
    })));
    const scoreAverage = computed(() => {
      const scores = overviewJobs.value.map((item) => item.overallScore).filter(Number.isFinite);
      if (!scores.length) return "—";
      return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
    });
    const scoreSpread = computed(() => {
      const scores = overviewJobs.value.map((item) => item.overallScore).filter(Number.isFinite);
      if (scores.length < 2) return "—";
      return Math.max(...scores) - Math.min(...scores);
    });

    function selectedCount(group) {
      const selected = new Set(session.selectedIds);
      return group.jobs.filter((job) => selected.has(job.recordId)).length;
    }

    function allSelected(group) {
      return group.jobs.length > 0 && selectedCount(group) === group.jobs.length;
    }

    function toggleGroup(group) {
      const visibleIds = new Set(group.jobs.map((job) => job.recordId));
      if (allSelected(group)) {
        session.selectedIds = session.selectedIds.filter((recordId) => !visibleIds.has(recordId));
        return;
      }
      const selected = new Set(session.selectedIds);
      for (const recordId of visibleIds) selected.add(recordId);
      session.selectedIds = [...selected];
    }

    function clearSelection() {
      session.selectedIds = [];
    }

    function chooseStage(stage) {
      preferenceDraft.stage = stage;
    }

    async function savePreference() {
      if (preferenceSaving.value) return false;
      preferenceSaving.value = true;
      preferenceError.value = "";
      try {
        const next = await api.patchComparisonPreference({
          stage: preferenceDraft.stage,
          valueOrientation: preferenceDraft.valueOrientation,
        });
        applyPreference(next);
        toast("比较偏好已保存");
        return true;
      } catch (failure) {
        if (!handleError(failure)) preferenceError.value = failure.message;
        return false;
      } finally {
        preferenceSaving.value = false;
      }
    }

    async function ensurePreferenceSaved() {
      if (!preferenceDirty.value) return true;
      return savePreference();
    }

    async function compare() {
      if (!canCompare.value) return;
      busy.value = true;
      error.value = "";
      try {
        const saved = await ensurePreferenceSaved();
        if (!saved) return;
        const result = await api.compareJobs({
          recordIds: selectedJobs.value.map((job) => job.recordId),
          criterion: session.criterion,
        });
        session.result = result;
        session.resultFingerprint = currentFingerprint.value;
      } catch (failure) {
        if (!handleError(failure)) error.value = failure.message;
      } finally {
        busy.value = false;
      }
    }

    const scoreClass = (score) => score >= 75 ? "high" : score >= 50 ? "mid" : "low";
    const technicalLabel = (level) => TECHNICAL_LEVELS[level] || "待重新比较";
    const strengthLabel = (level) => STRENGTH_LABELS[level] || "证据强度待确认";
    const checkStatusLabel = (status) => CHECK_STATUS_LABELS[status] || "待确认";
    const backgroundFitLabel = (fit) => BACKGROUND_FIT_LABELS[fit] || "待确认";
    const penaltyLabel = (penalty) => Number.isInteger(penalty)
      ? penalty === 0 ? "不调整" : penalty > 0 ? `+${penalty} 分` : `${penalty} 分`
      : "待重新比较";
    const adjustmentClass = (penalty) => Number.isInteger(penalty) && penalty > 0 ? "plus" : Number.isInteger(penalty) && penalty < 0 ? "minus" : "flat";
    const stageTip = (stage) => STAGE_TIPS[stage] || "阶段策略说明";
    const dimensionTip = (name) => DIMENSION_TIPS[name] || "维度说明";

    return {
      state,
      statuses,
      search,
      statusFilter,
      busy,
      error,
      preferenceBusy,
      preferenceSaving,
      preferenceError,
      preference,
      preferenceDraft,
      preferenceDirty,
      activePreference,
      stageOptions,
      weightLabel,
      session,
      groups,
      selectedJobs,
      stale,
      selectionHint,
      compareBlockReason,
      canCompare,
      overviewJobs,
      scoreAverage,
      scoreSpread,
      selectedCount,
      allSelected,
      toggleGroup,
      clearSelection,
      chooseStage,
      savePreference,
      compare,
      scoreClass,
      technicalLabel,
      strengthLabel,
      checkStatusLabel,
      backgroundFitLabel,
      penaltyLabel,
      adjustmentClass,
      stageTip,
      dimensionTip,
      MAX_CRITERION,
      MAX_ORIENTATION,
    };
  },
  template: `
    <div class="page comparison-page">
      <header class="pagehead comparison-head">
        <div>
          <h2 class="ptitle">岗位比较</h2>
          <p class="muted">按同步偏好和当前阶段横向看岗位：求职价值、练手价值、兜底价值分开判断。</p>
        </div>
      </header>

      <div class="comparison-workspace">
        <section class="comparison-picker">
          <header class="comparison-section-head">
            <div>
              <h3>选择岗位</h3>
              <p class="muted">{{ selectionHint }}</p>
            </div>
            <button v-if="selectedJobs.length" class="link" @click="clearSelection">清空选择</button>
          </header>

          <div class="comparison-filters">
            <input v-model="search" type="search" placeholder="搜索公司或岗位">
            <select v-model="statusFilter">
              <option>全部</option>
              <option v-for="status in statuses" :key="status">{{ status }}</option>
            </select>
          </div>

          <p v-if="!groups.length" class="muted comparison-empty">没有符合筛选条件的岗位。</p>
          <div v-else class="comparison-company-list">
            <section v-for="group in groups" :key="group.companyId" class="comparison-company">
              <header>
                <strong>{{ group.name }}</strong>
                <span class="muted">{{ selectedCount(group) }}/{{ group.jobs.length }}</span>
                <span class="grow"></span>
                <button class="link" @click="toggleGroup(group)">
                  {{ allSelected(group) ? '清空该公司' : '全选该公司' }}
                </button>
              </header>
              <label v-for="job in group.jobs" :key="job.recordId" class="comparison-job"
                :class="{ selected: session.selectedIds.includes(job.recordId) }">
                <input type="checkbox" :value="job.recordId" v-model="session.selectedIds">
                <span class="comparison-job-name">{{ job.position }}</span>
                <span class="pill">{{ job.status }}</span>
              </label>
            </section>
          </div>
        </section>

        <section class="comparison-criteria">
          <header class="comparison-section-head">
            <div>
              <h3>我的比较偏好</h3>
              <p class="muted">保存后会同步到飞书，多设备共用。开始比较前未保存修改会自动保存。</p>
            </div>
          </header>

          <p v-if="preferenceBusy" class="muted">正在读取偏好…</p>
          <div class="comparison-preference-box">
            <div class="comparison-label-row">
              <strong>当前阶段</strong>
              <span class="info-tip" tabindex="0" :data-tip="stageTip(preferenceDraft.stage)">?</span>
              <span class="muted">{{ weightLabel }}</span>
            </div>
            <div class="comparison-stage-buttons" role="group" aria-label="当前阶段">
              <button v-for="stage in stageOptions" :key="stage"
                :class="{ on: preferenceDraft.stage === stage }"
                :title="stageTip(stage)" @click="chooseStage(stage)">{{ stage }}</button>
            </div>
            <label class="comparison-preference-field">
              <span>价值取向</span>
              <textarea v-model="preferenceDraft.valueOrientation" rows="7" :maxlength="MAX_ORIENTATION"
                placeholder="例如：偏向 AI 产品、ToB / 平台型 / 工具型产品；不太想去明显高压、强销售、强地推公司……"></textarea>
            </label>
            <div class="comparison-criterion-meta">
              <span v-if="preferenceError" class="bad">{{ preferenceError }}</span>
              <span v-else-if="preferenceDirty" class="muted">偏好有未保存修改</span>
              <span v-else class="muted">偏好已同步</span>
              <span class="grow"></span>
              <span class="muted">{{ preferenceDraft.valueOrientation.length }}/{{ MAX_ORIENTATION }}</span>
              <button class="ghost" :disabled="state.offline || preferenceSaving || !preferenceDirty" @click="savePreference">
                {{ preferenceSaving ? '保存中…' : '保存偏好' }}
              </button>
            </div>
          </div>

          <header class="comparison-section-head compact">
            <div>
              <h3>本次补充标准</h3>
              <p class="muted">可留空；只写这次额外要看的东西。</p>
            </div>
          </header>
          <textarea v-model="session.criterion" rows="5" :maxlength="MAX_CRITERION"
            placeholder="例如：这批更想练 AI 产品表达，避开明显纯销售/地推岗位……"></textarea>
          <div class="comparison-criterion-meta">
            <span v-if="!state.experiences.length" class="bad">经历库为空，需先补充经历。</span>
            <span v-else-if="state.offline" class="bad">离线状态不能发起 AI 比较。</span>
            <span class="grow"></span>
            <span class="muted">{{ session.criterion.length }}/{{ MAX_CRITERION }}</span>
          </div>

          <button class="primary comparison-submit" :disabled="!canCompare" :title="compareBlockReason || '开始比较'" @click="compare">
            {{ busy ? '比较中…' : '开始比较' }}
          </button>
          <p v-if="compareBlockReason && !busy" class="comparison-block-reason" :class="state.offline || !state.experiences.length ? 'bad' : 'muted'">
            {{ compareBlockReason }}
          </p>
          <p v-if="error" class="bad">{{ error }}</p>
        </section>
      </div>

      <section v-if="session.result" class="comparison-results">
        <header class="comparison-results-head">
          <div>
            <h3>比较结果</h3>
            <p class="muted">{{ session.result.summary }}</p>
          </div>
          <span v-if="session.result.preference" class="pill">{{ session.result.preference.stage }}</span>
        </header>

        <p v-if="session.result.mock" class="notice bad">
          当前处于 AI 占位模式：结果只用于检查页面结构。配置真实 DeepSeek Key 并关闭 LLM_MOCK 后会生成真实分析。
        </p>
        <p v-if="stale" class="notice">岗位选择、补充标准或偏好已经变化，下面仍是上一次结果；重新比较后才会更新。</p>

        <div class="comparison-scorebar">
          <article>
            <span class="muted">已比较岗位</span>
            <strong>{{ overviewJobs.length }}</strong>
          </article>
          <article>
            <span class="muted">阶段加权均分</span>
            <strong>{{ scoreAverage }}</strong>
          </article>
          <article>
            <span class="muted">最高低分差</span>
            <strong>{{ scoreSpread }}</strong>
          </article>
        </div>

        <div v-if="session.result.contrasts.length" class="comparison-contrasts">
          <div v-for="item in session.result.contrasts" :key="item.topic">
            <strong>{{ item.topic }}</strong>
            <span>{{ item.observation }}</span>
          </div>
        </div>

        <div class="comparison-overview-grid">
          <article v-for="item in overviewJobs" :key="item.recordId" class="comparison-overview-card">
            <header>
              <div>
                <span class="muted">{{ item.company }}</span>
                <strong>{{ item.position }}</strong>
              </div>
              <span class="comparison-score overall" :class="scoreClass(item.overallScore)">{{ item.overallScore ?? '—' }}</span>
            </header>
            <p>{{ item.quickTake || item.bestFor }}</p>
            <dl class="comparison-axis-list">
              <dt>求职 <span class="info-tip" tabindex="0" :data-tip="dimensionTip('求职价值')">?</span></dt>
              <dd><span class="comparison-score" :class="scoreClass(item.careerValueScore)">{{ item.careerValueScore }}</span>{{ item.careerValueSummary }}</dd>
              <dt>练手 <span class="info-tip" tabindex="0" :data-tip="dimensionTip('练手价值')">?</span></dt>
              <dd><span class="comparison-score" :class="scoreClass(item.practiceValueScore)">{{ item.practiceValueScore }}</span>{{ item.practiceValueSummary }}</dd>
              <dt>兜底 <span class="info-tip" tabindex="0" :data-tip="dimensionTip('兜底价值')">?</span></dt>
              <dd><span class="comparison-score" :class="scoreClass(item.fallbackValueScore)">{{ item.fallbackValueScore }}</span>{{ item.fallbackValueSummary }}</dd>
              <dt>用途</dt><dd>{{ item.recommendedUse }}</dd>
              <dt>冲突 <span class="info-tip" tabindex="0" :data-tip="dimensionTip('冲突提示')">?</span></dt><dd>{{ item.firstConflict }}</dd>
            </dl>
          </article>
        </div>

        <h3 class="comparison-subtitle">逐岗分析</h3>
        <article v-for="item in session.result.jobs" :key="item.recordId" class="comparison-detail">
          <header>
            <div>
              <span class="muted">{{ item.company }}</span>
              <h3>{{ item.position }}</h3>
              <p>{{ item.quickTake || item.bestFor }}</p>
            </div>
            <div class="comparison-detail-meta">
              <span class="comparison-score overall" :class="scoreClass(item.overallScore)">{{ item.overallScore ?? '—' }}</span>
              <small>阶段分</small>
              <span class="pill">{{ item.status }}</span>
            </div>
          </header>
          <div class="comparison-detail-grid">
            <section class="wide comparison-axis-panel">
              <h4>三轴判断</h4>
              <div class="comparison-axis-cards">
                <article>
                  <strong>求职价值 <span class="info-tip" tabindex="0" :data-tip="dimensionTip('求职价值')">?</span></strong>
                  <span class="comparison-score" :class="scoreClass(item.careerValueScore)">{{ item.careerValueScore }}</span>
                  <p>{{ item.careerValueSummary }}</p>
                </article>
                <article>
                  <strong>练手价值 <span class="info-tip" tabindex="0" :data-tip="dimensionTip('练手价值')">?</span></strong>
                  <span class="comparison-score" :class="scoreClass(item.practiceValueScore)">{{ item.practiceValueScore }}</span>
                  <p>{{ item.practiceValueSummary }}</p>
                </article>
                <article>
                  <strong>兜底价值 <span class="info-tip" tabindex="0" :data-tip="dimensionTip('兜底价值')">?</span></strong>
                  <span class="comparison-score" :class="scoreClass(item.fallbackValueScore)">{{ item.fallbackValueScore }}</span>
                  <p>{{ item.fallbackValueSummary }}</p>
                </article>
              </div>
              <p class="muted">建议用途：{{ item.recommendedUse }}</p>
              <ul v-if="item.conflictNotes.length" class="comparison-conflicts">
                <li v-for="note in item.conflictNotes" :key="note">{{ note }}</li>
              </ul>
            </section>
            <section class="wide comparison-jd-checklist">
              <h4>JD 逐条对照</h4>
              <ul v-if="(item.jdChecklist || []).length">
                <li v-for="row in item.jdChecklist" :key="row.requirement + row.jdEvidence" :class="'check-' + row.status">
                  <strong><span>{{ checkStatusLabel(row.status) }}</span>{{ row.requirement }}</strong>
                  <em>{{ row.jdEvidence }}</em>
                  <small v-if="row.matchedExperienceTitle || row.proof">{{ row.matchedExperienceTitle || '经历证据' }}{{ row.proof ? '：' + row.proof : '' }}</small>
                  <small v-if="row.gap">缺口：{{ row.gap }}</small>
                  <small v-if="row.action">准备：{{ row.action }}</small>
                </li>
              </ul>
              <p v-else class="muted">请重新比较以生成 JD 逐条对照。</p>
            </section>
            <section>
              <h4>为什么这样给分</h4>
              <ul>
                <li v-for="part in (item.scoreBreakdown || item.scoreRationale || [])" :key="part.dimension">
                  <strong>{{ part.dimension }} · {{ part.score }}</strong>
                  <span>{{ part.reason }}</span>
                </li>
              </ul>
            </section>
            <section>
              <h4>经历证据</h4>
              <p>{{ item.experienceSummary }}</p>
              <ul v-if="(item.matchedExperiences || item.experienceEvidence || []).length">
                <li v-for="evidence in (item.matchedExperiences || [])" :key="evidence.jdRequirement + evidence.experienceTitle">
                  <strong>{{ evidence.experienceTitle }} · {{ strengthLabel(evidence.strength) }}</strong>
                  <span>{{ evidence.jdRequirement }}</span>
                  <small>{{ evidence.proof }}</small>
                </li>
                <template v-if="!(item.matchedExperiences || []).length">
                  <li v-for="evidence in item.experienceEvidence" :key="evidence.requirement + evidence.experienceTitle">
                    <strong>{{ evidence.experienceTitle }}</strong>
                    <span>{{ evidence.requirement }}</span>
                    <small>{{ evidence.evidence }}</small>
                  </li>
                </template>
              </ul>
              <p v-else class="muted">经历库中没有足够的直接证据。</p>
            </section>
            <section>
              <h4>专业与技术倾向</h4>
              <p class="comparison-technical-summary">
                <strong>{{ technicalLabel(item.technicalRequirement?.level) }}</strong>
                <strong>{{ backgroundFitLabel(item.technicalRequirement?.backgroundFit) }}</strong>
                <span :class="adjustmentClass(item.technicalRequirement?.penalty)">{{ penaltyLabel(item.technicalRequirement?.penalty) }}</span>
              </p>
              <p>{{ item.technicalRequirement?.evidence || '请重新比较以生成判断依据' }}</p>
              <small class="muted">{{ item.technicalRequirement?.assessment }}</small>
            </section>
            <section>
              <h4>风险与缺口</h4>
              <ul><li v-for="risk in (item.risks || item.gaps || [])" :key="risk">{{ risk }}</li></ul>
              <p v-if="!(item.risks || item.gaps || []).length" class="muted">没有识别出明确风险。</p>
            </section>
            <section>
              <h4>准备重点</h4>
              <ul><li v-for="focus in (item.prepFocus || [])" :key="focus">{{ focus }}</li></ul>
              <p v-if="!(item.prepFocus || []).length" class="muted">暂无额外准备建议。</p>
            </section>
            <section>
              <h4>信息不足</h4>
              <ul><li v-for="uncertainty in item.uncertainties" :key="uncertainty">{{ uncertainty }}</li></ul>
              <p v-if="!item.uncertainties.length" class="muted">JD 信息足以完成当前判断。</p>
            </section>
          </div>
        </article>
      </section>
    </div>`,
};
