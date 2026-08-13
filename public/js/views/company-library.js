import { api } from "../api.js";
import {
  JOB_STAR_VALUE,
  dropCompany,
  handleError,
  isStarredJob,
  mergeCompany,
  mergeJob,
  resumeCodes,
  saveJobPatch,
  setCurrentJob,
  state,
  statusRequiresResume,
  statuses,
  toast,
} from "../store.js";
import { confirmDialog, ddlLabel } from "../ui.js";

const { computed, reactive, ref, watch } = window.Vue;

function blankJob() {
  return {
    position: "",
    jd: "",
    status: "待投",
    resumeId: "",
    deadline: "",
    busy: false,
    error: "",
  };
}

export const CompanyLibrary = {
  setup() {
    const mode = ref("");
    const adding = reactive({ name: "", siteUrl: "", busy: false, error: "" });
    const editing = reactive({ name: "", siteUrl: "", companyBackground: "", note: "", busy: false, error: "" });
    const deleting = ref(false);
    const jobForm = reactive(blankJob());

    const companies = computed(() => [...state.companies].sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""), "zh-CN"),
    ));
    const selected = computed(() =>
      state.companies.find((company) => company.recordId === state.currentCompanyId) || null,
    );
    const companyJobs = computed(() => selected.value
      ? state.jobs
        .filter((job) => job.companyId === selected.value.recordId)
        .sort((a, b) => {
          const starOrder = Number(isStarredJob(b)) - Number(isStarredJob(a));
          return starOrder || (b.createdAt || 0) - (a.createdAt || 0);
        })
      : [],
    );
    const counts = computed(() => new Map(
      state.companies.map((company) => [
        company.recordId,
        state.jobs.filter((job) => job.companyId === company.recordId).length,
      ]),
    ));
    const needsResume = computed(() => statusRequiresResume(jobForm.status));

    watch(companies, (list) => {
      if (!list.length) return;
      if (!list.some((company) => company.recordId === state.currentCompanyId)) {
        state.currentCompanyId = list[0].recordId;
      }
    }, { immediate: true });

    function selectCompany(recordId) {
      state.currentCompanyId = recordId;
      mode.value = "";
    }

    async function addCompany() {
      if (adding.busy) return;
      if (!adding.name.trim()) {
        adding.error = "公司名要填";
        return;
      }
      adding.busy = true;
      adding.error = "";
      try {
        const company = await api.createCompany({ name: adding.name, siteUrl: adding.siteUrl });
        mergeCompany(company);
        state.currentCompanyId = company.recordId;
        adding.name = "";
        adding.siteUrl = "";
        toast(`已新增「${company.name}」`);
      } catch (failure) {
        if (!handleError(failure)) adding.error = failure.message;
      } finally {
        adding.busy = false;
      }
    }

    function beginEdit() {
      Object.assign(editing, {
        name: selected.value.name || "",
        siteUrl: selected.value.siteUrl || "",
        companyBackground: selected.value.companyBackground || "",
        note: selected.value.note || "",
        error: "",
      });
      mode.value = "edit";
    }

    async function saveCompany() {
      if (editing.busy) return;
      if (!editing.name.trim()) {
        editing.error = "公司名要填";
        return;
      }
      editing.busy = true;
      editing.error = "";
      try {
        const company = await api.patchCompany(selected.value.recordId, {
          name: editing.name,
          siteUrl: editing.siteUrl,
          companyBackground: editing.companyBackground,
          note: editing.note,
        });
        mergeCompany(company);
        mode.value = "";
        toast("公司信息已保存");
      } catch (failure) {
        if (!handleError(failure)) editing.error = failure.message;
      } finally {
        editing.busy = false;
      }
    }

    async function deleteCompany() {
      if (!selected.value || deleting.value) return;
      if (companyJobs.value.length) {
        toast(`公司下面还有 ${companyJobs.value.length} 个岗位，先删除或迁移岗位后再删公司`);
        return;
      }
      const target = selected.value;
      const ok = await confirmDialog({
        title: `删除公司「${target.name}」？`,
        body: "会从飞书公司库删除这家公司。只有没有任何岗位关联的公司才能删除；这个操作不可恢复。",
        danger: true,
      });
      if (!ok) return;
      deleting.value = true;
      try {
        await api.deleteCompany(target.recordId);
        dropCompany(target.recordId);
        mode.value = "";
        toast("公司已删除");
      } catch (failure) {
        if (!handleError(failure)) toast(failure.message);
      } finally {
        deleting.value = false;
      }
    }

    function beginJob() {
      Object.assign(jobForm, blankJob());
      mode.value = "job";
    }

    async function createJob() {
      if (jobForm.busy) return;
      if (!jobForm.position.trim()) {
        jobForm.error = "岗位名要填";
        return;
      }
      if (!jobForm.jd.trim()) {
        jobForm.error = "JD 要填";
        return;
      }
      if (needsResume.value && !jobForm.resumeId) {
        jobForm.error = `状态为「${jobForm.status}」时必须选择简历`;
        return;
      }
      jobForm.busy = true;
      jobForm.error = "";
      try {
        const payload = {
          companyId: selected.value.recordId,
          position: jobForm.position,
          jd: jobForm.jd,
          status: jobForm.status,
          resumeId: jobForm.resumeId,
        };
        if (jobForm.deadline) payload.deadline = jobForm.deadline;
        const job = await api.createJob(payload);
        mergeJob(job);
        setCurrentJob(job.recordId);
        toast(`已创建「${job.company} · ${job.position}」`);
        location.hash = "#/job/info";
      } catch (failure) {
        if (!handleError(failure)) jobForm.error = failure.message;
      } finally {
        jobForm.busy = false;
      }
    }

    function openJob(recordId) {
      setCurrentJob(recordId);
      location.hash = "#/job/info";
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
      companies,
      selected,
      companyJobs,
      counts,
      statuses,
      resumeCodes,
      needsResume,
      mode,
      adding,
      editing,
      deleting,
      jobForm,
      selectCompany,
      addCompany,
      beginEdit,
      saveCompany,
      deleteCompany,
      beginJob,
      createJob,
      openJob,
      toggleStar,
      isStarredJob,
      ddlLabel,
    };
  },
  template: `
    <div class="company-library">
      <form class="company-create" @submit.prevent="addCompany">
        <input v-model="adding.name" placeholder="公司名" :disabled="state.offline">
        <input v-model="adding.siteUrl" type="url" placeholder="官网链接" :disabled="state.offline">
        <button class="primary" :disabled="state.offline || adding.busy">
          {{ adding.busy ? '新增中…' : '新增公司' }}
        </button>
        <span v-if="adding.error" class="bad">{{ adding.error }}</span>
      </form>

      <p v-if="state.offline && !companies.length" class="notice">
        当前离线快照不包含公司库，联网刷新后可查看。
      </p>
      <div v-else class="company-layout">
        <aside class="company-list">
          <button v-for="company in companies" :key="company.recordId"
            :class="['company-card', { on: selected && selected.recordId === company.recordId }]"
            @click="selectCompany(company.recordId)">
            <strong>{{ company.name }}</strong>
            <span>{{ counts.get(company.recordId) || 0 }} 个岗位</span>
            <small v-if="company.siteUrl">{{ company.siteUrl }}</small>
          </button>
          <p v-if="!companies.length && !state.loading" class="muted">公司库为空。</p>
        </aside>

        <section v-if="selected" class="company-detail">
          <header>
            <div>
              <h2>{{ selected.name }}</h2>
              <a v-if="selected.siteUrl" :href="selected.siteUrl" target="_blank" rel="noreferrer">官网</a>
            </div>
            <span class="grow"></span>
            <button class="ghost" :disabled="state.offline" @click="beginEdit">编辑公司</button>
            <button class="danger" :disabled="state.offline || deleting" @click="deleteCompany">{{ deleting ? '删除中…' : '删除公司' }}</button>
            <button class="primary" :disabled="state.offline" @click="beginJob">新建岗位</button>
          </header>

          <dl v-if="selected.companyBackground || selected.note" class="meta">
            <template v-if="selected.companyBackground"><dt>公司背景</dt><dd>{{ selected.companyBackground }}</dd></template>
            <template v-if="selected.note"><dt>备注</dt><dd>{{ selected.note }}</dd></template>
          </dl>

          <form v-if="mode === 'edit'" class="company-form" @submit.prevent="saveCompany">
            <label><span>公司名</span><input v-model="editing.name" :disabled="state.offline"></label>
            <label><span>官网链接</span><input v-model="editing.siteUrl" type="url" :disabled="state.offline"></label>
            <label class="wide"><span>公司背景备注</span><textarea rows="5" v-model="editing.companyBackground" :disabled="state.offline"></textarea></label>
            <label class="wide"><span>备注</span><textarea rows="3" v-model="editing.note" :disabled="state.offline"></textarea></label>
            <div class="drow wide">
              <button class="primary" :disabled="state.offline || editing.busy">{{ editing.busy ? '保存中…' : '保存公司' }}</button>
              <button type="button" class="ghost" @click="mode = ''">取消</button>
              <span v-if="editing.error" class="bad">{{ editing.error }}</span>
            </div>
          </form>

          <form v-if="mode === 'job'" class="company-form job-create" @submit.prevent="createJob">
            <label><span>岗位名</span><input v-model="jobForm.position" :disabled="state.offline"></label>
            <label><span>初始状态</span><select v-model="jobForm.status" :disabled="state.offline">
              <option v-for="status in statuses" :key="status">{{ status }}</option>
            </select></label>
            <label><span>简历{{ needsResume ? '（必填）' : '' }}</span><select v-model="jobForm.resumeId" :disabled="state.offline">
              <option value="">（未指定）</option>
              <option v-for="code in resumeCodes" :key="code">{{ code }}</option>
            </select></label>
            <label><span>投递 DDL</span><input type="date" v-model="jobForm.deadline" :disabled="state.offline"></label>
            <label class="wide"><span>JD</span><textarea rows="12" v-model="jobForm.jd" :disabled="state.offline"></textarea></label>
            <div class="drow wide">
              <button class="primary" :disabled="state.offline || jobForm.busy">{{ jobForm.busy ? '创建中…' : '创建岗位' }}</button>
              <button type="button" class="ghost" @click="mode = ''">取消</button>
              <span v-if="jobForm.error" class="bad">{{ jobForm.error }}</span>
            </div>
          </form>

          <section class="company-jobs">
            <h3>已有岗位 <em>{{ companyJobs.length }}</em></h3>
            <article v-for="job in companyJobs" :key="job.recordId"
              :class="['company-job', { starred: isStarredJob(job) }]" role="button" tabindex="0"
              @click="openJob(job.recordId)" @keydown.enter.self.prevent="openJob(job.recordId)" @keydown.space.self.prevent="openJob(job.recordId)">
              <button class="star-button compact" :class="{ on: isStarredJob(job) }"
                :title="isStarredJob(job) ? '取消星标' : '标记下一批'"
                @click="toggleStar(job, $event)">{{ isStarredJob(job) ? '★' : '☆' }}</button>
              <span class="dot" :class="'s-' + job.status"></span>
              <strong>{{ job.position }}</strong>
              <span class="pill">{{ job.status }}</span>
              <span v-if="job.pendingSync" class="pill warn">待同步</span>
              <small v-if="job.deadline">{{ ddlLabel(job.deadline) }}</small>
            </article>
            <p v-if="!companyJobs.length" class="muted">还没有岗位。</p>
          </section>
        </section>
      </div>
    </div>`,
};
