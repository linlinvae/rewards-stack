// Display-only adapters for runtime API text, locale formatting and data enums.
function replace(text,from,to,all=false) {
  if(!text.includes(from))throw new Error('Pinned display adapter source no longer matches: '+from.slice(0,80));
  return all?text.split(from).join(to):text.replace(from,to);
}
export function adapt(file,text) {
  if(file==='public/views/accounts.js') {
    text=replace(text,'  if (total <= 0) return "";',`  if (earnable && Object.values(earnable).some(value => value == null)) return '<span class="point-source point-source--target"><strong>可获取积分</strong> 已知 ' + U.escapeHtml(U.fmtNumber(total)) + '，手机搜索额度未知</span>';
  if (total <= 0) return "";`);
  }
  if(file==='public/util.js') {
    text='import { displayMessage, displayPlatform, displayLevel, themeLabel } from "./zh-CN.js";\nexport { displayMessage, displayPlatform, displayLevel, themeLabel };\n'+text;
    text=replace(text,'Number(n).toLocaleString()','Number(n).toLocaleString("zh-CN")',true);
    text=replace(text,'d.toLocaleString(undefined, {','d.toLocaleString("zh-CN", {\n    timeZone: timeZone || undefined,\n    hour12: false,');
    text=replace(text,'d.toLocaleString("en-US", {','d.toLocaleString("zh-CN", {');
    text=replace(text,'hour12: true','hour12: false');
    text=replace(text,'toLocaleDateString(undefined, options)','toLocaleDateString("zh-CN", options)');
    text=replace(text,'`${Math.round(sec)}s`','`${Math.round(sec)} 秒`',true);
    text=replace(text,'`${m}m ${s}s` : `${m}m`','`${m} 分 ${s} 秒` : `${m} 分`');
    text=replace(text,'`${h}h ${m % 60}m`','`${h} 小时 ${m % 60} 分`');
    text=replace(text,'export function toast(message, kind = "info", ms = 4000) {','export function toast(message, kind = "info", ms = 4000) {\n  message = displayMessage(message);');
  }
  if(file==='public/app.js') {
    text='import { mountLoginInput } from "./login-input.js";\nmountLoginInput();\n'+text;
    text=replace(text,'U.escapeHtml(t.name)','U.escapeHtml(U.themeLabel(t.name))');
    text=replace(text,'badge.title = s?.lastError || ""','badge.title = U.displayMessage(s?.lastError || "")');
  }
  if(file==='public/api.js') {
    text='import { displayMessage } from "./zh-CN.js";\n'+text;
    text=replace(text,'err.status = res.status;','err.message = displayMessage(err.message);\n    err.status = res.status;');
    text=replace(text,'async function call(method, path, body) {','async function call(method, path, body) {\n  const accountWrite = (method === "POST" && path === "/api/accounts") || (method === "DELETE" && path.startsWith("/api/dashboard-accounts/"));');
    text=replace(text,'  let res;','  if (accountWrite) opts.headers["X-Rewards-Account-Write"] = "1";\n\n  let res;');
    text=replace(text,'export const api = {','export const api = {\n  accountManagement: () => call("GET", "/api/account-management"),\n  createAccount: (account) => call("POST", "/api/accounts", account),');
  }
  if(file==='public/views/overview.js') {
    for(const [en,zh] of [['profiles','个账号'],['points','积分'],['timestamp','时间'],['errors','个错误']])text=replace(text,JSON.stringify(en),JSON.stringify(zh),true);
    text=replace(text,'U.escapeHtml(sched.description || "\\u2013")','U.escapeHtml(U.displayMessage(sched.description || "\\u2013"))');
    text=replace(text,'errEl.textContent = accountsPayload.apiError','errEl.textContent = U.displayMessage(accountsPayload.apiError)');
  }
  if(file==='public/views/accounts.js') {
    text='import { mountAccountCreator, updateAccountCreator, refreshAccountCreator } from "../account-create.js";\n'+text;
    text=replace(text,'errEl.textContent = accountsPayload.apiError','errEl.textContent = U.displayMessage(accountsPayload.apiError)');
    text=replace(text,'  runBtn.textContent = batchRunning ? "正在启动…" : "运行所选账号";','  runBtn.textContent = batchRunning ? "正在启动…" : "运行所选账号";\n  updateAccountCreator(root, context);');
    text=replace(text,'    mounted = true;','    mounted = true;\n    mountAccountCreator(root, ctx);');
    text=replace(text,'    this.redraw(ctx);','    await refreshAccountCreator(rootEl, ctx);\n    this.redraw(ctx);');
    text=replace(text,'已在 .env 中配置','已配置');
    text=replace(text,'从管理面板永久删除此账号及其历史记录','删除账号配置及面板历史，保留登录会话');
    text=replace(text,'从管理面板移除此账号及其历史记录','删除账号配置及面板历史，保留登录会话');
    text=replace(text,'<span class="acc-delete-confirm">','<span class="acc-delete-confirm"><span class="hint">删除配置及面板历史，保留登录会话。</span>');
    text=replace(text,'const deleteBlocked = a.status === "running" || launching.has(a.index);','const deleteBlocked = Boolean(context?.status?.botRunning) || a.status === "running" || launching.has(a.index);');
    text=replace(text,'已从管理面板移除 ${account.email}。','已删除 ${account.email} 的账号配置及面板记录，可以重新添加。');
    text=replace(text,'账号配置位于脚本的 <code>.env</code> (<code>ACCOUNT_N_*</code>）。控制 API 会显示完整邮箱地址，但不会返回密码、恢复邮箱、TOTP 密钥或代理凭据。','可在此添加账号，保存后下次运行生效。列表不会显示密码；首次登录可能需要完成微软验证。');
  }
  if(file==='public/views/config.js') {
    text='import { mountPushPlus, refreshPushPlus } from "../pushplus.js";\n'+text;
    text=replace(text,'    U.$("#cfgReload", root).addEventListener','    mountPushPlus(root);\n\n    U.$("#cfgReload", root).addEventListener');
    text=replace(text,'  async refresh(ctx) {','  async refresh(ctx) {\n    await refreshPushPlus(rootEl);');
    text=replace(text,'function fallbackLabel(path) {','function fallbackLabel(path) {\n  if (path === \"contintueOnBotWarning\") return \"遇到机器人警告时继续\";');
    text=replace(text,'delaySubFieldHtml(def.label, "min", def.min)','delaySubFieldHtml(def.label, "最短", def.min)');
    text=replace(text,'delaySubFieldHtml(def.label, "max", def.max)','delaySubFieldHtml(def.label, "最长", def.max)');
  }
  if(file==='public/views/runs.js'){
    text='import { renderRunPushPlus } from "../run-pushplus.js";\n'+text;
    text=replace(text,'textContent = runsPayload.apiError','textContent = U.displayMessage(runsPayload.apiError)');
    text=replace(text,'    .join("");\n}\n\nfunction exitPill(exit)', '    .join("");\n  renderRunPushPlus(rootEl, runs);\n}\n\nfunction exitPill(exit)');
    text=replace(text,'colspan=\\"7\\"','colspan=\\"8\\"');
    text=replace(text,'根据脚本输出日志整理','根据脚本输出日志整理；可手动发送已结束记录，手机可左右滑动表格');
  }
  if(file==='public/views/schedule.js') {
    text=replace(text,'current.lastResult || "\\u2013"','U.displayMessage(current.lastResult || "\\u2013")');
    text=replace(text,'out.textContent = res.valid ? res.description : res.error','out.textContent = U.displayMessage(res.valid ? res.description : res.error)');
  }
  if(file==='public/views/diagnostics.js')text=replace(text,'U.escapeHtml(s.platform)','U.escapeHtml(U.displayPlatform(s.platform))');
  if(file==='public/views/logs.js')text=replace(text,'U.escapeHtml(e.level)','U.escapeHtml(U.displayLevel(e.level))');
  if(file==='lib/cron.js') {
    const start=text.indexOf('function to12h('),end=text.indexOf('\n}',start);
    if(start<0||end<0)throw new Error('Cron display helper not found');
    text=text.slice(0,start)+'function to12h(h, m) {\n  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;\n}'+text.slice(end+2);
  }
  return text;
}
