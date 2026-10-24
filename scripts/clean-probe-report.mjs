import assert from 'node:assert/strict';

export function cleanInterfaceReport(data){
  assert(data?.readOnly===true&&data.rewardsTaskStarted===false&&data.version===2&&Array.isArray(data.accounts)&&data.accounts.length<=10);
  const n=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
  const q=x=>({known:x?.known===true,earned:n(x?.earned),max:n(x?.max),remaining:n(x?.remaining)});
  return {checkedAt:new Date().toISOString(),readOnly:true,rewardsTaskStarted:false,version:2,complete:data.complete===true,error:data.error==='probe_setup_failed'?data.error:null,accounts:data.accounts.map(a=>({account:n(a.account),accountHint:/^[a-z0-9]{1,4}$/i.test(a.accountHint)?a.accountHint:null,platform:['mobile','desktop'].includes(a.platform)?a.platform:null,error:a.error==='missing_session'?a.error:null,endpoints:(a.endpoints||[]).slice(0,2).map(e=>({source:['primary','flyout'].includes(e.source)?e.source:null,http:n(e.http),bodyType:['object','string'].includes(e.bodyType)?e.bodyType:null,validAccount:e.validAccount===true,countersPresent:e.countersPresent===true,mobileFieldPresent:e.mobileFieldPresent===true,mobile:q(e.mobile),desktop:q(e.desktop),error:['http','network_or_body_read','timeout','invalid_report','worker_unavailable'].includes(e.error)?e.error:null}))}))};
}

export function cleanQuotaReport(data){
  assert(data?.readOnly===true&&data.rewardsTaskStarted===false&&data.version===3&&Array.isArray(data.accounts)&&data.accounts.length<=10);
  const n=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
  const q=x=>({known:x?.known===true,earned:n(x?.earned),max:n(x?.max),remaining:n(x?.remaining)});
  return {checkedAt:new Date().toISOString(),readOnly:true,rewardsTaskStarted:false,version:3,complete:data.complete===true,error:data.error==='probe_setup_failed'?data.error:null,accounts:data.accounts.map(a=>({account:n(a.account),accountHint:/^[a-z0-9]{1,4}$/i.test(a.accountHint)?a.accountHint:null,platform:['mobile','desktop'].includes(a.platform)?a.platform:null,error:a.error==='missing_session'?a.error:null,endpoints:(a.endpoints||[]).slice(0,4).map(e=>({source:['xhr','earn','dashboard','flyout'].includes(e.source)?e.source:null,http:n(e.http),bodyType:['object','string'].includes(e.bodyType)?e.bodyType:null,accountDataPresent:e.accountDataPresent===true,mobile:{...q(e.mobile),present:e.mobile?.present===true,conflicting:e.mobile?.conflicting===true},pc:{...q(e.pc),present:e.pc?.present===true,conflicting:e.pc?.conflicting===true},flightChunks:n(e.flightChunks),sharedRuleText:e.sharedRuleText===true,mobileSearchLabel:e.mobileSearchLabel===true,error:['http','network_or_body_read','timeout','invalid_report','worker_unavailable'].includes(e.error)?e.error:null}))}))};
}
