import {
  CALENDAR_EVENT_TYPES,
  WEEKDAYS,
  dateKey,
  defaultStatusForType,
  eventEndAt,
  eventTypeLabel,
  eventsForDate,
  formatEventTime,
  isLocalCalendarEvent,
  localDateTimeMillis,
  markStatusApplied,
  monthCells,
  normalizeCalendarEvent,
  shouldOfferStatusUpdate,
  sortCalendarEvents,
  splitLocalDateTime,
  todayKey,
} from "../calendar-events.js";
import { api } from "../api.js";
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
import { matchesJobSearch } from "../job-search.js";

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
    const eventsLoading = ref(false);
    const calendarError = ref("");
    const backendReady = ref(false);
    const editingId = ref("");
    const savingEvent = ref(false);
    const jobQuery = ref("");
    const jobPickerOpen = ref(false);
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

    const selectedJob = computed(() => jobById(form.recordId));
    const filteredJobOptions = computed(() => {
      const query = jobQuery.value.trim();
      const pool = query ? jobs.value.filter((job) => matchesJobSearch(job, query)) : jobs.value;
      return pool.slice(0, 8);
    });

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

    function cacheServerEvents(items) {
      events.value = sortCalendarEvents(items);
      calendarEvents.save(events.value);
    }

    function serverPayload(event) {
      return {
        ...event,
        clientId: event.clientId || (isLocalCalendarEvent(event) ? event.id : ""),
      };
    }

    async function syncLocalEvents(serverItems) {
      const serverClientIds = new Set(serverItems.map((event) => event.clientId).filter(Boolean));
      const localOnly = sortCalendarEvents(calendarEvents.load()).filter((event) =>
        isLocalCalendarEvent(event) && !serverClientIds.has(event.id),
      );
      if (!localOnly.length) return serverItems;
      const created = [];
      for (const event of localOnly) created.push(await api.createCalendarEvent(serverPayload(event)));
      return sortCalendarEvents([...serverItems, ...created]);
    }

    async function loadEvents() {
      eventsLoading.value = true;
      calendarError.value = "";
      try {
        const serverItems = sortCalendarEvents(await api.calendarEvents());
        const merged = await syncLocalEvents(serverItems);
        cacheServerEvents(merged);
        backendReady.value = true;
      } catch (failure) {
        backendReady.value = false;
        calendarError.value = failure.message || "日历表暂不可用，先显示本机缓存";
        handleError(failure);
      } finally {
        eventsLoading.value = false;
      }
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
      jobQuery.value = recordId ? jobLabel(jobById(recordId)) : "";
      jobPickerOpen.value = false;
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

    function selectJob(job) {
      form.recordId = job?.recordId || "";
      jobQuery.value = job ? jobLabel(job) : "";
      jobPickerOpen.value = false;
      applyJobDefault();
    }

    function clearJob() {
      form.recordId = "";
      jobQuery.value = "";
      jobPickerOpen.value = true;
      applyJobDefault();
    }

    function updateJobQuery() {
      jobPickerOpen.value = true;
      if (form.recordId && jobQuery.value.trim() !== jobLabel(selectedJob.value)) {
        form.recordId = "";
        applyJobDefault();
      }
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

    async function saveEvent() {
      formError.value = "";
      savingEvent.value = true;
      let event = null;
      try {
        event = buildEvent();
        let saved = event;
        if (backendReady.value) {
          saved = isLocalCalendarEvent(event)
            ? await api.createCalendarEvent(serverPayload(event))
            : await api.patchCalendarEvent(event.id, serverPayload(event));
        } else {
          calendarError.value = "日历表暂不可用，这条先保存在本机。";
        }
        events.value = [...events.value.filter((item) => item.id !== event.id && item.id !== saved.id), saved];
        persistEvents();
        selectedDate.value = dateKey(saved.startsAt);
        currentMonth.value = monthKeyFromDate(selectedDate.value);
        resetForm(selectedDate.value);
        toast(backendReady.value ? "日程已保存" : "日程已暂存在本机");
      } catch (failure) {
        if (event && handleError(failure)) {
          backendReady.value = false;
          calendarError.value = "日历表暂不可用，这条先保存在本机。";
          events.value = [...events.value.filter((item) => item.id !== event.id), event];
          persistEvents();
          resetForm(dateKey(event.startsAt));
          toast("日程已暂存在本机");
        } else {
          formError.value = failure.message || "保存失败";
        }
      } finally {
        savingEvent.value = false;
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
      jobQuery.value = event.recordId ? jobLabel(jobById(event.recordId)) : "";
      jobPickerOpen.value = false;
    }

    async function deleteEvent(event) {
      const ok = await confirmDialog({
        title: `删除「${event.title}」？`,
        body: "只会删除这条日程，不会改岗位记录。",
        danger: true,
      });
      if (!ok) return;
      try {
        if (backendReady.value && !isLocalCalendarEvent(event)) await api.deleteCalendarEvent(event.id);
        events.value = events.value.filter((item) => item.id !== event.id);
        persistEvents();
        if (editingId.value === event.id) resetForm(selectedDate.value);
        toast("日程已删除");
      } catch (failure) {
        if (!handleError(failure)) toast(failure.message || "删除失败");
      }
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
        const saved = backendReady.value && !isLocalCalendarEvent(marked)
          ? await api.patchCalendarEvent(marked.id, serverPayload(marked))
          : marked;
        events.value = events.value.map((item) => item.id === event.id ? saved : item);
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
    void loadEvents();

    return {
      state,
      statuses,
      events,
      eventsLoading,
      calendarError,
      backendReady,
      savingEvent,
      loadEvents,
      jobs,
      jobQuery,
      jobPickerOpen,
      selectedJob,
      filteredJobOptions,
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
      selectJob,
      clearJob,
      updateJobQuery,
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
          <p class="muted">面试、笔试截止和其它时间点会同步到飞书日历表；到点后可一键写回岗位状态。</p>
        </div>
        <span class="grow"></span>
        <div class="calendar-nav">
          <button class="ghost" type="button" @click="shiftMonth(-1)">‹</button>
          <strong>{{ monthLabel }}</strong>
          <button class="ghost" type="button" @click="shiftMonth(1)">›</button>
          <button class="ghost" type="button" @click="goToday">今天</button>
        </div>
      </header>

      <p v-if="calendarError" class="notice bad">
        {{ calendarError }}
        <button class="link" type="button" :disabled="eventsLoading" @click="loadEvents">重试加载</button>
      </p>
      <p v-else-if="eventsLoading" class="notice">正在加载日历表…</p>

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
              <div class="calendar-job-picker wide">
                <span>关联岗位</span>
                <div v-if="selectedJob" class="calendar-selected-job">
                  <button class="link" type="button" @click="openJob(selectedJob.recordId)">
                    {{ selectedJob.company }} · {{ selectedJob.position }}
                  </button>
                  <span class="pill">{{ selectedJob.status }}</span>
                  <button class="link" type="button" @click="clearJob">清除</button>
                </div>
                <input v-model="jobQuery" type="search" placeholder="搜公司或岗位名，支持部分关键词"
                  @focus="jobPickerOpen = true" @input="updateJobQuery">
                <div v-if="jobPickerOpen" class="calendar-job-options">
                  <button v-for="job in filteredJobOptions" :key="job.recordId" type="button"
                    :class="{ on: job.recordId === form.recordId }" @mousedown.prevent @click="selectJob(job)">
                    <strong>{{ job.company }}</strong>
                    <span>{{ job.position }}</span>
                    <small>{{ job.status }}</small>
                  </button>
                  <p v-if="!filteredJobOptions.length" class="muted">没有匹配的岗位。</p>
                </div>
              </div>
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
              <button class="primary" type="button" :disabled="savingEvent" @click="saveEvent">
                {{ savingEvent ? '保存中…' : editingId ? '保存修改' : '加入日历' }}
              </button>
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
