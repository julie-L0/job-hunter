// 共用件。三类：日期换算、草稿自动落盘、以及被多个页面反复用到的小组件。
import { draft } from "./persist.js";
import { handleError, state, setCurrentJob, toast } from "./store.js";

const { reactive, ref, watch, computed } = window.Vue;

const DAY = 86_400_000;

/** 毫秒时间戳 → input[type=date] 要的本地 YYYY-MM-DD。用本地分量，不能走 toISOString（会差 8 小时）。 */
export function dayStr(ms) {
  if (!ms) return "";
  const date = new Date(Number(ms));
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 距今天还有几天。负数是已过期，0 是今天。按天取整，不受当前时刻影响。 */
export function daysLeft(ms) {
  if (!ms) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(Number(ms));
  if (Number.isNaN(target.getTime())) return null;
  target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / DAY);
}

export function ddlLabel(ms) {
  const left = daysLeft(ms);
  if (left === null) return "";
  if (left < 0) return `已过 ${-left} 天`;
  if (left === 0) return "今天截止";
  if (left === 1) return "明天截止";
  return `${left} 天后`;
}

/** 待投且 3 天内到期 —— 看板上标红的唯一条件。 */
export function isUrgent(job) {
  if (job.status !== "待投" || !job.deadline) return false;
  const left = daysLeft(job.deadline);
  return left !== null && left <= 3;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text || "");
    return true;
  } catch {
    toast("复制失败，请手动选中文本");
    return false;
  }
}

/**
 * 草稿自动落盘。scopeRef 变化就换槽重载，所以换岗位不会串味。
 * AI 出过的内容都走这里——刷新、误关标签页、换设备都不该白花一次 API 调用。
 */
export function useDraft(kind, scopeRef, blank) {
  const fresh = () => JSON.parse(JSON.stringify(blank));
  const data = reactive(fresh());

  const assign = (source) => {
    const base = fresh();
    for (const key of Object.keys(base)) {
      data[key] = source && source[key] !== undefined ? source[key] : base[key];
    }
  };

  const reload = () => assign(draft.load(kind, scopeRef.value));
  reload();

  watch(scopeRef, reload);
  watch(data, () => draft.save(kind, scopeRef.value, { ...data }), { deep: true });

  return {
    data,
    reload,
    clear() {
      draft.clear(kind, scopeRef.value);
      assign(null);
    },
  };
}

// ---- 确认弹窗：await confirmDialog({...}) → true/false ----

const confirmState = reactive({ open: false, title: "", body: "", danger: false, resolve: null });

export function confirmDialog({ title, body = "", danger = false }) {
  return new Promise((resolve) => {
    Object.assign(confirmState, { open: true, title, body, danger, resolve });
  });
}

function settle(value) {
  const { resolve } = confirmState;
  confirmState.open = false;
  confirmState.resolve = null;
  if (resolve) resolve(value);
}

export const ConfirmHost = {
  setup: () => ({ s: confirmState, settle }),
  template: `
    <div v-if="s.open" class="mask" @click.self="settle(false)">
      <div class="modal">
        <h3>{{ s.title }}</h3>
        <p v-if="s.body" class="modal-body">{{ s.body }}</p>
        <div class="modal-actions">
          <button class="ghost" @click="settle(false)">取消</button>
          <button :class="s.danger ? 'danger' : 'primary'" @click="settle(true)">确定</button>
        </div>
      </div>
    </div>`,
};

/**
 * 单个字段 + 独立保存状态。每个字段自己显示 idle / 保存中 / ✓ / ✗重试，
 * 不共用一根全局错误条——备注存失败不该看起来像整页挂了。
 */
export const FieldRow = {
  props: {
    label: String,
    value: { type: [String, Number], default: "" },
    type: { type: String, default: "text" }, // text | textarea | select | date
    options: { type: Array, default: () => [] },
    rows: { type: Number, default: 3 },
    placeholder: { type: String, default: "" },
    emptyOption: { type: String, default: "（空）" },
    wide: Boolean,
    disabled: Boolean,
    save: Function,
  },
  setup(props) {
    const local = ref(props.value ?? "");
    const saved = ref(props.value ?? "");
    const status = ref("idle");
    const error = ref("");

    watch(
      () => props.value,
      (next) => {
        // 外部数据变了（重拉、别处改了同一条）；正在保存中不要打断
        if (status.value === "saving") return;
        local.value = next ?? "";
        saved.value = next ?? "";
      },
    );

    async function commit(force = false) {
      if (!props.save) return;
      const value = local.value;
      if (!force && value === saved.value) return;
      status.value = "saving";
      error.value = "";
      try {
        await props.save(value);
        saved.value = value;
        status.value = "ok";
        setTimeout(() => {
          if (status.value === "ok") status.value = "idle";
        }, 1600);
      } catch (failure) {
        // 全局类错误（掉线/口令失效）也要进全局状态，但这一格照样显示 ✗
        handleError(failure);
        status.value = "error";
        error.value = failure.message || "保存失败";
      }
    }

    return { local, status, error, commit };
  },
  template: `
    <div class="field" :class="{ wide }">
      <div class="fhead">
        <span class="flabel">{{ label }}</span>
        <span v-if="status === 'saving'" class="fstate">保存中…</span>
        <span v-else-if="status === 'ok'" class="fstate ok">已保存</span>
        <span v-else-if="status === 'error'" class="fstate bad">
          {{ error }} <button class="link" @click="commit(true)">重试</button>
        </span>
      </div>
      <textarea v-if="type === 'textarea'" :rows="rows" :disabled="disabled" :placeholder="placeholder"
        v-model="local" @change="commit()"></textarea>
      <select v-else-if="type === 'select'" :disabled="disabled" v-model="local" @change="commit()">
        <option v-if="emptyOption" value="">{{ emptyOption }}</option>
        <option v-for="option in options" :key="option" :value="option">{{ option }}</option>
      </select>
      <input v-else :type="type === 'date' ? 'date' : 'text'" :disabled="disabled"
        :placeholder="placeholder" v-model="local" @change="commit()">
    </div>`,
};

/** 技能标签只能从飞书已有的选项里选。写入未定义选项会 800030005，且加选项属于表结构变更。 */
export const TagPicker = {
  props: {
    modelValue: { type: Array, default: () => [] },
    options: { type: Array, default: () => [] },
    disabled: Boolean,
  },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    const toggle = (tag) => {
      const current = props.modelValue || [];
      emit(
        "update:modelValue",
        current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag],
      );
    };
    return { toggle };
  },
  template: `
    <div class="tagpick">
      <label v-for="tag in options" :key="tag" :class="{ on: (modelValue || []).includes(tag) }">
        <input type="checkbox" :disabled="disabled"
          :checked="(modelValue || []).includes(tag)" @change="toggle(tag)">{{ tag }}
      </label>
    </div>`,
};

/** AI 草稿框：可编辑、显示字数、能复制，动作按钮由调用方通过默认插槽给。 */
export const DraftBox = {
  props: {
    modelValue: { type: String, default: "" },
    title: { type: String, default: "AI 草稿" },
    rows: { type: Number, default: 12 },
    mock: Boolean,
  },
  emits: ["update:modelValue"],
  setup(props) {
    const copied = ref(false);
    async function copy() {
      if (!(await copyText(props.modelValue))) return;
      copied.value = true;
      setTimeout(() => (copied.value = false), 1600);
    }
    return { copied, copy };
  },
  template: `
    <div class="draftbox">
      <div class="dhead">
        <span class="dtitle">{{ title }}</span>
        <span v-if="mock" class="pill warn">MOCK 占位内容</span>
        <span class="grow"></span>
        <span class="muted">{{ (modelValue || '').length }} 字</span>
        <button class="link" @click="copy">{{ copied ? '已复制' : '复制' }}</button>
      </div>
      <textarea :rows="rows" :value="modelValue"
        @input="$emit('update:modelValue', $event.target.value)"></textarea>
      <div class="drow"><slot></slot></div>
    </div>`,
};

/** 岗位选择器，按状态分组。顶部条和各空态共用一个。 */
export const JobPicker = {
  setup() {
    const groups = computed(() => {
      const order = state.health.jobStatuses || [];
      return order
        .map((status) => ({ status, jobs: state.jobs.filter((job) => job.status === status) }))
        .filter((group) => group.jobs.length);
    });
    return { groups, state, setCurrentJob };
  },
  template: `
    <select class="jobpick" :value="state.currentJobId || ''"
      @change="setCurrentJob($event.target.value || null)">
      <option value="">（未选择岗位）</option>
      <optgroup v-for="group in groups" :key="group.status" :label="group.status">
        <option v-for="job in group.jobs" :key="job.recordId" :value="job.recordId">
          {{ job.company }} · {{ job.position }}
        </option>
      </optgroup>
    </select>`,
};

/** 四个岗位功能页共用的空态：没选岗位时给选择器，而不是渲染半个坏掉的表单。 */
export const NeedJob = {
  props: { what: { type: String, default: "这个功能" } },
  components: { JobPicker },
  template: `
    <div class="empty">
      <p class="etitle">先选一个岗位</p>
      <p class="muted">{{ what }}要基于某个具体岗位的 JD 和简历来做。选定后它会一直跟着你，
        换到别的功能页不用再选一次。</p>
      <JobPicker />
      <p class="muted">也可以去<a href="#/board">看板</a>里点一张卡片。</p>
    </div>`,
};




