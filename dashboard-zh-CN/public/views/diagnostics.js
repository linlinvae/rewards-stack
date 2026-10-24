import * as U from "../util.js";
import { cached } from "../api.js";

let rootEl = null;
let context = null;
let payload = null;
let open = null;

let accountsPayload = null;
let sessionsPayload = null;
let clearing = new Set();

function render() {
  if (!rootEl || !payload) return;

  U.$("#diagMeta", rootEl).textContent = payload.dir
    ? `共 ${payload.count} 份诊断资料，目录：${payload.dir}`
    : "";

  const list = U.$("#diagList", rootEl);
  const entries = payload.entries || [];

  if (!entries.length) {
    list.innerHTML =
      "<li class=\"empty-note\">暂无错误诊断资料。采集截图和页面需要在脚本配置中启用 <code>errorDiagnostics</code> 。</li>";
    return;
  }

  list.innerHTML = entries
    .map((entry) => {
      const isOpen = open === entry.name;
      const badges = [
        entry.hasScreenshot ? "<span class=\"tag-mini\">截图</span>" : "",
        entry.hasError ? '<span class="tag-mini">error.txt</span>' : "",
        entry.hasHtml ? '<span class="tag-mini">dump.html</span>' : "",
      ].join("");

      const firstLine =
        (entry.error || "").split("\n").find((l) => l.trim()) ||
        "未采集到错误文本。";

      const body = isOpen
        ? `<div class="diag-body">
                    ${entry.hasError
          ? `<pre class="diag-pre">${U.escapeHtml(entry.error || "")}</pre>`
          : "<p class=\"empty-note\">此份诊断中没有 error.txt。</p>"
        }
                    ${entry.hasScreenshot
          ? `<a class="diag-shot" href="${U.escapeAttr(diagUrl(entry.name, "screenshot.png"))}" target="_blank" rel="noopener">
                                 <img src="${U.escapeAttr(diagUrl(entry.name, "screenshot.png"))}" alt="${U.escapeAttr(entry.name)} 发生错误时采集的截图" loading="lazy">
                               </a>`
          : ""
        }
                    ${entry.hasHtml
          ? `<p><a class="btn btn-small" href="${U.escapeAttr(diagUrl(entry.name, "dump.html"))}" download>下载 dump.html</a></p>`
          : ""
        }
                   </div>`
        : "";

      return `<li class="diag-item">
                <button type="button" class="diag-head" data-diag="${U.escapeAttr(entry.name)}" aria-expanded="${isOpen}">
                    <span class="diag-when">${U.escapeHtml(U.fmtDateTime(entry.createdAt))}</span>
                    <span class="diag-name">${U.escapeHtml(entry.name)}</span>
                    <span class="diag-badges">${badges}</span>
                    <span class="exit-chevron" aria-hidden="true">${isOpen ? "\u25BE" : "\u25B8"}</span>
                </button>
                ${isOpen ? body : `<p class="diag-preview">${U.escapeHtml(String(firstLine || "").slice(0, 180))}</p>`}
            </li>`;
    })
    .join("");

  list.querySelectorAll("button[data-diag]").forEach((btn) =>
    btn.addEventListener("click", () => {
      open = open === btn.dataset.diag ? null : btn.dataset.diag;
      render();
    }),
  );
}

function diagUrl(name, file) {
  return `/api/diagnostics/${encodeURIComponent(name)}/${encodeURIComponent(file)}`;
}

// sessions

async function clearSession(email) {
  if (!context) return;
  const confirmed = window.confirm(
    `确定清除 ${email} 保存的会话吗？

此操作会立即退出该账号。下次运行需要重新登录，并重新完成双重验证（如果启用）。`,
  );
  if (!confirmed) return;

  clearing.add(email);
  renderSessions();
  try {
    await context.api.clearSession(email);
    context.toast(`已清除 ${email} 的会话。`, "success");
    context.invalidate();
    await context.refresh();
  } catch (e) {
    context.toast(e.message, e.status === 409 ? "warn" : "error");
  } finally {
    clearing.delete(email);
    renderSessions();
  }
}

function renderSessions() {
  if (!rootEl) return;
  const list = U.$("#sessionCardList", rootEl);
  if (!list) return;

  if (!accountsPayload || !sessionsPayload) {
    list.innerHTML = "<p class=\"empty-note\" style=\"padding:1.25rem\">正在加载…</p>";
    return;
  }

  const accounts = (accountsPayload.accounts || []).filter(
    (a) => a.configured,
  );
  if (!accounts.length) {
    list.innerHTML =
      "<p class=\"empty-note\" style=\"padding:1.25rem\">没有找到已配置的账号。</p>";
    return;
  }

  const byEmail = new Map();
  for (const s of sessionsPayload.sessions || []) {
    const key = s.email.toLowerCase();
    if (!byEmail.has(key)) byEmail.set(key, []);
    byEmail.get(key).push(s);
  }

  const running = Boolean(context?.status?.botRunning);

  list.innerHTML = accounts
    .map((a) => {
      const sessions = byEmail.get(a.email.toLowerCase()) || [];
      const hasSessions = sessions.length > 0;
      const latest = sessions.reduce(
        (max, s) => (!max || s.updatedAt > max ? s.updatedAt : max),
        null,
      );
      const meta = hasSessions
        ? `${sessions.map((s) => U.escapeHtml(U.displayPlatform(s.platform))).join(" \u00b7 ")} · 更新于 ${U.escapeHtml(U.fmtRelative(latest))}`
        : "尚无保存的会话";

      const isClearing = clearing.has(a.email);
      const disabled = !hasSessions || running || isClearing;
      const title = running
        ? "脚本必须空闲才能清除会话"
        : !hasSessions
          ? "此账号尚无保存的会话"
          : "";

      return `<div class="session-card">
                <div class="session-card-info">
                    <span class="session-card-email">${U.escapeHtml(a.email)}${a.index != null ? ` <span class="tag-mini">ACCOUNT_${a.index}</span>` : ""}</span>
                    <span class="session-card-meta">${meta}</span>
                </div>
                <button type="button" class="btn btn-danger btn-small" data-clear-session="${U.escapeAttr(a.email)}"
                    ${disabled ? "disabled" : ""} ${title ? `title="${U.escapeAttr(title)}"` : ""}>
                    ${isClearing ? "正在清除…" : "清除会话"}
                </button>
            </div>`;
    })
    .join("");

  list.querySelectorAll("button[data-clear-session]").forEach((btn) =>
    btn.addEventListener("click", () =>
      clearSession(btn.dataset.clearSession),
    ),
  );
}

export default {
  id: "diagnostics",
  label: "诊断",
  interval: 30000,

  mount(root, ctx) {
    rootEl = root;
    context = ctx;
    root.innerHTML = `
            <section class="panel" aria-labelledby="sessions-heading">
                <div class="panel-head">
                    <h2 id="sessions-heading">会话管理</h2>
                    <span class="panel-sub">清除会话可用于处理部分常见登录问题</span>
                </div>
                <p class="notice notice--warn">
                    清除会话会立即退出该账号，下次运行需要重新登录，并重新完成双重验证（如果启用）。仅在该账号确实出现登录问题时使用此操作。
                </p>
                <div class="session-card-list" id="sessionCardList">
                    <p class="empty-note" style="padding:1.25rem">正在加载…</p>
                </div>
            </section>

            <section class="panel" aria-labelledby="diag-heading">
                <div class="panel-head">
                    <h2 id="diag-heading">错误诊断资料</h2>
                    <span class="panel-sub" id="diagMeta"></span>
                    <button type="button" id="diagRefresh" class="btn btn-small">刷新</button>
                </div>
                <ul class="diag-list" id="diagList">
                    <li class="empty-note">正在加载…</li>
                </ul>
            </section>`;

    U.$("#diagRefresh", root).addEventListener("click", () =>
      this.refresh(ctx),
    );
  },

  async refresh(ctx) {
    context = ctx;
    try {
      payload = await ctx.api.diagnostics();
      render();
    } catch (e) {
      U.$("#diagList", rootEl).innerHTML =
        `<li class="notice notice--warn">${U.escapeHtml(e.message)}</li>`;
    }

    try {
      [accountsPayload, sessionsPayload] = await Promise.all([
        cached("accounts", ctx.api.accounts, 5000),
        ctx.api.sessions(),
      ]);
    } catch (e) {
      U.$("#sessionCardList", rootEl).innerHTML =
        `<p class="notice notice--warn">${U.escapeHtml(e.message)}</p>`;
      return;
    }
    renderSessions();
  },

  redraw() {
    render();
    renderSessions();
  },

  onState(state, ctx) {
    context = ctx;
    renderSessions();
  },
};