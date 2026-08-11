import { api } from "../api.js";
import { handleError, state, statuses } from "../store.js";
import { useDraft } from "../ui.js";

const { computed, ref } = window.Vue;

const MIN_JOBS = 2;
const MAX_JOBS = 20;
const MAX_CRITERION = 500;
const PRESETS = {
  fit: "优先判断岗位要求与我的已有能力、经验方向和可证明成果是否匹配，以及我是否能较快进入状态。",
  practice: "优先判断岗位要求是否相对基础、面试准备成本是否较低，以及是否适合作为练手和验证求职方向的机会。",
};
const TECHNICAL_LEVELS = {
  none: "无相关要求",
  preferred: "优先项",
  required: "必需要求",
};

function fingerprint(recordIds, criterion) {
  return JSON.stringify([2, recordIds, criterion.trim()]);
}

export const JobComparison = {
  setup() {
    const search = ref("");
    const statusFilter = ref("全部");
    const busy = ref(false);
    const error = ref("");
    const scope = computed(() => "main");
    const { data: session } = useDraft("job-comparison", scope, {
      selectedIds: [],
      preset: "fit",
      criterion: PRESETS.fit,
      result: null,
      resultFingerprint: "",
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
    const canCompare = computed(() => {
      const count = selectedJobs.value.length;
      const length = session.criterion.trim().length;
      return !state.offline && !busy.value && state.experiences.length > 0
        && count >= MIN_JOBS && count <= MAX_JOBS
        && length > 0 && length <= MAX_CRITERION;
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

    function choosePreset(key) {
      session.preset = key;
      if (PRESETS[key]) session.criterion = PRESETS[key];
    }

    function markCustom() {
      session.preset = "custom";
    }

    async function compare() {
      if (!canCompare.value) return;
      busy.value = true;
      error.value = "";
      try {
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
    const penaltyLabel = (penalty) => Number.isInteger(penalty)
      ? penalty === 0 ? "不扣分" : `${penalty} 分`
      : "待重新比较";

    return {
      state,
      statuses,
      search,
      statusFilter,
      busy,
      error,
      session,
      groups,
      selectedJobs,
      stale,
      selectionHint,
      canCompare,
      selectedCount,
      allSelected,
      toggleGroup,
      clearSelection,
      choosePreset,
      markCustom,
      compare,
      scoreClass,
      technicalLabel,
      penaltyLabel,
      MAX_CRITERION,
    };
  },
  template: `
    <div class="page comparison-page">
      <header class="pagehead comparison-head">
        <div>
          <h2 class="ptitle">岗位比较</h2>
          <p class="muted">在选定范围内，对照本次标准和经历库查看匹配证据；结果不代表投递顺序。</p>
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
              <h3>本次比较标准</h3>
              <p class="muted">预设只是起点，内容可以继续修改。</p>
            </div>
          </header>

          <div class="comparison-presets" role="group" aria-label="比较标准预设">
            <button :class="{ on: session.preset === 'fit' }" @click="choosePreset('fit')">更适合我</button>
            <button :class="{ on: session.preset === 'practice' }" @click="choosePreset('practice')">练手优先</button>
            <button :class="{ on: session.preset === 'custom' }" @click="choosePreset('custom')">自定义</button>
          </div>

          <textarea v-model="session.criterion" rows="9" :maxlength="MAX_CRITERION"
            placeholder="例如：更看重业务分析和策略能力，尽量避开强销售属性……"
            @input="markCustom"></textarea>
          <div class="comparison-criterion-meta">
            <span v-if="!state.experiences.length" class="bad">经历库为空，需先补充经历。</span>
            <span v-else-if="state.offline" class="bad">离线状态不能发起 AI 比较。</span>
            <span class="grow"></span>
            <span class="muted">{{ session.criterion.length }}/{{ MAX_CRITERION }}</span>
          </div>

          <button class="primary comparison-submit" :disabled="!canCompare" @click="compare">
            {{ busy ? '比较中…' : '开始比较' }}
          </button>
          <p v-if="error" class="bad">{{ error }}</p>
        </section>
      </div>

      <section v-if="session.result" class="comparison-results">
        <header class="comparison-results-head">
          <div>
            <h3>比较结果</h3>
            <p class="muted">{{ session.result.summary }}</p>
          </div>
          <span v-if="session.result.mock" class="pill warn">MOCK 占位内容</span>
        </header>

        <p v-if="stale" class="notice">岗位选择或比较标准已经变化，下面仍是上一次结果；重新比较后才会更新。</p>

        <div v-if="session.result.contrasts.length" class="comparison-contrasts">
          <div v-for="item in session.result.contrasts" :key="item.topic">
            <strong>{{ item.topic }}</strong>
            <span>{{ item.observation }}</span>
          </div>
        </div>

        <div class="comparison-table-wrap">
          <table class="comparison-table">
            <thead>
              <tr><th>岗位</th><th>综合分</th><th>标准符合度</th><th>经历匹配度</th><th>专业/技术倾向</th><th>更适合什么</th><th>主要短板</th></tr>
            </thead>
            <tbody>
              <tr v-for="item in session.result.jobs" :key="item.recordId">
                <td><strong>{{ item.company }}</strong><span>{{ item.position }}</span></td>
                <td><span class="comparison-score overall" :class="scoreClass(item.overallScore)">{{ item.overallScore ?? '—' }}</span></td>
                <td><span class="comparison-score" :class="scoreClass(item.criterionScore)">{{ item.criterionScore }}</span><small>{{ item.criterionSummary }}</small></td>
                <td><span class="comparison-score" :class="scoreClass(item.experienceScore)">{{ item.experienceScore }}</span><small>{{ item.experienceSummary }}</small></td>
                <td><strong>{{ technicalLabel(item.technicalRequirement?.level) }}</strong><small>{{ penaltyLabel(item.technicalRequirement?.penalty) }} · {{ item.technicalRequirement?.evidence || '请重新比较以生成判断依据' }}</small></td>
                <td>{{ item.bestFor }}</td>
                <td>{{ item.gaps[0] || '未发现明确缺口' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <article v-for="item in session.result.jobs" :key="item.recordId" class="comparison-detail">
          <header>
            <div>
              <span class="muted">{{ item.company }}</span>
              <h3>{{ item.position }}</h3>
            </div>
            <div class="comparison-detail-meta">
              <span class="comparison-score overall" :class="scoreClass(item.overallScore)">{{ item.overallScore ?? '—' }}</span>
              <small>综合分</small>
              <span class="pill">{{ item.status }}</span>
            </div>
          </header>
          <div class="comparison-detail-grid">
            <section>
              <h4>本次标准</h4>
              <p>{{ item.criterionSummary }}</p>
              <ul>
                <li v-for="evidence in item.criterionEvidence" :key="evidence.requirement + evidence.evidence">
                  <strong>{{ evidence.requirement }}</strong>
                  <span>{{ evidence.evidence }}</span>
                  <small>{{ evidence.assessment }}</small>
                </li>
              </ul>
            </section>
            <section>
              <h4>经历证据</h4>
              <p>{{ item.experienceSummary }}</p>
              <ul v-if="item.experienceEvidence.length">
                <li v-for="evidence in item.experienceEvidence" :key="evidence.requirement + evidence.experienceTitle">
                  <strong>{{ evidence.experienceTitle }}</strong>
                  <span>{{ evidence.requirement }}</span>
                  <small>{{ evidence.evidence }}</small>
                </li>
              </ul>
              <p v-else class="muted">经历库中没有足够的直接证据。</p>
            </section>
            <section>
              <h4>专业与技术倾向</h4>
              <p class="comparison-technical-summary">
                <strong>{{ technicalLabel(item.technicalRequirement?.level) }}</strong>
                <span>{{ penaltyLabel(item.technicalRequirement?.penalty) }}</span>
              </p>
              <p>{{ item.technicalRequirement?.evidence || '请重新比较以生成判断依据' }}</p>
              <small class="muted">{{ item.technicalRequirement?.assessment }}</small>
            </section>
            <section>
              <h4>缺口</h4>
              <ul><li v-for="gap in item.gaps" :key="gap">{{ gap }}</li></ul>
              <p v-if="!item.gaps.length" class="muted">没有识别出明确缺口。</p>
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
