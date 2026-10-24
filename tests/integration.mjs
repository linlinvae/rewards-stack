import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire,stripTypeScriptTypes} from 'node:module';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {snapshotTree} from '../scripts/snapshot.mjs';
import {patchScriptServer,patchDashboardServer} from '../docker/install-account-ui.mjs';
import {patchLoginScriptServer,patchLoginDashboardServer,patchLoginHelper,patchLoginController} from '../docker/install-web-login.mjs';
import {patchPushPlusDashboard} from '../docker/install-pushplus.mjs';
import {patchControlParser,patchDashboardParser,patchDashboardStore} from '../docker/install-rewards-reliability.mjs';
const root=path.resolve(import.meta.dirname,'..');
let req=createRequire(import.meta.url);
try {req.resolve('yaml');} catch {req=createRequire(path.join(root,'.test-work/tools/package.json'));}
const yaml=req('yaml');
const variant=process.env.TEST_VARIANT||'source';
assert(['source','image','zh-CN'].includes(variant));
fs.mkdirSync(path.join(root,'.test-work'),{recursive:true});
const workspace=fs.mkdtempSync(path.join(root,'.test-work','integration-'));
const pushplusCapture=path.join(workspace,'pushplus-fixture.ndjson');
const pushplusFixtureToken='fixture-pushplus-token-0123456789abcd';
const capturedPushes=()=>fs.existsSync(pushplusCapture)?fs.readFileSync(pushplusCapture,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)):[];
const scriptDir=path.join(workspace,'script'),dashDir=path.join(workspace,'dashboard');
fs.mkdirSync(scriptDir);
const scriptSource=variant!=='source'?path.join(root,'.test-work/image/script'):path.join(root,'upstream/script');
const dashSource=variant!=='source'?path.join(root,'.test-work/image/dashboard'):path.join(root,'upstream/dashboard/rewards-dashboard');
for(const file of ['scripts','package.json','config.example.json']) fs.cpSync(path.join(scriptSource,file),path.join(scriptDir,file),{recursive:true});
fs.mkdirSync(path.join(scriptDir,'dist/util'),{recursive:true});
let configSyncOverride;
if(variant!=='source') {
  fs.copyFileSync(path.join(scriptSource,'dist/util/ConfigSync.js'),path.join(scriptDir,'dist/util/ConfigSync.js'));
} else {
  // Exercise the source utility without downloading the full browser runtime.
  // Strip TypeScript and provide its CommonJS CLI guard for an ESM import.
  configSyncOverride=path.join(scriptDir,'dist/util/ConfigSync.mjs');
  const code=stripTypeScriptTypes(fs.readFileSync(path.join(scriptSource,'src/util/ConfigSync.ts'),'utf8'));
  fs.writeFileSync(configSyncOverride,"const require={main:null};const module={};\n"+code);
}
fs.cpSync(dashSource,dashDir,{recursive:true});
if(variant==='zh-CN') {
  fs.cpSync(path.join(root,'dashboard-zh-CN/public'),path.join(dashDir,'public'),{recursive:true});
  fs.copyFileSync(path.join(root,'dashboard-zh-CN/lib/cron.js'),path.join(dashDir,'lib/cron.js'));
  const scriptFile=path.join(scriptDir,'scripts/api/server.js'),dashFile=path.join(dashDir,'server.js');
  fs.writeFileSync(scriptFile,patchLoginScriptServer(patchScriptServer(fs.readFileSync(scriptFile,'utf8'),pathToFileURL(path.join(root,'docker/account-manager.mjs')).href),pathToFileURL(path.join(root,'docker/login-broker.mjs')).href));
  // Inject a local capture transport at the module boundary; no external notifications.
  const pushplusMock=path.join(workspace,'pushplus-fixture.cjs');
  fs.writeFileSync(pushplusMock,`const {PushPlus}=require(${JSON.stringify(path.join(root,'docker/pushplus.cjs'))});\nmodule.exports.PushPlus=class extends PushPlus {constructor(options){super({...options,fetchImpl:async(url,init)=>{require('node:fs').appendFileSync(${JSON.stringify(pushplusCapture)},JSON.stringify({url,...JSON.parse(init.body)})+'\\n');return Response.json({code:200,data:'fixture-accepted'});}});}};\n`);
  fs.writeFileSync(dashFile,patchPushPlusDashboard(patchLoginDashboardServer(patchDashboardServer(fs.readFileSync(dashFile,'utf8'))),pushplusMock,path.join(root,'docker/notification-details.cjs')));
  const authDir=path.join(scriptDir,'dist/browser/auth');fs.mkdirSync(path.join(authDir,'methods'),{recursive:true});
  for(const name of ['LoginUtils','GetACodeLogin','RecoveryEmailLogin','Totp2FALogin'])fs.writeFileSync(path.join(authDir,'methods',name+'.js'),patchLoginHelper(name,fs.readFileSync(path.join(scriptSource,'dist/browser/auth/methods',name+'.js'),'utf8'),path.join(root,'docker/login-client.cjs')));
  fs.writeFileSync(path.join(authDir,'Login.js'),patchLoginController(fs.readFileSync(path.join(scriptSource,'dist/browser/auth/Login.js'),'utf8'),path.join(root,'docker/login-client.cjs')));
}
fs.mkdirSync(path.join(scriptDir,'config'));
if(variant==='zh-CN') {
  for(const [file,patch] of [[path.join(scriptDir,'scripts/api/logParser.js'),patchControlParser],[path.join(dashDir,'lib/parser.js'),patchDashboardParser],[path.join(dashDir,'lib/store.js'),patchDashboardStore]])fs.writeFileSync(file,patch(fs.readFileSync(file,'utf8')));
}
const config=JSON.parse(fs.readFileSync(path.join(scriptDir,'config.example.json'),'utf8'));
config.webhook.telegram.botToken='private-webhook-test-value';
for(const name of ['config.json','config/config.json'])fs.writeFileSync(path.join(scriptDir,name),JSON.stringify(config));
fs.mkdirSync(path.join(scriptDir,'sessions'));
fs.writeFileSync(path.join(scriptDir,'sessions','preserve.marker'),'existing-session-fixture');
const dataDir=path.join(workspace,'data');fs.mkdirSync(dataDir);
const token=crypto.randomBytes(32).toString('hex'),password=crypto.randomBytes(24).toString('hex');
const testPassword='unique-fixture-password-do-not-display';
const results=[];const children=[];let output='';
async function test(name,fn) {await fn();results.push({name,status:'PASS'});console.log('PASS: '+name);}
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
const apiPort=await freePort(),dashPort=await freePort();
const api=`http://127.0.0.1:${apiPort}`,dash=`http://127.0.0.1:${dashPort}`;
const bearer={Authorization:`Bearer ${token}`},basic={Authorization:`Basic ${Buffer.from(`fixture:${password}`).toString('base64')}`};
const overlay=pathToFileURL(path.join(root,'docker/redact.mjs')).href;
const scriptEnv={...process.env,API_HOST:'127.0.0.1',API_PORT:String(apiPort),API_TOKEN:token,API_ALLOW_SCHEDULE_WRITE:'false',API_ALLOW_CONFIG_WRITE:'false',API_ALLOW_CONFIG_REVEAL:'false',API_ALLOW_ENV_OVERRIDES:'false',CRON_SCHEDULE:'',RUN_ON_START:'false',SCHEDULE_FILE:path.join(workspace,'no-schedule.json'),API_RUN_COMMAND:process.execPath,API_RUN_ARGS:JSON.stringify([path.join(root,'tests/fake-run.mjs')]),ACCOUNT_1_EMAIL:'fixture@example.invalid',ACCOUNT_1_PASSWORD:testPassword,TZ:'Asia/Jakarta',STACK_ROLE:'script',NODE_OPTIONS:`--import=${overlay} --disable-warning=ExperimentalWarning`};
if(configSyncOverride)scriptEnv.API_VALIDATOR_MODULE=configSyncOverride;
if(variant==='zh-CN')scriptEnv.STACK_ALLOW_ACCOUNT_CREATE='true';
// Clear inherited real account credentials before any fixture process is created.
for(const key of Object.keys(scriptEnv))if(/^ACCOUNT_\d+_/.test(key)&&!['ACCOUNT_1_EMAIL','ACCOUNT_1_PASSWORD'].includes(key))delete scriptEnv[key];
const dashEnv={...process.env,CONTROL_API_URL:api,CONTROL_API_TOKEN:token,DASHBOARD_USERNAME:'fixture',DASHBOARD_PASSWORD:password,DATA_DIR:dataDir,PORT:String(dashPort),TZ:'Asia/Jakarta',POLL_MS:'1000',STACK_ROLE:'dashboard',NODE_OPTIONS:`--import=${overlay} --disable-warning=ExperimentalWarning`};
function launch(file,cwd,env) {
  const child=spawn(process.execPath,[file],{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  child.on('error',e=>output+='child error '+e.message);children.push(child);return child;
}
async function stop(child){if(child.exitCode!==null)return;const ended=new Promise(r=>child.once('exit',r));child.kill();await Promise.race([ended,new Promise(r=>setTimeout(r,3000))]);if(child.exitCode===null)child.kill('SIGKILL');}
async function call(base,url,headers,method='GET',body) {
  const r=await fetch(base+url,{method,headers:{...headers,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
  const text=await r.text();let json;try{json=JSON.parse(text);}catch{}
  return {status:r.status,json,text};
}
async function until(fn){for(let i=0;i<100;i++){try{if(await fn())return;}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error('Timed out waiting for local fixture');}
let script,dashboard,browser;
try {
  await test('Compose YAML static safety invariants (not docker compose config)',async()=>{
    const c=yaml.parse(fs.readFileSync(path.join(root,'compose.yaml'),'utf8'));
    assert(!c.services.script.ports);assert.deepEqual(c.services.dashboard.ports,['127.0.0.1:8890:8890']);
    assert.equal(c.services.dashboard.environment.CONTROL_API_URL,'http://script:3010');
    assert.equal(c.services.script.environment.CRON_SCHEDULE,'');assert.equal(c.services.script.environment.RUN_ON_START,'false');
    assert.equal(c.services.script.environment.API_ALLOW_SCHEDULE_WRITE,'false');
    assert.equal(c.services.script.environment.API_ALLOW_ENV_OVERRIDES,'false');
    assert.equal(c.services.script.environment.API_ALLOW_CONFIG_REVEAL,'false');
    for(const name of ['script','dashboard']){assert.equal(c.services[name].restart,'unless-stopped');assert(c.services[name].healthcheck);assert(!c.services[name].privileged);assert(!JSON.stringify(c.services[name]).includes('docker.sock'));}
  });
  script=launch(path.join(scriptDir,'scripts/api/server.js'),scriptDir,scriptEnv);
  dashboard=launch(path.join(root,'docker/dashboard-start.mjs'),dashDir,dashEnv);
  await until(async()=>{const v=await call(dash,'/api/health',basic);return v.status===200&&v.json.controlApi&&v.json.controlApiAuthOk;});
  await test('API health and absent/invalid token rejection',async()=>{
    for(const h of [{},{Authorization:'Bearer invalid'}])assert.equal((await call(api,'/status',h)).status,401);
    const r=await call(api,'/health',bearer);assert.equal(r.status,200);assert(r.json.ok&&r.json.authRequired);
    assert.equal((await call(api,'/status',bearer)).json.state,'idle');
  });
  await test('Dashboard authentication, connection and seven view APIs',async()=>{
    assert.equal((await call(dash,'/',{})).status,401);
    assert.equal((await call(dash,'/api/health',{})).status,401);
    assert.equal((await call(dash,'/',basic)).status,200);
    for(const p of ['/api/summary','/api/accounts','/api/logs','/api/runs','/api/schedule','/api/config','/api/diagnostics']){const r=await call(dash,p,basic);assert.equal(r.status,200,p);assert(r.json,p);}
    const account=(await call(dash,'/api/accounts',basic)).text;assert(!account.includes(testPassword));
  });
  await test('Script schedule/config writes and env overrides blocked; config secrets redacted',async()=>{
    const s=(await call(api,'/schedule',bearer)).json;assert.equal(s.enabled,false);assert.equal(s.writable,false);
    for(const [url,method,body] of [['/schedule','PUT',{enabled:true,cron:'* * * * *'}],['/config','PATCH',{headless:true}],['/start','POST',{env:{TEST:'x'}}]])assert.equal((await call(api,url,bearer,method,body)).status,403,url);
    assert(!(await call(api,'/config',bearer)).text.includes(config.webhook.telegram.botToken));
    const reveal=await call(api,'/config?reveal=1',bearer);
    assert.equal(reveal.status,200);assert.equal(reveal.json.redacted,true);
    assert(!reveal.text.includes(config.webhook.telegram.botToken));
  });
  if(variant==='zh-CN')await test('PushPlus authenticated same-origin settings, saved-token test and persistent run notifications',async()=>{
    const endpoint='/api/notifications/pushplus',headers={...basic,'X-Rewards-Notification-Write':'1'};
    assert.equal((await call(dash,endpoint,{})).status,401);
    assert.equal((await call(dash,endpoint,basic,'POST',{token:pushplusFixtureToken})).status,403);
    assert.equal((await call(dash,endpoint,{...headers,Origin:'https://other.invalid'},'POST',{})).status,403);
    assert.equal((await call(dash,endpoint,{...headers,'Sec-Fetch-Site':'cross-site'},'POST',{})).status,403);
    assert.equal((await call(dash,endpoint,headers,'POST',{token:pushplusFixtureToken,enabled:true})).status,200);
    const safe=await call(dash,endpoint,basic);assert(safe.json.tokenConfigured);assert(!safe.text.includes(pushplusFixtureToken));
    assert.equal((await call(dash,endpoint+'/test',headers,'POST',{token:'untrusted'})).status,400);
    const checked=await call(dash,endpoint+'/test',headers,'POST',{});assert.equal(checked.status,200);assert(checked.json.accepted);
    assert.equal((await call(dash,endpoint+'/test',headers,'POST',{})).status,429);assert.equal(capturedPushes().length,1);
    for(const [arg,expected] of [['--success','完成'],['--partial','异常'],['--fail','异常']]){
      const prior=(await call(api,'/status',bearer)).json.lastExit?.at;
      assert.equal((await call(api,'/start',bearer,'POST',{accountIndex:1,args:[path.join(root,'tests/fake-notification-run.mjs'),arg]})).status,202);
      await until(async()=>{const s=(await call(api,'/status',bearer)).json;return s.state==='idle'&&s.lastExit?.at&&s.lastExit.at!==prior;});
      const total={'--success':2,'--partial':3,'--fail':4}[arg];
      await until(async()=>capturedPushes().length===total);
      const sent=capturedPushes().at(-1);assert(sent.title.includes(expected));assert(!sent.content.includes('fixture@'));
      if(arg==='--success'){assert(sent.content.includes('120 积分'));assert(sent.content.includes('1120 积分'));}
      if(arg==='--partial'){
        assert(sent.content.includes('42 积分'));assert(sent.content.includes('1042'));assert(sent.content.includes('手机搜索额度：未知'));assert(sent.content.includes('最后确认值'));
        const s=(await call(api,'/status',bearer)).json;assert.equal(s.run.accounts[0].collectedPoints,42);assert.equal(s.run.accounts[0].success,false);assert.equal(s.run.accounts[0].earnable.mobile,null);
        await until(async()=>(await call(dash,'/api/runs?limit=50',basic)).json.runs.some(r=>r.status==='partial'&&r.totalGained===42));
      }
      await new Promise(r=>setTimeout(r,1200));assert.equal(capturedPushes().length,total,'SSE/poll sent duplicate notifications');
    }
    await stop(dashboard);dashboard=launch(path.join(root,'docker/dashboard-start.mjs'),dashDir,dashEnv);
    await until(async()=>(await call(dash,'/api/health',basic)).json?.controlApi);
    await new Promise(r=>setTimeout(r,1200));assert.equal(capturedPushes().length,4,'restart replayed the previous result');
    assert((await call(dash,endpoint,basic)).json.enabled);
    assert.equal((await call(dash,endpoint,headers,'POST',{enabled:false,token:''})).status,200);
    assert(!output.includes(pushplusFixtureToken));
  });
  if(variant==='zh-CN')await test('Account creation authentication, CSRF, validation and immediate safe listing',async()=>{
    const payload={email:'managed@example.invalid',password:'managed-fixture-password-$#-unique',geoLocale:'auto',langCode:'zh-CN'};
    assert.equal((await call(api,'/accounts/managed',{},'POST',payload)).status,401);
    assert.equal((await call(dash,'/api/accounts',{},'POST',payload)).status,401);
    assert.equal((await call(dash,'/api/accounts',basic,'POST',payload)).status,403);
    const headers={...basic,'X-Rewards-Account-Write':'1'};
    assert.equal((await call(dash,'/api/accounts',{...headers,Origin:'https://untrusted.invalid'},'POST',payload)).status,403);
    assert.equal((await call(dash,'/api/accounts',headers,'POST',{email:'invalid'})).status,400);
    assert.equal((await call(dash,'/api/account-management',basic)).json.enabled,true);
    const added=await call(dash,'/api/accounts',headers,'POST',payload);assert.equal(added.status,200);assert.equal(added.json.account.index,2);assert(!added.text.includes(payload.password));
    const list=await call(dash,'/api/accounts',basic);assert(list.json.accounts.some(a=>a.email===payload.email&&a.index===2));assert(!list.text.includes(payload.password));
    assert.equal((await call(dash,'/api/accounts',headers,'POST',{...payload,email:'MANAGED@example.invalid'})).status,409);
    assert.equal((await call(api,'/status',bearer)).json.state,'idle');
    assert.equal(fs.readFileSync(path.join(scriptDir,'sessions/preserve.marker'),'utf8'),'existing-session-fixture');
  });
  if(variant==='zh-CN')await test('Web login input authentication, CSRF and child-only bridge rejection',async()=>{
    assert.equal((await call(dash,'/api/login-input',{})).status,401);
    assert.equal((await call(api,'/login-input',{})).status,401);
    assert.equal((await call(dash,'/api/login-input',basic,'POST',{id:'stale',value:'482617'})).status,403);
    const write={...basic,'X-Rewards-Login-Write':'1'};
    assert.equal((await call(dash,'/api/login-input',{...write,Origin:'https://untrusted.invalid'},'POST',{id:'stale',value:'482617'})).status,403);
    assert.equal((await call(dash,'/api/login-input',{...write,'Sec-Fetch-Site':'cross-site'},'POST',{id:'stale',value:'482617'})).status,403);
    assert.equal((await call(dash,'/api/login-input',write,'POST',{id:'stale',value:'482617'})).status,409);
    assert.equal((await call(api,'/login-input/bridge',bearer,'POST',{kind:'code',email:'fixture@example.invalid',platform:'mobile'})).status,403);
    assert.deepEqual((await call(dash,'/api/login-input',basic)).json.challenges,[]);
  });
  if(variant==='zh-CN')await test('Account deletion rejects unauthenticated and cross-origin writes without changing accounts',async()=>{
    const endpoint='/api/dashboard-accounts/managed%40example.invalid';
    assert.equal((await call(dash,endpoint,{},'DELETE')).status,401);
    assert.equal((await call(dash,endpoint,basic,'DELETE')).status,403);
    assert.equal((await call(dash,endpoint,{...basic,'X-Rewards-Account-Write':'1',Origin:'https://untrusted.invalid'},'DELETE')).status,403);
    assert.equal((await call(api,'/accounts/remove',{},'POST',{email:'managed@example.invalid'})).status,401);
    assert.equal((await call(api,'/accounts/remove',bearer,'POST',{email:'managed@example.invalid',extra:true})).status,400);
    assert.equal((await call(api,'/accounts',bearer)).json.count,2);
  });
  await test('Fixture task start/stop, busy conflict, and credential log redaction',async()=>{
    assert.equal((await call(dash,'/api/control/start',basic,'POST',{})).status,200);
    await until(async()=>(await call(api,'/status',bearer)).json.state==='running');
    assert.equal((await call(api,'/start',bearer,'POST',{})).status,409);
    if(variant==='zh-CN')assert.equal((await call(dash,'/api/accounts',{...basic,'X-Rewards-Account-Write':'1'},'POST',{email:'busy@example.invalid'})).status,409);
    if(variant==='zh-CN')assert.equal((await call(dash,'/api/dashboard-accounts/managed%40example.invalid',{...basic,'X-Rewards-Account-Write':'1'},'DELETE')).status,409);
    await until(async()=>(await call(api,'/logs',bearer)).text.includes('Needs manual verification'));
    for(const text of [(await call(api,'/logs',bearer)).text,(await call(dash,'/api/logs',basic)).text,output]){
      for(const secret of [token,password,testPassword,'unknown-fixture-secret','fixture-cookie','second-cookie-secret'])assert(!text.includes(secret),'secret appeared in log');
    }
    assert.equal((await call(dash,'/api/control/stop',basic,'POST',{})).status,200);
    await until(async()=>(await call(api,'/status',bearer)).json.state==='idle');
  });
  await test('Fixture abnormal exit recorded in API and Dashboard',async()=>{
    assert.equal((await call(api,'/start',bearer,'POST',{args:[path.join(root,'tests/fake-run.mjs'),'--exit']})).status,202);
    await until(async()=>(await call(api,'/status',bearer)).json.lastExit?.code===2);
    await until(async()=>(await call(dash,'/api/runs',basic)).json.exits.some(x=>x.exit?.code===2));
  });
  if(variant==='zh-CN')await test('New account single-run selection, exclusions and dynamic password redaction',async()=>{
    const probe=[path.join(root,'tests/fake-run.mjs'),'--account-probe'];
    for(const selection of [{accountIndex:2},{excludedAccountIndexes:[1]}]){
      assert.equal((await call(api,'/start',bearer,'POST',{...selection,args:probe})).status,202);
      await until(async()=>(await call(api,'/status',bearer)).json.lastExit?.code===0);
      const logs=(await call(api,'/logs',bearer)).text;
      assert(logs.includes('managed@example.invalid'));assert(logs.includes('ACCOUNT-PROBE'));assert(!logs.includes('managed-fixture-password-$#-unique'));
      const entries=(await call(api,'/logs',bearer)).json.logs.filter(e=>(e.raw||e.message||'').includes('ACCOUNT-PROBE'));
      assert(entries.length);assert(!JSON.stringify(entries).includes('fixture@example.invalid'),'original account leaked into selected child environment');
    }
    assert(!output.includes('managed-fixture-password-$#-unique'));
    assert.equal((await call(api,'/accounts',bearer)).json.count,2,'selection changed parent account registry');
  });
  await test('Daily schedule validation, next run and persistence after process restart',async()=>{
    assert.equal((await call(dash,'/api/schedule',basic,'PUT',{cron:'invalid'})).status,400);
    const save=await call(dash,'/api/schedule',basic,'PUT',{target:'local',cron:'0 9 * * *',enabled:true,skipIfRunning:true,misfirePolicy:'skip'});
    assert.equal(save.status,200);assert(save.json.local.nextRunAt);
    assert.equal(new Date(save.json.local.nextRunAt).getUTCHours(),2);
    assert.equal((await call(api,'/schedule',bearer)).json.enabled,false);
    await stop(dashboard);await stop(script);
    script=launch(path.join(scriptDir,'scripts/api/server.js'),scriptDir,scriptEnv);
    dashboard=launch(path.join(root,'docker/dashboard-start.mjs'),dashDir,dashEnv);
    await until(async()=>(await call(dash,'/api/health',basic)).json?.controlApi);
    const restored=(await call(dash,'/api/schedule',basic)).json.local;
    assert.equal(restored.cron,'0 9 * * *');assert.equal(restored.enabled,true);assert(restored.nextRunAt);
    assert.equal(fs.readFileSync(path.join(scriptDir,'sessions/preserve.marker'),'utf8'),'existing-session-fixture');
    assert((await call(dash,'/api/runs',basic)).json.runs.length>0,'Dashboard run history did not persist');
    if(variant==='zh-CN')assert((await call(dash,'/api/accounts',basic)).json.accounts.some(a=>a.email==='managed@example.invalid'&&a.index===2),'GUI-added account did not survive API restart');
    await call(dash,'/api/schedule',basic,'PUT',{enabled:false});
  });
  await test('Scheduler busy skip, API 409 race and missed-run skip policy (mock client)',async()=>{
    const {Scheduler}=req(path.join(dashDir,'lib/scheduler.js'));let saved=null,calls=0;
    const store={getSchedule:()=>saved,setSchedule:s=>saved=structuredClone(s)};
    const s=new Scheduler({store,client:{post:async()=>{calls++;}},isBusy:()=>true});s.init();
    await s._fire();assert.equal(calls,0);assert(s.lastResult.includes('skipped'));s.stop();
    const race=new Scheduler({store,client:{post:async()=>{throw Object.assign(new Error('busy'),{statusCode:409});}}});race.init();await race._fire();assert(race.lastResult.includes('skipped'));race.stop();
    saved={enabled:true,cron:'0 9 * * *',nextRunAt:new Date(Date.now()-3600000).toISOString(),misfirePolicy:'skip'};
    const missed=new Scheduler({store,client:{post:async()=>{calls++;}}});missed.init();assert(missed.lastResult.includes('missed run skipped'));assert.equal(calls,0);missed.stop();
  });
  await test('SQLite online snapshots preserve live WAL rows and sessions DB',async()=>{
    const sessionDb=new DatabaseSync(path.join(scriptDir,'sessions/sessions.db'));
    sessionDb.exec("PRAGMA journal_mode=WAL; CREATE TABLE fixture(value TEXT); INSERT INTO fixture VALUES ('session-preserved'); CREATE TABLE sessions(email TEXT, platform TEXT, storage_state TEXT, fingerprint TEXT, updated_at INTEGER, PRIMARY KEY(email,platform)); CREATE TABLE account_metadata(email TEXT PRIMARY KEY, resolved_region TEXT, updated_at INTEGER);");
    sessionDb.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run('fixture@example.invalid','desktop','{"cookies":[],"origins":[]}',null,Date.now());
    const dest=path.join(workspace,'snapshot');
    snapshotTree(dataDir,path.join(dest,'data'));
    snapshotTree(path.join(scriptDir,'sessions'),path.join(dest,'sessions'));
    for(const file of ['data/dashboard.sqlite','sessions/sessions.db']){const d=new DatabaseSync(path.join(dest,file),{readOnly:true});assert.equal(Object.values(d.prepare('PRAGMA quick_check').get())[0],'ok');if(file.startsWith('sessions'))assert.equal(d.prepare('SELECT value FROM fixture').get().value,'session-preserved');else assert(d.prepare('SELECT count(*) AS n FROM runs').get().n>0);d.close();}
    assert(!fs.existsSync(path.join(dest,'sessions/sessions.db-wal')));sessionDb.close();
  });
  if(variant==='zh-CN')await test('Historical push validates identity, source and finished status without sending rejected requests',async()=>{
    const endpoint='/api/notifications/pushplus/send-run',headers={...basic,'X-Rewards-Notification-Write':'1'},prior=capturedPushes().length;
    assert.equal((await call(dash,endpoint,{},'POST',{runId:'x'})).status,401);
    assert.equal((await call(dash,endpoint,basic,'POST',{runId:'x'})).status,403);
    assert.equal((await call(dash,endpoint,{...headers,Origin:'https://untrusted.invalid'},'POST',{runId:'x'})).status,403);
    for(const body of [null,[],{}, {runId:1},{runId:'x',content:'spoofed'},{runId:'x',token:pushplusFixtureToken},{runId:'x\n'},{runId:'x'.repeat(257)}])assert.equal((await call(dash,endpoint,headers,'POST',body)).status,400);
    for(const runId of ['missing-record',"' OR 1=1 --"])assert.equal((await call(dash,endpoint,headers,'POST',{runId})).status,404);
    const db=new DatabaseSync(path.join(dataDir,'dashboard.sqlite'));
    db.prepare("INSERT INTO runs (id,status,start_ts,total_gained) VALUES (?, 'running', ?, 0)").run('manual-running-fixture',new Date().toISOString());db.close();
    assert.equal((await call(dash,endpoint,headers,'POST',{runId:'manual-running-fixture'})).status,409);
    assert.equal(capturedPushes().length,prior);
  });
  await test('Browser desktop/mobile seven tabs without JavaScript errors',async()=>{
    const {chromium}=req('@playwright/test');
    const installed=process.env.BROWSER_EXECUTABLE||(process.platform==='win32'?'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe':undefined);
    browser=await chromium.launch({headless:true,...(installed?{executablePath:installed}:{})});
    const context=await browser.newContext({httpCredentials:{username:'fixture',password},viewport:{width:1440,height:1000}});
    const page=await context.newPage();const errors=[],httpErrors=[];page.on('pageerror',e=>errors.push(e.message));
    page.on('response',r=>{if(r.url().includes('/api/')&&r.status()>=400)httpErrors.push(`${new URL(r.url()).pathname}: ${r.status()}`);});
    await page.goto(dash,{waitUntil:'networkidle'});
    await page.screenshot({path:path.join(root,`reports/dashboard-${variant}-desktop.png`),fullPage:true});
    const views=variant==='zh-CN'?['概览','账号','日志','运行记录','运行计划','配置','诊断']:['Overview','Accounts','Logs','Runs','Schedule','Config','Diagnostics'];
    for(const view of views){
      const button=page.getByRole('button',{name:view,exact:true});
      if(await button.count())await button.click();else await page.getByText(view,{exact:true}).first().click();
      await page.waitForTimeout(150);
      if(variant==='zh-CN')await page.screenshot({path:path.join(root,`reports/zh-CN-${view}.png`),fullPage:true});
    }
    assert.deepEqual(httpErrors,[]);
    if(variant==='zh-CN') {
      assert.equal(await page.locator('html').getAttribute('lang'),'zh-CN');
      await page.getByRole('tab',{name:'账号',exact:true}).click();
      await page.getByRole('button',{name:'添加账号',exact:true}).click();
      await page.locator('#accountCreateEmail').fill('ui-added@example.invalid');
      await page.locator('#accountCreatePassword').fill('ui-fixture-secret-$#');
      await page.screenshot({path:path.join(root,'reports/account-create-desktop.png'),fullPage:true});
      await page.getByRole('button',{name:'保存账号',exact:true}).click();
      await until(async()=>(await call(dash,'/api/accounts',basic)).json.accounts.some(a=>a.email==='ui-added@example.invalid'));
      assert.equal(await page.locator('#accountCreatePassword').inputValue(),'');
      assert.equal(await page.locator('dialog.account-create-dialog').isVisible(),false);
      await page.getByRole('button',{name:'添加账号',exact:true}).click();
      await page.setViewportSize({width:390,height:844});
      await page.screenshot({path:path.join(root,'reports/account-create-mobile.png'),fullPage:true});
      assert(await page.locator('#accountCreateSave').isVisible());
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
      await page.getByRole('button',{name:'取消',exact:true}).click();
      await page.setViewportSize({width:1440,height:1000});
      // Exercise the real patched input helper through the authenticated browser.
      const startLogin=()=>call(api,'/start',bearer,'POST',{accountIndex:2,args:[path.join(root,'tests/fake-login-run.mjs')]});
      assert.equal((await startLogin()).status,202);
      await page.locator('dialog.web-login-dialog[open]').waitFor();
      assert((await page.locator('[data-login-account]').textContent()).includes('managed@example.invalid'));
      await page.locator('#webLoginValue').fill('recovery@example.invalid');
      await page.getByRole('button',{name:'提交验证',exact:true}).click();
      await until(async()=>await page.locator('[data-login-label]').textContent()==='邮箱收到的 6 位验证码');
      await page.locator('dialog.web-login-dialog[open]').waitFor();
      assert.equal(await page.locator('#webLoginValue').inputValue(),'');
      const challenge=(await call(dash,'/api/login-input',basic)).json.challenges[0];
      assert.equal((await call(dash,'/api/login-input',{...basic,'X-Rewards-Login-Write':'1'},'POST',{id:challenge.id,value:'invalid'})).status,400);
      await page.screenshot({path:path.join(root,'reports/login-input-desktop.png'),fullPage:true});
      await page.setViewportSize({width:390,height:844});
      await page.screenshot({path:path.join(root,'reports/login-input-mobile.png'),fullPage:true});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
      await page.getByRole('button',{name:'稍后填写',exact:true}).click();
      await page.getByRole('button',{name:'填写验证信息',exact:true}).click();
      await page.locator('#webLoginValue').fill('482617');
      await page.getByRole('button',{name:'提交验证',exact:true}).click();
      await until(async()=>(await call(api,'/status',bearer)).json.state==='idle');
      assert.equal((await call(api,'/status',bearer)).json.lastExit.code,0);
      assert.equal((await call(dash,'/api/login-input',{...basic,'X-Rewards-Login-Write':'1'},'POST',{id:challenge.id,value:'482617'})).status,409);
      assert(!output.includes('482617'));
      assert(!(await call(dash,'/api/logs',basic)).text.includes('482617'));
      assert.equal(await page.locator('#webLoginValue').inputValue(),'');
      // Cancellation and process stop must release pending prompts.
      assert.equal((await startLogin()).status,202);
      await page.locator('dialog.web-login-dialog[open]').waitFor();
      await page.getByRole('button',{name:'取消本次验证',exact:true}).click();
      await until(async()=>(await call(api,'/status',bearer)).json.state==='idle');
      assert.equal((await call(api,'/status',bearer)).json.lastExit.code,3);
      assert.equal((await startLogin()).status,202);
      await until(async()=>(await call(dash,'/api/login-input',basic)).json.challenges.length===1);
      await call(api,'/stop',bearer,'POST',{});
      await until(async()=>(await call(api,'/status',bearer)).json.state==='idle');
      assert.deepEqual((await call(dash,'/api/login-input',basic)).json.challenges,[]);
      await until(async()=>!await page.locator('dialog.web-login-dialog').isVisible());
      await page.setViewportSize({width:1440,height:1000});
      assert(await page.getByRole('button',{name:'开始运行',exact:true}).isVisible());
      // Delete through the actual two-click UI, verify disappearance, then add the same email.
      await page.getByRole('tab',{name:'账号',exact:true}).click();
      const deletedKey='ui-added@example.invalid';
      await page.locator('button[data-arm-delete="'+deletedKey+'"]').click();
      const deleteResponse=page.waitForResponse(r=>r.request().method()==='DELETE'&&r.url().includes('/api/dashboard-accounts/'));
      await page.locator('button[data-confirm-delete="'+deletedKey+'"]').click();
      const deleteResult=await deleteResponse;assert.equal(deleteResult.status(),200,await deleteResult.text());
      await until(async()=>!(await call(api,'/accounts',bearer)).json.accounts.some(a=>a.email===deletedKey));
      await until(async()=>!(await call(dash,'/api/accounts',basic)).json.accounts.some(a=>a.email===deletedKey));
      await page.getByRole('button',{name:'添加账号',exact:true}).click();
      await page.locator('#accountCreateEmail').fill(deletedKey);
      await page.locator('#accountCreatePassword').fill('replacement-ui-secret');
      await page.getByRole('button',{name:'保存账号',exact:true}).click();
      await until(async()=>(await call(api,'/accounts',bearer)).json.accounts.some(a=>a.email===deletedKey));
      assert.equal(fs.readFileSync(path.join(scriptDir,'sessions/preserve.marker'),'utf8'),'existing-session-fixture');
      await stop(script);script=launch(path.join(scriptDir,'scripts/api/server.js'),scriptDir,scriptEnv);
      await until(async()=>(await call(api,'/accounts',bearer)).json.accounts?.length===3);
      assert.equal((await call(api,'/accounts',bearer)).json.accounts.filter(a=>a.email===deletedKey).length,1);
      assert(await page.getByText('桌面端',{exact:false}).count()>0);
      await page.getByRole('tab',{name:'运行计划',exact:true}).click();
      assert.equal(await page.locator('#schedMisfire').inputValue(),'skip');
      assert.equal(await page.locator('#schedCron').inputValue(),'0 9 * * *');
      await page.locator('#schedCron').fill('0 9 * * *');
      await until(async()=>await page.locator('#schedDesc').textContent()==='每天 09:00');
      await page.getByRole('tab',{name:'配置',exact:true}).click();
      const raw=JSON.parse(await page.locator('#cfgEditor').inputValue());
      assert.equal(raw.headless,false);assert(Object.hasOwn(raw.workers,'doMobileSearch'));
      // Use the notification form with the captured transport, never the real provider.
      await page.locator('#pushplusToken').waitFor();
      await until(async()=>!await page.locator('#pushplusToken').isDisabled());
      const notifications=page.locator('section').filter({has:page.getByRole('heading',{name:'PushPlus 微信推送',exact:true})});
      assert.equal(await page.locator('#pushplusToken').inputValue(),'');
      await page.locator('#pushplusToken').fill(pushplusFixtureToken);
      assert(await notifications.getByRole('button',{name:'发送测试通知',exact:true}).isDisabled(),'unsaved settings must be saved before test');
      await notifications.getByRole('button',{name:'保存通知设置',exact:true}).click();
      await until(async()=>(await notifications.locator('[data-pushplus-message]').textContent()).includes('已保存'));
      assert.equal(await page.locator('#pushplusToken').inputValue(),'');
      const beforePushes=capturedPushes().length;
      await notifications.getByRole('button',{name:'发送测试通知',exact:true}).click();
      await until(async()=>(await notifications.locator('[data-pushplus-message]').textContent()).includes('已受理'));
      assert.equal(capturedPushes().length,beforePushes+1);
      assert(!await page.evaluate(value=>JSON.stringify({...localStorage}).includes(value),pushplusFixtureToken));
      assert(!(await page.locator('#cfgEditor').inputValue()).includes(pushplusFixtureToken));
      await until(async()=>await page.locator('.toast').count()===0);
      await notifications.screenshot({path:path.join(root,'reports/pushplus-desktop.png')});
      await page.setViewportSize({width:390,height:844});
      await notifications.screenshot({path:path.join(root,'reports/pushplus-mobile.png')});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
      await page.setViewportSize({width:1440,height:1000});
      assert(!output.includes(pushplusFixtureToken));
      // Configure three recipients with the actual panel controls; all deliveries are captured locally.
      await notifications.locator('[name="deliveryMode"]').selectOption('accounts');
      const routeFor=email=>notifications.locator('fieldset').filter({has:page.locator('legend').filter({hasText:email})});
      await routeFor('fixture@example.invalid').locator('select').selectOption('self');
      for(const [email,value]of [['managed@example.invalid','c'.repeat(32)],['ui-added@example.invalid','d'.repeat(32)]]){
        await routeFor(email).locator('select').selectOption('friend');await routeFor(email).locator('input[type="password"]').fill(value);
      }
      await notifications.getByRole('button',{name:'保存通知设置',exact:true}).click();
      await until(async()=>(await call(dash,'/api/notifications/pushplus',basic)).json.deliveryMode==='accounts');
      for(const email of ['managed@example.invalid','ui-added@example.invalid']){
        const before=capturedPushes().length;await routeFor(email).getByRole('button',{name:'测试此接收人',exact:true}).click();
        await until(async()=>capturedPushes().length===before+1);
        await until(async()=>(await routeFor(email).innerText()).includes('已受理'));
      }
      assert.equal(capturedPushes().at(-2).to,'c'.repeat(32));assert.equal(capturedPushes().at(-1).to,'d'.repeat(32));
      assert.equal(await routeFor('managed@example.invalid').locator('input[type="password"]').inputValue(),'');
      await notifications.screenshot({path:path.join(root,'reports/pushplus-routing-desktop.png')});
      await page.setViewportSize({width:390,height:844});await notifications.screenshot({path:path.join(root,'reports/pushplus-routing-mobile.png')});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await page.setViewportSize({width:1440,height:1000});
      await notifications.locator('[name="deliveryMode"]').selectOption('summary');await notifications.getByRole('button',{name:'保存通知设置',exact:true}).click();await until(async()=>(await call(dash,'/api/notifications/pushplus',basic)).json.deliveryMode==='summary');
      // Click only the isolated fake runner, never the user's real service.
      await page.getByRole('button',{name:'开始运行',exact:true}).click();
      await until(async()=>(await call(api,'/status',bearer)).json.state==='running');
      await page.getByRole('button',{name:'停止',exact:true}).click();
      await until(async()=>(await call(api,'/status',bearer)).json.state==='idle');
      await page.getByRole('tab',{name:'日志',exact:true}).click();
      await until(async()=>(await page.locator('#logBox').innerText()).includes('Needs manual verification'));
      assert(!((await page.locator('#logBox').innerText()).includes(testPassword)));
      assert(await page.locator('.log-level--error').count()>0);
      // Send a persisted history row through the real browser button.
      await page.getByRole('tab',{name:'运行记录',exact:true}).click();
      await until(async()=>await page.locator('button[data-send-run]').count()>0);
      const history=(await call(dash,'/api/runs?limit=100',basic)).json.runs;
      const selected=history.find(r=>r.status==='done'&&r.totalGained===120&&r.endTs);
      assert(selected,'completed persisted run fixture is available');
      const detailResponse=await call(dash,'/api/notifications/pushplus/run-details?runId='+encodeURIComponent(selected.id),basic);assert.equal(detailResponse.status,200);assert(detailResponse.json.accounts.some(a=>a.email==='fixture@example.invalid'&&a.collectedPoints===120&&a.initialPoints===1000&&a.finalPoints===1120));assert(!detailResponse.text.includes(testPassword));
      await page.locator('[data-view-run='+JSON.stringify(selected.id)+']').click();
      await until(async()=>(await page.locator('dialog[data-notification-details]').innerText()).includes('1120'));
      assert((await page.locator('dialog[data-notification-details]').innerText()).includes('120 积分'));
      await page.locator('dialog[data-notification-details]').screenshot({path:path.join(root,'reports/pushplus-details-desktop.png')});
      await page.setViewportSize({width:390,height:844});
      await page.locator('dialog[data-notification-details]').screenshot({path:path.join(root,'reports/pushplus-details-mobile.png')});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
      await page.getByRole('button',{name:'关闭明细',exact:true}).click();await page.setViewportSize({width:1440,height:1000});
      const beforeManual=capturedPushes().length;
      const runButton=page.locator('[data-send-run='+JSON.stringify(selected.id)+']');
      await runButton.click();
      await until(async()=>capturedPushes().length===beforeManual+1);
      await until(async()=>(await runButton.locator('..').innerText()).includes('已受理'));
      const manual=capturedPushes().at(-1);assert(manual.title.includes('运行记录'));assert(manual.content.includes('120 积分'));assert(manual.content.includes('1120 积分'));assert(manual.content.includes(new Date(selected.endTs).toISOString()));
      assert(!manual.content.includes(testPassword));assert(await runButton.isDisabled());
      assert(await page.locator('[data-send-run="manual-running-fixture"]').isDisabled());
      await until(async()=>await page.locator('.toast').count()===0);
      await page.locator('section[aria-labelledby="runs-table-heading"]').screenshot({path:path.join(root,'reports/pushplus-manual-desktop.png')});
      await page.setViewportSize({width:390,height:844});
      await page.locator('section[aria-labelledby="runs-table-heading"] .table-wrap').evaluate(el=>{el.scrollLeft=el.scrollWidth;});
      await page.locator('section[aria-labelledby="runs-table-heading"]').screenshot({path:path.join(root,'reports/pushplus-manual-mobile.png')});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
      assert.equal((await call(api,'/status',bearer)).json.state,'idle','manual push started a task');
      assert.equal((await call(dash,'/api/notifications/pushplus/send-run',{...basic,'X-Rewards-Notification-Write':'1'},'POST',{runId:selected.id})).status,429);
    }
    await page.getByText(variant==='zh-CN'?'概览':'Overview',{exact:true}).first().click();
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(root,`reports/dashboard-${variant}-mobile.png`),fullPage:true});
    assert.deepEqual(errors,[]);await browser.close();browser=null;
  });
  if(variant==='zh-CN')await test('Manual-send cooldown and saved history survive Dashboard restart',async()=>{
    const before=capturedPushes().length,rows=(await call(dash,'/api/runs?limit=100',basic)).json.runs;
    await stop(dashboard);dashboard=launch(path.join(root,'docker/dashboard-start.mjs'),dashDir,dashEnv);
    await until(async()=>(await call(dash,'/api/health',basic)).json?.controlApi);
    const selected=rows.find(r=>r.status==='done'&&r.totalGained===120&&r.endTs);
    assert.equal((await call(dash,'/api/notifications/pushplus/send-run',{...basic,'X-Rewards-Notification-Write':'1'},'POST',{runId:selected.id})).status,429);
    assert.equal(capturedPushes().length,before);assert((await call(dash,'/api/runs?limit=100',basic)).json.runs.some(r=>r.id===selected.id));
    assert.equal((await call(dash,'/api/notifications/pushplus',basic)).json.lastResult.kind,'manual');
  });
  if(variant==='zh-CN')await test('Saved friend bindings, independent tests and read-only account details survive restart',async()=>{
    const endpoint='/api/notifications/pushplus',headers={...basic,'X-Rewards-Notification-Write':'1'},friend='a'.repeat(32);
    const config=(await call(dash,endpoint,basic)).json;
    assert.equal(config.deliveryMode,'summary');
    const saved=await call(dash,endpoint,headers,'POST',{routes:[{email:'fixture@example.invalid',target:'self'},{email:'managed@example.invalid',target:'friend',friendToken:friend}],deliveryMode:'accounts'});
    assert.equal(saved.status,200);assert(!saved.text.includes(friend));assert(saved.json.routes[1].friendTokenConfigured);
    const before=capturedPushes().length;
    assert.equal((await call(dash,endpoint+'/test',headers,'POST',{email:'managed@example.invalid'})).status,200);
    assert.equal(capturedPushes().at(-1).to,friend);assert(!capturedPushes().at(-1).content.includes('fixture@'));
    assert.equal((await call(dash,endpoint+'/test',headers,'POST',{email:'managed@example.invalid'})).status,429);
    assert.equal((await call(dash,endpoint+'/test',headers,'POST',{email:''})).status,400);
    assert.equal((await call(dash,endpoint+'/test',headers,'POST',{email:'unbound@example.invalid'})).status,400);
    assert.equal(capturedPushes().length,before+1);
    await stop(dashboard);dashboard=launch(path.join(root,'docker/dashboard-start.mjs'),dashDir,dashEnv);await until(async()=>(await call(dash,'/api/health',basic)).json?.controlApi);
    const restored=(await call(dash,endpoint,basic)).json;assert.equal(restored.deliveryMode,'accounts');assert(restored.routes[1].friendTokenConfigured);assert(!JSON.stringify(restored).includes(friend));
    const selected=(await call(dash,'/api/runs?limit=100',basic)).json.runs.find(r=>r.status==='done'&&r.totalGained===120&&r.endTs);
    const details=await call(dash,endpoint+'/run-details?runId='+encodeURIComponent(selected.id),basic);assert.equal(details.status,200);assert(details.json.accounts.some(a=>a.finalPoints===1120));
    assert.equal((await call(dash,endpoint+'/run-details?runId='+encodeURIComponent(selected.id),{})).status,401);
    assert.equal((await call(dash,endpoint+'/run-details?runId=missing',basic)).status,404);
    assert.equal((await call(dash,endpoint,headers,'POST',{deliveryMode:'summary',routes:[]})).status,200);
    assert(!output.includes(friend));
  });
} catch(e){results.push({name:'Failure',status:'FAIL',detail:e.stack||e.message});console.error('FAIL: '+(e.stack||e.message));process.exitCode=1;}
finally {
  if(browser)await browser.close();
  try{if(script?.exitCode===null)await call(api,'/stop',bearer,'POST',{});}catch{}
  for(const child of children.reverse())await stop(child);
  fs.mkdirSync(path.join(root,'reports'),{recursive:true});
  fs.writeFileSync(path.join(root,`reports/local-tests-${variant}.json`),JSON.stringify({checkedAt:new Date().toISOString(),variant,node:process.version,scope:'Local HTTP/process fixtures only; no Docker, no Microsoft login, no Rewards actions',results},null,2)+'\n');
}
