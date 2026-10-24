'use strict';
// Read-only requests, current accounts only. Each HTTP operation has a separate killable process.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),{DatabaseSync}=require('node:sqlite');
const CHILD=String.raw`
let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>input+=s);process.stdin.on('end',async()=>{
let finished=false;const done=value=>{if(finished)return;finished=true;process.stdout.write(JSON.stringify(value)+'\n',()=>process.exit(0));};
setTimeout(()=>done({error:'timeout'}),12000);
try{
const {createRequire}=require('node:module'),path=require('node:path'),req=createRequire(path.join(process.cwd(),'package.json'));
const x=JSON.parse(input),Http=req('./dist/util/Http.js').default;
const res=await new Http({}).request({url:x.url,method:'GET',headers:x.headers,retries:0,timeout:8000});
const raw=res.data,status=x.source==='primary'?raw?.dashboard?.userStatus:raw?.flyoutResult?.userStatus,c=status?.counters;
const quota=rows=>{
if(!Array.isArray(rows)||!rows.length||rows.some(r=>!Number.isFinite(r?.pointProgress)||!Number.isFinite(r?.pointProgressMax)))return {known:false,earned:null,max:null,remaining:null};
const max=rows.reduce((s,r)=>s+r.pointProgressMax,0),earned=rows.reduce((s,r)=>s+Math.min(r.pointProgress,r.pointProgressMax),0);return {known:true,max,earned,remaining:max-earned};};
done({http:res.status,bodyType:typeof raw,validAccount:x.source==='primary'?!!status:!!(raw?.userInfo?.isRewardsUser&&raw?.userInfo?.profile&&status?.isRewardsUser),dashboardPresent:!!raw?.dashboard,countersPresent:!!c,mobileFieldPresent:!!c&&('MobileSearch' in c||'mobileSearch' in c),mobile:quota(c?.MobileSearch??c?.mobileSearch),desktop:quota(c?.PCSearch??c?.pcSearch)});
}catch(e){const status=e.status??e.response?.status;done({http:typeof status==='number'?status:null,error:status?'http':'network_or_body_read'});}
});`;
function probe(payload,spawnImpl=spawn,timeoutMs=15000){return new Promise(resolve=>{
  const env={...process.env};delete env.NODE_OPTIONS;
  const child=spawnImpl(process.execPath,['-e',CHILD],{env,stdio:['pipe','pipe','ignore'],windowsHide:true});
  let text='',done=false;
  const finish=value=>{if(done)return;done=true;clearTimeout(timer);resolve(value);};
  const timer=setTimeout(()=>{child.kill('SIGKILL');finish({error:'timeout'});},timeoutMs);
  child.stdout.on('data',b=>{text+=b;if(text.length>8192){child.kill('SIGKILL');finish({error:'invalid_report'});}});
  child.on('error',()=>finish({error:'worker_unavailable'}));
  child.on('close',()=>{try{finish(JSON.parse(text));}catch{finish({error:'invalid_report'});}});
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(payload));
});}
function cookieHeader(cookies,url){const u=new URL(url);return cookies.filter(c=>{const domain=String(c.domain||'').replace(/^\./,'');return (c.expires===-1||c.expires>Date.now()/1000)&&(u.hostname===domain||(String(c.domain).startsWith('.')&&u.hostname.endsWith('.'+domain)))&&u.pathname.startsWith(c.path||'/');}).sort((a,b)=>(b.path?.length||1)-(a.path?.length||1)).map(c=>c.name+'='+c.value).join('; ');}
async function main(){
  const auth={Authorization:'Bearer '+process.env.API_TOKEN};
  const get=async endpoint=>{const r=await fetch('http://127.0.0.1:3010'+endpoint,{headers:auth,signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('api');return r.json();};
  if((await get('/status')).state!=='idle')throw Error('busy');
  const list=await get('/accounts'),accounts=Array.isArray(list.accounts)?list.accounts:[];
  if(!accounts.length||accounts.length>10)throw Error('accounts');
  const db=new DatabaseSync(path.resolve('sessions/sessions.db'),{readOnly:true});
  let rows;try{rows=db.prepare('SELECT email,platform,storage_state,fingerprint FROM sessions WHERE storage_state IS NOT NULL').all();}finally{db.close();}
  const output={checkedAt:new Date().toISOString(),readOnly:true,rewardsTaskStarted:false,version:2,complete:true,accounts:[]};
  // A mobile session is the relevant evidence. Use desktop only when no mobile session is saved.
  for(const account of accounts){
    const matches=rows.filter(r=>r.email.toLowerCase()===account.email.toLowerCase()),row=matches.find(r=>r.platform==='mobile')??matches.find(r=>r.platform==='desktop');
    const item={account:account.index,accountHint:account.email.split('@')[0].slice(-4),platform:row?.platform??null,endpoints:[]};output.accounts.push(item);
    if(!row){item.error='missing_session';continue;}
    const state=JSON.parse(row.storage_state),fp=row.fingerprint?JSON.parse(row.fingerprint):null;
    const headers={...(fp?.headers??{})};for(const key of Object.keys(headers))if(/cookie|authorization/i.test(key))delete headers[key];
    for(const [source,url]of [['primary','https://rewards.bing.com/api/getuserinfo'],['flyout','https://www.bing.com/rewards/panelflyout/getuserinfo?channel=BingFlyout&partnerId=BingRewards']]){
      const u=new URL(url);item.endpoints.push({source,...await probe({source,url,headers:{...headers,Cookie:cookieHeader(state.cookies||[],url),Referer:u.origin+'/',Origin:u.origin,Accept:'application/json'}})});
    }
  }
  return output;
}
module.exports={probe,cookieHeader,CHILD};
if(require.main===module){main().then(output=>{process.stdout.write(JSON.stringify(output)+'\n',()=>process.exit(0));}).catch(()=>{process.stdout.write(JSON.stringify({readOnly:true,rewardsTaskStarted:false,version:2,complete:false,accounts:[],error:'probe_setup_failed'})+'\n',()=>process.exit(1));});}
