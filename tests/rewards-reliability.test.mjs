import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {patchRewardsFile,patchControlParser,patchDashboardParser,patchDashboardStore} from '../docker/install-rewards-reliability.mjs';
const require=createRequire(import.meta.url),runtime=path.resolve('docker/rewards-reliability.cjs');
const R=require(runtime),read=name=>fs.readFileSync('.test-work/image/script/dist/'+name,'utf8');
const evaluate=(s,req=require,extras={})=>{const module={exports:{}};vm.runInNewContext(s,{module,exports:module.exports,require:req,console,URL,setTimeout,clearTimeout,Date,Map,...extras});return module.exports;};
test('Missing, empty and malformed quotas stay unknown; explicit zero and earned quotas are known',()=>{
  for(const value of [null,undefined,[],[{}],[{pointProgress:0,pointProgressMax:null}]])assert.equal(R.quota(value).known,false);
  assert.deepEqual(R.quota([{pointProgress:0,pointProgressMax:0}]),{earned:0,max:0,remaining:0,known:true});
  assert.deepEqual(R.quota([{pointProgress:6,pointProgressMax:60}]),{earned:6,max:60,remaining:54,known:true});
});
test('Read retries recover truncated bodies and missing data, are bounded, respect permanent errors and cooldowns',async()=>{
  let calls=0,delays=[];
  assert.equal(await R.readWithRetry(async()=>{if(++calls<3)throw Error('UnexpectedEof');return 42;},{wait:async ms=>delays.push(ms)}),42);
  assert.deepEqual(delays,[1000,2000]);
  for(const [status,expected]of [[401,1],[403,1],[429,1],[503,3],[undefined,3]]){
    let n=0;await assert.rejects(R.readWithRetry(async()=>{n++;throw Object.assign(Error('failed'),{status});},{wait:async()=>{}}));assert.equal(n,expected);
  }
  let n=0;delays=[];await R.readWithRetry(async()=>{if(++n===1)throw Object.assign(Error('limited'),{status:429,response:{headers:{'retry-after':'4'}}});return true;},{wait:async ms=>delays.push(ms)});assert.deepEqual(delays,[4000]);
});
const flyout=(mobile)=>({userInfo:{isRewardsUser:true,balance:100,profile:{attributes:{}}},flyoutResult:{userStatus:{isRewardsUser:true,availablePoints:100,counters:{PCSearch:[{pointProgress:0,pointProgressMax:60}],...(mobile===undefined?{}:{MobileSearch:mobile})}}}});
function browserFixture(request){
  const lines=[],bot={http:{request},fingerprint:{headers:{}},isMobile:true,currentAccountEmail:'one@example.invalid',userData:{userName:'one'},logger:{warn:(...a)=>lines.push(a),error:(...a)=>lines.push(a)}};
  class Browser{constructor(){this.bot=bot;}getCachedCookies(){return [];}buildCookieHeader(){return '';}async applyResponseCookies(){}async getBrowserEarnablePoints(){return {mobileSearchPoints:0,totalEarnablePoints:60};}}
  const primary='https://rewards.bing.com/api/getuserinfo',fallback='https://www.bing.com/rewards/panelflyout/getuserinfo';
  R.installBrowser(Browser,{URLs:{rewards:{userInfoApi:primary,referer:'https://rewards.bing.com/'},bing:{rewardsFlyoutUserInfo:fallback,origin:'https://www.bing.com'}},mapFlyoutToDashboard:raw=>{if(!raw.userInfo)throw Error('Missing Rewards account data');return {dashboard:{userStatus:{availablePoints:raw.userInfo.balance,counters:{mobileSearch:raw.flyoutResult.userStatus.counters.MobileSearch??[]}}}};},detectFlyoutBotWarning:()=>({likelyLimited:false,hasBotProfileMarkers:false,hasCollapsedActivities:false})},{wait:async()=>{}});
  return {browser:new Browser(),bot,lines,primary,fallback};
}
test('A partial flyout does not manufacture mobile entitlement; fallback retries response validation',async()=>{
  let pcalls=0,fcalls=0;
  const f=browserFixture(async({url,retries,method})=>{assert.equal(retries,0);assert.equal(method,'GET');if(url.includes('api/getuserinfo')){pcalls++;return {data:{},headers:{}};}fcalls++;return {data:fcalls<3?{}:flyout(),headers:{}};});
  const d=await f.browser.getDashboardData();assert.equal(pcalls,3);assert.equal(fcalls,3);assert.equal(d.dashboard.userStatus.counters.mobileSearch,undefined);assert.equal((await f.browser.getBrowserEarnablePoints(d)).mobileSearchPoints,null);
  assert(f.lines.some(a=>a.at(-1).includes('mobileQuota=unknown')));
});
test('Fallback preference is isolated per account/platform and retries primary after fallback failure',async()=>{
  const counts={};let flyFail=false;
  const f=browserFixture(async({url})=>{const key=f.bot.currentAccountEmail+':'+f.bot.isMobile;counts[key]=(counts[key]||0)+1;if(url===f.primary){if(flyFail)return {headers:{},data:{dashboard:{userStatus:{availablePoints:102,counters:{mobileSearch:[{pointProgress:0,pointProgressMax:60}]}}}}};return {data:{},headers:{}};}if(flyFail)throw Error('UnexpectedEof');return {data:flyout(),headers:{}};});
  await f.browser.getDashboardData();assert.equal(counts['one@example.invalid:true'],4);
  await f.browser.getDashboardData();assert.equal(counts['one@example.invalid:true'],5);
  f.bot.currentAccountEmail='two@example.invalid';await f.browser.getDashboardData();assert.equal(counts['two@example.invalid:true'],4);
  f.bot.isMobile=false;await f.browser.getDashboardData();assert.equal(counts['two@example.invalid:false'],4);
  flyFail=true;const data=await f.browser.getDashboardData();assert.equal(data.dashboard.userStatus.availablePoints,102);assert.equal(f.bot.__rewardsIncomplete,undefined);
});
test('Search plan skips unknown mobile quota with an explicit reason, but runs a known mobile quota',async()=>{
  const progress=evaluate(patchRewardsFile('functions/activities/search/SearchProgress.js',read('functions/activities/search/SearchProgress.js'),runtime));
  const {SearchManager}=evaluate(patchRewardsFile('functions/activities/search/SearchManager.js',read('functions/activities/search/SearchManager.js'),runtime),name=>name==='./SearchProgress'?progress:{});
  const lines=[],counters={pcSearch:[{pointProgress:0,pointProgressMax:60}]};
  const bot={browser:{func:{getDashboardData:async()=>({dashboard:{userStatus:{counters}}})}},config:{workers:{doMobileSearch:true,doDesktopSearch:true}},logger:{info:(...a)=>lines.push(a)}};
  const m=new SearchManager(bot);assert.equal((await m.getSearchPoints()).doMobile,false);assert(lines.some(a=>a.at(-1).includes('unknown quota')));
  counters.mobileSearch=[{pointProgress:0,pointProgressMax:60}];assert.equal((await m.getSearchPoints()).doMobile,true);
});
test('Actual pinned runTasks retains failed account gains and resets them before the next account',async()=>{
  let source=patchRewardsFile('index.js',read('index.js'),runtime);source=source.slice(0,source.lastIndexOf('\nmain().catch'));
  const stub=class {};
  const {MicrosoftRewardsBot}=evaluate(source,name=>{
    if(name===runtime)return R;
    if(name==='node:async_hooks')return require(name);
    if(name==='cluster')return {__esModule:true,default:{isPrimary:false}};
    if(name==='./util/Locale')return {resolveAccountLocale:()=>({language:'en',country:'US',locale:'en-US'})};
    return {__esModule:true,default:stub};
  });
  const logs=[],bot={config:{clusters:2},userData:{},utils:{getEmailUsername:x=>x.split('@')[0]},logger:{info:(...a)=>logs.push(a),warn:(...a)=>logs.push(a),error:(...a)=>logs.push(a)},waitBeforeNextAccount:async()=>{},Main:async account=>{if(account.email.startsWith('one')){R.beginAccount(bot,100);bot.userData.currentPoints=142;}throw Error('UnexpectedEof');}};
  const stats=await MicrosoftRewardsBot.prototype.runTasks.call(bot,[{email:'one@example.invalid',geoLocale:'US'},{email:'two@example.invalid',geoLocale:'US'}],Date.now());
  assert.equal(stats[0].collectedPoints,42);assert.equal(stats[0].success,false);assert.equal(stats[1].collectedPoints,0);assert.equal(stats[1].balanceKnown,false);assert(logs.some(a=>a.at(-1).includes('pointsGained=unknown')));
});
test('Control API parser accepts unknown earnable values and failed account last confirmed balances',async()=>{
  const code=patchControlParser(fs.readFileSync('.test-work/image/script/scripts/api/logParser.js','utf8'));
  const P=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
  const state=P.createRunState();const apply=(title,message)=>P.applyLogToRunState(state,{parsed:true,title,message,user:'one',level:'info'});
  apply('ACCOUNT-START','Starting account: one@example.invalid | geoLocale: US | locale: en-US');
  apply('POINTS','Earnable today | Mobile: unknown | Browser: 60 | App: 40 | one@example.invalid | locale: en-US');
  apply('ACCOUNT-PARTIAL','Partial account: one@example.invalid | pointsGained=42 | previousBalance=100 | currentBalance=142 | durationSeconds=80');
  const a=P.summarizeRunState(state).accounts[0];assert.equal(a.earnable.mobile,null);assert.equal(a.collectedPoints,42);assert.equal(a.success,false);assert.equal(a.finalPoints,142);
});
test('Dashboard stores a failed account with confirmed points, and details and notification retain unknown quota',t=>{
  const directory=fs.mkdtempSync(path.resolve('.test-work/reliability-store-'));
  const {Store}=evaluate(patchDashboardStore(fs.readFileSync('.test-work/image/dashboard/lib/store.js','utf8')),require,{process:{env:{DATA_DIR:directory}},__dirname:directory,setInterval,clearInterval});const store=new Store();t.after(()=>store.close());
  const {parseLine}=evaluate(patchDashboardParser(fs.readFileSync('.test-work/image/dashboard/lib/parser.js','utf8')));
  let tick=0;const line=(title,msg)=>parseLine(`${new Date(Date.parse('2026-10-23T01:00:00Z')+tick++).toISOString()} [10/23/2026, 9:00:00 AM] [one] [INFO] MAIN [${title}] ${msg}`);
  store.apply(line('RUN-START','Starting Microsoft Rewards Script | v4.3.2 | Accounts: 1 | Clusters: 1'));
  store.apply(line('ACCOUNT-START','Starting account: one@example.invalid | geoLocale: US'));
  const e=line('ACCOUNT-PARTIAL','Partial account: one@example.invalid | pointsGained=42 | previousBalance=100 | currentBalance=142 | durationSeconds=80');assert.equal(e.kind,'account-partial');store.apply(e);
  const account=store.db.prepare('SELECT * FROM accounts').get();assert.equal(account.status,'error');assert.equal(account.last_gained,42);assert.equal(account.last_points,142);assert.equal(store.db.prepare('SELECT count(*) AS n FROM account_history').get().n,1);
  store.apply(line('RUN-END','Completed all accounts | accountsProcessed=1 | pointsGained=42 | previousBalance=100 | currentBalance=142 | runtimeMinutes=1.3'));
  const row=store.db.prepare('SELECT status,total_gained FROM runs').get();assert.equal(row.status,'partial');assert.equal(row.total_gained,42);
  const {NotificationDetails,accountLines}=require('../docker/notification-details.cjs');const details=new NotificationDetails(store.db);
  details.record('test',e);details.record('test',{kind:'generic',email:'one@example.invalid',title:'SEARCH-QUOTA',message:'Mobile: unknown | Desktop: known'});const a=details.accounts('test')[0];assert.equal(a.collectedPoints,42);assert.equal(a.partial,true);assert(accountLines(a).join('\n').includes('手机搜索额度：未知'));
});
