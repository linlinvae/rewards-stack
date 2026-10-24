import { mountPushPlus, refreshPushPlus } from "../pushplus.js";
import * as U from "../util.js";
import { api } from "../api.js";

const REDACTED = "***REDACTED***";

let rootEl = null;
let loaded = null; // the config exactly as the API returned it
let meta = null; // { path, redacted }
let drift = null; // { addedKeys, upToDate } from GET /api/config/diff, or null if unknown

const isPlainObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);

// Human-readable name + description for every known boolean config path,
// grouped for display. Descriptions are copied verbatim from the README's
// "Configuration Options" tables (same wording, so the two stay in sync).
// Labels are ours (the README doesn't provide separate display names) - a
// few README descriptions just restate the setting name (e.g. "Claim bonus
// points" / "Proxy query engine requests"), so label and description read
// the same for those; that's expected, not a bug. Anything present in
// config.json but not listed here at all (e.g. a brand-new option from an
// update the dashboard hasn't caught up with yet) still renders - just with
// a name derived from its path and no description - under a trailing
// "Other settings" group, so the toggle grid never silently drops a real
// setting.
const TOGGLE_GROUPS = [
  {
    title: "基础设置",
    fields: {
      headless: {
        label: "无头浏览器",
        desc: "在没有可见窗口的情况下运行浏览器",
      },
      errorDiagnostics: {
        label: "错误诊断",
        desc: "将错误和未知登录页面的诊断资料保存到 diagnostics/",
      },
      ensureStreakProtection: {
        label: "确保连续记录保护",
        desc: "确保已启用连续记录保护",
      },
      autoClaimPunchcardRewards: {
        label: "自动领取打卡奖励",
        desc: "自动领取已完成的打卡任务奖励",
      },
      skipNonPointTasks: {
        label: "跳过无积分任务",
        desc: "跳过不奖励积分的任务",
      },
      searchOnBingLocalQueries: {
        label: "ExploreOnBing 使用本地查询词",
        desc: "为 ExploreOnBing 使用本地查询词列表",
      },
    },
  },
  {
    title: "执行任务",
    fields: {
      "workers.doDailySet": {
        label: "每日任务集",
        desc: "完成每日任务集",
      },
      "workers.doClaimBonusPoints": {
        label: "领取额外积分",
        desc: "领取额外积分",
      },
      "workers.doMorePromotions": {
        label: "更多活动",
        desc: "完成“更多活动”中的任务",
      },
      "workers.doPunchCards": {
        label: "打卡任务",
        desc: "完成打卡任务",
      },
      "workers.doAppPromotions": {
        label: "应用活动",
        desc: "完成应用活动",
      },
      "workers.doDesktopSearch": {
        label: "桌面搜索",
        desc: "执行桌面搜索",
      },
      "workers.doMobileSearch": {
        label: "移动端搜索",
        desc: "执行移动端搜索",
      },
      "workers.doBonusSearches": {
        label: "额外搜索",
        desc: "执行超过常规上限的额外搜索",
      },
      "workers.doDailyCheckIn": {
        label: "每日签到",
        desc: "完成每日签到",
      },
      "workers.doReadToEarn": {
        label: "阅读赚取积分",
        desc: "完成阅读赚取积分任务",
      },
      "workers.doActivateSearchPerk": {
        label: "激活搜索加成",
        desc: "存在“搜索积分倍增”加成时激活（在每日任务集之后执行）",
      },
      "workers.doVisualSearch": {
        label: "视觉搜索",
        desc: "激活视觉搜索连续任务并执行视觉搜索",
      },
    },
  },
  {
    title: "活动设置",
    fields: {
      "activities.urlReward": {
        label: "链接奖励",
        desc: "完成链接奖励活动",
      },
      "activities.searchOnBing": {
        label: "ExploreOnBing",
        desc: "完成 ExploreOnBing 活动",
      },
    },
  },
  {
    title: "搜索设置",
    fields: {
      "searchSettings.scrollRandomResults": {
        label: "随机滚动结果",
        desc: "在搜索结果页面随机滚动",
      },
      "searchSettings.clickRandomResults": {
        label: "随机点击结果",
        desc: "随机点击链接",
      },
      "searchSettings.runOnZeroPoints": {
        label: "无剩余积分时继续搜索",
        desc: "即使没有剩余搜索积分也执行搜索",
      },
      "searchSettings.parallelSearching": {
        label: "并行搜索",
        desc: "并行执行搜索",
      },
      "searchSettings.clusterSearch": {
        label: "按主题分组搜索",
        desc: "根据 Bing 建议为每个主要主题生成一组查询词",
      },
    },
  },
  {
    title: "实验功能",
    fields: {
      "experimental.apiSearch": {
        label: "API 搜索",
        desc: "通过 HTTP 执行 Bing 搜索，替代浏览器页面操作",
      },
      "experimental.apiSearchOnBing": {
        label: "API ExploreOnBing",
        desc: "通过 HTTP 完成 ExploreOnBing 活动，替代浏览器操作",
      },
      "experimental.blockMedia": {
        label: "屏蔽媒体资源",
        desc: "屏蔽浏览器图片和媒体请求以减少流量",
      },
      "experimental.edgeBrowsing": {
        label: "Edge 浏览任务",
        desc: "以后台 HTTP 任务上报 30 分钟 Edge 浏览活动",
      },
    },
  },
  {
    title: "日志设置",
    fields: {
      debugLogs: {
        label: "调试日志",
        desc: "启用调试日志",
      },
      "consoleLogFilter.enabled": {
        label: "控制台日志过滤",
        desc: "启用控制台日志过滤",
      },
    },
  },
  {
    title: "代理",
    fields: {
      "proxy.queryEngine": {
        label: "查询来源请求使用代理",
        desc: "查询来源请求使用代理",
      },
      "proxy.ignoreCertificateErrors": {
        label: "忽略证书错误",
        desc: "为拦截代理关闭浏览器 TLS 证书校验",
      },
    },
  },
  {
    title: "通知与 Webhook",
    fields: {
      "webhook.discord.enabled": {
        label: "Discord 通知",
        desc: "启用 Discord Webhook 通知",
      },
      "webhook.telegram.enabled": {
        label: "Telegram 通知",
        desc: "启用 Telegram 通知",
      },
      "webhook.ntfy.enabled": {
        label: "ntfy 通知",
        desc: "启用 ntfy 通知",
      },
      "webhook.webhookLogFilter.enabled": {
        label: "通知日志过滤",
        desc: "启用通知日志过滤",
      },
    },
  },
];

const TOGGLE_META = {};
for (const group of TOGGLE_GROUPS) {
  for (const [path, meta] of Object.entries(group.fields)) {
    TOGGLE_META[path] = { ...meta, group: group.title };
  }
}
const OTHER_GROUP_TITLE = "其他设置";
const TOGGLE_GROUP_ORDER = [
  ...TOGGLE_GROUPS.map((g) => g.title),
  OTHER_GROUP_TITLE,
];

// Fallback for a boolean path with no entry above: "workers.doFooBar" ->
// "Foo bar". Keeps an unrecognized-but-real setting visible and readable
// rather than dropping it or showing the raw dotted path.
function fallbackLabel(path) {
  if (path === "contintueOnBotWarning") return "遇到机器人警告时继续";
  const last = path.split(".").pop();
  const spaced = last
    .replace(/^do/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  if (!spaced) return last;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

// Non-boolean settings a human would actually want a real control for
// (text/number/select/tag-list), grouped the same way as TOGGLE_GROUPS.
// Unlike the toggles, this list is NOT auto-discovered from config.json -
// each field needs a specific input type (a duration string isn't the same
// UI as a webhook URL isn't the same UI as a keyword list), so it's
// hand-maintained same as the toggle descriptions. Descriptions are again
// verbatim from the README's "Configuration Options" tables.
const FIELD_GROUPS = [
  {
    title: "基础设置",
    fields: {
      sessionPath: {
        kind: "text",
        label: "会话路径",
        desc: "保存浏览器会话的目录",
        placeholder: "sessions",
      },
      clusters: {
        kind: "number",
        label: "并发账号组数",
        desc: "并发执行的账号组数量",
        min: 0,
        step: 1,
        placeholder: "1",
      },
      globalTimeout: {
        kind: "text",
        label: "全局超时",
        desc: "所有操作的超时时间",
        placeholder: "30sec",
      },
      accountDelay: {
        kind: "delay",
        label: "账号之间的等待时间",
        min: {
          path: "accountDelay.min",
          desc: "开始下一个账号前的最短等待时间",
          placeholder: "1min",
        },
        max: {
          path: "accountDelay.max",
          desc: "开始下一个账号前的最长等待时间",
          placeholder: "3min",
        },
      },
    },
  },
  {
    title: "搜索设置",
    fields: {
      "searchSettings.maxBonusSearches": {
        kind: "number",
        label: "额外搜索最大次数",
        desc: "每次运行的额外搜索最大次数（启用额外搜索时）",
        min: 0,
        step: 1,
        placeholder: "110",
      },
      "searchSettings.searchResultVisitTime": {
        kind: "text",
        label: "搜索结果停留时间",
        desc: "在每个搜索结果中停留的时间",
        placeholder: "10sec",
      },
      "searchSettings.searchDelay": {
        kind: "delay",
        label: "搜索之间的等待时间",
        min: {
          path: "searchSettings.searchDelay.min",
          desc: "两次搜索之间的最短等待时间",
          placeholder: "30sec",
        },
        max: {
          path: "searchSettings.searchDelay.max",
          desc: "两次搜索之间的最长等待时间",
          placeholder: "1min",
        },
      },
      "searchSettings.readDelay": {
        kind: "delay",
        label: "阅读之间的等待时间",
        min: {
          path: "searchSettings.readDelay.min",
          desc: "阅读之间的最短等待时间",
          placeholder: "30sec",
        },
        max: {
          path: "searchSettings.readDelay.max",
          desc: "阅读之间的最长等待时间",
          placeholder: "1min",
        },
      },
      "searchSettings.queryEngines": {
        kind: "tags",
        label: "查询词来源",
        desc: "用于生成搜索查询词的来源",
        placeholder: "例如 google、rss.bbc",
        hint: "可用：google、wikipedia、wikirandom、hackernews、reddit、local 或 rss.<source> （例如 rss.bbc、rss.googleNews）。",
      },
    },
  },
  {
    title: "日志设置",
    fields: {
      "consoleLogFilter.mode": {
        kind: "select",
        label: "控制台过滤模式",
        desc: "过滤模式（白名单/黑名单）",
        options: [
          { value: "whitelist", label: "白名单" },
          { value: "blacklist", label: "黑名单" },
        ],
      },
      "consoleLogFilter.levels": {
        kind: "tags",
        label: "控制台过滤级别",
        desc: "参与过滤的日志级别",
        placeholder: "例如 error、warn",
        suggestions: ["error", "warn", "info", "debug"],
      },
      "consoleLogFilter.keywords": {
        kind: "tags",
        label: "控制台过滤关键词",
        desc: "参与过滤的关键词",
        placeholder: "例如 starting account",
      },
      "consoleLogFilter.regexPatterns": {
        kind: "tags",
        label: "控制台过滤正则表达式",
        desc: "用于过滤的正则表达式",
        placeholder: "例如 ^Error:",
        mono: true,
      },
    },
  },
  {
    title: "通知与 Webhook",
    fields: {
      "webhook.discord.url": {
        kind: "text",
        label: "Discord Webhook 地址",
        desc: "Discord Webhook 地址",
        placeholder: "https://discord.com/api/webhooks/...",
      },
      "webhook.telegram.botToken": {
        kind: "text",
        label: "Telegram 机器人令牌",
        desc: "Telegram 机器人令牌",
      },
      "webhook.telegram.chatId": {
        kind: "text",
        label: "Telegram 聊天 ID",
        desc: "Telegram 聊天 ID",
      },
      "webhook.ntfy.url": {
        kind: "text",
        label: "ntfy 服务器地址",
        desc: "ntfy 服务器地址",
      },
      "webhook.ntfy.topic": {
        kind: "text",
        label: "ntfy 主题",
        desc: "ntfy 主题",
      },
      "webhook.ntfy.token": {
        kind: "text",
        label: "ntfy 认证令牌",
        desc: "ntfy 认证令牌",
      },
      "webhook.ntfy.title": {
        kind: "text",
        label: "ntfy 通知标题",
        desc: "通知标题",
        placeholder: "Microsoft-Rewards-Script",
      },
      "webhook.ntfy.tags": {
        kind: "tags",
        label: "ntfy 标签",
        desc: "通知标签",
        placeholder: "例如 bot、notify",
      },
      "webhook.ntfy.priority": {
        kind: "select",
        label: "ntfy 优先级",
        desc: "通知优先级（1–5）",
        numeric: true,
        options: [
          { value: "1", label: "1 – 最低" },
          { value: "2", label: "2 – 低" },
          { value: "3", label: "3 – 默认" },
          { value: "4", label: "4 – 高" },
          { value: "5", label: "5 – 最高" },
        ],
      },
      "webhook.webhookLogFilter.mode": {
        kind: "select",
        label: "通知过滤模式",
        desc: "过滤模式（白名单/黑名单）",
        options: [
          { value: "whitelist", label: "白名单" },
          { value: "blacklist", label: "黑名单" },
        ],
      },
      "webhook.webhookLogFilter.levels": {
        kind: "tags",
        label: "通知过滤级别",
        desc: "发送通知的日志级别",
        placeholder: "例如 error、warn",
        suggestions: ["error", "warn", "info", "debug"],
      },
      "webhook.webhookLogFilter.keywords": {
        kind: "tags",
        label: "通知过滤关键词",
        desc: "参与过滤的关键词",
        placeholder: "例如 starting account",
      },
      "webhook.webhookLogFilter.regexPatterns": {
        kind: "tags",
        label: "通知过滤正则表达式",
        desc: "用于过滤的正则表达式",
        placeholder: "例如 ^Error:",
        mono: true,
      },
    },
  },
];

// Looked up by group title when rendering the combined toggles+fields
// section, so each group's card can render its fields (if any) right under
// its toggles (if any) - see renderSettings().
const FIELD_GROUPS_BY_TITLE = new Map(
  FIELD_GROUPS.map((g) => [g.title, g.fields]),
);

// The exact filter the bot's own maintainer uses for push-notification
// webhooks (ntfy, and equally relevant to Discord/Telegram): without it,
// every log line - including debug noise - goes out as a notification.
const RECOMMENDED_WEBHOOK_FILTER = {
  webhook: {
    webhookLogFilter: {
      enabled: true,
      mode: "whitelist",
      levels: [],
      keywords: ["starting account", "select number", "collected"],
      regexPatterns: [],
    },
  },
};

function deepDiff(base, next) {
  const out = {};
  for (const [k, v] of Object.entries(next)) {
    const b = isPlainObject(base) ? base[k] : undefined;
    if (isPlainObject(v) && isPlainObject(b)) {
      const sub = deepDiff(b, v);
      if (Object.keys(sub).length) out[k] = sub;
    } else if (JSON.stringify(v) !== JSON.stringify(b)) {
      out[k] = v;
    }
  }
  return out;
}

function booleanPaths(obj, prefix = "") {
  let out = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "boolean") out.push({ path, value: v });
    else if (isPlainObject(v)) out = out.concat(booleanPaths(v, path));
  }
  return out;
}

function nest(path, value) {
  const parts = path.split(".");
  const root = {};
  let node = root;
  for (let i = 0; i < parts.length - 1; i++) {
    node[parts[i]] = {};
    node = node[parts[i]];
  }
  node[parts[parts.length - 1]] = value;
  return root;
}

function setDeep(obj, path, value) {
  const parts = path.split(".");
  let node = obj;
  for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]];
  node[parts[parts.length - 1]] = value;
}

function getDeep(obj, path) {
  let node = obj;
  for (const key of path.split(".")) {
    if (node == null) return undefined;
    node = node[key];
  }
  return node;
}

// Same shape as configEditor.js's server-side deepMerge (objects merge key
// by key, arrays/scalars replace wholesale) - used to fold a just-saved
// patch into the in-memory `loaded` config without a full re-fetch. No
// __proto__ guard here since these patches are always ones we built
// ourselves from known field paths, never parsed from outside input.
function localMerge(base, patch) {
  if (!isPlainObject(patch)) return patch;
  const out = { ...(isPlainObject(base) ? base : {}) };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isPlainObject(v) ? localMerge(out[k], v) : v;
  }
  return out;
}

// Folds a successful save's patch into `loaded` and refreshes the combined
// toggles+fields section plus the raw JSON editor. Used by every control in
// that section (toggle switches, text/select/tag fields, the recommended-
// filter tip) - a single rebuild keeps all of it consistent, e.g. flipping
// "Webhook log filter" on via the tip button correctly checks that same
// toggle switch too, since they're now rendered from the same pass.
function afterSave(patch) {
  loaded = localMerge(loaded, patch);
  renderSettings();
  U.$("#cfgEditor", rootEl).value = JSON.stringify(loaded, null, 2);
}

function showNotice(id, message, kind = "warn") {
  const el = U.$(`#${id}`, rootEl);
  el.hidden = !message;
  el.className = `notice notice--${kind}`;
  el.innerHTML = message || "";
}

// Combines a field's description with its raw config path into one native
// tooltip string (description on the first line, path on the second) so
// hovering still surfaces both pieces of info now that neither is shown
// as visible on-page text.
function fieldTooltip(path, desc) {
  return desc ? `${desc}\n${path}` : path;
}

function switchHtml(b) {
  const meta = TOGGLE_META[b.path];
  const label = meta?.label || fallbackLabel(b.path);
  const desc = meta?.desc || "";
  return `
        <label class="switch" title="${U.escapeAttr(fieldTooltip(b.path, desc))}">
            <input type="checkbox" data-path="${U.escapeAttr(b.path)}" ${b.value ? "checked" : ""}>
            <span class="switch-label hint-text">${U.escapeHtml(label)}</span>
        </label>`;
}

function renderSettings() {
  const host = U.$("#cfgSettings", rootEl);
  if (!host) return;

  // Group booleans in TOGGLE_GROUP_ORDER order; anything unrecognized falls
  // into a trailing "Other settings" group rather than being dropped.
  const bools = booleanPaths(loaded);
  const togglesByGroup = new Map();
  for (const b of bools) {
    const groupTitle = TOGGLE_META[b.path]?.group || OTHER_GROUP_TITLE;
    if (!togglesByGroup.has(groupTitle)) togglesByGroup.set(groupTitle, []);
    togglesByGroup.get(groupTitle).push(b);
  }

  // TOGGLE_GROUP_ORDER already lists every group that can have detail
  // fields too (Core/Search settings/Logging/Webhooks are a subset of it),
  // so it's the single source of truth for section order - toggles for a
  // group render first, its detail fields render underneath, in the same
  // card, so e.g. "Webhook log filter" (the enable toggle) sits directly
  // above the filter's mode/levels/keywords fields it controls.
  host.innerHTML = TOGGLE_GROUP_ORDER.filter(
    (title) => togglesByGroup.has(title) || FIELD_GROUPS_BY_TITLE.has(title),
  )
    .map((title) => {
      const toggles = togglesByGroup.get(title) || [];
      const fields = FIELD_GROUPS_BY_TITLE.get(title);
      return `
        <div class="acc-detail-group">
            <h3 class="acc-detail-group-title">${U.escapeHtml(title)}</h3>
            ${toggles.length ? `<div class="switch-grid">${toggles.map(switchHtml).join("")}</div>` : ""}
            ${title === "通知与 Webhook" ? webhookFilterTipHtml() : ""}
            ${fields
          ? `<div class="field-grid">${Object.entries(fields)
            .map(([path, def]) => fieldHtml(path, def))
            .join("")}</div>`
          : ""
        }
        </div>`;
    })
    .join("");

  bindToggleEvents(host);
  bindFieldEvents(host);
}

function bindToggleEvents(host) {
  host.querySelectorAll('input[type="checkbox"][data-path]').forEach((input) =>
    input.addEventListener("change", async () => {
      const path = input.dataset.path;
      const value = input.checked;
      input.disabled = true;
      try {
        await save(nest(path, value), `${path} \u2192 ${value}`);
        afterSave(nest(path, value)); // rebuilds the whole section from the new state
      } catch {
        input.checked = !value; // roll the switch back; save() already explained why
        input.disabled = false;
      }
    }),
  );
}

function listId(path) {
  return `dl-${path.replace(/[^a-zA-Z0-9]/g, "-")}`;
}

function textFieldHtml(path, def) {
  const type = def.kind === "number" ? "number" : "text";
  const raw = getDeep(loaded, path);
  const locked = typeof raw === "string" && raw === REDACTED;
  const value = locked ? "" : (raw ?? "");
  return `
        <label class="field field-item" title="${U.escapeAttr(fieldTooltip(path, def.desc))}">
            <span class="hint-text">${U.escapeHtml(def.label)}</span>
            <input class="input" type="${type}" data-path="${U.escapeAttr(path)}"
                value="${U.escapeAttr(String(value))}"
                placeholder="${U.escapeAttr(locked ? "内容已隐藏，勾选下方“显示敏感值”后才能编辑" : def.placeholder || "")}"
                ${locked ? "disabled" : ""}
                ${def.min != null ? `min="${def.min}"` : ""}
                ${def.step != null ? `step="${def.step}"` : ""}>
            ${locked ? "<span class=\"field-locked\">🔒 显示敏感值之前保持隐藏</span>" : ""}
        </label>`;
}

function selectFieldHtml(path, def) {
  const raw = getDeep(loaded, path);
  const current = raw == null ? "" : String(raw);
  return `
        <label class="field field-item" title="${U.escapeAttr(fieldTooltip(path, def.desc))}">
            <span class="hint-text">${U.escapeHtml(def.label)}</span>
            <select class="input" data-path="${U.escapeAttr(path)}" ${def.numeric ? 'data-numeric="1"' : ""}>
                ${def.options
      .map(
        (o) =>
          `<option value="${U.escapeAttr(o.value)}" ${String(o.value) === current ? "selected" : ""}>${U.escapeHtml(o.label)}</option>`,
      )
      .join("")}
            </select>
        </label>`;
}

function tagsFieldHtml(path, def) {
  const raw = getDeep(loaded, path);
  const items = Array.isArray(raw) ? raw : [];
  const dlId = def.suggestions ? listId(path) : null;
  return `
        <div class="field field-item field-tags" title="${U.escapeAttr(fieldTooltip(path, def.desc))}" data-tags-path="${U.escapeAttr(path)}">
            <span class="hint-text">${U.escapeHtml(def.label)}</span>
            <div class="tag-chips">
                ${items
      .map(
        (item, i) => `
                    <span class="tag-chip${def.mono ? " tag-chip--mono" : ""}">
                        <span class="tag-chip-text">${U.escapeHtml(String(item))}</span>
                        <button type="button" class="tag-chip-remove" data-tag-remove="${i}" aria-label="移除 ${U.escapeAttr(String(item))}">&times;</button>
                    </span>`,
      )
      .join("")}
                ${!items.length ? "<span class=\"empty-note tag-empty\">尚未设置</span>" : ""}
            </div>
            <div class="tag-add">
                <input class="input tag-add-input" type="text" placeholder="${U.escapeAttr(def.placeholder || "添加值…")}" ${dlId ? `list="${dlId}"` : ""}>
                <button type="button" class="btn btn-small tag-add-btn">添加</button>
            </div>
            ${dlId ? `<datalist id="${dlId}">${def.suggestions.map((s) => `<option value="${U.escapeAttr(s)}">`).join("")}</datalist>` : ""}
            ${def.hint ? `<span class="field-hint">${U.escapeHtml(def.hint)}</span>` : ""}
        </div>`;
}

function delaySubFieldHtml(groupLabel, subLabel, sub) {
  const value = getDeep(loaded, sub.path);
  return `
        <label class="field field-item" title="${U.escapeAttr(fieldTooltip(sub.path, sub.desc))}">
            <span class="hint-text">${U.escapeHtml(groupLabel)} \u2014 ${subLabel}</span>
            <input class="input" type="text" data-path="${U.escapeAttr(sub.path)}"
                value="${U.escapeAttr(value ?? "")}" placeholder="${U.escapeAttr(sub.placeholder || "")}">
        </label>`;
}

function fieldHtml(path, def) {
  switch (def.kind) {
    case "text":
    case "number":
      return textFieldHtml(path, def);
    case "select":
      return selectFieldHtml(path, def);
    case "tags":
      return tagsFieldHtml(path, def);
    case "delay":
      return (
        delaySubFieldHtml(def.label, "最短", def.min) +
        delaySubFieldHtml(def.label, "最长", def.max)
      );
    default:
      return "";
  }
}

function webhookFilterTipHtml() {
  return `
        <p class="notice notice--info cfg-tip">
            请先将 <strong>通知日志过滤</strong> 设置为 <em>开启</em> 后再启用 ntfy 等推送通知，否则每一条日志（包括调试信息）都会推送。启用过滤后，仅发送账号开始、双重验证提示和账号完成摘要。可用白名单模式及下方“通知过滤关键词”设置要接收的内容。
            <span class="notice-actions">
                <button type="button" id="cfgWebhookFilterTipBtn" class="btn btn-primary btn-small">应用推荐过滤规则</button>
                <span class="notice-sub">白名单 · starting account、select number、collected</span>
            </span>
        </p>`;
}

function bindFieldEvents(host) {
  host.querySelectorAll("input.input[data-path]").forEach((input) => {
    if (input.disabled) return; // locked/redacted - nothing to bind
    const path = input.dataset.path;
    const isNumber = input.type === "number";
    const original = input.value;

    const commit = async () => {
      const next = input.value.trim();
      if (next === original.trim()) return;
      if (next === "") {
        input.value = original;
        return;
      }
      const value = isNumber ? Number(next) : next;
      if (isNumber && Number.isNaN(value)) {
        U.toast("请输入有效数字。", "error");
        input.value = original;
        return;
      }
      input.disabled = true;
      try {
        await save(nest(path, value), `${path} \u2192 ${value}`);
        afterSave(nest(path, value));
      } catch {
        input.value = original; // save() already explained why
      } finally {
        input.disabled = false;
      }
    };

    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "请输入") input.blur();
    });
  });

  host.querySelectorAll("select.input[data-path]").forEach((select) => {
    const path = select.dataset.path;
    const numeric = select.dataset.numeric === "1";
    select.addEventListener("change", async () => {
      const raw = select.value;
      const value = numeric ? Number(raw) : raw;
      select.disabled = true;
      try {
        await save(nest(path, value), `${path} \u2192 ${value}`);
        afterSave(nest(path, value));
      } catch {
        const prev = getDeep(loaded, path);
        select.value = prev == null ? "" : String(prev); // save() already explained why
      } finally {
        select.disabled = false;
      }
    });
  });

  host.querySelectorAll("[data-tags-path]").forEach((wrap) => {
    const path = wrap.dataset.tagsPath;
    const controls = () => wrap.querySelectorAll("input,button");

    const commitTags = async (nextItems) => {
      controls().forEach((el) => (el.disabled = true));
      try {
        await save(
          nest(path, nextItems),
          `${path} → ${nextItems.length} 项`,
        );
        afterSave(nest(path, nextItems)); // re-renders this field with the new list
      } catch {
        controls().forEach((el) => (el.disabled = false)); // save() already explained why
      }
    };

    wrap.querySelectorAll("[data-tag-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.tagRemove);
        const items = Array.isArray(getDeep(loaded, path))
          ? [...getDeep(loaded, path)]
          : [];
        items.splice(idx, 1);
        commitTags(items);
      });
    });

    const input = wrap.querySelector(".tag-add-input");
    const addBtn = wrap.querySelector(".tag-add-btn");
    const addFromInput = () => {
      const value = input.value.trim();
      if (!value) return;
      const items = Array.isArray(getDeep(loaded, path))
        ? [...getDeep(loaded, path)]
        : [];
      if (items.includes(value)) {
        U.toast("此项已在列表中。", "info");
        input.value = "";
        return;
      }
      items.push(value);
      commitTags(items);
    };
    addBtn?.addEventListener("click", addFromInput);
    input?.addEventListener("keydown", (e) => {
      if (e.key === "请输入") {
        e.preventDefault();
        addFromInput();
      }
    });
  });

  const tipBtn = U.$("#cfgWebhookFilterTipBtn", host);
  tipBtn?.addEventListener("click", async () => {
    tipBtn.disabled = true;
    tipBtn.textContent = "正在应用…";
    try {
      await save(RECOMMENDED_WEBHOOK_FILTER, "推荐通知过滤规则");
      afterSave(RECOMMENDED_WEBHOOK_FILTER);
    } catch {
      // save() already explained why
    } finally {
      tipBtn.disabled = false;
      tipBtn.textContent = "应用推荐过滤规则";
    }
  });
}

function explainConfigError(e) {
  if (e.status === 403) {
    return {
      kind: "warn",
      message:
        "控制 API 已关闭配置写入。需设置 <code>API_ALLOW_CONFIG_WRITE=true</code> 到脚本环境变量中，并重建脚本容器。",
    };
  }
  if (e.status === 422) {
    const errors = (e.body && e.body.errors) || [];
    return {
      kind: "error",
      message: `<strong>脚本拒绝了此配置：</strong><ul>${errors.map((x) => `<li>${U.escapeHtml(x)}</li>`).join("")}</ul>`,
    };
  }
  return { kind: "error", message: U.escapeHtml(e.message) };
}

async function save(patch, description) {
  try {
    const res = await api.patchConfig(patch);
    showNotice("cfgNotice", "");
    U.toast(`已保存：${description}。下次运行时生效。`, "success");
    return res;
  } catch (e) {
    const { kind, message } = explainConfigError(e);
    showNotice("cfgNotice", message, kind);
    U.toast(e.message, "error");
    throw e;
  }
}

async function checkDrift() {
  try {
    drift = await api.configDiff();
  } catch {
    drift = null; // best-effort; the rest of the page works fine without it
  }
  renderDrift();
}

function renderDrift() {
  const el = U.$("#cfgDrift", rootEl);
  if (!el) return;
  if (!drift || drift.upToDate || !drift.addedKeys?.length) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  const n = drift.addedKeys.length;
  el.hidden = false;
  el.className = "notice notice--warn";
  el.innerHTML = `
    <strong>配置有可同步的新字段</strong> — 最近的脚本更新新增了 ${n} 个字段：
    <ul>${drift.addedKeys.map((k) => `<li><code>${U.escapeHtml(k)}</code></li>`).join("")}</ul>
    <div class="notice-actions">
      <button type="button" id="cfgSyncBtn" class="btn btn-primary btn-small">立即同步</button>
      <span class="notice-sub">按默认值补充缺失字段，已有配置值不会被修改。</span>
    </div>`;
  U.$("#cfgSyncBtn", rootEl).addEventListener("click", doSync);
}

async function doSync() {
  const btn = U.$("#cfgSyncBtn", rootEl);
  btn.disabled = true;
  btn.textContent = "正在同步…";
  try {
    const result = await api.syncConfig();
    showNotice("cfgNotice", "");
    U.toast(
      result.patched
        ? `已同步 ${result.addedKeys.length} 个字段，下次运行时生效。`
        : "配置已是最新。",
      "success",
    );
    await loadConfig(U.$("#cfgReveal", rootEl)?.checked || false); // reload config.json (now includes the synced fields) and re-check drift
  } catch (e) {
    const { kind, message } = explainConfigError(e);
    showNotice("cfgNotice", message, kind);
    btn.disabled = false;
    btn.textContent = "立即同步";
  }
}

// Shared by initial load, "Reload from API", the reveal-secrets toggle, and
// post-sync reload - one place that fetches config.json + drift status together.
async function loadConfig(reveal) {
  const res = await api.config(reveal);
  loaded = res.config;
  meta = { path: res.path, redacted: res.redacted };
  paint();
  checkDrift(); // not awaited - drift banner fills in once it resolves, doesn't block the rest of the page
  return res;
}

function paint() {
  U.$("#cfgRedacted", rootEl).hidden = !meta.redacted;
  U.$("#cfgEditor", rootEl).value = JSON.stringify(loaded, null, 2);
  renderSettings();
  showNotice("cfgNotice", "");
}

export default {
  id: "config",
  label: "配置",
  interval: 0, // never poll: it would stomp on whatever is in the editor

  mount(root, ctx) {
    rootEl = root;
    root.innerHTML = `
            <p class="notice notice--warn" id="cfgNotice" hidden></p>
            <div id="cfgDrift" hidden></div>

            <section class="panel" aria-labelledby="cfg-settings-heading">
                <div class="panel-head">
                    <h2 id="cfg-settings-heading">设置</h2>
                    <span class="panel-sub">每次修改会自动保存，下次运行时生效。</span>
                </div>
                <div class="cfg-toggle-groups" id="cfgSettings"></div>
            </section>

            <section class="panel" aria-labelledby="cfg-raw-heading">
                <div class="panel-head">
                    <h2 id="cfg-raw-heading">原始 JSON 配置</h2>
                    <span class="panel-sub">仅提交你实际修改的字段</span>
                    <label class="check">
                        <input type="checkbox" id="cfgReveal">
                        <span>显示敏感值</span>
                    </label>
                </div>

                <p class="notice notice--info" id="cfgRedacted" hidden>
                    Webhook 地址和令牌显示为 <code>${REDACTED}</code>。保存时不会覆盖这些隐藏值，只会提交你修改的字段。若要查看和编辑它们，请将 <code>API_ALLOW_CONFIG_REVEAL=true</code>
                    到控制 API 环境变量中，再勾选“显示敏感值”。
                </p>

                <textarea id="cfgEditor" class="editor" spellcheck="false" autocomplete="off" aria-label="config.json"></textarea>

                <div class="form-actions">
                    <button type="button" id="cfgSave" class="btn btn-primary">保存修改</button>
                    <button type="button" id="cfgReload" class="btn" title="放弃未保存的修改，重新从脚本读取 config.json。">从 API 重新加载</button>
                </div>
            </section>`;

    mountPushPlus(root);

    U.$("#cfgReload", root).addEventListener("click", () => this.refresh(ctx));

    U.$("#cfgReveal", root).addEventListener("change", async (e) => {
      try {
        const res = await loadConfig(e.target.checked);
        if (e.target.checked && res.redacted) {
          showNotice(
            "cfgNotice",
            "控制 API 拒绝显示敏感值。需设置 <code>API_ALLOW_CONFIG_REVEAL=true</code> （以及 <code>API_TOKEN</code>）到控制 API 环境变量中，才能启用此功能。",
          );
        }
      } catch (err) {
        U.toast(err.message, "error");
      }
    });

    U.$("#cfgSave", root).addEventListener("click", async () => {
      let edited;
      try {
        edited = JSON.parse(U.$("#cfgEditor", root).value);
      } catch (err) {
        showNotice(
          "cfgNotice",
          `JSON 格式无效：${U.escapeHtml(err.message)}`,
          "error",
        );
        return;
      }

      const patch = deepDiff(loaded, edited);
      if (!Object.keys(patch).length) {
        U.toast("没有配置变更。", "info");
        return;
      }

      if (JSON.stringify(patch).includes(REDACTED)) {
        showNotice(
          "cfgNotice",
          "此修改会用 <code>" +
          REDACTED +
          "</code> 覆盖实际凭据。需启用 <code>API_ALLOW_CONFIG_REVEAL=true</code> 并先勾选“显示敏感值”。",
          "error",
        );
        return;
      }

      try {
        await save(
          patch,
          `${Object.keys(patch).length} 个字段`,
        );
        loaded = edited;
        renderSettings();
      } catch {
      }
    });
  },

  async refresh(ctx) {
    await refreshPushPlus(rootEl);
    try {
      const reveal = U.$("#cfgReveal", rootEl)?.checked || false;
      await loadConfig(reveal);
    } catch (e) {
      showNotice("cfgNotice", U.escapeHtml(e.message), "error");
    }
  },
};
