// 看板。两种形态共用一套数据：
// 「全部」= 进行中六列 + 已结束折叠；点某个状态 tab = 左列表右 JD 的两栏速查。
// 速查就是「只看一面的岗位 JD」这个需求的落点，点中一条同时把它设成全局当前岗位。
import { api } from "../api.js";
import {
  ACTIVE_STATUSES,
  handleError,
  isClosed,
  isPending,
  mergeJob,
  pendingJobs,
  setCurrentJob,
  state,
  toast,
} from "../store.js";
import { ddlLabel, isUrgent } from "../ui.js";

const { computed, reactive, ref } = window.Vue;

const CLOSED_TAB = "已结束";
const PENDING_TAB = "待定公司";

/** DDL 升序，没填 DDL 的排最后——没截止日期的不该插在快到期的前面。 */
function byDeadline(jobs) {
  return [...jobs].sort((a, b) => {
    if (!a.deadline && !b.deadline) return 0;
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return a.deadline - b.deadline;
  });
}

export const Board = {
  setup() {
    const tab = ref("全部");
    const showClosed = ref(false);
    const showPending = ref(true);
    const adding = reactive({ company: "", position: "", busy: false, error: "" });

    // 六列只放已经定了岗位的。待定公司单独一区，否则「今天要投哪几个」这个视图会被污染
    const inStatus = (status) =>
      byDeadline(state.jobs.filter((job) => job.status === status && !isPending(job)));

    const tabs = computed(() => ["全部", PENDING_TAB, ...ACTIVE_STATUSES.value, CLOSED_TAB]);
    const columns = computed(() =>
      ACTIVE_STATUSES.value.map((status) => ({ status, jobs: inStatus(status) })),
    );
    // 待定但已经挂了的公司归到已结束，不然「待定公司」会一直堆着放弃了的
    const pending = computed(() => byDeadline(pendingJobs.value.filter((job) => !isClosed(job.status))));
    const closed = computed(() => byDeadline(state.jobs.filter((job) => isClosed(job.status))));
    const closedSummary = computed(() => {
      const counts = new Map();
      for (const job of closed.value) counts.set(job.status, (counts.get(job.status) || 0) + 1);
      return [...counts].map(([status, n]) => `${status} ${n}`).join(" · ");
    });

    const listed = computed(() => {
      if (tab.value === CLOSED_TAB) return closed.value;
      if (tab.value === PENDING_TAB) return pending.value;
      return inStatus(tab.value);
    });
    // 右栏铺开哪一条：优先当前岗位，它不在这个状态里就退到第一条
    const detail = computed(() => {
      const list = listed.value;
      if (!list.length) return null;
      return list.find((job) => job.recordId === state.currentJobId) || list[0];
    });

    async function add() {
      if (adding.busy) return;
      const company = adding.company.trim();
      const position = adding.position.trim();
      if (!company) {
        adding.error = "公司名要填";
        return;
      }
      adding.busy = true;
      adding.error = "";
      try {
        const job = await api.createJob(position ? { company, position } : { company });
        mergeJob(job);
        setCurrentJob(job.recordId);
        adding.company = "";
        adding.position = "";
        if (position) toast(`已建「${company} · ${position}」，状态待投`);
        else {
          tab.value = PENDING_TAB;
          toast(`已收下「${company}」，等你找到岗位再补岗位名和 JD`);
        }
      } catch (failure) {
        if (!handleError(failure)) adding.error = failure.message;
      } finally {
        adding.busy = false;
      }
    }

    return {
      state,
      tab,
      tabs,
      columns,
      pending,
      closed,
      closedSummary,
      showClosed,
      showPending,
      listed,
      detail,
      adding,
      add,
      setCurrentJob,
      ddlLabel,
      isUrgent,
      isPending,
      CLOSED_TAB,
      PENDING_TAB,
    };
  },
  template: `
    <div class="board-page">
      <div class="quickadd">
        <input v-model="adding.company" placeholder="公司名" :disabled="state.offline"
          @keyup.enter="add">
        <input v-model="adding.position" placeholder="岗位名（可留空，之后再补）" :disabled="state.offline"
          @keyup.enter="add">
        <button class="primary" :disabled="state.offline || adding.busy" @click="add">
          {{ adding.busy ? '添加中…' : (adding.position.trim() ? '新增岗位' : '新增公司') }}
        </button>
        <span v-if="adding.error" class="bad">{{ adding.error }}</span>
        <span class="grow"></span>
        <span class="muted">共 {{ state.jobs.length }} 条<template v-if="pending.length">，其中 {{ pending.length }} 家待定岗位</template></span>
      </div>

      <nav class="tabs">
        <button v-for="name in tabs" :key="name" :class="{ on: tab === name }" @click="tab = name">
          {{ name }}
        </button>
      </nav>

      <template v-if="tab === '全部'">
        <section v-if="pending.length" class="pendingbar">
          <button class="link" @click="showPending = !showPending">
            {{ showPending ? '▾' : '▸' }} {{ PENDING_TAB }} {{ pending.length }}
            <span class="muted">（还没找具体岗位）</span>
          </button>
          <div v-if="showPending" class="pendinglist">
            <article v-for="job in pending" :key="job.recordId"
              :class="{ urgent: isUrgent(job), on: job.recordId === state.currentJobId }"
              @click="setCurrentJob(job.recordId)">
              <strong>{{ job.company }}</strong>
              <small v-if="job.deadline" :class="{ bad: isUrgent(job) }">{{ ddlLabel(job.deadline) }}</small>
              <a v-if="job.siteUrl" :href="job.siteUrl" target="_blank" rel="noreferrer"
                @click.stop>秋招网址</a>
            </article>
          </div>
        </section>

        <div class="cols">
          <section v-for="col in columns" :key="col.status" class="col">
            <h3>{{ col.status }} <em>{{ col.jobs.length }}</em></h3>
            <article v-for="job in col.jobs" :key="job.recordId"
              :class="{ urgent: isUrgent(job), on: job.recordId === state.currentJobId }"
              @click="setCurrentJob(job.recordId)">
              <strong>{{ job.company }}</strong>
              <span class="pos">{{ job.position }}</span>
              <small v-if="job.deadline" :class="{ bad: isUrgent(job) }">{{ ddlLabel(job.deadline) }}</small>
              <small v-if="job.resumeId" class="muted">{{ job.resumeId }}</small>
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
              :class="{ on: job.recordId === state.currentJobId }" @click="setCurrentJob(job.recordId)">
              <span class="dot" :class="'s-' + job.status"></span>
              <strong>{{ job.company }}</strong>
              <span class="pos">{{ job.position || '（待定岗位）' }}</span>
              <small class="muted">{{ job.status }}</small>
            </article>
            <p v-if="!closed.length" class="muted">还没有结束的岗位。</p>
          </div>
        </section>
      </template>
      <div v-else class="quick">
        <aside class="qlist">
          <p v-if="!listed.length" class="muted">
            {{ tab === PENDING_TAB ? '没有待定的公司——所有公司都定好岗位了。' : '这个状态下没有岗位。' }}
          </p>
          <article v-for="job in listed" :key="job.recordId"
            :class="{ urgent: isUrgent(job), on: detail && job.recordId === detail.recordId }"
            @click="setCurrentJob(job.recordId)">
            <strong>{{ job.company }}</strong>
            <span class="pos">{{ job.position || '（待定岗位）' }}</span>
            <small v-if="job.deadline" :class="{ bad: isUrgent(job) }">{{ ddlLabel(job.deadline) }}</small>
            <small v-if="tab === CLOSED_TAB" class="muted">{{ job.status }}</small>
          </article>
        </aside>

        <section class="qdetail" v-if="detail">
          <header>
            <h2>{{ detail.company }} · {{ detail.position || '（待定岗位）' }}</h2>
            <span class="pill">{{ detail.status }}</span>
            <span v-if="detail.deadline" class="pill" :class="{ warn: isUrgent(detail) }">
              {{ ddlLabel(detail.deadline) }}
            </span>
            <span v-if="detail.resumeId" class="pill">{{ detail.resumeId }}</span>
            <span class="grow"></span>
            <a v-if="detail.siteUrl" class="ghost" :href="detail.siteUrl" target="_blank" rel="noreferrer">官网</a>
            <a class="ghost" href="#/job/info">编辑</a>
          </header>
          <dl class="meta">
            <template v-if="detail.referralCode"><dt>内推码</dt><dd class="mono">{{ detail.referralCode }}</dd></template>
            <template v-if="detail.prepDocUrl"><dt>准备文档</dt>
              <dd><a :href="detail.prepDocUrl" target="_blank" rel="noreferrer">在飞书打开</a></dd></template>
            <template v-if="detail.note"><dt>备注</dt><dd>{{ detail.note }}</dd></template>
          </dl>
          <h4>JD</h4>
          <pre class="jd">{{ detail.jd || '（还没填 JD）' }}</pre>
          <p v-if="isPending(detail)" class="muted">
            这条只有公司。照上面的秋招网址翻一遍岗位，选中的填进<a href="#/job/info">岗位信息</a>；
            同一家开了多个岗位就在那页「同公司再加一个岗位」，网址和内推码会带过去。
          </p>
        </section>
      </div>
    </div>`,
};

