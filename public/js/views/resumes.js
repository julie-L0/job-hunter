// 简历库（F3）。列表 + 行内展开编辑；新建走「生成草稿 → 编辑 → 存为新编号」。
// 编号由后端 nextResumeCode 分配，界面上不给填：编号是投递记录的连接键，手打就会错位。
import { api } from "../api.js";
import { currentJobRef, handleError, loadAll, mergeResume, state, toast } from "../store.js";
import { DraftBox, FieldRow, dayStr, useDraft } from "../ui.js";

const { computed, ref } = window.Vue;

export const Resumes = {
  components: { DraftBox, FieldRow },
  setup() {
    const job = currentJobRef;
    const open = ref("");
    const busy = ref(false);
    const saving = ref(false);
    const recomputing = ref(false);
    const error = ref("");

    const scope = ref("new");
    const { data: draft, clear } = useDraft("resume", scope, {
      source: "job",
      jd: "",
      text: "",
      mock: false,
      versionName: "",
      direction: "",
    });

    const rows = computed(() =>
      [...state.resumes].sort((a, b) =>
        String(a.code || "").localeCompare(String(b.code || ""), "zh", { numeric: true }),
      ),
    );
    const jdText = computed(() => (draft.source === "job" ? job.value?.jd || "" : draft.jd));
    const canSave = computed(() => Boolean(draft.versionName.trim() && draft.text.trim()));

    async function generate() {
      if (busy.value) return;
      if (!jdText.value.trim()) {
        error.value = draft.source === "job" ? "当前岗位还没填 JD" : "先把 JD 粘进来";
        return;
      }
      busy.value = true;
      error.value = "";
      try {
        const result = await api.generateResume(jdText.value);
        draft.text = result.draft;
        draft.mock = Boolean(result.mock);
      } catch (failure) {
        if (!handleError(failure)) error.value = failure.message;
      } finally {
        busy.value = false;
      }
    }
    async function save() {
      if (saving.value || !canSave.value) return;
      saving.value = true;
      error.value = "";
      try {
        const record = await api.createResume({
          versionName: draft.versionName.trim(),
          direction: draft.direction.trim(),
          content: draft.text,
        });
        mergeResume(record);
        clear();
        toast(`已存为 ${record.code}`);
      } catch (failure) {
        if (!handleError(failure)) error.value = failure.message;
      } finally {
        saving.value = false;
      }
    }

    async function recompute() {
      if (recomputing.value) return;
      recomputing.value = true;
      error.value = "";
      try {
        const result = await api.recomputeApply();
        await loadAll({ silent: true });
        toast(result.updated ? `重算完成，更新了 ${result.updated} 条` : "重算完成，没有变化");
      } catch (failure) {
        if (!handleError(failure)) error.value = failure.message;
      } finally {
        recomputing.value = false;
      }
    }

    const saver = (recordId, key) => async (value) => {
      const record = await api.patchResume(recordId, { [key]: value });
      mergeResume(record);
    };

    return {
      state, job, rows, open, busy, saving, recomputing, error,
      draft, jdText, canSave, generate, save, recompute, saver, clear, dayStr,
      toggle: (recordId) => (open.value = open.value === recordId ? "" : recordId),
    };
  },
  template: `
    <div class="page">
      <h2 class="ptitle">简历库</h2>
      <p class="muted">编号 R1、R2… 由系统分配；「投递记录」按主表的状态和简历编号自动重算，都不用手填。</p>

      <div class="strip">
        <span class="muted">共 {{ rows.length }} 版</span>
        <span class="grow"></span>
        <button class="ghost" :disabled="recomputing || state.offline" @click="recompute">
          {{ recomputing ? '重算中…' : '重算投递记录' }}
        </button>
      </div>

      <p v-if="error" class="notice bad">{{ error }}</p>

      <table v-if="rows.length" class="grid">
        <thead>
          <tr><th>编号</th><th>版本名</th><th>适用方向</th><th>投递记录</th><th>创建</th><th></th></tr>
        </thead>
        <tbody v-for="row in rows" :key="row.recordId">
          <tr :class="{ on: open === row.recordId }">
            <td class="mono">{{ row.code }}</td>
            <td>{{ row.versionName || '—' }}</td>
            <td>{{ row.direction || '—' }}</td>
            <td class="muted">{{ row.applyRecord || '还没投出去' }}</td>
            <td class="muted">{{ dayStr(row.createdAt) || '—' }}</td>
            <td>
              <button class="link" @click="toggle(row.recordId)">
                {{ open === row.recordId ? '收起' : '编辑' }}
              </button>
            </td>
          </tr>
          <tr v-if="open === row.recordId" class="editrow">
            <td colspan="6">
              <div class="fields">
                <FieldRow label="版本名" :value="row.versionName || ''" :disabled="state.offline"
                  :save="saver(row.recordId, 'versionName')" />
                <FieldRow label="适用方向" :value="row.direction || ''" placeholder="产品运营 / 数据分析…"
                  :disabled="state.offline" :save="saver(row.recordId, 'direction')" />
                <FieldRow label="正文内容" type="textarea" :rows="18" wide :value="row.content || ''"
                  :disabled="state.offline" :save="saver(row.recordId, 'content')" />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted">还没有简历，下面新建一版。</p>
      <section class="newbox">
        <h3>新建一版</h3>
        <div class="strip">
          <label class="check"><input type="radio" value="job" v-model="draft.source">取当前岗位的 JD</label>
          <label class="check"><input type="radio" value="paste" v-model="draft.source">自己粘 JD</label>
          <span v-if="draft.source === 'job'" class="muted">
            {{ job ? job.company + ' · ' + job.position : '还没选岗位' }}{{ job && !job.jd ? '（这个岗位没填 JD）' : '' }}
          </span>
        </div>
        <textarea v-if="draft.source === 'paste'" rows="8" v-model="draft.jd"
          placeholder="把 JD 粘进来"></textarea>
        <div class="drow">
          <button class="primary" :disabled="busy || state.offline" @click="generate">
            {{ busy ? '生成中…' : (draft.text ? '重新生成' : '按 JD 生成草稿') }}
          </button>
          <span class="muted">会带上整个经历库。也可以跳过生成，直接在下面手写。</span>
        </div>

        <DraftBox v-model="draft.text" :mock="draft.mock" title="简历草稿" :rows="20">
          <input v-model="draft.versionName" placeholder="版本名，例如「产品运营-字节向」">
          <input v-model="draft.direction" placeholder="适用方向（可空）">
          <button class="primary" :disabled="saving || state.offline || !canSave" @click="save">
            {{ saving ? '保存中…' : '存为新简历' }}
          </button>
          <button class="ghost" @click="clear">清空</button>
        </DraftBox>
      </section>
    </div>`,
};
