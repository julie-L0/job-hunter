// 岗位信息（F1 F2）。每个字段独立保存、独立显示状态。
// 简历编号是下拉不是手打：打错一个字符，简历库的投递记录就永远关联不上，
// 这是确定性问题，不该靠人不犯错。
import { api } from "../api.js";
import {
  currentJobRef,
  dropJob,
  handleError,
  mergeJob,
  resumeCodes,
  state,
  statuses,
  toast,
} from "../store.js";
import { FieldRow, NeedJob, confirmDialog, dayStr } from "../ui.js";

const { computed, ref } = window.Vue;

const INTRO_FIELDS = [
  ["intro1min", "1 分钟"],
  ["intro3min", "3 分钟"],
  ["intro5min", "5 分钟"],
  ["introEn", "英文"],
];

export const JobInfo = {
  components: { FieldRow, NeedJob },
  setup() {
    const job = currentJobRef;
    const docBusy = ref(false);
    const docError = ref("");
    // 回填失败时文档已经建出来了，URL 必须留在界面上，否则那个文档就找不回来
    const orphanDocUrl = ref("");

    async function patch(fields) {
      const result = await api.patchJob(job.value.recordId, fields);
      mergeJob(result.job);
      if (result.recompute?.error) {
        toast(`岗位已存好，但简历投递记录重算失败：${result.recompute.error}`);
      }
    }

    const save = (key, transform = (v) => v) => (value) => patch({ [key]: transform(value) });
    const orNull = (value) => (value === "" ? null : value);

    async function createDoc() {
      if (docBusy.value) return;
      docBusy.value = true;
      docError.value = "";
      orphanDocUrl.value = "";
      try {
        const doc = await api.prepDoc(job.value.recordId);
        const warns = [];
        if (doc.writeBackError) {
          orphanDocUrl.value = doc.url;
          warns.push(`链接回填飞书失败：${doc.writeBackError}`);
        } else {
          mergeJob({ recordId: job.value.recordId, prepDocUrl: doc.url });
        }
        // 应用创建的文档默认只有应用自己能看。授权失败就是「链接在这儿但你打不开」，
        // 不说清楚会以为是链接坏了
        if (doc.grant?.error) {
          warns.push("没能把访问权限授给你，点链接会 403 —— 应用缺云文档权限，要去飞书开放平台给它加上再重新发布版本");
        }
        if (warns.length) docError.value = `文档已建好，但${warns.join("；")}。`;
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
        body: "会从飞书主表里删掉这条记录，删了拿不回来。简历库的投递记录会自动重算。",
        danger: true,
      });
      if (!ok) return;
      try {
        const result = await api.deleteJob(target.recordId);
        dropJob(target.recordId);
        toast(result.recompute?.error ? `已删除，投递记录重算失败：${result.recompute.error}` : "已删除");
        location.hash = "#/board";
      } catch (failure) {
        if (!handleError(failure)) toast(failure.message);
      }
    }

    const introDone = computed(() =>
      INTRO_FIELDS.map(([key, label]) => ({ label, done: Boolean(job.value?.[key]) })),
    );

    return {
      state, job, statuses, resumeCodes, docBusy, docError, orphanDocUrl,
      introDone, save, orNull, dayStr, createDoc, remove,
    };
  },
  template: `
    <NeedJob v-if="!job" what="岗位信息" />
    <div v-else class="page">
      <h2 class="ptitle">{{ job.company }} · {{ job.position }}</h2>

      <div class="fields">
        <FieldRow label="状态" type="select" :options="statuses" :value="job.status"
          :empty-option="''" :disabled="state.offline" :save="save('status')" />
        <FieldRow label="简历编号" type="select" :options="resumeCodes" :value="job.resumeId || ''"
          empty-option="（未指定）" :disabled="state.offline" :save="save('resumeId', orNull)" />
        <FieldRow label="投递 DDL" type="date" :value="dayStr(job.deadline)"
          :disabled="state.offline" :save="save('deadline', orNull)" />
        <FieldRow label="内推码" :value="job.referralCode || ''" placeholder="有就填，面试时要用"
          :disabled="state.offline" :save="save('referralCode')" />
        <FieldRow label="官网链接" :value="job.siteUrl || ''" placeholder="https://"
          :disabled="state.offline" :save="save('siteUrl')" wide />
        <FieldRow label="JD" type="textarea" :rows="12" :value="job.jd || ''" wide
          placeholder="把岗位职责和任职要求整段粘进来。自我介绍、面试准备、Mock 面试都靠它。"
          :disabled="state.offline" :save="save('jd')" />
        <FieldRow label="公司背景备注" type="textarea" :rows="4" :value="job.companyBackground || ''" wide
          placeholder="业务线、竞品、最近动态——会一起喂给 AI"
          :disabled="state.offline" :save="save('companyBackground')" />
        <FieldRow label="备注" type="textarea" :rows="3" :value="job.note || ''" wide
          placeholder="笔试时间、内推人、答复截止……"
          :disabled="state.offline" :save="save('note')" />
      </div>

      <section class="strip">
        <span class="flabel">准备文档</span>
        <a v-if="job.prepDocUrl" class="ghost" :href="job.prepDocUrl" target="_blank" rel="noreferrer">
          在飞书打开
        </a>
        <button v-else class="ghost" :disabled="state.offline || docBusy" @click="createDoc">
          {{ docBusy ? '创建中…' : '创建准备文档' }}
        </button>
        <span class="muted">面试准备材料可以追加写进去，追加不覆盖。</span>
      </section>

      <p v-if="docError" class="notice bad">
        {{ docError }}
        <a v-if="orphanDocUrl" :href="orphanDocUrl" target="_blank" rel="noreferrer">{{ orphanDocUrl }}</a>
        <span v-if="orphanDocUrl" class="muted">← 这个链接现在只在这里，记得自己存一份。</span>
      </p>

      <section class="strip">
        <span class="flabel">自我介绍</span>
        <span v-for="item in introDone" :key="item.label" class="pill" :class="{ ok: item.done }">
          {{ item.label }}{{ item.done ? ' ✓' : '' }}
        </span>
        <a class="ghost" href="#/job/intro">去生成</a>
      </section>

      <section class="strip danger-zone">
        <button class="danger-link" :disabled="state.offline" @click="remove">删除这个岗位</button>
      </section>
    </div>`,
};

