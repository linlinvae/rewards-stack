import assert from 'node:assert/strict';
import {test} from 'node:test';
import {once} from 'node:events';
import {ProcessManager} from '../.test-work/image/script/scripts/api/processManager.js';
import {installBrowserStartupGuard} from '../docker/browser-startup-guard.mjs';

const launch = {title:'BROWSER',message:'Launching bundled patched Chromium (Edge UA)'};
function fixture() {
  class Manager {
    state='running';child={};logs=[];stops=0;
    _appendLog(e){this.logs.push(e);}
    _controllerLog(level,message){this._appendLog({title:'CONTROLLER',level,message});}
    stop(){this.stops++;this.state='stopping';}
    _finalize(){this.state='idle';this.child=null;}
  }
  const timers=[];
  installBrowserStartupGuard(Manager,{timeoutMs:180000,schedule:fn=>{const t={fn};timers.push(t);return t;},cancel:t=>{t.canceled=true;}});
  return {manager:new Manager(),timers};
}
test('Startup deadline is not extended by session restore; exactly one stop',()=>{
  const {manager,timers}=fixture();manager._appendLog(launch);
  manager._appendLog({title:'SESSION',message:'Restoring saved browser session | cookies=10'});
  assert.equal(timers.length,1);timers[0].fn();timers[0].fn();
  assert.equal(manager.stops,1);assert(manager.logs.some(e=>e.level==='error'&&e.message.includes('恢复已保存会话')));
});
test('Created contexts, manual stops and normal exits disarm startup guard',()=>{
  for(const action of ['created','stop','exit']){
    const {manager,timers}=fixture();manager._appendLog(launch);
    if(action==='created')manager._appendLog({title:'BROWSER',message:'Created context | locale=en'});
    if(action==='stop')manager.stop();
    if(action==='exit')manager._finalize();
    timers[0].fn();assert(timers[0].canceled);assert.equal(manager.stops,action==='stop'?1:0);
  }
});
test('Stale timer cannot stop a new run or a replaced browser attempt',()=>{
  const {manager,timers}=fixture();manager._appendLog(launch);
  manager.child={};timers[0].fn();assert.equal(manager.stops,0);
  manager._appendLog(launch);manager._appendLog(launch);timers[1].fn();assert.equal(manager.stops,0);timers[2].fn();assert.equal(manager.stops,1);
});
test('Real process manager stops a stalled fixture child and returns idle',async()=>{
  class FixtureManager extends ProcessManager {}
  installBrowserStartupGuard(FixtureManager,{timeoutMs:300});
  const manager=new FixtureManager({command:process.execPath,args:['-e','console.log("[10/15/2026, 1:00:00 AM] [test] [INFO] MOBILE [BROWSER] Launching bundled patched Chromium (Edge UA)");setInterval(()=>{},1000)'],cwd:process.cwd(),stopTimeoutMs:1000});
  const exited=once(manager,'exit');
  const deadline=setTimeout(()=>{if(manager.state!=='idle')manager.stop({force:true});},5000);
  try{manager.start();await exited;assert.equal(manager.state,'idle');assert(manager.logBuffer.some(e=>e.level==='error'&&e.message.includes('浏览器初始化超过')));}finally{clearTimeout(deadline);if(manager.state!=='idle')manager.stop({force:true});}
});
