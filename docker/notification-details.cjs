'use strict';
// Numeric, allowlisted per-account facts only. Raw logs and credentials never enter this archive.
const SOURCES={search:'Bing 搜索',bonus:'搜索奖励',read:'阅读文章',checkIn:'每日签到',claimBonus:'领取奖励积分',claimReward:'领取任务奖励',urlReward:'网页任务',visualSearch:'图片搜索',appReward:'App 任务',punchcard:'打卡任务',searchOnBing:'搜索活动'};
const numeric=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const validEmail=value=>typeof value==='string'&&value.length<=254&&/^[^\s@\x00-\x1f]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value);
function errorKind(value){const s=String(value||'');return /captcha|verification|mfa|login|auth|sign.?in|验证|登录/i.test(s)?'login':/timeout|timed out|超时/i.test(s)?'timeout':s?'other':null;}
function sanitizeAccount(a){
  if(!a||!validEmail(a.email))return null;
  const out={email:a.email.toLowerCase(),success:a.success===true?true:a.success===false?false:null,
    initialPoints:numeric(a.initialPoints),collectedPoints:numeric(a.collectedPoints)??numeric(a.live?.gained),finalPoints:numeric(a.finalPoints)??numeric(a.live?.balance),durationSeconds:numeric(a.durationSeconds),
    errorKind:['login','timeout','other'].includes(a.errorKind)?a.errorKind:errorKind(a.error),bySource:{},searchSummary:null,mobileQuotaKnown:typeof a.mobileQuotaKnown==='boolean'?a.mobileQuotaKnown:a.earnable?.mobile===null?false:null,partial:a.partial===true};
  for(const key of Object.keys(SOURCES)){const v=numeric(a.bySource?.[key])??numeric(a.live?.bySource?.[key]);if(v!=null)out.bySource[key]=v;}
  if(a.searchSummary)out.searchSummary=Object.fromEntries(['mobile','desktop','bonus'].map(k=>[k,numeric(a.searchSummary[k])]));
  return out;
}
function accountLines(a){
  a=sanitizeAccount(a);if(!a)return [];
  const mask=a.email[0]+'***@'+a.email.split('@')[1];
  const status=a.success===true?'已完成':a.errorKind==='login'?'登录或验证异常':a.errorKind==='timeout'?'执行超时':a.success===false?'执行失败':'未完成';
  const n=v=>v==null?'未记录':String(v);
  const lines=[`账号：${mask}`,`状态：${status}`,`本次新增：${n(a.collectedPoints)} 积分`,`余额变化：${n(a.initialPoints)} → ${n(a.finalPoints)} 积分`];
  if(a.partial)lines.push('积分为最后确认值；任务未全部完成。');
  if(a.mobileQuotaKnown===false)lines.push('手机搜索额度：未知（接口未提供有效额度，未执行手机搜索）');
  if(a.durationSeconds!=null)lines.push(`耗时：${Math.round(a.durationSeconds)} 秒`);
  const sources=Object.entries(a.bySource);
  if(sources.length){lines.push('积分来源（已识别部分）：');for(const [key,value]of sources)lines.push(`${SOURCES[key]}：${value} 积分`);}
  if(a.searchSummary){lines.push(`搜索明细：电脑 ${n(a.searchSummary.desktop)}，手机 ${a.mobileQuotaKnown===false?'未执行（额度未知）':n(a.searchSummary.mobile)}，奖励 ${n(a.searchSummary.bonus)} 积分`);}
  if(!sources.length&&!a.searchSummary)lines.push('积分来源明细：未记录');
  return lines;
}
function sourceFor(event){
  const msg=event.message||'',title=event.title;
  const rules=[['SEARCH-BING',/^pointsGained=/,'search'],['SEARCH-BONUS',/^pointsGained=/,'bonus'],['READ-TO-EARN',/^(Read article |No points gained,)/,'read'],['DAILY-CHECK-IN',/^(Completed Daily Check-In |Daily Check-In completed )/,'checkIn'],['CLAIM-BONUS-POINTS',/^(Completed ClaimBonusPoints |Nothing claimed )/,'claimBonus'],['CLAIM-REWARD',/^Reward claimed /,'claimReward'],['URL-REWARD',/^(Completed UrlReward|UrlReward credited )/,'urlReward'],['VISUAL-SEARCH',/^Daily visual search done /,'visualSearch'],['APP-REWARD',/^Completed AppReward/,'appReward'],['PUNCHCARD',/^Reported child /,'punchcard'],['SEARCH-ON-BING-SEARCH',/^SearchOnBing activity completed /,'searchOnBing']];
  return rules.find(([t,re])=>t===title&&re.test(msg))?.[2]||null;
}
class NotificationDetails{
  constructor(db){
    this.db=db;
    db.exec('CREATE TABLE IF NOT EXISTS pushplus_account_details (run_id TEXT NOT NULL, email TEXT NOT NULL, facts TEXT NOT NULL, PRIMARY KEY(run_id,email))');
    this.read=db.prepare('SELECT facts FROM pushplus_account_details WHERE run_id = ? ORDER BY email');
    this.write=db.prepare('INSERT INTO pushplus_account_details (run_id,email,facts) VALUES (?,?,?) ON CONFLICT(run_id,email) DO UPDATE SET facts=excluded.facts');
  }
  runningId(){return this.db.prepare("SELECT id FROM runs WHERE status='running' ORDER BY start_ts DESC LIMIT 1").get()?.id||null;}
  accounts(runId){return this.read.all(runId).map(row=>sanitizeAccount(JSON.parse(row.facts))).filter(Boolean);}
  ingest(event,beforeId){
    const id=event.kind==='run-start'?this.runningId():beforeId;
    if(id)this.record(id,event);
  }
  record(runId,event){
    const msg=event.message||'';let email=event.email,m;
    const end=/^Completed account: (\S+) \| pointsGained=(-?\d+) \| previousBalance=(\d+) \| currentBalance=(\d+) \| durationSeconds=([\d.]+)$/.exec(msg);
    const start=/^Starting account: (\S+) \|/.exec(msg);
    const partial=event.title==='ACCOUNT-PARTIAL'?/^Partial account: (\S+) \| pointsGained=(-?\d+|unknown) \| previousBalance=(\d+|unknown) \| currentBalance=(\d+|unknown) \| durationSeconds=([\d.]+)/.exec(msg):null;
    const quota=event.title==='SEARCH-QUOTA'?/^Mobile: (known|unknown) \|/.exec(msg):null;
    const error=event.kind==='account-error'?/^(\S+@\S+): ([\s\S]*)$/.exec(msg):null;
    if(end)email=end[1];else if(partial)email=partial[1];else if(start)email=start[1];else if(error)email=error[1];
    const source=sourceFor(event),search=event.title==='SEARCH-MANAGER'?/^Search summary \| mobile=(-?\d+) \| desktop=(-?\d+) \| bonus=(-?\d+) \| total=(-?\d+)/.exec(msg):null;
    if(!['account-start','account-end','account-error'].includes(event.kind)&&!source&&!search&&!partial&&!quota)return;
    const accounts=this.accounts(runId);
    if(!email){const matches=accounts.filter(a=>a.email.split('@')[0]===String(event.userName||'').toLowerCase());if(matches.length!==1)return;email=matches[0].email;}
    if(!validEmail(email))return;email=email.toLowerCase();
    let a=accounts.find(a=>a.email===email)||sanitizeAccount({email});
    if(end){a.success=true;a.collectedPoints=Number(end[2]);a.initialPoints=Number(end[3]);a.finalPoints=Number(end[4]);a.durationSeconds=Number(end[5]);}
    else if(event.kind==='account-end'&&numeric(event.gained)!=null){a.success=true;a.collectedPoints=event.gained;a.initialPoints=numeric(event.oldPoints);a.finalPoints=numeric(event.newPoints);a.durationSeconds=numeric(event.durationSec);}
    else if(event.kind==='account-error'){if(a.success!==true)a.success=false;a.errorKind=errorKind(event.error||error?.[2]||msg);}
    if(source){m=/(?:^| \| )pointsGained=(-?\d+(?:\.\d+)?)(?= \| |$)/.exec(msg);if(m&&Number(m[1])>0)a.bySource[source]=(a.bySource[source]||0)+Number(m[1]);}
    if(search)a.searchSummary={mobile:Number(search[1]),desktop:Number(search[2]),bonus:Number(search[3])};
    if(partial){const num=v=>v==='unknown'?null:Number(v);a.success=false;a.partial=true;a.collectedPoints=num(partial[2]);a.initialPoints=num(partial[3]);a.finalPoints=num(partial[4]);a.durationSeconds=Number(partial[5]);}
    if(quota)a.mobileQuotaKnown=quota[1]==='known';
    a=sanitizeAccount(a);this.write.run(runId,email,JSON.stringify(a));
  }
  forRun(row){
    if(!row)return [];
    const stored=this.accounts(row.id);if(stored.length)return stored;
    // Backfill only a genuine app run whose exact RUN-START still exists.
    // Missing/pruned history is never replaced with today's account values.
    if(!row.startTs||!row.endTs||!this.db.prepare("SELECT 1 FROM activity WHERE kind='run-start' AND ts=?").get(row.startTs))return [];
    const events=this.db.prepare('SELECT ts,kind,title,email,user_name AS userName,message FROM activity WHERE ts>=? AND ts<=? ORDER BY ts,id').all(row.startTs,row.endTs);
    for(const event of events)this.record(row.id,event);
    return this.accounts(row.id);
  }
}
module.exports={SOURCES,sanitizeAccount,accountLines,NotificationDetails,validEmail};
