'use strict';
// GET-only diagnostics. Read saved sessions without changing them; never print cookies or response bodies.
const {DatabaseSync}=require('node:sqlite');
const path=require('node:path');
const {createRequire}=require('node:module');
const req=createRequire(path.join(process.cwd(),'package.json'));
const Http=req('./dist/util/Http.js').default;
const {URLs}=req('./dist/constants/urls.js');
const {quota,readWithRetry}=require('/stack/rewards-reliability.cjs');
async function diagnose(){
  const db=new DatabaseSync(path.resolve('sessions/sessions.db'),{readOnly:true});
  const rows=db.prepare('SELECT email,platform,storage_state,fingerprint FROM sessions WHERE storage_state IS NOT NULL ORDER BY email,platform').all();db.close();
  const output={checkedAt:new Date().toISOString(),readOnly:true,rewardsTaskStarted:false,accounts:[]};
  for(const row of rows){
    const cookies=JSON.parse(row.storage_state).cookies||[],fp=row.fingerprint?JSON.parse(row.fingerprint):null;
    const headers={...(fp?.headers??{})};
    for(const key of Object.keys(headers))if(/cookie|authorization/i.test(key))delete headers[key];
    const client=new Http({});
    const item={account:rows.map(r=>r.email).filter((x,i,a)=>a.indexOf(x)===i).indexOf(row.email)+1,accountHint:row.email.split('@')[0].slice(-4),platform:row.platform,endpoints:[]};
    for(const [source,url]of [['primary',URLs.rewards.userInfoApi],['flyout',URLs.bing.rewardsFlyoutUserInfo]]){
      const u=new URL(url),now=Date.now()/1000;
      const cookie=cookies.filter(c=>{const d=c.domain.replace(/^\./,'');return (c.expires===-1||c.expires>now)&&(u.hostname===d||(c.domain.startsWith('.')&&u.hostname.endsWith('.'+d)))&&u.pathname.startsWith(c.path||'/');}).sort((a,b)=>(b.path?.length||1)-(a.path?.length||1)).map(c=>c.name+'='+c.value).join('; ');
      try{
        const response=await readWithRetry(()=>client.request({url,method:'GET',headers:{...headers,Cookie:cookie,Referer:u.origin+'/',Origin:u.origin,Accept:'application/json'},retries:0,timeout:15000}),{attempts:2});
        const raw=response.data,status=source==='primary'?raw?.dashboard?.userStatus:raw?.flyoutResult?.userStatus;
        const counters=status?.counters,mobile=counters?.mobileSearch??counters?.MobileSearch,desktop=counters?.pcSearch??counters?.PCSearch;
        item.endpoints.push({source,http:response.status,validAccount:source==='primary'?!!status:!!(raw?.userInfo?.isRewardsUser&&raw?.userInfo?.profile&&status?.isRewardsUser),bodyType:typeof raw,
          dashboardPresent:!!raw?.dashboard,countersPresent:!!counters,mobileFieldPresent:!!counters&&('MobileSearch' in counters||'mobileSearch' in counters),mobile:quota(mobile),desktop:quota(desktop)});
      }catch(error){const status=error.status??error.response?.status;item.endpoints.push({source,http:status??null,error:status?'http':'network_or_body_read'});}
    }
    output.accounts.push(item);
  }
  console.log(JSON.stringify(output));
}
diagnose().catch(()=>{console.log(JSON.stringify({ok:false,readOnly:true,error:'Session or interface diagnostic unavailable; no credentials printed'}));process.exitCode=1;});
