import { api } from "../api.js";
import {
  JOB_STAR_VALUE,
  currentJobRef,
  dropJob,
  handleError,
  isStarredJob,
  mergeJob,
  openCompanyLibrary,
  resumeCodes,
  state,
  statusRequiresResume,
  statuses,
  toast,
} from "../store.js";
import { FieldRow, confirmDialog, dayStr } from "../ui.js";

const { computed, ref } = window.Vue;

const INTRO_FIELDS = [
  ["intro1min", "1 分钟"],
  ["intro3min", "3 分钟"],
  ["intro5min", "5 分钟"],
  ["introEn", "英文"],
];

export const JobInfo = {
  components: { FieldRow },
  setup() {
    const job = currentJobRef;
    const docBusy = ref(false);
    const docError = ref("");
    const orphanDocUrl = ref("");

    async function patch(fields) {
      const next = { ...job.value, ...fields };
      if (statusRequiresResume(next.status) && !String(next.resumeId || "").trim()) {
        throw new Error(`状态为「${next.status}」时必须选择简历`);
      }
      const result = await api.patchJob(job.value.recordId, fields);
      mergeJob(result.job);
      if (result.warning) toast(result.warning);
    }

    const save = (key, transform = (value) => value) => (value) => patch({ [key]: transform(value) });
    const orNull = (value) => value === "" ? null : value;

    async function toggleStar() {
      try {
        await patch({ starred: isStarredJob(job.value) ? "" : JOB_STAR_VALUE });
        toast(isStarredJob(job.value) ? "已标记为下一批" : "已取消星标");
      } catch (failure) {
        if (!handleError(failure)) toast(failure.message);
      }
    }

    async function createDoc() {
      if (docBusy.value) return;
      docBusy.value = true;
      docError.value = "";
      orphanDocUrl.value = "";
      try {
        const doc = await api.prepDoc(job.value.recordId);
        const warnings = [];
        if (doc.writeBackError) {
          orphanDocUrl.value = doc.url;
          warnings.push(`链接回填飞书失败：${doc.writeBackError}`);
        } else {
          mergeJob({ recordId: job.value.recordId, prepDocUrl: doc.url });
        }
        if (doc.grant?.error) warnings.push("没能授予文档访问权限");
        if (warnings.length) docError.value = `文档已创建，但${warnings.join("；")}。`;
        else toast("准备文档已创建");
      } catch (failure) {
        if (!handleError(failure)) docError.value = failure.message;
      } finally {
        docBusy.value = false;
      }
    }

    async function remove() {
      const target = job.value;
      const ok = await confirmDialog({
        title: `删除「${target.company} · ${target.position}」？`,
        body: "会从飞书岗位主表删除这条记录，公司仍保留在公司库。简历投递记录会自动重算。",
        danger: true,
      });
      if (!ok) return;
      try {
        const result = await api.deleteJob(target.recordId);
        dropJob(target.recordId);
        toast(result.warning || "已删除岗位");
        location.hash = "#/board";
      } catch (failure) {
        if (!handleError(failure)) toast(failure.message);
      }
    }

    const introDone = computed(() =>
      INTRO_FIELDS.map(([key, label]) => ({ label, done: Boolean(job.value?.[key]) })),
    );
    const resumeHint = computed(() => job.value && statusRequiresResume(job.value.status)
      ? `状态为「${job.value.status}」，必须保留一份简历`
      : "待投阶段可留空",
    );

    return {
      state,
      job,
      statuses,
      resumeCodes,
      docBusy,
      docError,
      orphanDocUrl,
      introDone,
      resumeHint,
      save,
      toggleStar,
      isStarredJob,
      orNull,
      dayStr,
      createDoc,
      remove,
      openCompanyLibrary,
    };
  },
  template: `
    <div v-if="!job" class="empty">
      <p class="etitle">未选择岗位</p>
      <p class="muted">从<a href="#/board">看板</a>或公司库打开一个岗位。</p>
    </div>
    <div v-else class="page job-info-page">
      <header class="pagehead">
        <div>
          <h2 class="ptitle">{{ job.company }} · {{ job.position }}</h2>
          <a v-if="job.siteUrl" :href="job.siteUrl" target="_blank" rel="noreferrer">官网</a>
        </div>
        <span class="grow"></span>
        <button class="star-button star-button-label" :class="{ on: isStarredJob(job) }"
          :disabled="state.offline" @click="toggleStar">
          <span>{{ isStarredJob(job) ? '★' : '☆' }}</span>
          <span>{{ isStarredJob(job) ? '下一批' : '标记下一批' }}</span>
        </button>
        <button class="ghost" @click="openCompanyLibrary(job.companyId)">编辑公司</button>
      </header>

      <section v-if="job.companyBackground || job.companyNote" class="company-context">
        <p v-if="job.companyBackground">{{ job.companyBackground }}</p>
        <p v-if="job.companyNote" class="muted">{{ job.companyNote }}</p>
      </section>

      <div class="fields job-fields">
        <FieldRow label="状态" type="select" :options="statuses" :value="job.status"
          :disabled="state.offline" :save="save('status')" />
        <FieldRow label="简历" type="select" :options="resumeCodes" :value="job.resumeId || ''"
          empty-option="（未指定）" :hint="resumeHint" :disabled="state.offline"
          :save="save('resumeId', orNull)" />
        <FieldRow label="岗位名" :value="job.position" :disabled="state.offline" :save="save('position')" />
        <FieldRow label="投递 DDL" type="date" :value="dayStr(job.deadline)"
          hint="招满为止就留空" :disabled="state.offline" :save="save('deadline', orNull)" />
        <FieldRow label="JD" type="textarea" :rows="16" :value="job.jd"
          :disabled="state.offline" :save="save('jd')" wide />
        <FieldRow label="内推码" :value="job.referralCode || ''"
          :disabled="state.offline" :save="save('referralCode')" />
        <FieldRow label="岗位备注" type="textarea" :rows="4" :value="job.note || ''"
          :disabled="state.offline" :save="save('note')" wide />
      </div>

      <section class="strip">
        <span class="flabel">准备文档</span>
        <a v-if="job.prepDocUrl" :href="job.prepDocUrl" target="_blank" rel="noreferrer">在飞书打开</a>
        <button v-else class="primary" :disabled="state.offline || docBusy" @click="createDoc">
          {{ docBusy ? '创建中…' : '创建准备文档' }}
        </button>
      </section>
      <p v-if="docError" class="notice bad">
        {{ docError }}
        <a v-if="orphanDocUrl" :href="orphanDocUrl" target="_blank" rel="noreferrer">{{ orphanDocUrl }}</a>
      </p>

      <section class="strip">
        <span class="flabel">自我介绍</span>
        <span v-for="item in introDone" :key="item.label" class="pill" :class="{ ok: item.done }">
          {{ item.label }}{{ item.done ? ' ✓' : '' }}
        </span>
        <a class="ghost" href="#/job/intro">去生成</a>
      </section>

      <section class="dangerzone">
        <button class="danger" :disabled="state.offline" @click="remove">删除岗位</button>
      </section>
    </div>`,
};
