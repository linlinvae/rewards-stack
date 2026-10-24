'use strict';
// Read-only requests, current accounts only. Each HTTP operation has a separate killable process.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),{DatabaseSync}=require('node:sqlite');
const CHILD="let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>input+=s);process.stdin.on('end',async()=>{\nlet finished=false;const done=value=>{if(finished)return;finished=true;process.stdout.write(JSON.stringify(value)+'\\n',()=>process.exit(0));};\nsetTimeout(()=>done({error:'timeout'}),12000);\ntry{\nconst parserModule={exports:{}};(function(module){'use strict';\n// Parse JSON and Next.js Flight payloads as data, never execute downloaded scripts.\nfunction knownQuota(rows){\n  if(!Array.isArray(rows)||!rows.length||rows.some(r=>!Number.isSafeInteger(r?.pointProgress)||!Number.isSafeInteger(r?.pointProgressMax)||r.pointProgress<0||r.pointProgressMax<0))return null;\n  const max=rows.reduce((s,r)=>s+r.pointProgressMax,0),earned=rows.reduce((s,r)=>s+Math.min(r.pointProgress,r.pointProgressMax),0);\n  return {known:true,earned,max,remaining:max-earned};\n}\nfunction parseQuotaSource(raw){\n  const chunks=[],roots=[];let accountDataPresent=false,visited=0;\n  if(raw&&typeof raw==='object')roots.push(raw);\n  if(typeof raw==='string'){\n    try{roots.push(JSON.parse(raw));}catch{}\n    for(const match of raw.matchAll(/self\\.__next_f\\.push\\(\\s*\\[\\s*1\\s*,\\s*(\"(?:\\\\.|[^\"\\\\])*\")\\s*\\]\\s*\\)/g)){\n      if(chunks.length>=3000)break;\n      try{chunks.push(JSON.parse(match[1]));}catch{}\n    }\n    // Lines are React Flight records: ID followed by a JSON value. Import/error records are ignored.\n    for(const line of chunks.join('').split('\\n')){\n      const m=/^[a-z0-9]+:([\\[{].*)$/i.exec(line);if(!m)continue;\n      try{roots.push(JSON.parse(m[1]));}catch{}\n    }\n  }\n  const candidates={mobile:[],pc:[]},present={mobile:false,pc:false};\n  function visit(node,depth=0){\n    if(!node||typeof node!=='object'||depth>45||++visited>150000)return;\n    if(Number.isSafeInteger(node.availablePoints)&&node.availablePoints>=0)accountDataPresent=true;\n    if(node.isRewardsUser===true&&node.profile)accountDataPresent=true;\n    if(!Array.isArray(node))for(const [field,kind]of [['mobileSearch','mobile'],['MobileSearch','mobile'],['pcSearch','pc'],['PCSearch','pc']]){\n      if(Object.hasOwn(node,field)){\n        present[kind]=true;const q=knownQuota(node[field]);\n        if(q&&!candidates[kind].some(x=>JSON.stringify(x)===JSON.stringify(q)))candidates[kind].push(q);\n      }\n    }\n    for(const child of Object.values(node))visit(child,depth+1);\n  }\n  for(const root of roots)visit(root);\n  function result(kind){const list=candidates[kind];return {present:present[kind],known:accountDataPresent&&list.length===1,...(accountDataPresent&&list.length===1?list[0]:{earned:null,max:null,remaining:null}),conflicting:list.length>1};}\n  const text=typeof raw==='string'?raw+'\\n'+chunks.join(''):'';\n  return {accountDataPresent,mobile:result('mobile'),pc:result('pc'),flightChunks:chunks.length,\n    sharedRuleText:/same daily limit|regardless of whether you search on PC or mobile/i.test(text),\n    mobileSearchLabel:/mobile search|手机搜索|移动搜索|モバイル検索/i.test(text)};\n}\nmodule.exports={knownQuota,parseQuotaSource};\n\n})(parserModule);\nconst {createRequire}=require('node:module'),path=require('node:path'),req=createRequire(path.join(process.cwd(),'package.json'));\nconst x=JSON.parse(input),Http=req('./dist/util/Http.js').default;\nconst res=await new Http({}).request({url:x.url,method:'GET',headers:x.headers,retries:0,timeout:8000});\ndone({http:res.status,bodyType:typeof res.data,...parserModule.exports.parseQuotaSource(res.data)});\n}catch(e){const status=e.status??e.response?.status;done({http:typeof status==='number'?status:null,error:status?'http':'network_or_body_read'});}\n});";
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
  const output={checkedAt:new Date().toISOString(),readOnly:true,rewardsTaskStarted:false,version:3,complete:true,accounts:[]};
  // A mobile session is the relevant evidence. Use desktop only when no mobile session is saved.
  for(const account of accounts){
    const matches=rows.filter(r=>r.email.toLowerCase()===account.email.toLowerCase()),row=matches.find(r=>r.platform==='mobile')??matches.find(r=>r.platform==='desktop');
    const item={account:account.index,accountHint:account.email.split('@')[0].slice(-4),platform:row?.platform??null,endpoints:[]};output.accounts.push(item);
    if(!row){item.error='missing_session';continue;}
    const state=JSON.parse(row.storage_state),fp=row.fingerprint?JSON.parse(row.fingerprint):null;
    const headers={...(fp?.headers??{})};for(const key of Object.keys(headers))if(/cookie|authorization/i.test(key))delete headers[key];
    for(const [source,url]of [['xhr','https://rewards.bing.com/api/getuserinfo?type=1&X-Requested-With=XMLHttpRequest'],['earn','https://rewards.bing.com/earn'],['dashboard','https://rewards.bing.com/dashboard'],['flyout','https://www.bing.com/rewards/panelflyout/getuserinfo?channel=BingFlyout&partnerId=BingRewards']]){
      const u=new URL(url);item.endpoints.push({source,...await probe({source,url,headers:{...headers,Cookie:cookieHeader(state.cookies||[],url),Referer:u.origin+'/',Origin:u.origin,Accept:'application/json,text/html;q=0.9','X-Requested-With':'XMLHttpRequest'}})});
    }
  }
  return output;
}
module.exports={probe,cookieHeader,CHILD};
if(require.main===module){main().then(output=>{process.stdout.write(JSON.stringify(output)+'\n',()=>process.exit(0));}).catch(()=>{process.stdout.write(JSON.stringify({readOnly:true,rewardsTaskStarted:false,version:3,complete:false,accounts:[],error:'probe_setup_failed'})+'\n',()=>process.exit(1));});}
