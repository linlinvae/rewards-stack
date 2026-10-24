const sources={search:'Bing 搜索',bonus:'搜索奖励',read:'阅读文章',checkIn:'每日签到',claimBonus:'领取奖励积分',claimReward:'领取任务奖励',urlReward:'网页任务',visualSearch:'图片搜索',appReward:'App 任务',punchcard:'打卡任务',searchOnBing:'搜索活动'};
export async function showNotificationDetails(root,runId){
  root.querySelector('dialog[data-notification-details]')?.remove();
  const dialog=document.createElement('dialog');dialog.dataset.notificationDetails='';dialog.style.cssText='width:min(640px,90vw);max-height:85vh;overflow:auto;border-radius:12px;padding:20px';
  const heading=document.createElement('h2');heading.textContent='积分通知明细';
  const content=document.createElement('div'),close=document.createElement('button');close.type='button';close.className='btn';close.textContent='关闭明细';close.addEventListener('click',()=>dialog.close());
  dialog.append(heading,content,close);root.append(dialog);dialog.showModal();content.textContent='正在读取该轮明细…';
  try{
    const r=await fetch('/api/notifications/pushplus/run-details?runId='+encodeURIComponent(runId),{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000)});
    const data=await r.json();if(!r.ok)throw Error(data.error||'读取失败。');content.replaceChildren();
    const notice=document.createElement('p');notice.className='hint';notice.textContent=data.sourceNotice;content.append(notice);
    if(!data.accounts.length){const p=document.createElement('p');p.textContent='这条历史记录未保存账号明细，仍可发送原有汇总。';content.append(p);}
    const n=value=>value==null?'未记录':String(value);
    for(const account of data.accounts){
      const section=document.createElement('section');section.style.cssText='border-top:1px solid #ccd2d8;margin:12px 0;padding-top:8px';
      const title=document.createElement('h3');title.textContent=account.email;title.style.overflowWrap='anywhere';section.append(title);
      const state=account.success===true?'已完成':account.errorKind==='login'?'登录或验证异常':account.errorKind==='timeout'?'执行超时':account.success===false?'执行失败':'未完成';
      const lines=[`状态：${state}`,`本次新增：${n(account.collectedPoints)} 积分`,`余额变化：${n(account.initialPoints)} → ${n(account.finalPoints)} 积分`,`耗时：${n(account.durationSeconds)} 秒`];
      if(account.partial)lines.push('积分为最后确认值；任务未全部完成。');
      if(account.mobileQuotaKnown===false)lines.push('手机搜索额度：未知（接口未提供有效额度，未执行手机搜索）');
      const entries=Object.entries(account.bySource||{}).filter(([key])=>sources[key]);
      if(entries.length)lines.push('积分来源（已识别部分）：',...entries.map(([key,value])=>`${sources[key]}：${value} 积分`));
      if(account.searchSummary)lines.push(`搜索明细：电脑 ${n(account.searchSummary.desktop)}，手机 ${account.mobileQuotaKnown===false?'未执行（额度未知）':n(account.searchSummary.mobile)}，奖励 ${n(account.searchSummary.bonus)} 积分`);
      if(!entries.length&&!account.searchSummary)lines.push('积分来源明细：未记录');
      for(const line of lines){const p=document.createElement('p');p.textContent=line;section.append(p);}content.append(section);
    }
  }catch(error){content.textContent='读取积分明细失败：'+error.message;}
}
