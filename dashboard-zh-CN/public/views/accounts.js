import { mountAccountCreator, updateAccountCreator, refreshAccountCreator } from "../account-create.js";
import * as U from "../util.js";
import { cached } from "../api.js";

let accountsPayload = null;
let rootEl = null;
let mounted = false;
let context = null;

const launching = new Set();
const selectedForBatch = new Set();
const expandedAccounts = new Set();
let batchRunning = false;

// Two-step delete: a key must be "armed" by a first click before a second
// click on the confirm button actually deletes anything, so there's no way
// to remove an account's dashboard data with a single accidental click.
const deleteArmed = new Set();
const deleting = new Set();

const SOURCE_LABELS = {
  search: "搜索",
  bonus: "额外搜索",
  read: "阅读",
  checkIn: "签到",
  claimReward: "领取奖励",
  claimBonus: "领取额外积分",
  urlReward: "链接奖励",
  visualSearch: "视觉搜索",
  appReward: "应用奖励",
  punchcard: "打卡任务",
  searchOnBing: "搜索活动",
};

function controlState() {
  const status = context?.status;
  const usable = Boolean(status?.reachable && status?.authOk !== false);
  const running = Boolean(status?.botRunning);
  return { usable, running };
}

async function runAccount(account) {
  if (!context || !account.configured || !Number.isInteger(account.index)) return;

  launching.add(account.index);
  render(rootEl);
  try {
    await context.api.control("start", { accountIndex: account.index });
    context.toast(
      `已单独启动 ACCOUNT_${account.index}（${account.email}）。`,
      "success",
    );
    context.invalidate();
    await context.refresh();
  } catch (error) {
    context.toast(error.message, error.status === 409 ? "warn" : "error");
  } finally {
    launching.delete(account.index);
    render(rootEl);
  }
}

function selectableAccounts() {
  return (accountsPayload?.accounts || []).filter(
    (a) => a.configured && Number.isInteger(a.index),
  );
}

// Removes an account's stored data (status, history, activity log) from the
// dashboard's own database. This never touches the bot itself - it's meant
// for accounts the bot no longer runs (removed from .env) whose dashboard
// data would otherwise linger forever.
async function deleteAccount(account) {
  if (!context) return;

  deleteArmed.delete(account.key);
  deleting.add(account.key);
  render(rootEl);
  try {
    await context.api.deleteDashboardAccount(account.email);
    context.toast(`已删除 ${account.email} 的账号配置及面板记录，可以重新添加。`, "success");
    context.invalidate();
    await context.refresh();
  } catch (error) {
    context.toast(error.message, error.status === 409 ? "warn" : "error");
  } finally {
    deleting.delete(account.key);
    render(rootEl);
  }
}

async function runSelectedAccounts() {
  if (!context) return;
  const configured = selectableAccounts();
  const selectedIndexes = configured
    .filter((a) => selectedForBatch.has(a.index))
    .map((a) => a.index);
  if (!selectedIndexes.length) return;

  // The control API only accepts an exclusion list, so a "run these x of y"
  // request is expressed as "exclude everyone else".
  const excludedAccountIndexes = configured
    .filter((a) => !selectedForBatch.has(a.index))
    .map((a) => a.index);

  batchRunning = true;
  render(rootEl);
  try {
    await context.api.control("start", { excludedAccountIndexes });
    context.toast(
      `已启动所选账号中的 ${selectedIndexes.length}/${configured.length} 个。`,
      "success",
    );
    context.invalidate();
    await context.refresh();
  } catch (error) {
    context.toast(error.message, error.status === 409 ? "warn" : "error");
  } finally {
    batchRunning = false;
    render(rootEl);
  }
}

function renderBatchToolbar(root) {
  const configured = selectableAccounts();
  const configuredIndexes = new Set(configured.map((a) => a.index));
  // Drop selections for accounts that disappeared (e.g. .env edited).
  for (const index of [...selectedForBatch]) {
    if (!configuredIndexes.has(index)) selectedForBatch.delete(index);
  }

  const { usable, running } = controlState();
  const count = selectedForBatch.size;
  const total = configured.length;

  U.$("#accountsSelectedCount", root).textContent = `已选择 ${count}/${total} 个`;

  const allBtn = U.$("#accountsSelectAll", root);
  allBtn.checked = total > 0 && count === total;
  allBtn.indeterminate = count > 0 && count < total;
  allBtn.disabled = total === 0;

  const runBtn = U.$("#accountsRunSelected", root);
  runBtn.disabled = !usable || running || batchRunning || count === 0;
  runBtn.textContent = batchRunning ? "正在启动…" : "运行所选账号";
  updateAccountCreator(root, context);
}

function earnableBadge(account) {
  const earnable = account.earnable || account.live?.earnable;
  const total = earnable
    ? Object.values(earnable).reduce((sum, points) => sum + (Number(points) || 0), 0)
    : 0;
  if (earnable && Object.values(earnable).some(value => value == null)) return '<span class="point-source point-source--target"><strong>可获取积分</strong> 已知 ' + U.escapeHtml(U.fmtNumber(total)) + '，手机搜索额度未知</span>';
  if (total <= 0) return "";
  return `<span class="point-source point-source--target"><strong>可获得积分</strong> ${U.escapeHtml(U.fmtNumber(total))}</span>`;
}

// Only sources that actually earned something today — ten "+0" chips per
// account is noise, not detail.
function sourceBreakdown(account) {
  const bySource = account.live?.bySource || {};
  return Object.entries(SOURCE_LABELS)
    .filter(([source]) => Number(bySource[source]) > 0)
    .map(
      ([source, label]) =>
        `<span class="point-source"><strong>${U.escapeHtml(label)}</strong> ${U.escapeHtml(U.fmtSigned(Number(bySource[source])))}</span>`,
    )
    .join("");
}

function protectionPresentation(account) {
  if (account.streakProtectionEnabled == null) return null;

  const remaining = account.streakProtectionRemainingDays;
  const days =
    remaining == null
      ? "剩余天数未知"
      : `剩余 ${remaining} 天保护`;
  const state = account.streakProtectionEnabled ? "开启" : "关闭";
  const streak =
    account.streakCounter == null
      ? "连续记录未知"
      : `当前连续 ${U.fmtNumber(account.streakCounter)} 天`;

  return {
    state,
    days,
    streak,
    pillClass:
      account.streakProtectionEnabled && remaining !== 0
        ? "pill-success"
        : remaining === 0
          ? "pill-warn"
          : "pill-idle",
  };
}

function kv(items) {
  return `<dl class="kv">${items
    .map(
      ([k, v]) =>
        `<div><dt>${U.escapeHtml(k)}</dt><dd>${U.escapeHtml(String(v))}</dd></div>`,
    )
    .join("")}</dl>`;
}

function detailGroups(a, protection) {
  const groups = [];

  groups.push([
    "账号配置",
    [
      ["已配置", a.configured ? "是" : "否，仅在日志中出现"],
      ...(a.geoLocale ? [["地区", a.geoLocale]] : []),
      ...(a.langCode ? [["语言", a.langCode]] : []),
      ...(a.hasTotp != null ? [["TOTP 密钥", a.hasTotp ? "已设置" : "未设置"]] : []),
      ...(a.hasRecoveryEmail != null
        ? [["恢复邮箱", a.hasRecoveryEmail ? "已设置" : "未设置"]]
        : []),
      [
        "代理",
        a.proxy
          ? `${a.proxy.url}${a.proxy.port ? `:${a.proxy.port}` : ""}${a.proxy.hasCredentials ? " （需要认证）" : ""}`
          : "无",
      ],
    ],
  ]);

  groups.push([
    "连续记录与保护",
    [
      ["连续成功次数", `${a.successStreak} 次运行`],
      ...(protection
        ? [
          [
            "当前连续天数",
            a.streakCounter == null
              ? "暂无信息"
              : `${U.fmtNumber(a.streakCounter)} 天`,
          ],
          ["连续记录保护", protection.state === "开启" ? "已启用" : "已关闭"],
          [
            "保护剩余天数",
            a.streakProtectionRemainingDays == null
              ? "暂无信息"
              : `${a.streakProtectionRemainingDays} 天`,
          ],
          ...(a.streakProtectionUpdatedAt
            ? [["保护状态检查时间", U.fmtRelative(a.streakProtectionUpdatedAt)]]
            : []),
        ]
        : []),
    ],
  ]);

  groups.push([
    "运行历史",
    [
      ["API 记录的运行次数", U.fmtNumber(a.apiRuns)],
      ["获得积分（API 历史）", U.fmtSigned(a.apiTotalCollected)],
      ["上次运行耗时", U.fmtDuration(a.lastDurationSec)],
      ["已加载的历史积分记录", U.fmtNumber(a.historyCount)],
    ],
  ]);

  return `<div class="acc-detail-groups">${groups
    .map(
      ([title, items]) => `
        <div class="acc-detail-group">
            <h3 class="acc-detail-group-title">${title}</h3>
            ${kv(items)}
        </div>`,
    )
    .join("")}</div>`;
}

// Mirrors overview.js's statCard icon convention (stat-icon-check /
// -running / -alert icon-alert-active / -idle with \u2713 / \u25CF / ! / \u2013)
// so an account's live status reads the same way here as it does there.
function statusIconParts(statusKey) {
  switch (statusKey) {
    case "success":
    case "done":
      return { cls: "stat-icon-check", icon: "\u2713", label: "成功" };
    case "running":
    case "starting":
    case "stopping":
      return { cls: "stat-icon-running", icon: "\u25CF", label: U.pillParts(statusKey).label };
    case "pending":
      return { cls: "stat-icon-pending", icon: "\u25CF", label: U.pillParts(statusKey).label };
    case "error":
    case "crashed":
    case "interrupted":
    case "stopped":
      return { cls: "stat-icon-alert icon-alert-active", icon: "!", label: U.pillParts(statusKey).label };
    default:
      return { cls: "stat-icon-idle", icon: "\u2013", label: "空闲" };
  }
}

function renderAccountPanel(a, live) {
  const protection = protectionPresentation(a);
  const { usable, running } = controlState();

  // Accounts now start one at a time (accountDelay), so mid-run there can be
  // several accounts that already finished this run while another is still
  // going - `live` just means "has a record in this run", true for both.
  // a.status is this account's own last-observed outcome (idle/running/
  // success/error), so it correctly tells finished accounts apart from the
  // one actually in progress right now.
  // Mirrors overview.js: while waiting between accounts, the one named by
  // pendingDelay.nextEmail is up next, so it reads as "pending" rather than
  // whatever its last-observed status happened to be.
  const nextAccountEmail = context?.status?.pendingDelay?.nextEmail || null;
  const statusKey = launching.has(a.index)
    ? "starting"
    : a.status !== "running" && nextAccountEmail && a.email === nextAccountEmail
      ? "pending"
      : a.status;

  const runButton =
    a.configured && Number.isInteger(a.index)
      ? `<button type="button" class="btn btn-primary btn-small" data-run-account="${a.index}" ${!usable || running || launching.has(a.index) ? "disabled" : ""} title="仅运行 ACCOUNT_${a.index}">${launching.has(a.index) ? "正在启动…" : "仅运行此账号"}</button>`
      : "";

  const selectCheckbox =
    a.configured && Number.isInteger(a.index)
      ? `<label class="check acc-batch-select" title="将 ACCOUNT_${a.index} 加入批量运行">
          <input type="checkbox" data-select-account="${a.index}" ${selectedForBatch.has(a.index) ? "checked" : ""}>
          <span>选择</span>
        </label>`
      : "";

  const { cls: statusIconCls, icon: statusIcon, label: statusLabel } = statusIconParts(statusKey);
  const isExpanded = expandedAccounts.has(a.key);
  const detailsId = `acc-details-${U.escapeAttr(a.key)}`;

  const isDeleting = deleting.has(a.key);
  const deleteBlocked = Boolean(context?.status?.botRunning) || a.status === "running" || launching.has(a.index);
  const deleteButton = deleteArmed.has(a.key)
    ? `<span class="acc-delete-confirm"><span class="hint">删除配置及面板历史，保留登录会话。</span>
        <button type="button" class="btn btn-small" data-cancel-delete="${U.escapeAttr(a.key)}" ${isDeleting ? "disabled" : ""}>取消</button>
        <button type="button" class="btn btn-danger btn-small" data-confirm-delete="${U.escapeAttr(a.key)}" ${isDeleting ? "disabled" : ""} title="删除账号配置及面板历史，保留登录会话">
            ${isDeleting ? "正在移除…" : "确认删除？"}
        </button>
      </span>`
    : `<button type="button" class="btn btn-danger btn-small" data-arm-delete="${U.escapeAttr(a.key)}" ${deleteBlocked ? "disabled" : ""} title="${deleteBlocked ? "账号必须空闲才能删除" : "删除账号配置及面板历史，保留登录会话"}">删除</button>`;

  const chips = [
    protection
      ? `<span class="pill ${protection.pillClass}" title="${U.escapeAttr(protection.streak)}；连续记录保护${protection.state.toLowerCase()}；${U.escapeAttr(protection.days)}">保护${protection.state} · ${a.streakProtectionRemainingDays == null ? "剩余天数未知" : `剩余 ${a.streakProtectionRemainingDays} 天`}</span>`
      : "",
    earnableBadge(live || {}),
    sourceBreakdown(live || {}),
  ]
    .filter(Boolean)
    .join("");

  return `
    <div class="panel account-detail-panel">
        <div class="panel-head">
            <h2>
                <button type="button" class="acc-detail-toggle" data-toggle-details="${U.escapeAttr(a.key)}" aria-expanded="${isExpanded}" aria-controls="${detailsId}" title="${isExpanded ? "收起详情" : "展开详情"}">\u25b8</button>
                <span class="acc-status-icon ${statusIconCls}" role="img" aria-label="${U.escapeAttr(statusLabel)}" title="${U.escapeAttr(statusLabel)}">${statusIcon}</span>${U.escapeHtml(a.email)}
            </h2>
            ${a.index != null ? `<span class="tag-mini acc-tag-account-id">ACCOUNT_${a.index}</span>` : ""}
            ${a.configured ? "" : "<span class=\"tag-mini\">未配置</span>"}
            <span class="acc-detail-actions">
                <span class="acc-status-pill">${U.statusPill(statusKey)}</span>
                ${selectCheckbox}
                ${runButton}
                ${deleteButton}
            </span>
        </div>
        <div class="panel-body" id="${detailsId}" ${isExpanded ? "" : "hidden"}>
            ${detailGroups(a, protection)}
        </div>
        ${chips ? `<div class="account-today-row">
            <span class="account-today-label">今日获得</span>
            <div class="account-today-chips">${chips}</div>
        </div>` : ""}
    </div>`;
}

function render(root) {
  const container = U.$("#accountsContainer", root);
  const accounts = accountsPayload?.accounts || [];

  const liveByEmail = new Map(
    (context?.status?.bot?.run?.accounts || []).map((la) => [la.email, la]),
  );

  const errEl = U.$("#accountsError", root);
  if (errEl) {
    errEl.hidden = !accountsPayload?.apiError;
    if (accountsPayload?.apiError) errEl.textContent = U.displayMessage(accountsPayload.apiError);
  }

  if (!accounts.length) {
    container.innerHTML = "<p class=\"empty-note\" style=\"padding:1.25rem\">尚未配置账号，也没有观测到账号记录。</p>";
    renderBatchToolbar(root);
    return;
  }

  container.innerHTML = accounts.map(a => {
    const live = liveByEmail.get(a.email) || null;
    return renderAccountPanel(a, live);
  }).join("");

  container.querySelectorAll("button[data-run-account]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const index = Number(btn.dataset.runAccount);
      const account = accounts.find((a) => a.index === index);
      if (account) runAccount(account);
    }),
  );

  container.querySelectorAll("input[data-select-account]").forEach((input) =>
    input.addEventListener("change", () => {
      const index = Number(input.dataset.selectAccount);
      if (input.checked) selectedForBatch.add(index);
      else selectedForBatch.delete(index);
      renderBatchToolbar(root);
    }),
  );

  container.querySelectorAll("button[data-toggle-details]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const key = btn.dataset.toggleDetails;
      if (expandedAccounts.has(key)) expandedAccounts.delete(key);
      else expandedAccounts.add(key);
      render(root);
    }),
  );

  container.querySelectorAll("button[data-arm-delete]").forEach((btn) =>
    btn.addEventListener("click", () => {
      deleteArmed.add(btn.dataset.armDelete);
      render(root);
    }),
  );

  container.querySelectorAll("button[data-cancel-delete]").forEach((btn) =>
    btn.addEventListener("click", () => {
      deleteArmed.delete(btn.dataset.cancelDelete);
      render(root);
    }),
  );

  container.querySelectorAll("button[data-confirm-delete]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const key = btn.dataset.confirmDelete;
      const account = accounts.find((a) => a.key === key);
      if (account) deleteAccount(account);
    }),
  );

  renderBatchToolbar(root);
}

export default {
  id: "accounts",
  label: "账号",
  interval: 10000,

  mount(root, ctx) {
    rootEl = root;
    context = ctx;
    root.innerHTML = `
      <p class="notice notice--warn" id="accountsError" hidden></p>
      <div class="panel batch-select-box" id="accountsBatchToolbar">
          <div class="batch-select-header">
              <h2 class="batch-select-title">批量运行</h2>
              <div class="batch-select-controls">
                  <label class="check">
                      <input type="checkbox" id="accountsSelectAll">
                      <span>全选</span>
                  </label>
                  <span class="hint" id="accountsSelectedCount">已选择 0/0 个</span>
                  <button type="button" class="btn btn-primary btn-small" id="accountsRunSelected" disabled>运行所选账号</button>
              </div>
          </div>
      </div>
      <div id="accountsContainer">
          <p class="empty-note" style="padding:1.25rem">正在加载账号配置详情…</p>
      </div>
      <p class="hint" style="margin-top: 1.5rem;">可在此添加账号，保存后下次运行生效。列表不会显示密码；首次登录可能需要完成微软验证。</p>
    `;
    mounted = true;
    mountAccountCreator(root, ctx);

    U.$("#accountsSelectAll", root).addEventListener("change", (e) => {
      const configured = selectableAccounts();
      if (e.target.checked) configured.forEach((a) => selectedForBatch.add(a.index));
      else selectedForBatch.clear();
      render(root);
    });

    U.$("#accountsRunSelected", root).addEventListener("click", () => {
      runSelectedAccounts();
    });
  },

  async refresh(ctx) {
    context = ctx;
    accountsPayload = await cached("accounts", ctx.api.accounts, 5000);
    await refreshAccountCreator(rootEl, ctx);
    this.redraw(ctx);
  },

  redraw(ctx) {
    context = ctx || context;
    if (!mounted || !accountsPayload) return;
    render(rootEl);
  }
};