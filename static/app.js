const state = {
  user: null,
  users: [],
  tasks: [],
  stats: {},
  monthly: {},
  teamOverview: [],
  reminders: [],
  type: "all",
  delayedOnly: false,
  status: "all",
  priority: "all",
  month: new Date().toISOString().slice(0, 7),
  selectedOwnerId: null,
  selectedOwnerName: "",
  selectedScopeLabel: "",
  dueStart: "",
  dueEnd: "",
  search: "",
  reminderFilter: "all",
  taskPage: 1,
  taskPageSize: 10,
};

const taskTypeLabel = {
  week: "本周",
  month: "本月",
  year: "年度",
};

const statusLabel = {
  todo: "待处理",
  doing: "进行中",
  done: "已完成",
};

const priorityLabel = {
  high: "高",
  medium: "中",
  low: "低",
};

function todayISO() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function currentMonth() {
  return todayISO().slice(0, 7);
}

function shiftMonth(month, offset) {
  const [year, monthIndex] = month.split("-").map(Number);
  const date = new Date(year, monthIndex - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthRange(month) {
  const start = `${month}-01`;
  const endMonth = shiftMonth(month, 1);
  const endDate = new Date(`${endMonth}-01T00:00:00`);
  endDate.setDate(endDate.getDate() - 1);
  const localEnd = new Date(endDate.getTime() - endDate.getTimezoneOffset() * 60000);
  return { start, end: localEnd.toISOString().slice(0, 10) };
}

function nextMonthSameDay(dateText) {
  const source = dateText || todayISO();
  const [year, month, day] = source.split("-").map(Number);
  const nextMonthStart = new Date(year, month, 1);
  const nextMonthEnd = new Date(year, month + 1, 0);
  const nextDay = Math.min(day, nextMonthEnd.getDate());
  const nextDate = new Date(nextMonthStart.getFullYear(), nextMonthStart.getMonth(), nextDay);
  const local = new Date(nextDate.getTime() - nextDate.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function nextWeekSameDay(dateText) {
  const source = dateText || todayISO();
  const [year, month, day] = source.split("-").map(Number);
  const nextDate = new Date(year, month - 1, day + 7);
  const local = new Date(nextDate.getTime() - nextDate.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function setDateLimits() {
  const minDate = todayISO();
  document.querySelectorAll('input[type="date"]').forEach((input) => {
    input.min = minDate;
  });
}

function monthParts(month) {
  const [year, monthValue] = month.split("-");
  return { year, monthValue };
}

function syncMonthControls() {
  const yearInput = document.querySelector("#yearInput");
  const monthSelect = document.querySelector("#monthSelect");
  if (!yearInput || !monthSelect) return;
  const { year, monthValue } = monthParts(state.month);
  yearInput.value = year;
  monthSelect.value = monthValue;
}

function monthFromControls() {
  const yearInput = document.querySelector("#yearInput");
  const monthSelect = document.querySelector("#monthSelect");
  const fallback = currentMonth();
  const year = Number.parseInt(yearInput.value, 10);
  if (!Number.isInteger(year) || year < 2000) {
    return fallback;
  }
  return `${year}-${monthSelect.value}`;
}

const api = {
  async me() {
    return request("/api/me");
  },
  async bootstrap() {
    return request("/api/bootstrap");
  },
  async register(payload) {
    return request("/api/register", { method: "POST", body: payload });
  },
  async login(payload) {
    return request("/api/login", { method: "POST", body: payload });
  },
  async resetOtp(payload) {
    return request("/api/reset-otp", { method: "POST", body: payload });
  },
  async logout() {
    return fetch("/api/logout", { method: "POST" });
  },
  async changePassword(payload) {
    return request("/api/change-password", { method: "POST", body: payload });
  },
  async tasks() {
    const params = new URLSearchParams({
      type: state.type,
      status: state.status,
      priority: state.priority,
      delayed: state.delayedOnly ? "1" : "0",
      month: state.month,
    });
    if (state.selectedOwnerId) {
      params.set("owner_id", state.selectedOwnerId);
    }
    if (state.dueStart) {
      params.set("due_start", state.dueStart);
    }
    if (state.dueEnd) {
      params.set("due_end", state.dueEnd);
    }
    if (state.search) {
      params.set("q", state.search);
    }
    return request(`/api/tasks?${params.toString()}`);
  },
  async createTask(payload) {
    return request("/api/tasks", { method: "POST", body: payload });
  },
  async updateTask(id, payload) {
    return request(`/api/tasks/${id}`, { method: "PATCH", body: payload });
  },
  async deleteTask(id) {
    return request(`/api/tasks/${id}`, { method: "DELETE" });
  },
  async createTaskComment(id, payload) {
    return request(`/api/tasks/${id}/comments`, { method: "POST", body: payload });
  },
  async reminders() {
    return request("/api/reminders");
  },
  async createReminder(payload) {
    return request("/api/reminders", { method: "POST", body: payload });
  },
  async updateReminder(id, payload) {
    return request(`/api/reminders/${id}`, { method: "PATCH", body: payload });
  },
  async deleteReminder(id) {
    return request(`/api/reminders/${id}`, { method: "DELETE" });
  },
  async convertReminderToTask(id, payload) {
    return request(`/api/reminders/${id}/task`, { method: "POST", body: payload });
  },
  async updateUserRole(payload) {
    return request("/api/users/role", { method: "POST", body: payload });
  },
  async deleteUser(payload) {
    return request("/api/users/delete", { method: "POST", body: payload });
  },
};

async function request(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 204) {
    return {};
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "请求失败");
  }
  return data;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formPayload(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.style.display = "block";
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.style.display = "none";
  }, 1800);
}

function showAuth() {
  document.querySelector("#authView").classList.remove("hidden");
  document.querySelector("#appView").classList.add("hidden");
}

function showApp() {
  document.querySelector("#authView").classList.add("hidden");
  document.querySelector("#appView").classList.remove("hidden");
}

function showTaskPage() {
  document.querySelector("#taskPage").classList.remove("hidden");
  document.querySelector("#reminderPage").classList.add("hidden");
  document.querySelector("#openTaskDialog").classList.remove("hidden");
  document.querySelector("#showTaskPage").classList.add("active");
  document.querySelector("#showReminderPage").classList.remove("active");
}

function showReminderPage() {
  document.querySelector("#taskPage").classList.add("hidden");
  document.querySelector("#reminderPage").classList.remove("hidden");
  document.querySelector("#openTaskDialog").classList.add("hidden");
  document.querySelector("#showTaskPage").classList.remove("active");
  document.querySelector("#showReminderPage").classList.add("active");
  renderReminders();
}

function renderStats() {
  document.querySelector("#statTotal").textContent = state.stats.total || 0;
  document.querySelector("#statWeek").textContent = state.stats.week || 0;
  document.querySelector("#statMonth").textContent = state.stats.month || 0;
  document.querySelector("#statYear").textContent = state.stats.year || 0;
  document.querySelector("#statDelayed").textContent = state.stats.delayed || 0;
}

function renderMonthly() {
  syncMonthControls();
  document.querySelector("#monthDue").textContent = state.monthly.due || 0;
  document.querySelector("#monthCompleted").textContent = state.monthly.completed || 0;
  document.querySelector("#monthDelayed").textContent = state.monthly.delayed || 0;
  document.querySelector("#monthRate").textContent = `${state.monthly.rate || 0}%`;
  const review = document.querySelector("#monthReview");
  if (review) {
    review.innerHTML = `
      <strong>月度复盘</strong>
      <span>到期 ${state.monthly.due || 0}，完成 ${state.monthly.completed || 0}，延期 ${state.monthly.delayed || 0}，完成率 ${state.monthly.rate || 0}%</span>
    `;
  }
  const weekList = document.querySelector("#monthWeekList");
  if (!weekList) return;
  const weeks = state.monthly.weeks || [];
  weekList.innerHTML = weeks.map((week) => `
    <article class="week-row ${week.delayed ? "danger" : ""}" data-week-start="${escapeHtml(week.start)}" data-week-end="${escapeHtml(week.end)}" data-week-label="${escapeHtml(week.label)}" data-week-range="${escapeHtml(week.range)}" tabindex="0" role="button" aria-label="查看${escapeHtml(week.label)}任务">
      <div>
        <strong>${escapeHtml(week.label)}</strong>
        <span>${escapeHtml(week.range)}</span>
      </div>
      <div class="week-metrics">
        <span><b>${week.due || 0}</b>到期</span>
        <span><b>${week.completed || 0}</b>完成</span>
        <span><b>${week.delayed || 0}</b>延期</span>
      </div>
    </article>
  `).join("");
}

function isThisWeek(task) {
  if (!task.due_at || task.status === "done") return false;
  const today = new Date(`${todayISO()}T00:00:00`);
  const due = new Date(`${task.due_at}T00:00:00`);
  const day = today.getDay() || 7;
  const start = new Date(today);
  start.setDate(today.getDate() - day + 1);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return due >= start && due <= end;
}

function renderTodayBoard() {
  const board = document.querySelector("#todayBoard");
  if (!board) return;
  const delayed = state.tasks.filter((task) => task.is_delayed && task.status !== "done").length;
  const weekOpen = state.tasks.filter(isThisWeek).length;
  const urgentReminders = state.reminders.filter((item) => item.status === "open" && (item.is_due_soon || item.is_overdue)).length;
  const convertedOpen = state.reminders.filter((item) => item.task_id && item.linked_task_status !== "done").length;
  board.innerHTML = `
    <button type="button" data-today-scope="delayed"><b>${delayed}</b><span>延期待处理</span></button>
    <button type="button" data-today-scope="week"><b>${weekOpen}</b><span>本周未完成</span></button>
    <button type="button" data-today-scope="reminders"><b>${urgentReminders}</b><span>提醒需关注</span></button>
    <button type="button" data-today-scope="converted-reminders"><b>${convertedOpen}</b><span>已转任务未完成</span></button>
  `;
}

function reminderClass(reminder) {
  if (reminder.status === "done") return "done";
  if (reminder.is_overdue) return "overdue";
  if (reminder.is_due_soon) return "soon";
  return "";
}

function reminderStatusText(reminder) {
  if (reminder.status === "done") return "已完成";
  if (reminder.is_overdue) return `已逾期 ${Math.abs(reminder.days_left)} 天`;
  if (reminder.is_due_soon) return `提醒中，剩余 ${reminder.days_left} 天`;
  return `${reminder.remind_at} 开始提醒`;
}

function reminderCounts() {
  return {
    all: state.reminders.length,
    open: state.reminders.filter((item) => item.status === "open").length,
    attention: state.reminders.filter((item) => item.status === "open" && (item.is_due_soon || item.is_overdue)).length,
    converted: state.reminders.filter((item) => item.task_id && item.linked_task_status !== "done").length,
    done: state.reminders.filter((item) => item.status === "done").length,
  };
}

function filteredReminders() {
  if (state.reminderFilter === "open") return state.reminders.filter((item) => item.status === "open");
  if (state.reminderFilter === "attention") return state.reminders.filter((item) => item.status === "open" && (item.is_due_soon || item.is_overdue));
  if (state.reminderFilter === "converted") return state.reminders.filter((item) => item.task_id && item.linked_task_status !== "done");
  if (state.reminderFilter === "done") return state.reminders.filter((item) => item.status === "done");
  return state.reminders;
}

function renderReminderFilters() {
  const bar = document.querySelector("#reminderFilters");
  const summary = document.querySelector("#reminderSummary");
  if (!bar || !summary) return;
  const counts = reminderCounts();
  const filters = [
    ["all", "全部", counts.all],
    ["open", "未完成", counts.open],
    ["attention", "需关注", counts.attention],
    ["converted", "已转任务", counts.converted],
    ["done", "已完成", counts.done],
  ];
  bar.innerHTML = filters.map(([key, label, count]) => `
    <button type="button" data-reminder-filter="${key}" class="${state.reminderFilter === key ? "active" : ""}">
      <span>${label}</span><b>${count}</b>
    </button>
  `).join("");
  summary.textContent = `${counts.open} 个未完成，${counts.attention} 个需关注`;
}

function renderReminders() {
  const list = document.querySelector("#reminderList");
  const summary = document.querySelector("#reminderSummary");
  if (!list || !summary) return;
  renderReminderFilters();
  const reminders = filteredReminders();

  if (!state.reminders.length) {
    list.innerHTML = '<div class="empty">还没有提醒事项。</div>';
    return;
  }
  if (!reminders.length) {
    list.innerHTML = '<div class="empty">当前筛选下没有提醒事项。</div>';
    return;
  }

  list.innerHTML = reminders.map((reminder) => `
    <article class="reminder-card ${reminderClass(reminder)}">
      <div>
        <div class="task-head">
          <span class="status ${reminder.status === "done" ? "done" : reminder.is_due_soon || reminder.is_overdue ? "delayed" : "doing"}">${escapeHtml(reminderStatusText(reminder))}</span>
          <h3>${escapeHtml(reminder.title)}</h3>
        </div>
        <p>${escapeHtml(reminder.note || "暂无备注")}</p>
        <div class="task-meta">
          <span>截止：${escapeHtml(reminder.due_at)}</span>
          <span>提醒日：${escapeHtml(reminder.remind_at)}</span>
          <span>提前 ${escapeHtml(reminder.remind_days || 15)} 天</span>
          ${reminder.task_id ? `<span>已转任务 #${escapeHtml(reminder.task_id)}${reminder.linked_task_status ? ` · ${escapeHtml(statusLabel[reminder.linked_task_status] || reminder.linked_task_status)}` : " · 任务未找到"}</span>` : ""}
        </div>
      </div>
      <div class="task-actions">
        ${!reminder.task_id && reminder.status !== "done" ? `<button data-reminder-action="task" data-id="${reminder.id}">转为任务</button>` : ""}
        ${reminder.status !== "done" ? `<button data-reminder-action="done" data-id="${reminder.id}">完成</button>` : `<button data-reminder-action="open" data-id="${reminder.id}">重新打开</button>`}
        <button data-reminder-action="delete" data-id="${reminder.id}">删除</button>
      </div>
    </article>
  `).join("");
}

async function showWeekTasks(row) {
  state.dueStart = row.dataset.weekStart;
  state.dueEnd = row.dataset.weekEnd;
  state.selectedScopeLabel = `${row.dataset.weekLabel} ${row.dataset.weekRange}`;
  if (!state.selectedOwnerId) {
    state.selectedOwnerName = "我的任务";
  }
  resetTaskPage();
  await refreshTasks();
  document.querySelector("#taskList").scrollIntoView({ block: "start", behavior: "smooth" });
}

async function showSideScope(scope) {
  const labels = {
    total: "全部任务",
    week: "本周任务",
    month: "本月任务",
    year: "年度任务",
    delayed: "已延期",
  };
  state.type = "all";
  state.status = "all";
  state.priority = "all";
  state.delayedOnly = false;
  state.dueStart = "";
  state.dueEnd = "";
  state.selectedScopeLabel = labels[scope] || "任务";
  if (!state.selectedOwnerId) {
    state.selectedOwnerName = "我的任务";
  }

  if (scope === "week" || scope === "month" || scope === "year") {
    state.type = scope;
  } else if (scope === "delayed") {
    state.delayedOnly = true;
  }

  syncFilterButtons();
  resetTaskPage();
  await refreshTasks();
  document.querySelector("#taskList").scrollIntoView({ block: "start", behavior: "smooth" });
}

async function showMonthScope(scope) {
  const labels = {
    due: "本月到期",
    completed: "本月已完成",
    delayed: "本月延期",
    all: "本月任务",
  };
  const range = monthRange(state.month);
  state.type = "all";
  state.status = "all";
  state.priority = "all";
  state.delayedOnly = false;
  state.dueStart = range.start;
  state.dueEnd = range.end;
  state.selectedScopeLabel = `${state.month} ${labels[scope] || "任务"}`;
  if (!state.selectedOwnerId) {
    state.selectedOwnerName = "我的任务";
  }

  if (scope === "completed") {
    state.status = "done";
  } else if (scope === "delayed") {
    state.delayedOnly = true;
  }

  syncFilterButtons();
  resetTaskPage();
  await refreshTasks();
  document.querySelector("#taskList").scrollIntoView({ block: "start", behavior: "smooth" });
}

function metricButton(item, metric, value, label) {
  return `
    <button type="button" class="metric-button" data-owner-id="${item.user_id}" data-owner-name="${escapeHtml(item.display_name)}" data-metric="${metric}">
      <b>${value || 0}</b>${label}
    </button>
  `;
}

function renderTeamOverview() {
  const panel = document.querySelector("#teamOverviewPanel");
  const list = document.querySelector("#teamOverviewList");
  if (!panel || !list) return;

  if (!state.teamOverview.length) {
    panel.classList.add("hidden");
    list.innerHTML = "";
    return;
  }

  panel.classList.remove("hidden");
  list.innerHTML = state.teamOverview.map((item) => {
    const delayedClass = item.delayed ? "danger" : "";
    return `
      <article class="team-row ${delayedClass}">
        <div>
          <strong>${escapeHtml(item.display_name)}${item.is_active ? "" : ' <span class="status delayed">已删除</span>'}</strong>
          <span>${item.is_active ? "点击右侧数字查看对应任务" : "用户已删除，历史任务仍保留"}</span>
        </div>
        <div class="team-metrics">
          ${metricButton(item, "total", item.total, "总数")}
          ${metricButton(item, "week", item.week, "本周")}
          ${metricButton(item, "month", item.month, "本月")}
          ${metricButton(item, "year", item.year, "年度")}
          ${metricButton(item, "doing", item.doing, "进行中")}
          ${metricButton(item, "done", item.done, "完成")}
          ${metricButton(item, "delayed", item.delayed, "延期")}
          <span><b>${item.completion_rate || 0}%</b>完成率</span>
        </div>
      </article>
    `;
  }).join("");
}

function renderTaskScope() {
  const bar = document.querySelector("#taskScopeBar");
  const text = document.querySelector("#taskScopeText");
  if (!bar || !text) return;

  if (!state.selectedOwnerId && !state.dueStart) {
    bar.classList.add("hidden");
    text.textContent = "";
    return;
  }

  bar.classList.remove("hidden");
  text.textContent = `当前查看：${state.selectedOwnerName || "我的任务"} - ${state.selectedScopeLabel || "当前筛选"}`;
}

function syncFilterButtons() {
  document.querySelectorAll("[data-type]").forEach((item) => {
    const activeType = state.delayedOnly ? "delayed" : state.type;
    item.classList.toggle("active", item.dataset.type === activeType);
  });
  document.querySelectorAll("[data-status]").forEach((item) => {
    item.classList.toggle("active", item.dataset.status === state.status);
  });
  document.querySelectorAll("[data-priority]").forEach((item) => {
    item.classList.toggle("active", item.dataset.priority === state.priority);
  });
}

async function showOverviewTasks(button) {
  const metric = button.dataset.metric;
  const labels = {
    total: "总数",
    week: "本周",
    month: "本月",
    year: "年度",
    doing: "进行中",
    done: "已完成",
    delayed: "延期",
  };

  state.selectedOwnerId = button.dataset.ownerId;
  state.selectedOwnerName = button.dataset.ownerName;
  state.selectedScopeLabel = labels[metric] || "任务";
  state.dueStart = "";
  state.dueEnd = "";
  state.type = "all";
  state.status = "all";
  state.priority = "all";
  state.delayedOnly = false;

  if (metric === "week" || metric === "month" || metric === "year") {
    state.type = metric;
  } else if (metric === "doing") {
    state.status = "doing";
  } else if (metric === "done") {
    state.status = "done";
  } else if (metric === "delayed") {
    state.delayedOnly = true;
  }

  syncFilterButtons();
  resetTaskPage();
  await refreshTasks();
  document.querySelector("#taskList").scrollIntoView({ block: "start", behavior: "smooth" });
}

function renderUserAdminPanel() {
  const panel = document.querySelector("#userAdminPanel");
  const list = document.querySelector("#userAdminList");
  if (!panel || !list) return;

  if (!state.user || state.user.role !== "admin") {
    panel.classList.add("hidden");
    list.innerHTML = "";
    return;
  }

  panel.classList.remove("hidden");
  list.innerHTML = state.users.map((user) => {
    const isAdmin = user.role === "admin";
    const isSelf = state.user && user.id === state.user.id;
    return `
      <article class="user-row">
        <div>
          <strong>${escapeHtml(user.display_name)}</strong>
          <span>${escapeHtml(user.username)} · ${isAdmin ? "管理员" : "普通用户"}</span>
        </div>
        <div class="user-actions">
          <button data-role-user="${user.id}" data-role="${isAdmin ? "user" : "admin"}" ${isSelf ? "disabled" : ""}>
            ${isAdmin ? "设为普通用户" : "设为管理员"}
          </button>
          <button class="danger-button" data-delete-user="${user.id}" data-user-name="${escapeHtml(user.display_name)}" ${isSelf ? "disabled" : ""}>删除用户</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderUsers() {
  const ownerSelect = document.querySelector("#ownerSelect");
  const reminderTaskOwnerSelect = document.querySelector("#reminderTaskOwnerSelect");
  const options = state.users.map((user) => `
    <option value="${user.id}" ${state.user && user.id === state.user.id ? "selected" : ""}>
      ${escapeHtml(user.display_name)}
    </option>
  `).join("");
  if (ownerSelect) ownerSelect.innerHTML = options;
  if (reminderTaskOwnerSelect) reminderTaskOwnerSelect.innerHTML = options;
}

function dueText(task) {
  return task.due_at ? `计划完成：${task.due_at}` : "未设置计划完成时间";
}

function taskClass(task) {
  if (task.is_delayed) return "delayed-card";
  if (task.status === "done") return "done-card";
  if (task.status === "doing") return "active-card";
  return "";
}

function taskActionHint(task) {
  if (task.status === "done") {
    return "";
  }
  if (task.is_delayed) {
    const reason = task.delay_reason ? "已记录延期原因" : "需要补充延期原因";
    return `
      <div class="action-hint danger">
        <strong>延期处理</strong>
        <span>${reason}，必要时调整计划完成时间并同步跟进人。</span>
      </div>
    `;
  }
  if (task.issue_note) {
    return `
      <div class="action-hint warn">
        <strong>存在问题</strong>
        <span>建议跟进人确认阻塞是否需要协调。</span>
      </div>
    `;
  }
  return "";
}

function rolloverButton(task) {
  if (task.status === "done") return "";
  const custom = `<button data-action="postpone-custom" data-id="${task.id}">自定义顺延</button>`;
  if (task.task_type === "week") {
    return `<button data-action="rollover-week" data-id="${task.id}">顺延下周</button>${custom}`;
  }
  if (task.task_type === "month") {
    return `<button data-action="rollover-month" data-id="${task.id}">顺延下月</button>${custom}`;
  }
  return custom;
}

function noteBlock(title, value, extraClass = "") {
  if (!value) return "";
  return `
    <div class="note-line ${extraClass}">
      <strong>${title}</strong>
      <span>${escapeHtml(value)}</span>
    </div>
  `;
}

function detailLine(label, value) {
  return `
    <div class="detail-line">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value || "未填写")}</strong>
    </div>
  `;
}

function detailSection(title, value) {
  return `
    <section class="detail-section">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(value || "未填写")}</p>
    </section>
  `;
}

function renderTaskComments(task) {
  const comments = task.comments || [];
  if (!comments.length) return '<div class="empty small-empty">暂无跟进记录。</div>';
  return comments.map((item) => `
    <article class="timeline-item">
      <strong>${escapeHtml(item.user_name || "未知用户")}</strong>
      <time>${escapeHtml(item.created_at || "")}</time>
      <p>${escapeHtml(item.comment || "")}</p>
    </article>
  `).join("");
}

function renderTaskLogs(task) {
  const logs = task.logs || [];
  if (!logs.length) return '<div class="empty small-empty">暂无操作记录。</div>';
  return logs.map((item) => `
    <article class="timeline-item muted-timeline">
      <strong>${escapeHtml(item.action || "操作")}</strong>
      <time>${escapeHtml(item.created_at || "")} · ${escapeHtml(item.user_name || "未知用户")}</time>
      <p>${escapeHtml(item.detail || "")}</p>
    </article>
  `).join("");
}

function isUrgent(task) {
  if (!task.due_at || task.status === "done") return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${task.due_at}T00:00:00`);
  const diffDays = Math.round((due - today) / 86400000);
  return diffDays <= 3;
}

function csvValue(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function exportDoingTasks() {
  const doingTasks = state.tasks.filter((task) => task.status === "doing");
  if (!doingTasks.length) {
    showToast("当前列表没有进行中的任务");
    return;
  }

  const header = ["标题", "类型", "优先级", "负责人", "跟进人", "计划完成", "是否延期", "执行备注", "问题", "延期原因"];
  const rows = doingTasks.map((task) => [
    task.title,
    taskTypeLabel[task.task_type] || task.task_type,
    priorityLabel[task.priority] || "中",
    task.owner_name,
    task.follower,
    task.due_at,
    task.is_delayed ? "是" : "否",
    task.work_note,
    task.issue_note,
    task.delay_reason,
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvValue).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `进行中任务-${todayISO()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast(`已导出 ${doingTasks.length} 条进行中任务`);
}

function canDeleteTask(task) {
  return state.user && (state.user.role === "admin" || String(task.creator_id) === String(state.user.id));
}

function taskPageCount() {
  return Math.max(1, Math.ceil(state.tasks.length / state.taskPageSize));
}

function clampTaskPage() {
  state.taskPage = Math.min(Math.max(1, state.taskPage), taskPageCount());
}

function pagedTasks() {
  clampTaskPage();
  const start = (state.taskPage - 1) * state.taskPageSize;
  return state.tasks.slice(start, start + state.taskPageSize);
}

function resetTaskPage() {
  state.taskPage = 1;
}

function renderTaskPagination() {
  const bar = document.querySelector("#taskPagination");
  const summary = document.querySelector("#taskPaginationSummary");
  const pageText = document.querySelector("#taskPageText");
  const prev = document.querySelector("#prevTaskPage");
  const next = document.querySelector("#nextTaskPage");
  const pageSize = document.querySelector("#taskPageSize");
  if (!bar || !summary || !pageText || !prev || !next || !pageSize) return;

  pageSize.value = String(state.taskPageSize);
  if (!state.tasks.length) {
    bar.classList.add("hidden");
    summary.textContent = "";
    pageText.textContent = "";
    return;
  }

  clampTaskPage();
  const total = state.tasks.length;
  const start = (state.taskPage - 1) * state.taskPageSize + 1;
  const end = Math.min(total, state.taskPage * state.taskPageSize);
  const pages = taskPageCount();

  bar.classList.remove("hidden");
  summary.textContent = `显示 ${start}-${end} 条，共 ${total} 条`;
  pageText.textContent = `${state.taskPage} / ${pages}`;
  prev.disabled = state.taskPage <= 1;
  next.disabled = state.taskPage >= pages;
}

function renderTasks() {
  const list = document.querySelector("#taskList");
  renderExportCount();
  renderTaskPagination();
  if (!state.tasks.length) {
    list.innerHTML = '<div class="empty">当前没有分配给你的任务。</div>';
    return;
  }

  list.innerHTML = pagedTasks().map((task) => `
    <article class="task-card ${taskClass(task)}" data-task-id="${task.id}" tabindex="0" role="button" aria-label="查看任务明细：${escapeHtml(task.title)}">
      <div>
        <div class="task-head">
          <span class="pill ${escapeHtml(task.task_type)}">${escapeHtml(taskTypeLabel[task.task_type])}</span>
          <span class="priority ${escapeHtml(task.priority || "medium")}">优先级：${escapeHtml(priorityLabel[task.priority] || "中")}</span>
          <span class="status ${escapeHtml(task.status)}">${escapeHtml(statusLabel[task.status])}</span>
          ${task.is_delayed ? '<span class="status delayed">已延期</span>' : ""}
          <h3>${escapeHtml(task.title)}</h3>
        </div>
        <p>${escapeHtml(task.description || "暂无说明")}</p>
        ${taskActionHint(task)}
        ${noteBlock("执行备注", task.work_note)}
        ${noteBlock("问题", task.issue_note, "problem")}
        ${noteBlock("延期原因", task.delay_reason, "delay")}
        <div class="task-meta">
          <span>${escapeHtml(dueText(task))}</span>
          <span>跟进人：${escapeHtml(task.follower || "未填写")}</span>
          <span>创建人：${escapeHtml(task.creator_name)}</span>
        </div>
      </div>
      <div class="task-actions">
        <button data-action="detail" data-id="${task.id}">查看明细</button>
        <button data-action="edit" data-id="${task.id}">更新进展</button>
        ${rolloverButton(task)}
        ${task.status !== "doing" ? `<button data-action="doing" data-id="${task.id}">进行中</button>` : ""}
        ${task.status !== "done" ? `<button data-action="done" data-id="${task.id}">完成</button>` : ""}
        ${canDeleteTask(task) ? `<button data-action="delete" data-id="${task.id}">删除</button>` : ""}
      </div>
    </article>
  `).join("");
}

function renderExportCount() {
  const button = document.querySelector("#exportDoingTasks");
  if (!button) return;
  const count = state.tasks.filter((task) => task.status === "doing").length;
  button.textContent = `导出进行中（${count}）`;
  button.disabled = count === 0;
}

function renderDashboard() {
  document.querySelector("#welcomeText").textContent = `${state.user.display_name}，这里是当前分配给你的任务。`;
  renderStats();
  renderMonthly();
  renderTeamOverview();
  renderUserAdminPanel();
  renderUsers();
  renderTaskScope();
  renderTodayBoard();
  renderTasks();
  renderReminders();
}

async function loadDashboard() {
  const data = await api.bootstrap();
  state.user = data.user;
  state.users = data.users;
  state.tasks = data.tasks;
  state.stats = data.stats;
  state.monthly = data.monthly;
  state.teamOverview = data.team_overview || [];
  state.reminders = data.reminders || [];
  showApp();
  renderDashboard();
  showTaskPage();
  openTaskFromHash();
}

async function refreshTasks() {
  const data = await api.tasks();
  state.tasks = data.tasks;
  state.stats = data.stats;
  state.monthly = data.monthly;
  state.teamOverview = data.team_overview || state.teamOverview;
  renderStats();
  renderMonthly();
  renderTeamOverview();
  renderTaskScope();
  renderTodayBoard();
  renderTasks();
  openTaskFromHash();
}

async function refreshDashboard() {
  const data = await api.bootstrap();
  state.user = data.user;
  state.users = data.users;
  state.tasks = data.tasks;
  state.stats = data.stats;
  state.monthly = data.monthly;
  state.teamOverview = data.team_overview || [];
  state.reminders = data.reminders || state.reminders;
  renderDashboard();
  renderTodayBoard();
  openTaskFromHash();
}

async function refreshReminders() {
  const data = await api.reminders();
  state.reminders = data.reminders || [];
  renderReminders();
  renderTodayBoard();
}

function setAuthTab(tabName) {
  document.querySelectorAll("#authTabs button").forEach((button) => {
    button.classList.toggle("active", button.dataset.authTab === tabName);
  });
  document.querySelector("#loginForm").classList.toggle("hidden", tabName !== "login");
  document.querySelector("#registerForm").classList.toggle("hidden", tabName !== "register");
  document.querySelector("#resetOtpForm").classList.add("hidden");
}

function renderGoogleOtpSetup(data) {
  const qr = document.querySelector("#setupQr");
  qr.src = data.qr_url;
  qr.hidden = !data.qr_url;
  document.querySelector("#setupSecret").textContent = data.totp_secret;
  document.querySelector("#setupUri").textContent = data.otpauth_url;
  document.querySelector("#setupCode").textContent = data.current_code;
  document.querySelector("#setupBox").classList.remove("hidden");
}

document.querySelector("#authTabs").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-auth-tab]");
  if (!button) return;
  setAuthTab(button.dataset.authTab);
});

document.querySelector("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api.login(formPayload(form));
    form.reset();
    await loadDashboard();
    showToast("登录成功");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const data = await api.register(formPayload(form));
    renderGoogleOtpSetup(data);
    form.reset();
    setAuthTab("login");
    showToast("注册成功，请保存 Google 验证器密钥");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#showResetOtp").addEventListener("click", () => {
  document.querySelector("#loginForm").classList.add("hidden");
  document.querySelector("#registerForm").classList.add("hidden");
  document.querySelector("#resetOtpForm").classList.remove("hidden");
});

document.querySelector("#backToLogin").addEventListener("click", () => {
  setAuthTab("login");
});

document.querySelector("#resetOtpForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const data = await api.resetOtp(formPayload(form));
    renderGoogleOtpSetup(data);
    form.reset();
    setAuthTab("login");
    showToast("Google 验证器密钥已重置");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#logoutBtn").addEventListener("click", async () => {
  await api.logout();
  state.user = null;
  state.tasks = [];
  state.reminders = [];
  showAuth();
  showToast("已退出");
});

document.querySelector("#showTaskPage").addEventListener("click", showTaskPage);
document.querySelector("#showReminderPage").addEventListener("click", showReminderPage);

const taskSearch = document.querySelector("#taskSearch");
taskSearch.addEventListener("input", async (event) => {
  state.search = event.target.value.trim();
  resetTaskPage();
  await refreshTasks();
});
document.querySelector("#clearTaskSearch").addEventListener("click", async () => {
  state.search = "";
  taskSearch.value = "";
  resetTaskPage();
  await refreshTasks();
});
document.querySelector("#exportDoingTasks").addEventListener("click", exportDoingTasks);
document.querySelector("#prevTaskPage").addEventListener("click", () => {
  state.taskPage -= 1;
  renderTasks();
  document.querySelector("#taskList").scrollIntoView({ block: "start", behavior: "smooth" });
});
document.querySelector("#nextTaskPage").addEventListener("click", () => {
  state.taskPage += 1;
  renderTasks();
  document.querySelector("#taskList").scrollIntoView({ block: "start", behavior: "smooth" });
});
document.querySelector("#taskPageSize").addEventListener("change", (event) => {
  state.taskPageSize = Number.parseInt(event.target.value, 10) || 10;
  resetTaskPage();
  renderTasks();
});

const passwordDialog = document.querySelector("#passwordDialog");
const passwordForm = document.querySelector("#passwordForm");
document.querySelector("#openPasswordDialog").addEventListener("click", () => passwordDialog.showModal());
document.querySelector("#closePasswordDialog").addEventListener("click", () => passwordDialog.close());
document.querySelector("#cancelPassword").addEventListener("click", () => passwordDialog.close());
passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api.changePassword(formPayload(passwordForm));
    passwordForm.reset();
    passwordDialog.close();
    showToast("密码已修改");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector(".filters").addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  if (button.dataset.type) {
    state.delayedOnly = button.dataset.type === "delayed";
    state.type = state.delayedOnly ? "all" : button.dataset.type;
    if (state.selectedOwnerId) state.selectedScopeLabel = "当前筛选";
  }

  if (button.dataset.status) {
    state.status = state.status === button.dataset.status ? "all" : button.dataset.status;
    if (state.selectedOwnerId) state.selectedScopeLabel = "当前筛选";
  }

  if (button.dataset.priority) {
    state.priority = state.priority === button.dataset.priority ? "all" : button.dataset.priority;
    state.selectedScopeLabel = priorityLabel[state.priority] ? `${priorityLabel[state.priority]}优先级任务` : state.selectedScopeLabel;
  }

  resetTaskPage();
  syncFilterButtons();
  await refreshTasks();
});

document.querySelector(".stats").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-side-scope]");
  if (!button) return;
  await showSideScope(button.dataset.sideScope);
});

document.querySelector("#todayBoard").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-today-scope]");
  if (!button) return;
  if (button.dataset.todayScope === "reminders") {
    state.reminderFilter = "attention";
    showReminderPage();
    return;
  }
  if (button.dataset.todayScope === "converted-reminders") {
    state.reminderFilter = "converted";
    showReminderPage();
    return;
  }
  await showSideScope(button.dataset.todayScope);
});

document.querySelector(".month-grid").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-month-scope]");
  if (!button) return;
  await showMonthScope(button.dataset.monthScope);
});

document.querySelector("#monthWeekList").addEventListener("click", async (event) => {
  const row = event.target.closest(".week-row[data-week-start]");
  if (!row) return;
  await showWeekTasks(row);
});

document.querySelector("#monthWeekList").addEventListener("keydown", async (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const row = event.target.closest(".week-row[data-week-start]");
  if (!row) return;
  event.preventDefault();
  await showWeekTasks(row);
});

document.querySelector("#teamOverviewList").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-owner-id][data-metric]");
  if (!button) return;
  await showOverviewTasks(button);
});

document.querySelector("#clearTaskScope").addEventListener("click", async () => {
  state.selectedOwnerId = null;
  state.selectedOwnerName = "";
  state.selectedScopeLabel = "";
  state.dueStart = "";
  state.dueEnd = "";
  state.type = "all";
  state.status = "all";
  state.priority = "all";
  state.delayedOnly = false;
  resetTaskPage();
  syncFilterButtons();
  await refreshTasks();
});

document.querySelector("#userAdminList").addEventListener("click", async (event) => {
  const deleteButton = event.target.closest("button[data-delete-user]");
  const roleButton = event.target.closest("button[data-role-user]");
  const button = deleteButton || roleButton;
  if (!button) return;

  try {
    let data;
    if (deleteButton) {
      const name = deleteButton.dataset.userName || "这个用户";
      if (!window.confirm(`确定删除 ${name}？任务会保留，但该用户不能再登录。`)) return;
      data = await api.deleteUser({ user_id: deleteButton.dataset.deleteUser });
      showToast("用户已删除，历史任务已保留");
    } else {
      data = await api.updateUserRole({
        user_id: roleButton.dataset.roleUser,
        role: roleButton.dataset.role,
      });
      showToast("用户权限已更新");
    }
    state.users = data.users;
    state.teamOverview = data.team_overview || [];
    renderUserAdminPanel();
    renderTeamOverview();
    renderUsers();
  } catch (error) {
    showToast(error.message);
  }
});

async function handleMonthControlChange() {
  state.month = monthFromControls();
  state.dueStart = "";
  state.dueEnd = "";
  if (!state.selectedOwnerId) {
    state.selectedOwnerName = "";
    state.selectedScopeLabel = "";
  }
  await refreshTasks();
}

document.querySelector("#yearInput").addEventListener("change", handleMonthControlChange);
document.querySelector("#monthSelect").addEventListener("change", handleMonthControlChange);

document.querySelector("#taskList").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    const card = event.target.closest(".task-card[data-task-id]");
    if (card) {
      openTaskDetail(card.dataset.taskId);
    }
    return;
  }

  try {
    if (button.dataset.action === "detail") {
      openTaskDetail(button.dataset.id);
      return;
    } else if (button.dataset.action === "edit") {
      openProgressDialog(button.dataset.id);
      return;
    } else if (button.dataset.action === "rollover-week" || button.dataset.action === "rollover-month") {
      const task = state.tasks.find((item) => String(item.id) === String(button.dataset.id));
      if (!task) return;
      const isWeekRollover = button.dataset.action === "rollover-week";
      const nextDueAt = isWeekRollover ? nextWeekSameDay(task.due_at) : nextMonthSameDay(task.due_at);
      await api.updateTask(button.dataset.id, {
        due_at: nextDueAt,
        status: task.status === "todo" ? "todo" : "doing",
        delay_reason: task.delay_reason || (isWeekRollover ? "本周未完成，顺延到下周继续处理。" : "本月未完成，顺延到下个月继续处理。"),
      });
      showToast(`已顺延到 ${nextDueAt}`);
    } else if (button.dataset.action === "postpone-custom") {
      openPostponeDialog(button.dataset.id);
      return;
    } else if (button.dataset.action === "delete") {
      await api.deleteTask(button.dataset.id);
      showToast("任务已删除");
    } else {
      await api.updateTask(button.dataset.id, { status: button.dataset.action });
      showToast("任务状态已更新");
    }
    await refreshTasks();
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#taskList").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const card = event.target.closest(".task-card[data-task-id]");
  if (!card) return;
  event.preventDefault();
  openTaskDetail(card.dataset.taskId);
});


const postponeDialog = document.querySelector("#postponeDialog");
const postponeForm = document.querySelector("#postponeForm");

function openPostponeDialog(taskId) {
  const task = state.tasks.find((item) => String(item.id) === String(taskId));
  if (!task) return;
  setDateLimits();
  document.querySelector("#postponeTaskId").value = task.id;
  document.querySelector("#postponeDueAt").value = task.due_at || todayISO();
  document.querySelector("#postponeDelayReason").value = task.delay_reason || "";
  postponeDialog.showModal();
}

document.querySelector("#closePostponeDialog").addEventListener("click", () => postponeDialog.close());
document.querySelector("#cancelPostpone").addEventListener("click", () => postponeDialog.close());

postponeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setDateLimits();
  const payload = formPayload(postponeForm);
  const taskId = payload.task_id;
  delete payload.task_id;
  payload.delay_reason = String(payload.delay_reason || "").trim();
  if (!payload.delay_reason) {
    showToast("请填写顺延原因");
    return;
  }
  const task = state.tasks.find((item) => String(item.id) === String(taskId));
  if (task) {
    payload.status = task.status === "todo" ? "todo" : "doing";
  }
  try {
    await api.updateTask(taskId, payload);
    postponeForm.reset();
    postponeDialog.close();
    showToast("任务已顺延");
    await refreshTasks();
  } catch (error) {
    showToast(error.message);
  }
});

const progressDialog = document.querySelector("#progressDialog");
const progressForm = document.querySelector("#progressForm");
const detailDialog = document.querySelector("#detailDialog");

function setTaskHash(taskId) {
  const nextHash = `#task-${taskId}`;
  if (window.location.hash !== nextHash) {
    history.pushState(null, "", nextHash);
  }
}

function clearTaskHash() {
  if (window.location.hash.startsWith("#task-")) {
    history.pushState(null, "", `${window.location.pathname}${window.location.search}`);
  }
}

function openTaskFromHash() {
  const match = window.location.hash.match(/^#task-(\d+)$/);
  if (!match || !state.tasks.length) return;
  openTaskDetail(match[1], { syncHash: false });
}

function closeTaskDetail() {
  detailDialog.close();
  clearTaskHash();
}

function openTaskDetail(taskId, options = {}) {
  const syncHash = options.syncHash !== false;
  const task = state.tasks.find((item) => String(item.id) === String(taskId));
  if (!task) return;
  if (syncHash) {
    setTaskHash(task.id);
  }

  document.querySelector("#detailTitle").textContent = task.title;
  document.querySelector("#detailBody").innerHTML = `
    <div class="detail-grid">
      ${detailLine("类型", taskTypeLabel[task.task_type])}
      ${detailLine("状态", statusLabel[task.status])}
      ${detailLine("优先级", priorityLabel[task.priority] || "中")}
      ${detailLine("负责人", task.owner_name)}
      ${detailLine("跟进人", task.follower)}
      ${detailLine("计划完成", task.due_at)}
      ${detailLine("创建人", task.creator_name)}
      ${detailLine("是否延期", task.is_delayed ? "是" : "否")}
      ${detailLine("完成时间", task.completed_at)}
    </div>
    ${detailSection("任务说明", task.description)}
    ${detailSection("执行备注", task.work_note)}
    ${detailSection("问题展示", task.issue_note)}
    ${detailSection("延期原因", task.delay_reason)}
  `;
  document.querySelector("#commentTaskId").value = task.id;
  document.querySelector("#taskCommentInput").value = "";
  document.querySelector("#taskComments").innerHTML = renderTaskComments(task);
  document.querySelector("#taskLogs").innerHTML = renderTaskLogs(task);
  document.querySelector("#detailEditBtn").dataset.id = task.id;
  detailDialog.showModal();
}

window.addEventListener("hashchange", openTaskFromHash);
detailDialog.addEventListener("close", clearTaskHash);
document.querySelector("#closeDetailDialog").addEventListener("click", closeTaskDetail);
document.querySelector("#detailEditBtn").addEventListener("click", (event) => {
  const taskId = event.currentTarget.dataset.id;
  detailDialog.close();
  clearTaskHash();
  openProgressDialog(taskId);
});

const taskCommentForm = document.querySelector("#taskCommentForm");
taskCommentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = formPayload(taskCommentForm);
  const taskId = payload.task_id;
  delete payload.task_id;
  try {
    const data = await api.createTaskComment(taskId, payload);
    const task = state.tasks.find((item) => String(item.id) === String(taskId));
    if (task && data.task_detail) {
      task.comments = data.task_detail.comments || [];
      task.logs = data.task_detail.logs || [];
      document.querySelector("#taskComments").innerHTML = renderTaskComments(task);
      document.querySelector("#taskLogs").innerHTML = renderTaskLogs(task);
    }
    document.querySelector("#taskCommentInput").value = "";
    showToast("跟进记录已提交");
  } catch (error) {
    showToast(error.message);
  }
});

function openProgressDialog(taskId) {
  const task = state.tasks.find((item) => String(item.id) === String(taskId));
  if (!task) return;
  setDateLimits();
  document.querySelector("#progressTaskId").value = task.id;
  document.querySelector("#progressStatus").value = task.status;
  document.querySelector("#progressDueAt").value = task.due_at || "";
  document.querySelector("#progressWorkNote").value = task.work_note || "";
  document.querySelector("#progressIssueNote").value = task.issue_note || "";
  document.querySelector("#progressDelayReason").value = task.delay_reason || "";
  progressDialog.showModal();
}

document.querySelector("#closeProgressDialog").addEventListener("click", () => progressDialog.close());
document.querySelector("#cancelProgress").addEventListener("click", () => progressDialog.close());

progressForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setDateLimits();
  const payload = formPayload(progressForm);
  const taskId = payload.task_id;
  delete payload.task_id;
  try {
    await api.updateTask(taskId, payload);
    progressDialog.close();
    showToast("进展已保存");
    await refreshTasks();
  } catch (error) {
    showToast(error.message);
  }
});

const taskDialog = document.querySelector("#taskDialog");
const taskForm = document.querySelector("#taskForm");

document.querySelector("#openTaskDialog").addEventListener("click", () => taskDialog.showModal());
document.querySelector("#openTaskDialog").addEventListener("click", setDateLimits);
document.querySelector("#closeTaskDialog").addEventListener("click", () => taskDialog.close());
document.querySelector("#cancelTask").addEventListener("click", () => taskDialog.close());

document.querySelector("#dueInput").required = true;
setDateLimits();
syncMonthControls();
document.querySelector("#quickDueInput").min = todayISO();

document.querySelector("#quickTaskForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = formPayload(event.currentTarget);
  payload.owner_id = state.user.id;
  payload.follower = state.user.display_name;
  payload.description = "快速新增";
  try {
    await api.createTask(payload);
    event.currentTarget.reset();
    document.querySelector("#quickDueInput").min = todayISO();
    showToast("任务已添加");
    await refreshTasks();
  } catch (error) {
    showToast(error.message);
  }
});

const reminderTaskDialog = document.querySelector("#reminderTaskDialog");
const reminderTaskForm = document.querySelector("#reminderTaskForm");

function openReminderTaskDialog(reminderId) {
  const reminder = state.reminders.find((item) => String(item.id) === String(reminderId));
  if (!reminder) return;
  renderUsers();
  document.querySelector("#reminderTaskId").value = reminder.id;
  document.querySelector("#reminderTaskTitle").value = reminder.title;
  document.querySelector("#reminderTaskType").value = "week";
  document.querySelector("#reminderTaskFollower").value = state.user ? state.user.display_name : "";
  document.querySelector("#reminderTaskHint").textContent = `截止时间沿用提醒日期 ${reminder.due_at}，提醒本身会保留并关联新任务。`;
  reminderTaskDialog.showModal();
}

document.querySelector("#closeReminderTaskDialog").addEventListener("click", () => reminderTaskDialog.close());
document.querySelector("#cancelReminderTask").addEventListener("click", () => reminderTaskDialog.close());

reminderTaskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = formPayload(reminderTaskForm);
  const reminderId = payload.reminder_id;
  delete payload.reminder_id;
  try {
    const data = await api.convertReminderToTask(reminderId, payload);
    state.reminders = data.reminders || [];
    state.tasks = data.tasks || state.tasks;
    state.stats = data.stats || state.stats;
    state.monthly = data.monthly || state.monthly;
    reminderTaskForm.reset();
    reminderTaskDialog.close();
    renderStats();
    renderMonthly();
    renderTodayBoard();
    renderTasks();
    renderReminders();
    showToast("已转为任务，提醒仍保留");
  } catch (error) {
    showToast(error.message);
  }
});

const reminderForm = document.querySelector("#reminderForm");
document.querySelector("#reminderDueInput").min = todayISO();

reminderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  document.querySelector("#reminderDueInput").min = todayISO();
  try {
    const data = await api.createReminder(formPayload(reminderForm));
    state.reminders = data.reminders || [];
    reminderForm.reset();
    document.querySelector("#reminderDueInput").min = todayISO();
    renderReminders();
    showToast("提醒已保存");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#reminderFilters").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-reminder-filter]");
  if (!button) return;
  state.reminderFilter = button.dataset.reminderFilter;
  renderReminders();
});

document.querySelector("#reminderList").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-reminder-action]");
  if (!button) return;
  try {
    let data;
    if (button.dataset.reminderAction === "delete") {
      data = await api.deleteReminder(button.dataset.id);
      showToast("提醒已删除");
    } else if (button.dataset.reminderAction === "task") {
      openReminderTaskDialog(button.dataset.id);
      return;
    } else {
      data = await api.updateReminder(button.dataset.id, { status: button.dataset.reminderAction });
      showToast("提醒状态已更新");
    }
    state.reminders = data.reminders || [];
    renderReminders();
  } catch (error) {
    showToast(error.message);
  }
});

taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setDateLimits();
  try {
    await api.createTask(formPayload(taskForm));
    taskForm.reset();
    document.querySelector("#dueInput").required = true;
    taskDialog.close();
    showToast("任务已创建");
    await refreshTasks();
  } catch (error) {
    showToast(error.message);
  }
});

async function boot() {
  try {
    const data = await api.me();
    if (data.user) {
      await loadDashboard();
    } else {
      showAuth();
    }
  } catch {
    showAuth();
  }
}

boot();
