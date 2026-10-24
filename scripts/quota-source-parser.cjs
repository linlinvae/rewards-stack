'use strict';
// Parse JSON and Next.js Flight payloads as data, never execute downloaded scripts.
function knownQuota(rows){
  if(!Array.isArray(rows)||!rows.length||rows.some(r=>!Number.isSafeInteger(r?.pointProgress)||!Number.isSafeInteger(r?.pointProgressMax)||r.pointProgress<0||r.pointProgressMax<0))return null;
  const max=rows.reduce((s,r)=>s+r.pointProgressMax,0),earned=rows.reduce((s,r)=>s+Math.min(r.pointProgress,r.pointProgressMax),0);
  return {known:true,earned,max,remaining:max-earned};
}
function parseQuotaSource(raw){
  const chunks=[],roots=[];let accountDataPresent=false,visited=0;
  if(raw&&typeof raw==='object')roots.push(raw);
  if(typeof raw==='string'){
    try{roots.push(JSON.parse(raw));}catch{}
    for(const match of raw.matchAll(/self\.__next_f\.push\(\s*\[\s*1\s*,\s*("(?:\\.|[^"\\])*")\s*\]\s*\)/g)){
      if(chunks.length>=3000)break;
      try{chunks.push(JSON.parse(match[1]));}catch{}
    }
    // Lines are React Flight records: ID followed by a JSON value. Import/error records are ignored.
    for(const line of chunks.join('').split('\n')){
      const m=/^[a-z0-9]+:([\[{].*)$/i.exec(line);if(!m)continue;
      try{roots.push(JSON.parse(m[1]));}catch{}
    }
  }
  const candidates={mobile:[],pc:[]},present={mobile:false,pc:false};
  function visit(node,depth=0){
    if(!node||typeof node!=='object'||depth>45||++visited>150000)return;
    if(Number.isSafeInteger(node.availablePoints)&&node.availablePoints>=0)accountDataPresent=true;
    if(node.isRewardsUser===true&&node.profile)accountDataPresent=true;
    if(!Array.isArray(node))for(const [field,kind]of [['mobileSearch','mobile'],['MobileSearch','mobile'],['pcSearch','pc'],['PCSearch','pc']]){
      if(Object.hasOwn(node,field)){
        present[kind]=true;const q=knownQuota(node[field]);
        if(q&&!candidates[kind].some(x=>JSON.stringify(x)===JSON.stringify(q)))candidates[kind].push(q);
      }
    }
    for(const child of Object.values(node))visit(child,depth+1);
  }
  for(const root of roots)visit(root);
  function result(kind){const list=candidates[kind];return {present:present[kind],known:accountDataPresent&&list.length===1,...(accountDataPresent&&list.length===1?list[0]:{earned:null,max:null,remaining:null}),conflicting:list.length>1};}
  const text=typeof raw==='string'?raw+'\n'+chunks.join(''):'';
  return {accountDataPresent,mobile:result('mobile'),pc:result('pc'),flightChunks:chunks.length,
    sharedRuleText:/same daily limit|regardless of whether you search on PC or mobile/i.test(text),
    mobileSearchLabel:/mobile search|手机搜索|移动搜索|モバイル検索/i.test(text)};
}
module.exports={knownQuota,parseQuotaSource};
