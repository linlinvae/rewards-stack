import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const {PushPlus,summarize,summarizeHistory}=createRequire(import.meta.url)('../docker/pushplus.cjs');
const token='0123456789abcdef0123456789abcdef';
function fixture(t, options={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rewards-pushplus-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const requests=[],file=path.join(dir,'pushplus.json');let clock=Date.now();
  const settings={file,now:()=>clock,delay:async()=>{},fetchImpl:async(url,init)=>{requests.push({url,...JSON.parse(init.body)});return Response.json({code:200,data:'fixture-short-code'});},...options};
  const service=new PushPlus(settings);
  return {dir,file,service,requests,settings,tick:ms=>clock+=ms};
}
function finished(at=new Date().toISOString(), overrides={}) {
  return {state:'idle',lastExit:{at,code:0},run:{finished:true,accountsTotal:1,collected:120,totals:{accountsProcessed:1,collected:120,newTotal:4000,runtimeMinutes:12},accounts:[{email:'person@example.invalid',success:true,collectedPoints:120}]},...overrides};
}
test('Save, reload, replace and clear token without exposing it or enabling by default',t=>{
  const f=fixture(t);assert.equal(f.service.view().enabled,false);
  const saved=f.service.save({token,enabled:true});assert(saved.tokenConfigured);assert(!JSON.stringify(saved).includes(token));
  f.service.save({token:'',notifySuccess:false});assert.equal(f.service.state.config.token,token);
  assert.equal(new PushPlus(f.settings).view().notifySuccess,false);
  assert.equal(new PushPlus(f.settings).state.config.token,token);
  if(process.platform!=='win32')assert.equal(fs.statSync(f.file).mode&0o777,0o600);
  assert.throws(()=>f.service.save({clearToken:true}),e=>e.status===400);
  f.service.save({enabled:false,clearToken:true});assert(!f.service.view().tokenConfigured);
  assert(!fs.readFileSync(f.file,'utf8').includes(token));
});
test('Invalid and untrusted settings leave the saved configuration intact',t=>{
  const f=fixture(t);f.service.save({token});const before=fs.readFileSync(f.file,'utf8');
  for(const input of [null,[],{enabled:1},{token:'invalid'},{token:'x\n'.repeat(20)},{token:42},{endpoint:'http://internal'},{clearToken:'true'},JSON.parse('{"__proto__":{}}')])assert.throws(()=>f.service.save(input),e=>e.status===400);
  assert.equal(fs.readFileSync(f.file,'utf8'),before);
});
test('Test sends saved token using HTTPS POST to WeChat even when automatic push is disabled',async t=>{
  const f=fixture(t);assert.throws(()=>f.service.save({enabled:true}),e=>e.status===400);
  await assert.rejects(f.service.test(),e=>e.status===400);
  f.service.save({token});const result=await f.service.test();assert(result.accepted);
  assert.match(result.message,/已受理/);assert.equal(f.requests.length,1);
  const sent=f.requests[0];assert.equal(sent.url,'https://www.pushplus.plus/send');assert.equal(sent.token,token);assert.equal(sent.channel,'wechat');assert.equal(sent.template,'txt');
  assert.match(sent.title,/测试/);assert(!JSON.stringify(result).includes(token));
  await assert.rejects(f.service.test(),e=>e.status===429);
  f.tick(30000);await f.service.test();assert.equal(f.requests.length,2);
});
test('Completion waits for process exit and sends only once across SSE, poll and restart',async t=>{
  const f=fixture(t);f.service.save({token,enabled:true});f.tick(1000);const status=finished(new Date(f.settings.now()).toISOString());
  f.service.observe({...status,state:'running'});assert.equal(f.requests.length,0);
  f.service.observe(status);f.service.observe(status);await f.service.drain();assert.equal(f.requests.length,1);
  new PushPlus(f.settings).observe(status);assert.equal(f.requests.length,1);
  const sent=f.requests[0];assert.match(sent.content,/120 积分/);assert.match(sent.content,/4000 积分/);assert.match(sent.content,/12 分钟/);assert.match(sent.content,/p\*\*\*@example.invalid/);assert(!sent.content.includes('person@'));
});
test('Account failure and partial runs alert even when exit code is zero',async t=>{
  const f=fixture(t);f.service.save({token,enabled:true,notifySuccess:false});f.tick(1000);
  const status=finished(new Date(f.settings.now()).toISOString());status.run.accounts[0]={email:'failed@example.invalid',success:false,error:`login failed password=${token} OTP 482617 https://example.invalid/cookie`};
  f.service.observe(status);await f.service.drain();assert.equal(f.requests.length,1);assert.match(f.requests[0].title,/异常/);assert.match(f.requests[0].content,/1 个失败/);
  for(const secret of [token,'482617','password=','https://example.invalid/cookie'])assert(!f.requests[0].content.includes(secret));
  assert.equal(summarize(finished(undefined,{run:{finished:true,status:'partial',totals:{},accounts:[]}})).failure,true);
});
test('Nonzero exit, spawn failure, unknown accounts and missing RUN-END are failures',()=>{
  for(const change of [{lastExit:{code:2}},{lastExit:{error:'sensitive spawn failure'}},{run:{finished:false,accounts:[]}},{run:{finished:true,accountsTotal:2,totals:{},accounts:[{success:true}]}}])assert(summarize(finished(undefined,change)).failure);
  assert.match(summarize(finished(undefined,{lastExit:{signal:'SIGTERM'}})).title,/停止/);
  assert(summarize(finished(undefined,{lastExit:{signal:'SIGSEGV'}})).failure);
});
test('Failure-only, success-only and disabled modes respect settings without replay on enabling',async t=>{
  const f=fixture(t);f.tick(1000);const status=finished(new Date(f.settings.now()).toISOString());
  f.service.observe(status);f.service.save({token,enabled:true});f.service.observe(status);await f.service.drain();assert.equal(f.requests.length,0);
  f.service.save({notifySuccess:false});f.tick(1000);f.service.observe(finished(new Date(f.settings.now()).toISOString()));await f.service.drain();assert.equal(f.requests.length,0);
  f.service.save({notifySuccess:true,notifyFailure:false});f.tick(1000);f.service.observe(finished(new Date(f.settings.now()).toISOString(),{lastExit:{at:new Date(f.settings.now()).toISOString(),code:2}}));await f.service.drain();assert.equal(f.requests.length,0);
  f.tick(1000);f.service.observe(finished(new Date(f.settings.now()).toISOString()));await f.service.drain();assert.equal(f.requests.length,1);
});
test('Historical completion before installation is not pushed',async t=>{
  const f=fixture(t);f.service.save({token,enabled:true});f.service.observe(finished(new Date(f.settings.now()-10000).toISOString()));await f.service.drain();assert.equal(f.requests.length,0);
});
test('Business rejection, malformed response and timeout never leak provider errors or retry ambiguously',async t=>{
  for(const fetchImpl of [async()=>Response.json({code:600,msg:token}),async()=>new Response(token),async()=>{throw Error(token);}]) {
    let count=0;const f=fixture(t,{fetchImpl:async(...args)=>{count++;return fetchImpl(...args);}});f.service.save({token});
    await assert.rejects(f.service.test(),e=>e.public&&e.status===502&&!e.message.includes(token));assert.equal(count,1);assert.equal(f.service.view().lastResult.ok,false);
  }
});
test('Explicit temporary HTTP failure gets at most one retry; successful 200 is not retried',async t=>{
  let attempts=0;const f=fixture(t,{fetchImpl:async()=>++attempts===1?new Response('',{status:503}):Response.json({code:200})});f.service.save({token});await f.service.test();assert.equal(attempts,2);
  let attempts2=0;const g=fixture(t,{fetchImpl:async()=>{attempts2++;return new Response('',{status:503});}});g.service.save({token});await assert.rejects(g.service.test());assert.equal(attempts2,2);
});
test('Notification failure is contained and repeated status does not retry the whole run',async t=>{
  let attempts=0;const f=fixture(t,{fetchImpl:async()=>{attempts++;throw Error('connection closed');}});f.service.save({token,enabled:true});f.tick(1000);const status=finished(new Date(f.settings.now()).toISOString());
  f.service.observe(status);await f.service.drain();assert.equal(f.service.view().lastResult.ok,false);
  f.service.observe(status);await f.service.drain();assert.equal(attempts,1);
});
test('Disk write failure preserves settings and does not send a notification without a deduplication checkpoint',async t=>{
  const f=fixture(t);f.service.save({token,enabled:true});const original=f.service.state;
  fs.unlinkSync(f.file);fs.mkdirSync(f.file);
  assert.throws(()=>f.service.save({notifySuccess:false}));assert.deepEqual(f.service.state,original);
  f.tick(1000);assert.throws(()=>f.service.observe(finished(new Date(f.settings.now()).toISOString())));assert.equal(f.requests.length,0);
});
function historyRow(overrides={}){return {id:'persisted-run-1',status:'done',startTs:'2026-10-22T01:00:00Z',endTs:'2026-10-22T01:12:00Z',accountsProcessed:2,totalAccounts:2,totalGained:240,newTotal:8000,runtimeMin:12,...overrides};}
test('Historical summary uses only saved row values and never fabricates account successes or sends raw logs',()=>{
  const message=summarizeHistory(historyRow({raw:'password=secret',email:'person@example.invalid',error:'OTP 482617'}));
  for(const text of ['240 积分','8000 积分','12 分钟','已处理账号：2 / 2','2026-10-22T01:00:00.000Z','已保存的运行汇总'])assert(message.content.includes(text));
  for(const text of ['secret','person@','482617','个成功'])assert(!message.content.includes(text));
  assert.match(summarizeHistory(historyRow({status:'partial',totalGained:null,newTotal:null})).content,/未记录/);
  assert.match(summarizeHistory(historyRow({status:'error'})).content,/只包含部分账号/);
  assert.match(summarizeHistory(historyRow({runtimeMin:null})).content,/12 分钟/);
  assert.throws(()=>summarizeHistory(null),e=>e.status===404);
  for(const row of [historyRow({status:'running'}),historyRow({endTs:null}),historyRow({endTs:'invalid'})])assert.throws(()=>summarizeHistory(row),e=>e.status===409);
});
test('Manual send works with automatic notifications disabled and retains automatic deduplication',async t=>{
  const f=fixture(t);f.service.save({token,enabled:false});const before=[...f.service.state.seen];
  assert((await f.service.sendHistory(historyRow())).accepted);assert.equal(f.requests.length,1);assert.match(f.requests[0].title,/运行记录/);assert.equal(f.service.view().lastResult.kind,'manual');
  assert.deepEqual(f.service.state.seen,before);assert.equal(f.service.view().enabled,false);
  await assert.rejects(f.service.sendHistory(historyRow({id:'another'})),e=>e.status===429);
  await assert.rejects(new PushPlus(f.settings).sendHistory(historyRow()),e=>e.status===429);
  f.tick(30000);await f.service.sendHistory(historyRow());assert.equal(f.requests.length,2);
});
test('Manual send requires saved token, rejects active notification concurrency and keeps cooldown after timeout',async t=>{
  const f=fixture(t);await assert.rejects(f.service.sendHistory(historyRow()),e=>e.status===400);assert.equal(f.requests.length,0);
  f.service.save({token});f.service.testing=true;await assert.rejects(f.service.sendHistory(historyRow()),e=>e.status===409);f.service.testing=false;
  const g=fixture(t,{fetchImpl:async()=>{throw Error('ambiguous timeout');}});g.service.save({token});
  await assert.rejects(g.service.sendHistory(historyRow()),e=>e.status===502);assert.equal(g.service.view().lastResult.ok,false);
  await assert.rejects(new PushPlus(g.settings).sendHistory(historyRow()),e=>e.status===429);
});
const friendA='a'.repeat(32),friendB='b'.repeat(32);
function routing(){return [{email:'owner@example.invalid',target:'self'},{email:'second@example.invalid',target:'friend',friendToken:friendA},{email:'third@example.invalid',target:'friend',friendToken:friendB}];}
function threeAccounts(){return [{email:'owner@example.invalid',success:true,initialPoints:100,collectedPoints:11,finalPoints:111,durationSeconds:5,live:{bySource:{read:3,checkIn:8}}},{email:'second@example.invalid',success:true,initialPoints:200,collectedPoints:22,finalPoints:222,searchSummary:{mobile:10,desktop:12,bonus:0}},{email:'third@example.invalid',success:false,initialPoints:300,collectedPoints:7,finalPoints:307,error:'login secret=123'}];}
test('Three account recipients receive only their own details, never global balances or another account',async t=>{
  const f=fixture(t);f.service.save({token,enabled:true,deliveryMode:'accounts',routes:routing()});f.tick(1000);
  const status=finished(new Date(f.settings.now()).toISOString());status.run.accounts=threeAccounts();status.run.accountsTotal=3;status.run.totals.newTotal=99999;
  f.service.observe(status);await f.service.drain();assert.equal(f.requests.length,3);
  assert(!Object.hasOwn(f.requests[0],'to'));assert.equal(f.requests[1].to,friendA);assert.equal(f.requests[2].to,friendB);
  for(let i=0;i<3;i++){
    const sent=f.requests[i];assert.equal(sent.token,token);assert(sent.content.includes([111,222,307][i]+' 积分'));
    for(let j=0;j<3;j++)if(j!==i)assert(!sent.content.includes([111,222,307][j]+' 积分'));
    assert(!sent.content.includes('99999'));assert(!sent.content.includes('secret=123'));
  }
  assert.match(f.requests[0].content,/阅读文章：3/);assert.match(f.requests[1].content,/电脑 12，手机 10/);assert.match(f.requests[2].title,/异常/);
  assert.equal(f.service.view().lastResult.acceptedCount,3);
});
test('Friend token stays hidden and follows email rather than row position, including configuration migration',t=>{
  const f=fixture(t);f.service.save({token,routes:routing()});const safe=f.service.view();assert(!JSON.stringify(safe).includes(friendA));assert(safe.routes[1].friendTokenConfigured);
  f.service.save({routes:[{email:'third@example.invalid',target:'friend',friendToken:''},{email:'second@example.invalid',target:'friend',friendToken:''},{email:'owner@example.invalid',target:'self'}]});
  const restored=new PushPlus(f.settings);assert.equal(restored.state.config.routes[0].friendToken,friendB);assert.equal(restored.state.config.routes[1].friendToken,friendA);
  const legacy=fixture(t);fs.writeFileSync(legacy.file,JSON.stringify({config:{enabled:true,notifySuccess:true,notifyFailure:true,token},seen:[]}));const loaded=new PushPlus(legacy.settings);assert.equal(loaded.view().deliveryMode,'summary');assert.deepEqual(loaded.view().routes,[]);
});
test('Recipient validation rejects unbound friends, duplicate accounts, comma-separated targets and unsafe values',t=>{
  const f=fixture(t);f.service.save({token});
  for(const routes of [[{email:'second@example.invalid',target:'friend'}],[{email:'second@example.invalid',target:'friend',friendToken:friendA+','+friendB}],[{email:'bad',target:'self'}],[{email:'owner@example.invalid',target:'self',url:'https://other.invalid'}],[{email:'owner@example.invalid',target:'self'},{email:'OWNER@example.invalid',target:'off'}]])assert.throws(()=>f.service.save({routes}),e=>e.status===400);
  assert.throws(()=>f.service.save({enabled:true,deliveryMode:'accounts'}),e=>e.status===400);
  f.service.save({routes:routing()});assert.throws(()=>f.service.save({routes:[{email:'second@example.invalid',target:'friend',clearFriendToken:true}]}),e=>e.status===400);
});
test('Individual recipient testing uses saved binding, independent cooldowns and no other account data',async t=>{
  const f=fixture(t);f.service.save({token,routes:routing()});await f.service.test('second@example.invalid');await f.service.test('third@example.invalid');
  assert.equal(f.requests[0].to,friendA);assert.equal(f.requests[1].to,friendB);assert(!f.requests[0].content.includes('third'));
  await assert.rejects(f.service.test('second@example.invalid'),e=>e.status===429);
  await assert.rejects(f.service.test('missing@example.invalid'),e=>e.status===400);assert.equal(f.requests.length,2);
});
test('Skipped accounts and disabled routes are not notified, failure filter is per account',async t=>{
  const f=fixture(t);f.service.save({token,enabled:true,notifySuccess:false,deliveryMode:'accounts',routes:routing()});f.tick(1000);
  const status=finished(new Date(f.settings.now()).toISOString());status.run.accounts=threeAccounts();f.service.observe(status);await f.service.drain();assert.equal(f.requests.length,1);assert.equal(f.requests[0].to,friendB);
  f.service.save({notifySuccess:true,routes:[...routing().slice(0,2),{email:'third@example.invalid',target:'off'}]});f.tick(1000);status.lastExit.at=new Date(f.settings.now()).toISOString();status.run.accounts=threeAccounts().slice(0,1);f.service.observe(status);await f.service.drain();assert.equal(f.requests.length,2);assert(!Object.hasOwn(f.requests[1],'to'));
});
test('One failed recipient does not block another; partial acceptance is explicit and automatic run is not replayed',async t=>{
  const attempts=[];const f=fixture(t,{fetchImpl:async(url,init)=>{const payload=JSON.parse(init.body);attempts.push(payload);return Response.json({code:payload.to===friendA?903:200});}});f.service.save({token,enabled:true,deliveryMode:'accounts',routes:routing()});f.tick(1000);
  const status=finished(new Date(f.settings.now()).toISOString());status.run.accounts=threeAccounts();f.service.observe(status);await f.service.drain();assert.equal(attempts.length,3);assert.equal(f.service.view().lastResult.acceptedCount,2);assert.equal(f.service.view().lastResult.failedCount,1);
  f.service.observe(status);await f.service.drain();assert.equal(attempts.length,3);
});
test('Manual account distribution requires archived details and preserves isolated content',async t=>{
  const f=fixture(t);f.service.save({token,deliveryMode:'accounts',routes:routing()});await assert.rejects(f.service.sendHistory(historyRow()),e=>e.status===409);
  assert((await f.service.sendHistory(historyRow(),threeAccounts())).accepted);assert.equal(f.requests.length,3);assert(!f.requests[1].content.includes('8000'));assert.match(f.requests[1].title,/账号历史明细/);
});
