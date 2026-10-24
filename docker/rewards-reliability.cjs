'use strict';
// Read-only Rewards requests and accounting; never retries a point-claim/search mutation.
const finite = n => typeof n === 'number' && Number.isFinite(n);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function quota(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.some(r => !finite(r?.pointProgressMax) || !finite(r?.pointProgress) || r.pointProgressMax < 0 || r.pointProgress < 0))
    return {earned:0,max:0,remaining:0,known:false};
  return rows.reduce((q,r) => {
    q.max += r.pointProgressMax; q.earned += Math.min(r.pointProgress,r.pointProgressMax);
    q.remaining = q.max-q.earned; return q;
  }, {earned:0,max:0,remaining:0,known:true});
}
function statusOf(error) { return error?.status ?? error?.response?.status; }
async function readWithRetry(read, {wait=sleep, attempts=3, onRetry=()=>{}}={}) {
  for(let attempt=1;attempt<=attempts;attempt++) {
    try { return await read(); } catch(error) {
      const status=statusOf(error);
      if(attempt===attempts || (status>=400 && status<500 && ![408,425,429].includes(status))) throw error;
      const retryAfter=Number(error?.response?.headers?.['retry-after']);
      // A long server cooldown ends this lookup instead of sending too early.
      if(status===429 && (!Number.isFinite(retryAfter) || retryAfter>30))throw error;
      const delay=Math.max(1000*2**(attempt-1), Number.isFinite(retryAfter)?retryAfter*1000:0);
      onRetry(attempt,delay,status); await wait(delay);
    }
  }
}
function resetAccount(bot) {
  bot.__rewardsInitial=null; bot.__rewardsIncomplete=false;
  bot.userData.initialPoints=0; bot.userData.currentPoints=0; bot.userData.gainedPoints=0;
}
function beginAccount(bot, balance) { bot.__rewardsInitial=finite(balance)?balance:null; }
function partialStats(bot) {
  const initial=bot.__rewardsInitial, current=bot.userData.currentPoints;
  const known=finite(initial)&&finite(current);
  return {initialPoints:known?initial:0,finalPoints:known?current:0,collectedPoints:known?current-initial:0,balanceKnown:known};
}
function logPartial(bot,email,duration) {
  const s=partialStats(bot),v=n=>s.balanceKnown?n:'unknown';
  bot.logger.warn('main','ACCOUNT-PARTIAL',`Partial account: ${email} | pointsGained=${v(s.collectedPoints)} | previousBalance=${v(s.initialPoints)} | currentBalance=${v(s.finalPoints)} | durationSeconds=${duration}`);
}
function installBrowser(BrowserFunc, {URLs,mapFlyoutToDashboard,detectFlyoutBotWarning}, options={}) {
  const originalCurrent=BrowserFunc.prototype.getCurrentPoints;
  if(originalCurrent)BrowserFunc.prototype.getCurrentPoints=async function(...args){const balance=await originalCurrent.apply(this,args);if(finite(this.bot.__rewardsInitial)&&finite(balance))this.bot.userData.currentPoints=balance;return balance;};
  const originalEarnable=BrowserFunc.prototype.getBrowserEarnablePoints;
  BrowserFunc.prototype.getBrowserEarnablePoints=async function(data) {
    data ??= await this.getDashboardData();
    const result=await originalEarnable.call(this,data);
    if(!quota(data.dashboard.userStatus.counters.mobileSearch).known)result.mobileSearchPoints=null;
    return result;
  };
  BrowserFunc.prototype.getDashboardData=async function(cookies) {
    const bot=this.bot, headers={...(bot.fingerprint?.headers??{})};
    for(const key of Object.keys(headers))if(key.toLowerCase()==='cookie')delete headers[key];
    const key=(bot.currentAccountEmail??bot.userData.userName)+':'+bot.isMobile;
    this.__rewardsSources??=new Map();
    const cached=this.__rewardsSources.get(key),now=Date.now();
    const retry=read=>readWithRetry(read,{...options,onRetry:(attempt,delay,status)=>bot.logger.warn(bot.isMobile,'REWARDS-READ-RETRY',`Retrying Rewards read | attempt=${attempt+1}/3 | delayMs=${delay} | status=${status??'response/network'}`)});
    const request=async(url,referer)=>{
      const response=await bot.http.request({url,method:'GET',headers:{...headers,Accept:'application/json',Cookie:this.buildCookieHeader(this.getCachedCookies(cookies,url)),Referer:referer,Origin:new URL(url).origin},retries:0});
      await this.applyResponseCookies(url,response.headers['set-cookie']); return response.data;
    };
    let primaryError;
    if(!cached || now-cached>5*60*1000) {
      try {
        const data=await retry(async()=>{
          const data=await request(URLs.rewards.userInfoApi,URLs.rewards.referer);
          if(!finite(data?.dashboard?.userStatus?.availablePoints)||!data.dashboard.userStatus.counters)throw Error('Primary dashboard data missing');
          return data;
        });
        this.__rewardsSources.delete(key);
        this.__rewardsSource='primary';return data;
      } catch(error) {
        primaryError=error;this.__rewardsSources.set(key,now);
        bot.logger.warn(bot.isMobile,'GET-DASHBOARD-DATA',`Primary dashboard unavailable; using Bing flyout fallback | status=${statusOf(error)??'response/network'}`);
      }
    }
    try {
      const result=await retry(async()=>{
        const raw=await request(URLs.bing.rewardsFlyoutUserInfo,URLs.bing.origin+'/');
        const data=mapFlyoutToDashboard(raw);
        const rawBalance=raw.flyoutResult?.userStatus?.availablePoints??raw.userInfo?.balance;
        if(!finite(rawBalance))throw Error('Flyout balance missing');
        const mobile=quota(raw.flyoutResult?.userStatus?.counters?.MobileSearch??raw.flyoutResult?.userStatus?.counters?.mobileSearch);
        const detection=detectFlyoutBotWarning(raw);
        // Missing fields remain unknown; an explicit zero quota remains a known zero.
        if(!mobile.known)delete data.dashboard.userStatus.counters.mobileSearch;
        data.dashboard.userStatus.availablePoints=rawBalance;
        bot.logger.warn(bot.isMobile,'GET-DASHBOARD-DATA',`Using partial Bing flyout dashboard | mobileQuota=${mobile.known?'known':'unknown'} | suspectedLimited=${detection.likelyLimited} | botMarkers=${detection.hasBotProfileMarkers} | activitiesCollapsed=${detection.hasCollapsedActivities}`);
        return data;
      });
      this.__rewardsSource='flyout';return result;
    } catch(error) {
      // A fallback may fail after the primary API recovered. Probe the primary once more.
      try {
        const data=await retry(async()=>{
          const d=await request(URLs.rewards.userInfoApi,URLs.rewards.referer);
          if(!finite(d?.dashboard?.userStatus?.availablePoints)||!d.dashboard.userStatus.counters)throw Error('Primary dashboard data missing');return d;
        });
        this.__rewardsSources.delete(key);this.__rewardsSource='primary';return data;
      }catch{}
      bot.__rewardsIncomplete=true;
      bot.logger.error(bot.isMobile,'GET-DASHBOARD-DATA','Primary dashboard and Bing flyout fallback failed after bounded read retries');
      throw error??primaryError;
    }
  };
}
module.exports={quota,readWithRetry,resetAccount,beginAccount,partialStats,logPartial,installBrowser};
