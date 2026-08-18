import {
  CALENDAR_EVENT_TYPES,
  WEEKDAYS,
  dateKey,
  defaultStatusForType,
  eventEndAt,
  eventTypeLabel,
  eventsForDate,
  formatEventTime,
  localDateTimeMillis,
  markStatusApplied,
  monthCells,
  normalizeCalendarEvent,
  shouldOfferStatusUpdate,
  sortCalendarEvents,
  splitLocalDateTime,
  todayKey,
} from "../calendar-events.js";
import { calendarEvents } from "../persist.js";
import {
  currentJobRef,
  handleError,
  saveJobPatch,
  setCurrentJob,
  state,
  statuses,
  toast,
} from "../store.js";
import { confirmDialog } from "../ui.js";

const { computed, reactive, ref, watch } = window.Vue;

function monthKeyFromDate(key) {
  return String(key || "").slice(0, 7);
}

function monthName(key) {
  const date = new Date(`${key}-01T00:00:00`);
  if (Number.isNaN(date.getTime())) return key;
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "long" });
}

function dayName(key) {
  const date = new Date(`${key}T00:00:00`);
  if (Number.isNaN(date.getTime())) return key;
  return date.toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" });
}

function jobLabel(job) {
  return job ? `${job.company} · ${job.position}` : "未关联岗位";
}

function sortJobs(jobs) {
  return [...jobs].sort((a, b) =>
    jobLabel(a).localeCompare(jobLabel(b), "zh-Hans-CN") || String(a.recordId).localeCompare(String(b.recordId)),
  );
}

export const Calendar = {
  setup() {
    const nowKey = todayKey();
    const currentMonth = ref(monthKeyFromDate(nowKey));
    const selectedDate = ref(nowKey);
    const events = ref(sortCalendarEvents(calendarEvents.load()));
    const editingId = ref("");
    const formError = ref("");
    const form = reactive({
      recordId: "",
      type: "interview1",
      title: "",
      startDate: nowKey,
      startTime: "09:00",
      endDate: "",
      endTime: "",
      targetStatus: "一面",
      note: "",
    });

    const jobs = computed(() => sortJobs(state.jobs));
    const cells = computed(() => monthCells(currentMonth.value, events.value));
    const selectedEvents = computed(() => eventsForDate(events.value, selectedDate.value));
    const upcomingEvents = computed(() =>
      sortCalendarEvents(events.value).filter((event) => eventEndAt(event) >= Date.now()).slice(0, 8),
    );
    const monthLabel = computed(() => monthName(currentMonth.value));
    const selectedLabel = computed(() => dayName(selectedDate.value));

    function jobById(recordId) {
      return state.jobs.find((job) => job.recordId === recordId) || null;
    }

    function selectedJob() {
      return jobById(form.recordId);
    }

    function autoTitle(type = form.type, recordId = form.recordId) {
      const label = eventTypeLabel(type);
      const job = jobById(recordId);
      return job ? `${jobLabel(job)}｜${label}` : label;
    }

    function titleLooksAuto() {
      return CALENDAR_EVENT_TYPES.some((type) =>
        form.title === type.label || form.title.endsWith(`｜${type.label}`),
      );
    }

    function persistEvents() {
      events.value = sortCalendarEvents(events.value);
      calendarEvents.save(events.value);
    }

    function resetForm(day = selectedDate.value) {
      const recordId = currentJobRef.value?.recordId || state.currentJobId || jobs.value[0]?.recordId || "";
      const type = "interview1";
      editingId.value = "";
      formError.value = "";
      Object.assign(form, {
        recordId,
        type,
        title: autoTitle(type, recordId),
        startDate: day,
        startTime: "09:00",
        endDate: "",
        endTime: "",
        targetStatus: defaultStatusForType(type),
        note: "",
      });
    }

    function applyTypeDefaults() {
      const nextStatus = defaultStatusForType(form.type);
      const currentIsDefault = CALENDAR_EVENT_TYPES.some((type) => type.defaultStatus === form.targetStatus);
      if (!form.targetStatus || currentIsDefault) form.targetStatus = nextStatus;
      if (!form.title || titleLooksAuto()) form.title = autoTitle();
    }

    function applyJobDefault() {
      if (!form.title || titleLooksAuto()) form.title = autoTitle();
    }

    function selectDate(key) {
      selectedDate.value = key;
      if (!editingId.value) form.startDate = key;
    }

    function shiftMonth(step) {
      const date = new Date(`${currentMonth.value}-01T00:00:00`);
      date.setMonth(date.getMonth() + step);
      currentMonth.value = dateKey(date).slice(0, 7);
    }

    function goToday() {
      const key = todayKey();
      currentMonth.value = monthKeyFromDate(key);
      selectDate(key);
    }

    function buildEvent() {
      const startsAt = localDateTimeMillis(form.startDate, form.startTime || "09:00");
      const hasEnd = Boolean(form.endDate || form.endTime);
      const endsAt = hasEnd
        ? localDateTimeMillis(form.endDate || form.startDate, form.endTime || form.startTime || "09:00")
        : null;
      const existing = events.value.find((event) => event.id === editingId.value);
      return normalizeCalendarEvent({
        ...existing,
        recordId: form.recordId,
        type: form.type,
        title: form.title,
        startsAt,
        endsAt,
        targetStatus: form.targetStatus,
        note: form.note,
      });
    }

    function saveEvent() {
      formError.value = "";
      try {
        const event = buildEvent();
        events.value = [...events.value.filter((item) => item.id !== event.id), event];
        persistEvents();
        selectedDate.value = dateKey(event.startsAt);
        currentMonth.value = monthKeyFromDate(selectedDate.value);
        resetForm(selectedDate.value);
        toast("日程已保存");
      } catch (failure) {
        formError.value = failure.message || "保存失败";
      }
    }

    function editEvent(event) {
      const start = splitLocalDateTime(event.startsAt);
      const end = event.endsAt ? splitLocalDateTime(event.endsAt) : { date: "", time: "" };
      editingId.value = event.id;
      formError.value = "";
      Object.assign(form, {
        recordId: event.recordId || "",
        type: event.type || "other",
        title: event.title || "",
        startDate: start.date,
        startTime: start.time,
        endDate: end.date,
        endTime: end.time,
        targetStatus: event.targetStatus || "",
        note: event.note || "",
      });
    }

    async function deleteEvent(event) {
      const ok = await confirmDialog({
        title: `删除「${event.title}」？`,
        body: "只会删除这条本地日历，不会改岗位记录。",
        danger: true,
      });
      if (!ok) return;
      events.value = events.value.filter((item) => item.id !== event.id);
      persistEvents();
      if (editingId.value === event.id) resetForm(selectedDate.value);
      toast("日程已删除");
    }

    async function applyStatus(event) {
      const job = jobById(event.recordId);
      if (!job) {
        toast("这个日程没有关联岗位");
        return;
      }
      try {
        await saveJobPatch(job.recordId, { status: event.targetStatus });
        const marked = markStatusApplied(event);
        events.value = events.value.map((item) => item.id === event.id ? marked : item);
        persistEvents();
        toast(`已更新为「${event.targetStatus}」`);
      } catch (failure) {
        if (!handleError(failure)) toast(failure.message || "状态更新失败");
      }
    }

    function openJob(recordId) {
      if (!recordId) return;
      setCurrentJob(recordId);
      location.hash = "#/job/info";
    }

    function selectEventDate(event) {
      const key = dateKey(event.startsAt);
      if (!key) return;
      currentMonth.value = monthKeyFromDate(key);
      selectDate(key);
    }

    function dueStatus(event) {
      return shouldOfferStatusUpdate(event, jobById(event.recordId));
    }

    function eventJobLabel(event) {
      return jobLabel(jobById(event.recordId));
    }

    function formatAgendaTime(event) {
      const start = splitLocalDateTime(event.startsAt);
      if (!start.date) return "";
      const time = formatEventTime(event);
      return time.includes("-") && time.includes(start.date) ? time : `${start.date} ${time}`;
    }

    function isToday(key) {
      return key === todayKey();
    }

    watch(
      () => [state.jobs.length, state.currentJobId],
      () => {
        if (!editingId.value && !form.recordId) resetForm(selectedDate.value);
      },
    );

    resetForm(nowKey);

    return {
      state,
      statuses,
      events,
      jobs,
      cells,
      selectedDate,
      selectedEvents,
      upcomingEvents,
      currentMonth,
      monthLabel,
      selectedLabel,
      WEEKDAYS,
      CALENDAR_EVENT_TYPES,
      editingId,
      form,
      formError,
      selectDate,
      shiftMonth,
      goToday,
      saveEvent,
      editEvent,
      deleteEvent,
      applyStatus,
      applyTypeDefaults,
      applyJobDefault,
      formatEventTime,
      formatAgendaTime,
      eventTypeLabel,
      eventJobLabel,
      dueStatus,
      openJob,
      selectEventDate,
      isToday,
      selectedJob,
      resetForm,
    };
  },
  template: `
    <div class="page calendar-page">
      <header class="pagehead calendar-head">
        <div>
          <h2 class="ptitle">日历</h2>
          <p class="muted">面试、笔试截止和其它时间点先保存在本机；到点后可一键写回岗位状态。</p>
        </div>
        <span class="grow"></span>
        <div class="calendar-nav">
          <button class="ghost" type="button" @click="shiftMonth(-1)">‹</button>
          <strong>{{ monthLabel }}</strong>
          <button class="ghost" type="button" @click="shiftMonth(1)">›</button>
          <button class="ghost" type="button" @click="goToday">今天</button>
        </div>
      </header>

      <div class="calendar-layout">
        <section class="calendar-month" aria-label="月视图">
          <div class="calendar-weekdays">
            <span v-for="day in WEEKDAYS" :key="day">{{ day }}</span>
          </div>
          <div class="calendar-grid" role="grid">
            <button v-for="cell in cells" :key="cell.key" type="button" role="gridcell"
              class="calendar-day" :class="{ off: !cell.inMonth, on: selectedDate === cell.key, today: isToday(cell.key) }"
              @click="selectDate(cell.key)">
              <span class="calendar-date">{{ cell.day }}</span>
              <span v-for="event in cell.events.slice(0, 3)" :key="event.id" class="calendar-chip">
                <b>{{ formatEventTime(event) }}</b>{{ event.title }}
              </span>
              <em v-if="cell.events.length > 3">+{{ cell.events.length - 3 }}</em>
            </button>
          </div>
        </section>

        <aside class="calendar-sidepanel">
          <section class="calendar-card">
            <div class="calendar-card-head">
              <h3>{{ selectedLabel }}</h3>
              <span class="pill">{{ selectedEvents.length }} 项</span>
            </div>
            <p v-if="!selectedEvents.length" class="muted calendar-empty">这天还没有安排。</p>
            <article v-for="event in selectedEvents" :key="event.id" class="calendar-event">
              <header>
                <span class="dot" :class="'s-' + (event.targetStatus || '待投')"></span>
                <div>
                  <strong>{{ event.title }}</strong>
                  <p>{{ formatEventTime(event) }} · {{ eventTypeLabel(event.type) }}</p>
                </div>
              </header>
              <button v-if="event.recordId" class="link calendar-job-link" type="button" @click="openJob(event.recordId)">
                {{ eventJobLabel(event) }}
              </button>
              <p v-if="event.note" class="calendar-note">{{ event.note }}</p>
              <p v-if="event.targetStatus" class="muted">绑定状态：{{ event.targetStatus }}</p>
              <div class="calendar-event-actions">
                <button v-if="dueStatus(event)" class="primary" type="button" @click="applyStatus(event)">
                  更新为「{{ event.targetStatus }}」
                </button>
                <span v-else-if="event.statusAppliedAt" class="pill ok">已写回状态</span>
                <button class="link" type="button" @click="editEvent(event)">编辑</button>
                <button class="danger-link" type="button" @click="deleteEvent(event)">删除</button>
              </div>
            </article>
          </section>

          <section class="calendar-card">
            <div class="calendar-card-head">
              <h3>{{ editingId ? '编辑日程' : '新增日程' }}</h3>
              <button v-if="editingId" class="link" type="button" @click="resetForm(selectedDate)">取消编辑</button>
            </div>
            <div class="calendar-form">
              <label>
                <span>关联岗位</span>
                <select v-model="form.recordId" @change="applyJobDefault">
                  <option value="">不关联岗位</option>
                  <option v-for="job in jobs" :key="job.recordId" :value="job.recordId">
                    {{ job.company }} · {{ job.position }}
                  </option>
                </select>
              </label>
              <label>
                <span>类型</span>
                <select v-model="form.type" @change="applyTypeDefaults">
                  <option v-for="type in CALENDAR_EVENT_TYPES" :key="type.value" :value="type.value">
                    {{ type.label }}
                  </option>
                </select>
              </label>
              <label class="wide">
                <span>标题</span>
                <input v-model="form.title" type="text" placeholder="例如：腾讯一面 / 美团笔试截止">
              </label>
              <label>
                <span>开始日期</span>
                <input v-model="form.startDate" type="date">
              </label>
              <label>
                <span>开始时间</span>
                <input v-model="form.startTime" type="time">
              </label>
              <label>
                <span>结束日期</span>
                <input v-model="form.endDate" type="date" placeholder="留空表示时间点">
              </label>
              <label>
                <span>结束时间</span>
                <input v-model="form.endTime" type="time">
              </label>
              <label class="wide">
                <span>到点后提醒更新状态</span>
                <select v-model="form.targetStatus">
                  <option value="">不绑定状态</option>
                  <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
                </select>
              </label>
              <label class="wide">
                <span>备注</span>
                <textarea v-model="form.note" rows="3" placeholder="地点、会议链接、注意事项等"></textarea>
              </label>
            </div>
            <p v-if="formError" class="bad">{{ formError }}</p>
            <div class="drow">
              <button class="primary" type="button" @click="saveEvent">{{ editingId ? '保存修改' : '加入日历' }}</button>
              <button class="ghost" type="button" @click="resetForm(selectedDate)">重置</button>
            </div>
          </section>

          <section v-if="upcomingEvents.length" class="calendar-card compact">
            <h3>接下来</h3>
            <button v-for="event in upcomingEvents" :key="event.id" type="button" class="calendar-upcoming"
              @click="selectEventDate(event)">
              <span>{{ formatAgendaTime(event) }}</span>
              <strong>{{ event.title }}</strong>
            </button>
          </section>
        </aside>
      </div>
    </div>`,
};
