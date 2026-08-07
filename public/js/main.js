// 应用外壳：登录闸门 → 侧边栏 + hash 路由。
// 各功能页在 views/ 里，一个侧边栏项对应一个文件。
import { api, token } from "./api.js";
import { loadAll, loadHealth, state } from "./store.js";
import { ConfirmHost } from "./ui.js";
import { Board } from "./views/board.js";
import { JobInfo } from "./views/job-info.js";
import { Forms } from "./views/forms.js";
import { Intro } from "./views/intro.js";
import { Prep } from "./views/prep.js";
import { Mock } from "./views/mock.js";
import { Resumes } from "./views/resumes.js";
import { Experiences } from "./views/experiences.js";

const { createApp, computed, ref } = window.Vue;

const NAV = [
  { group: "", items: [["#/board", "看板"]] },
  {
    group: "当前岗位",
    items: [
      ["#/job/info", "岗位信息"],
      ["#/job/forms", "网申填表"],
      ["#/job/intro", "自我介绍"],
      ["#/job/prep", "面试准备"],
      ["#/job/mock", "Mock 面试"],
    ],
  },
  {
    group: "素材库",
    items: [
      ["#/lib/resumes", "简历库"],
      ["#/lib/experiences", "经历库"],
    ],
  },
];

const VIEWS = {
  "#/board": Board,
  "#/job/info": JobInfo,
  "#/job/forms": Forms,
  "#/job/intro": Intro,
  "#/job/prep": Prep,
  "#/job/mock": Mock,
  "#/lib/resumes": Resumes,
  "#/lib/experiences": Experiences,
};

const route = ref(location.hash in VIEWS ? location.hash : "#/board");
window.addEventListener("hashchange", () => {
  route.value = location.hash in VIEWS ? location.hash : "#/board";
});

const Gate = {
  setup() {
    const password = ref("");
    const error = ref("");
    const busy = ref(false);

    async function login() {
      error.value = "";
      busy.value = true;
      try {
        const result = await api.login(password.value);
        token.set(result.token);
        state.authed = true;
        password.value = "";
        await loadAll();
      } catch (failure) {
        error.value = failure.message || "登录失败";
      } finally {
        busy.value = false;
      }
    }
    return { password, error, busy, login };
  },
  template: `
    <div class="gate">
      <div class="gatebox">
        <h1>秋招管理</h1>
        <p class="muted">输入访问口令。口令是 .env 里的 APP_PASSWORD。</p>
        <input type="password" v-model="password" placeholder="口令" autofocus @keyup.enter="login">
        <button class="primary" :disabled="busy" @click="login">{{ busy ? '验证中…' : '进入' }}</button>
        <p v-if="error" class="bad">{{ error }}</p>
      </div>
    </div>`,
};

const App = {
  components: { Gate, ConfirmHost },
  setup() {
    const view = computed(() => VIEWS[route.value]);
    const snapshotAge = computed(() => {
      if (!state.snapshotAt) return "";
      const minutes = Math.round((Date.now() - state.snapshotAt) / 60000);
      if (minutes < 1) return "刚刚";
      if (minutes < 60) return `${minutes} 分钟前`;
      return `${Math.round(minutes / 60)} 小时前`;
    });
    return { state, route, NAV, view, snapshotAge, retry: () => loadAll() };
  },
  template: `
    <div v-if="!state.ready" class="boot">载入中…</div>
    <Gate v-else-if="!state.authed" />
    <div v-else class="shell">
      <aside class="side">
        <div class="brand">秋招管理</div>
        <template v-for="group in NAV" :key="group.group || 'top'">
          <p v-if="group.group" class="sgroup">{{ group.group }}</p>
          <a v-for="item in group.items" :key="item[0]" :href="item[0]"
            :class="['snav', { on: route === item[0] }]">{{ item[1] }}</a>
        </template>
        <span class="grow"></span>
        <div class="sfoot">
          <span v-if="state.health.larkMock" class="pill warn">飞书假数据</span>
          <span v-if="state.health.llmMock" class="pill warn">AI MOCK</span>
        </div>
      </aside>

      <main class="main">
        <p v-if="state.configError" class="banner bad">
          {{ state.configError }} —— 补到 .env 里再重启 npm run dev。
        </p>
        <p v-if="state.offline" class="banner">
          离线 · 显示 {{ snapshotAge }}的快照，改动无法保存
          <button class="link" @click="retry">重试</button>
        </p>

        <div class="content" :class="{ busy: state.loading }">
          <component :is="view" />
        </div>
      </main>

      <ConfirmHost />
      <div v-if="state.toast" class="toast" @click="state.toast = ''">{{ state.toast }}</div>
    </div>`,
};

createApp(App).mount("#app");

await loadHealth();
if (state.authed) await loadAll();
