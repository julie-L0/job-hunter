import {
  ACTIVE_STATUSES,
  JOB_STAR_VALUE,
  handleError,
  isClosed,
  isStarredJob,
  saveJobPatch,
  setCurrentJob,
  state,
  toast,
} from "../store.js";
import { FieldRow, ageLabel, ddlLabel, isStale, isUrgent } from "../ui.js";
import { CompanyLibrary } from "./company-library.js";

const { computed, nextTick, ref, watch } = window.Vue;

const CLOSED_TAB = "已结束";
const COMPANY_TAB = "公司库";

function byUrgency(jobs) {
  return [...jobs].sort((a, b) => {
    const starOrder = Number(isStarredJob(b)) - Number(isStarredJob(a));
    if (starOrder) return starOrder;
    if (a.deadline && b.deadline) return a.deadline - b.deadline;
    if (a.deadline) return -1;
    if (b.deadline) return 1;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
}

export const Board = {
  components: { CompanyLibrary, FieldRow },
  setup() {
    const tab = computed({
      get: () => state.boardTab,
      set: (value) => { state.boardTab = value; },
    });
    const showClosed = ref(false);
    const editJd = ref(false);
    const companyLibrary = ref(null);

    async function beginJob() {
      tab.value = COMPANY_TAB;
      await nextTick();
      companyLibrary.value?.beginJob();
    }

    const inStatus = (status) => byUrgency(state.jobs.filter((job) => job.status === status));
    const tabs = computed(() => ["全部", COMPANY_TAB, ...ACTIVE_STATUSES.value, CLOSED_TAB]);
    const columns = computed(() =>
      ACTIVE_STATUSES.value.map((status) => ({ status, jobs: inStatus(status) })),
    );
    const closed = computed(() => byUrgency(state.jobs.filter((job) => isClosed(job.status))));
    const closedSummary = computed(() => {
      const counts = new Map();
      for (const job of closed.value) counts.set(job.status, (counts.get(job.status) || 0) + 1);
      return [...counts].map(([status, count]) => `${status} ${count}`).join(" · ");
    });
    const listed = computed(() => tab.value === CLOSED_TAB ? closed.value : inStatus(tab.value));
    const detail = computed(() => {
      const list = listed.value;
      if (!list.length) return null;
      return list.find((job) => job.recordId === state.currentJobId) || list[0];
    });

    watch(() => detail.value?.recordId, () => { editJd.value = false; });

    async function saveJd(value) {
      const result = await saveJobPatch(detail.value.recordId, { jd: value });
      editJd.value = true;
      return result;
    }

    async function toggleStar(job, event) {
      event?.stopPropagation();
      if (!job) return;
      try {
        const nextStarred = !isStarredJob(job);
        await saveJobPatch(job.recordId, {
          starred: nextStarred ? JOB_STAR_VALUE : "",
        });
        toast(nextStarred ? "已标记为下一批" : "已取消星标");
      } catch (failure) {
        if (!handleError(failure)) toast(failure.message);
      }
    }

    return {
      state,
      tab,
      tabs,
      columns,
      closed,
      closedSummary,
      showClosed,
      companyLibrary,
      beginJob,
      listed,
      detail,
      editJd,
      saveJd,
      toggleStar,
      setCurrentJob,
      isStarredJob,
      ddlLabel,
      ageLabel,
      isUrgent,
      isStale,
      CLOSED_TAB,
      COMPANY_TAB,
    };
  },
  template: `
    <div class="board-page">
      <div class="board-summary">
        <span v-if="state.loading" class="muted">正在加载…</span>
        <span v-else class="muted">{{ state.companies.length }} 家公司 · {{ state.jobs.length }} 个岗位</span>
        <button class="primary" :disabled="state.offline || !state.companies.length" @click="beginJob">新建岗位</button>
      </div>

      <nav class="tabs">
        <button v-for="name in tabs" :key="name" :class="{ on: tab === name }" @click="tab = name">
          {{ name }}
        </button>
      </nav>

      <CompanyLibrary v-if="tab === COMPANY_TAB" ref="companyLibrary" />

      <template v-else-if="tab === '全部'">
        <div class="cols">
          <section v-for="col in columns" :key="col.status" class="col">
            <h3>{{ col.status }} <em>{{ col.jobs.length }}</em></h3>
            <article v-for="job in col.jobs" :key="job.recordId"
              :class="{ urgent: isUrgent(job), on: job.recordId === state.currentJobId, starred: isStarredJob(job) }"
              @click="setCurrentJob(job.recordId)">
              <div class="job-card-head">
                <strong>{{ job.company }}</strong>
                <button class="star-button compact" :class="{ on: isStarredJob(job) }"
                  :title="isStarredJob(job) ? '取消星标' : '标记下一批'"
                  @click="toggleStar(job, $event)">{{ isStarredJob(job) ? '★' : '☆' }}</button>
              </div>
              <span class="pos">{{ job.position }}</span>
              <small v-if="job.deadline" :class="{ bad: isUrgent(job) }">{{ ddlLabel(job.deadline) }}</small>
              <small v-else-if="job.status === '待投'" :class="{ bad: isStale(job) }">{{ ageLabel(job) }}</small>
              <small v-if="job.resumeId" class="muted">{{ job.resumeId }}</small>
              <small v-if="job.pendingSync" class="bad">待同步</small>
            </article>
            <p v-if="!col.jobs.length" class="colempty">—</p>
          </section>
        </div>

        <section class="closedbar">
          <button class="link" @click="showClosed = !showClosed">
            {{ showClosed ? '▾' : '▸' }} 已结束 {{ closed.length }}
            <span v-if="closedSummary" class="muted">（{{ closedSummary }}）</span>
          </button>
          <div v-if="showClosed" class="closedlist">
            <article v-for="job in closed" :key="job.recordId"
              :class="{ on: job.recordId === state.currentJobId, starred: isStarredJob(job) }" @click="setCurrentJob(job.recordId)">
              <span class="dot" :class="'s-' + job.status"></span>
              <strong>{{ job.company }}</strong>
              <span class="pos">{{ job.position }}</span>
              <small class="muted">{{ job.status }}</small>
              <small v-if="job.pendingSync" class="bad">待同步</small>
              <span class="grow"></span>
              <button class="star-button compact" :class="{ on: isStarredJob(job) }"
                :title="isStarredJob(job) ? '取消星标' : '标记下一批'"
                @click="toggleStar(job, $event)">{{ isStarredJob(job) ? '★' : '☆' }}</button>
            </article>
            <p v-if="!closed.length" class="muted">还没有结束的岗位。</p>
          </div>
        </section>
      </template>

      <div v-else class="quick">
        <aside class="qlist">
          <p v-if="state.loading" class="muted">正在加载岗位…</p>
          <p v-else-if="!listed.length" class="muted">这个状态下没有岗位。</p>
          <article v-for="job in listed" :key="job.recordId"
            :class="{ urgent: isUrgent(job), on: detail && job.recordId === detail.recordId, starred: isStarredJob(job) }"
            @click="setCurrentJob(job.recordId)">
            <div class="job-card-head">
              <strong>{{ job.company }}</strong>
              <button class="star-button compact" :class="{ on: isStarredJob(job) }"
                :title="isStarredJob(job) ? '取消星标' : '标记下一批'"
                @click="toggleStar(job, $event)">{{ isStarredJob(job) ? '★' : '☆' }}</button>
            </div>
            <span class="pos">{{ job.position }}</span>
            <small v-if="job.deadline" :class="{ bad: isUrgent(job) }">{{ ddlLabel(job.deadline) }}</small>
            <small v-else-if="job.status === '待投'" :class="{ bad: isStale(job) }">{{ ageLabel(job) }}</small>
            <small v-if="tab === CLOSED_TAB" class="muted">{{ job.status }}</small>
            <small v-if="job.pendingSync" class="bad">待同步</small>
          </article>
        </aside>

        <section class="qdetail" v-if="detail">
          <header>
            <h2>{{ detail.company }} · {{ detail.position }}</h2>
            <button class="star-button star-button-label" :class="{ on: isStarredJob(detail) }"
              @click="toggleStar(detail, $event)">
              <span>{{ isStarredJob(detail) ? '★' : '☆' }}</span>
              <span>{{ isStarredJob(detail) ? '下一批' : '标记下一批' }}</span>
            </button>
            <span class="pill">{{ detail.status }}</span>
            <span v-if="detail.pendingSync" class="pill warn">待同步</span>
            <span v-if="detail.deadline" class="pill" :class="{ warn: isUrgent(detail) }">{{ ddlLabel(detail.deadline) }}</span>
            <span v-else-if="detail.status === '待投'" class="pill" :class="{ warn: isStale(detail) }">{{ ageLabel(detail) }}</span>
            <span v-if="detail.resumeId" class="pill">{{ detail.resumeId }}</span>
            <span class="grow"></span>
            <a v-if="detail.siteUrl" class="ghost" :href="detail.siteUrl" target="_blank" rel="noreferrer">官网</a>
            <a class="ghost" href="#/job/info">编辑岗位</a>
          </header>
          <dl class="meta">
            <template v-if="detail.referralCode"><dt>内推码</dt><dd class="mono">{{ detail.referralCode }}</dd></template>
            <template v-if="detail.prepDocUrl"><dt>准备文档</dt><dd><a :href="detail.prepDocUrl" target="_blank" rel="noreferrer">在飞书打开</a></dd></template>
            <template v-if="detail.note"><dt>备注</dt><dd>{{ detail.note }}</dd></template>
          </dl>
          <h4>JD <button class="link" @click="editJd = !editJd">{{ editJd ? '收起编辑' : '改' }}</button></h4>
          <pre v-if="!editJd" class="jd">{{ detail.jd }}</pre>
          <FieldRow v-else label="" type="textarea" :rows="14" :value="detail.jd || ''"
            :save="saveJd" wide />
        </section>
      </div>
    </div>`,
};
