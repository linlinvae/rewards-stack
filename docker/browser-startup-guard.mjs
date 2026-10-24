// Bound browser startup only. This does not retry login or change browser identity.
const installed = new WeakSet();
export function installBrowserStartupGuard(Manager, {timeoutMs = 180000, schedule = setTimeout, cancel = clearTimeout} = {}) {
  if (installed.has(Manager)) return;
  installed.add(Manager);
  const active = new WeakMap();
  const clear = manager => {
    const pending = active.get(manager);
    if (pending) cancel(pending.timer);
    active.delete(manager);
  };
  const append = Manager.prototype._appendLog;
  Manager.prototype._appendLog = function(entry) {
    const result = append.call(this, entry);
    const message = String(entry.message || '');
    if (entry.title === 'BROWSER' && message.startsWith('Launching bundled patched Chromium')) {
      clear(this);
      if (!this.child || this.state !== 'running') return result;
      const pending = {child: this.child, stage: '启动浏览器', timer: null};
      pending.timer = schedule(() => {
        if (active.get(this) !== pending) return;
        clear(this);
        // A stale callback must never stop a replacement run.
        if (this.child !== pending.child || this.state !== 'running') return;
        this._controllerLog('error', `浏览器初始化超过 ${Math.round(timeoutMs / 1000)} 秒；最后阶段：${pending.stage}。已停止本次任务以释放资源，登录会话保留。请先排查浏览器初始化，避免连续重新运行。`);
        this.stop();
      }, timeoutMs);
      pending.timer?.unref?.();
      active.set(this, pending);
    } else if (entry.title === 'SESSION' && message.startsWith('Restoring saved browser session')) {
      const pending = active.get(this);
      if (pending) pending.stage = '恢复已保存会话';
    } else if (entry.title === 'BROWSER' && /^(Created context|Browser launch failed|Browser context closed)/.test(message)) {
      clear(this);
    }
    return result;
  };
  for (const name of ['stop', '_finalize']) {
    const original = Manager.prototype[name];
    Manager.prototype[name] = function(...args) {
      clear(this);
      return original.apply(this, args);
    };
  }
}
