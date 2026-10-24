import fs from 'node:fs';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
export const runtimePath='/stack/rewards-reliability.cjs';
function replace(s,a,b){if(s.split(a).length!==2)throw Error('Rewards reliability anchor mismatch: '+a.slice(0,90));return s.replace(a,()=>b);}
export function patchRewardsFile(name,s,modulePath=runtimePath){
  s=s.replace(/\r\n/g,'\n');
  if(name==='browser/BrowserFunc.js')return replace(s,'exports.default = BrowserFunc;',`require(${JSON.stringify(modulePath)}).installBrowser(BrowserFunc, {URLs:urls_1.URLs,...FlyoutDashboard_1});\nexports.default = BrowserFunc;`);
  if(name==='functions/activities/search/SearchProgress.js') {
    return replace(s,'    summarize(counters) {',`    summarize(counters) {\n        return require(${JSON.stringify(modulePath)}).quota(counters);\n    }\n    legacySummarize(counters) {`);
  }
  if(name==='functions/activities/search/SearchManager.js') {
    s=replace(s,'const doMobile = this.bot.config.workers.doMobileSearch && mobileMissing > 0;','const doMobile = this.bot.config.workers.doMobileSearch && quotas.mobile.known && mobileMissing > 0;');
    s=replace(s,'    describeQuota(enabled, quota) {','    describeQuota(enabled, quota) {\n        if (quota.known === false) return "skip (unknown quota; lookup incomplete)";');
    s=replace(s,'        return quotas.reduce((total, quota) => ({','        return quotas.reduce((total, quota) => ({\n            known: Boolean(total.known || quota.known),');
    // Preserve the established numeric summary while describing the missing quota explicitly.
    s=replace(s,'        return { doMobile, doDesktop, mobileMissing, desktopMissing };','        this.bot.logger.info("main", "SEARCH-QUOTA", `Mobile: ${quotas.mobile.known ? "known" : "unknown"} | Desktop: ${quotas.desktop.known ? "known" : "unknown"}`);\n        return { doMobile, doDesktop, mobileMissing, desktopMissing };');
    return s;
  }
  if(name==='index.js') {
    s=`const rewardsReliability = require(${JSON.stringify(modulePath)});\n`+s;
    s=replace(s,'            const accountEmail = account.email;','            const accountEmail = account.email;\n            rewardsReliability.resetAccount(this);');
    s=replace(s,'                this.userData.initialPoints = data.dashboard.userStatus.availablePoints;','                this.userData.initialPoints = data.dashboard.userStatus.availablePoints;\n                rewardsReliability.beginAccount(this, this.userData.initialPoints);');
    s=replace(s,'${browserEarnable.mobileSearchPoints}',"${browserEarnable.mobileSearchPoints ?? 'unknown'}");
    s=replace(s,'                if (result) {',`                if (result && this.__rewardsIncomplete) {
                    rewardsReliability.logPartial(this,accountEmail,durationSeconds);
                    accountStats.push({email:accountEmail,...rewardsReliability.partialStats(this),duration:parseFloat(durationSeconds),success:false,error:'Rewards data lookup failed; last confirmed balance retained'});
                    continue;
                }
                if (result) {`);
    s=replace(s,"                else {\n                    accountStats.push({\n                        email: accountEmail,\n                        initialPoints: 0,\n                        finalPoints: 0,\n                        collectedPoints: 0,",`                else {
                    rewardsReliability.logPartial(this,accountEmail,durationSeconds);
                    accountStats.push({
                        email: accountEmail,
                        ...rewardsReliability.partialStats(this),`);
    s=replace(s,'                accountStats.push({\n                    email: accountEmail,\n                    initialPoints: 0,\n                    finalPoints: 0,\n                    collectedPoints: 0,',`                rewardsReliability.logPartial(this,accountEmail,durationSeconds);
                accountStats.push({
                    email: accountEmail,
                    ...rewardsReliability.partialStats(this),`);
    return s;
  }
  throw Error('Unsupported reliability target: '+name);
}
export function patchControlParser(s){
  s=s.replace(/\r\n/g,'\n');
  s=replace(s,'Mobile: (\\d+) \\| Browser:', 'Mobile: (\\d+|unknown) \\| Browser:');
  s=replace(s,'mobile: Number(m[1]), browser:','mobile: m[1] === "unknown" ? null : Number(m[1]), browser:');
  s=replace(s,"        case 'SEARCH-MANAGER':",`        case 'SEARCH-QUOTA': {
            const q=/^Mobile: (known|unknown) \\|/.exec(msg),acc=ensureAccount(state,accountEmailForEntry(state,entry));
            if(q&&acc)acc.mobileQuotaKnown=q[1]==='known';
            break;
        }
        case 'SEARCH-MANAGER':`);
  s=replace(s,"        case 'ACCOUNT-END':",`        case 'ACCOUNT-PARTIAL': {
            const p=/^Partial account: (\\S+) \\| pointsGained=(-?\\d+|unknown) \\| previousBalance=(\\d+|unknown) \\| currentBalance=(\\d+|unknown) \\| durationSeconds=([\\d.]+)/.exec(msg);
            if(!p)break;
            const acc=ensureAccount(state,p[1]),num=v=>v==='unknown'?null:Number(v);
            acc.success=false;acc.partial=true;acc.error ||= 'Partial failure; last confirmed balance retained';
            acc.collectedPoints=num(p[2]);acc.initialPoints=num(p[3]);acc.finalPoints=num(p[4]);acc.durationSeconds=Number(p[5]);
            if(acc.finalPoints!=null){acc.live.balance=acc.finalPoints;acc.live.gained=acc.collectedPoints;}
            return 'account-partial';
        }
        case 'ACCOUNT-END':`);
  return s;
}
export function patchDashboardParser(s){
  s=s.replace(/\r\n/g,'\n');
  return replace(s,'    case "ACCOUNT-END": {',`    case "ACCOUNT-PARTIAL": {
      const p=/^Partial account: (\\S+) \\| pointsGained=(-?\\d+|unknown) \\| previousBalance=(\\d+|unknown) \\| currentBalance=(\\d+|unknown) \\| durationSeconds=([\\d.]+)/.exec(message);
      if(p){const n=v=>v==='unknown'?null:Number(v);return {...base,kind:'account-partial',email:p[1],gained:n(p[2]),oldPoints:n(p[3]),newPoints:n(p[4]),durationSec:Number(p[5])};}
      break;
    }
    case "ACCOUNT-END": {`);
}
export function patchDashboardStore(s){
  s=s.replace(/\r\n/g,'\n');
  s=replace(s,"WHERE title IN ('ACCOUNT-END', 'ACCOUNT-ERROR')","WHERE title IN ('ACCOUNT-END', 'ACCOUNT-ERROR', 'ACCOUNT-PARTIAL')");
  s=replace(s,'          this.stmts.closeRunFull.run(\n            "done",',`          this.stmts.closeRunFull.run(
            this.db.prepare("SELECT 1 FROM activity WHERE title='ACCOUNT-PARTIAL' AND ts>=? AND ts<=? LIMIT 1").get(running.startTs,event.ts) ? "partial" : "done",`);
  return replace(s,'      case "account-end": {',`      case "account-partial": {
        const previous=this.db.prepare('SELECT last_error FROM accounts WHERE email=?').get(event.email);
        if(event.newPoints!=null){
          this.stmts.upsertAccountEnd.run(event.email,event.userName||null,event.ts,event.gained,event.newPoints,event.durationSec);
          this.stmts.insertHistory.run(event.email,event.ts,event.newPoints,event.gained,event.durationSec);
        }
        this.stmts.upsertAccountError.run(event.email,event.ts,previous?.last_error||'任务未完成，保留最后确认积分');
        this._pushActivity(event);this._scheduleAutoCloseCheck();break;
      }
      case "account-end": {`);
}
export const targets=['browser/BrowserFunc.js','functions/activities/search/SearchProgress.js','functions/activities/search/SearchManager.js','index.js'];
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const role=process.argv[2],root=role==='script'?'/usr/src/microsoft-rewards-script':'/usr/src/rewards-dashboard';
  if(role==='script'){
    // Fail closed if the pinned upstream changes; hashes generated from the locked image.
    const lock=JSON.parse(fs.readFileSync('/stack/rewards-reliability-lock.json','utf8'));
    for(const name of targets){const file=root+'/dist/'+name,s=fs.readFileSync(file,'utf8');if(crypto.createHash('sha256').update(s).digest('hex')!==lock[name])throw Error('Pinned script mismatch: '+name);fs.writeFileSync(file,patchRewardsFile(name,s));}
    const file=root+'/scripts/api/logParser.js';fs.writeFileSync(file,patchControlParser(fs.readFileSync(file,'utf8')));
  }else if(role==='dashboard'){
    for(const [name,patch]of [['parser',patchDashboardParser],['store',patchDashboardStore]]){const file=root+'/lib/'+name+'.js';fs.writeFileSync(file,patch(fs.readFileSync(file,'utf8')));}
  }else throw Error('Expected script or dashboard');
  console.log('PASS: Rewards quota, bounded read retry and partial accounting installed for '+role);
}
