import { mountLoginInput } from "./login-input.js";
mountLoginInput();
import { themes } from "./themes/index.js";
import {
  applyTheme,
  getStoredThemeId,
  setStoredThemeId,
  getStoredMode,
  setStoredMode,
  systemPrefersDark,
} from "./themeManager.js";

import { api, invalidate } from "./api.js";
import * as U from "./util.js";

import overview from "./views/overview.js";
import accounts from "./views/accounts.js";
import logs from "./views/logs.js";
import runs from "./views/runs.js";
import schedule from "./views/schedule.js";
import configView from "./views/config.js";
import diagnostics from "./views/diagnostics.js";

function initVersion() {
  const version = window.APP_VERSION || "开发版本";

  if (els.footerVersion) {
    els.footerVersion.textContent = `Microsoft Rewards 管理面板：${version}`;
  }
}

const VIEWS = [
  overview,
  accounts,
  logs,
  runs,
  schedule,
  configView,
  diagnostics,
];

const els = {
  statusBadge: U.$("#statusBadge"),
  statusText: U.$("#statusText"),
  modeToggle: U.$("#modeToggle"),
  modeIcon: U.$("#modeIcon"),
  themeSelect: U.$("#themeSelect"),
  tabBar: U.$("#tabBar"),
  tabPanels: U.$("#tabPanels"),
  ctlPill: U.$("#ctlPill"),
  ctlDetail: U.$("#ctlDetail"),
  btnStart: U.$("#btnStart"),
  btnStop: U.$("#btnStop"),
  btnRestart: U.$("#btnRestart"),
  btnMore: U.$("#btnMore"),
  ctlMenu: U.$("#ctlMenu"),
  btnForceStop: U.$("#btnForceStop"),
  btnShutdown: U.$("#btnShutdown"),
  loginCodesSection: U.$("#loginCodesSection"),
  loginCodesList: U.$("#loginCodesList"),
  loginCodesAnnounce: U.$("#loginCodesAnnounce"),
  footerStatus: U.$("#footerStatus"),
  footerScriptVersion: U.$("#footerScriptVersion"),
  footerVersion: U.$("#footerVersion"),
};

const state = {
  status: null,
  codes: [],
  activeTab: null,
  streamOpen: false,
};

const mounted = new Set();
let refreshTimer = null;
let knownCodeKeys = new Set();

const ctx = {
  api,
  invalidate,
  toast: U.toast,
  get status() {
    return state.status;
  },
  refresh: () => refreshActive(true),
};

// theme

let currentThemeId = null;
let currentMode = "light";

const findTheme = (id) => themes.find((t) => t.id === id) || themes[0] || null;

function setMode(mode, persist) {
  currentMode = mode;
  els.modeIcon.textContent = mode === "dark" ? "\u2600" : "\u263D";
  const label =
    mode === "dark" ? "切换到浅色模式" : "切换到深色模式";
  els.modeToggle.setAttribute("aria-label", label);
  els.modeToggle.title = label;
  if (persist) setStoredMode(mode);
  const theme = findTheme(currentThemeId);
  if (theme) applyTheme(theme, currentMode);
  redrawActive();
}

function setTheme(id, persist) {
  const theme = findTheme(id);
  if (!theme) return;
  currentThemeId = theme.id;
  els.themeSelect.value = theme.id;
  if (persist) setStoredThemeId(theme.id);
  applyTheme(theme, currentMode);
}

function initTheme() {
  if (!themes.length) return;
  els.themeSelect.innerHTML = themes
    .map(
      (t) =>
        `<option value="${U.escapeAttr(t.id)}">${U.escapeHtml(U.themeLabel(t.name))}</option>`,
    )
    .join("");

  const storedThemeId = getStoredThemeId();
  currentMode = getStoredMode() || (systemPrefersDark() ? "dark" : "light");
  setTheme(
    storedThemeId && findTheme(storedThemeId) ? storedThemeId : themes[0].id,
    false,
  );
  setMode(currentMode, false);

  els.themeSelect.addEventListener("change", () =>
    setTheme(els.themeSelect.value, true),
  );
  els.modeToggle.addEventListener("click", () =>
    setMode(currentMode === "dark" ? "light" : "dark", true),
  );
}

// tabs

function initTabs() {
  els.tabBar.innerHTML = VIEWS.map(
    (v) => `<button type="button" role="tab" class="tab" id="tab-btn-${v.id}"
                 aria-controls="tab-panel-${v.id}" aria-selected="false" data-tab="${v.id}">${U.escapeHtml(v.label)}</button>`,
  ).join("");

  els.tabPanels.innerHTML = VIEWS.map(
    (v) =>
      `<div class="tab-panel" id="tab-panel-${v.id}" role="tabpanel" aria-labelledby="tab-btn-${v.id}" hidden></div>`,
  ).join("");

  els.tabBar.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-tab]");
    if (btn) location.hash = btn.dataset.tab;
  });

  els.tabBar.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = VIEWS.findIndex((v) => v.id === state.activeTab);
    const next =
      VIEWS[
      (i + (e.key === "ArrowRight" ? 1 : VIEWS.length - 1)) % VIEWS.length
      ];
    location.hash = next.id;
    U.$(`#tab-btn-${next.id}`)?.focus();
    e.preventDefault();
  });

  window.addEventListener("hashchange", () => activate(location.hash.slice(1)));
  activate(location.hash.slice(1));
}

function activate(id) {
  const view = VIEWS.find((v) => v.id === id) || VIEWS[0];
  if (state.activeTab === view.id) return;
  state.activeTab = view.id;

  for (const v of VIEWS) {
    const on = v.id === view.id;
    U.$(`#tab-btn-${v.id}`).setAttribute("aria-selected", String(on));
    U.$(`#tab-btn-${v.id}`).classList.toggle("tab--active", on);
    U.$(`#tab-panel-${v.id}`).hidden = !on;
  }

  const panel = U.$(`#tab-panel-${view.id}`);
  if (!mounted.has(view.id)) {
    view.mount(panel, ctx);
    mounted.add(view.id);
  }

  refreshActive(true);

  clearInterval(refreshTimer);
  if (view.interval)
    refreshTimer = setInterval(() => refreshActive(false), view.interval);
}

function currentView() {
  return VIEWS.find((v) => v.id === state.activeTab);
}

async function refreshActive(force) {
  const view = currentView();
  if (!view || !view.refresh) return;
  if (force) invalidate();
  try {
    await view.refresh(ctx);
    renderFooter();
  } catch (e) {
    console.error(`[${view.id}] refresh failed`, e);
  }
}

function redrawActive() {
  const view = currentView();
  if (view?.redraw) view.redraw(ctx);
}

// live

function connectStream() {
  const es = new EventSource("/api/events");

  es.addEventListener("open", () => {
    state.streamOpen = true;
  });

  es.addEventListener("state", (e) => {
    state.streamOpen = true;
    applyState(JSON.parse(e.data));
  });

  es.addEventListener("log", (e) => {
    const entry = JSON.parse(e.data);
    currentView()?.onLog?.(entry, ctx);
  });

  es.addEventListener("codes", (e) => {
    setCodes(JSON.parse(e.data).codes || []);
  });

  es.addEventListener("reset", () => {
    for (const v of VIEWS) v.onReset?.(ctx);
    U.toast("控制 API 已重启，连接已恢复。", "warn");
  });

  es.onerror = () => {
    state.streamOpen = false;
    renderStatusBadge();
  };
}

function applyState(next) {
  state.status = next;
  U.setTimeZone(next.timezone);
  setCodes(next.codes || []);
  renderStatusBadge();
  renderControlStrip();
  renderFooter();
  currentView()?.onState?.(next, ctx);
}

// status
function renderStatusBadge() {
  const s = state.status;
  const badge = els.statusBadge;
  badge.classList.remove(
    "status-live",
    "status-warn",
    "status-down",
    "status-unknown",
  );

  if (!state.streamOpen && !s) {
    badge.classList.add("status-down");
    els.statusText.textContent = "无法连接管理面板服务";
  } else if (!s) {
    badge.classList.add("status-unknown");
    els.statusText.textContent = "正在连接…";
  } else if (!s.reachable) {
    badge.classList.add("status-down");
    els.statusText.textContent = "脚本服务离线";
  } else if (s.authOk === false) {
    badge.classList.add("status-warn");
    els.statusText.textContent = "控制 API 令牌验证失败";
  } else if (s.botRunning) {
    badge.classList.add("status-live");
    els.statusText.textContent = "正在运行";
  } else {
    badge.classList.add("status-live");
    els.statusText.textContent = "已连接";
  }
  badge.title = U.displayMessage(s?.lastError || "");
}

function renderFooter() {
    // Use the els object instead of querying the DOM every time
    const { footerStatus, footerScriptVersion } = els;

    if (!footerStatus) return;

    const s = state.status;

    footerStatus.textContent =
        !s
            ? "正在连接…"
            : !s.reachable
                ? "连接已断开"
                : s.botRunning
                    ? "运行中"
                    : "已连接";

    footerScriptVersion.textContent =
        `Microsoft Rewards 脚本：${s?.version || "\u2013"}`;
}

function renderControlStrip() {
  const s = state.status;
  const botState = s?.botState || "unknown";
  const usable = Boolean(s?.reachable && s?.authOk !== false);
  const running = botState !== "idle" && botState !== "unknown";

  const { cls, label } = U.pillParts(
    botState === "unknown" ? "idle" : botState,
  );
  els.ctlPill.className = `pill ${cls}`;
  els.ctlPill.textContent = label;

  const bot = s?.bot;
  const bits = [];
  if (running && bot?.pid) bits.push(`进程 PID ${bot.pid}`);
  if (running && bot?.startedAt)
    bits.push(`开始于 ${U.fmtRelative(bot.startedAt)}`);
  if (bot?.run?.accountsTotal)
    bits.push(`${bot.run.accountsSeen || 0}/${bot.run.accountsTotal} 个账号`);
  if (running && bot?.run?.collected != null)
    bits.push(`${U.fmtSigned(bot.run.collected)} 积分`);
  if (!running && s?.schedule?.enabled && s.schedule.nextRunAt) {
    bits.push(`下次运行 ${U.fmtDateTime(s.schedule.nextRunAt)}`);
  }
  if (!running && !bits.length && bot?.lastExit) {
    bits.push(
      `上次退出：代码 ${bot.lastExit.code ?? "n/a"}${bot.lastExit.signal ? ` / ${bot.lastExit.signal}` : ""}`,
    );
  }
  U.renderTicker(
    els.ctlDetail,
    bits.join(" \u00b7 ") || (usable ? "已就绪" : "控制 API 不可用"),
  );

  els.btnStart.disabled = !usable || running;
  els.btnStop.disabled = !usable || !running;
  els.btnRestart.disabled = !usable;
  els.btnForceStop.disabled = !usable || !running;
  els.btnShutdown.disabled = !usable;
}

async function control(action, body, { confirm: confirmMsg, success } = {}) {
  if (confirmMsg && !window.confirm(confirmMsg)) return;
  try {
    await api.control(action, body || {});
    U.toast(success || `已发送 ${action} 指令。`, "success");
  } catch (e) {
    U.toast(e.message, e.status === 409 ? "warn" : "error");
  }
}

function initControls() {
  els.btnStart.addEventListener("click", () =>
    control("start", {}, { success: "任务已启动。" }),
  );
  els.btnStop.addEventListener("click", () =>
    control("stop", { force: false }, { success: "停止信号已发送。" }),
  );
  els.btnRestart.addEventListener("click", () =>
    control(
      "restart",
      {},
      {
        confirm: "确定重新运行脚本吗？当前正在执行的任务会先被停止。",
        success: "正在重新运行…",
      },
    ),
  );
  els.btnForceStop.addEventListener("click", () => {
    closeMenu();
    control(
      "stop",
      { force: true },
      {
        confirm: "确定强制终止任务（SIGKILL）吗？任务将无法执行清理操作。",
        success: "强制停止指令已发送。",
      },
    );
  });
  els.btnShutdown.addEventListener("click", () => {
    closeMenu();
    control(
      "shutdown",
      {},
      {
        confirm:
          "确定关闭控制 API 吗？管理面板将无法连接脚本，直到你在脚本服务器上重新启动 API。",
        success: "关闭指令已发送。",
      },
    );
  });

  els.btnMore.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = els.ctlMenu.hidden;
    els.ctlMenu.hidden = !open;
    els.btnMore.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", closeMenu);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });
}

function closeMenu() {
  els.ctlMenu.hidden = true;
  els.btnMore.setAttribute("aria-expanded", "false");
}

// login code

const codeKey = (c) => `${c.userName}:${c.number}:${c.issuedAt}`;

function setCodes(codes) {
  state.codes = codes;
  const fresh = codes.filter((c) => !knownCodeKeys.has(codeKey(c)));
  if (fresh.length) {
    els.loginCodesAnnounce.textContent = fresh
      .map(
        (c) =>
          `账号 ${c.userName} 需要批准登录：请选择数字 ${c.number}。60 秒后过期。`,
      )
      .join(" ");
  }
  knownCodeKeys = new Set(codes.map(codeKey));
  renderCodes();
}

function renderCodes() {
  state.codes = state.codes.filter((c) => Date.parse(c.expiresAt) > Date.now());
  els.loginCodesSection.hidden = state.codes.length === 0;
  if (!state.codes.length) return;

  els.loginCodesList.innerHTML = state.codes
    .map((c) => {
      const secsLeft = Math.max(
        0,
        Math.round((Date.parse(c.expiresAt) - Date.now()) / 1000),
      );
      return `
                <div class="login-code-card">
                    <div class="login-code-number">${U.escapeHtml(c.number)}</div>
                    <div class="login-code-info">
                        <span class="login-code-name">${U.escapeHtml(c.userName)}</span>
                        <span class="login-code-countdown ${secsLeft <= 15 ? "urgent" : ""}">${secsLeft} 秒后过期</span>
                    </div>
                </div>`;
    })
    .join("");
}

// init

initVersion();
initTheme();
initControls();
initTabs();
connectStream();

setInterval(renderCodes, 1000);
window.addEventListener("focus", () => refreshActive(true));
window.addEventListener(
  "resize",
  U.debounce(() => {
    redrawActive();
    renderControlStrip();
  }, 200),
);
