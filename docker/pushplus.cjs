'use strict';
// Dashboard-side notifications: independent of script log webhooks and config writes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {sanitizeAccount,accountLines,validEmail}=require('./notification-details.cjs');
const ENDPOINT = 'https://www.pushplus.plus/send';
const DEFAULTS = {enabled:false, notifySuccess:true, notifyFailure:true, token:'',deliveryMode:'summary',routes:[]};
function publicError(message, status=400) { return Object.assign(new Error(message), {status, public:true}); }
function atomicWrite(file, value) {
  const tmp = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2)+'\n', {mode:0o600, flag:'wx'});
    fs.renameSync(tmp, file);
  } finally { try { fs.unlinkSync(tmp); } catch {} }
}
function number(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function maskEmail(value) {
  const match = String(value || '').match(/^([^@\s]+)@([a-z0-9.-]+)$/i);
  return match ? match[1][0]+'***@'+match[2] : '账号';
}
// Never forward raw errors: they may contain URLs, credentials or verification codes.
function failureReason(account) {
  const error = String(account?.error || '');
  if (/captcha|verification|mfa|login|auth|sign.?in|验证|登录/i.test(error)) return '登录或验证异常，请在面板处理';
  if (/timeout|timed out|超时/i.test(error)) return '执行超时';
  return account?.success === false ? '执行失败，请在面板查看详情' : '未完成';
}
function summarize(status) {
  const run = status.run || {}, totals = run.totals || {};
  const accounts = Array.isArray(run.accounts) ? run.accounts : [];
  const success = accounts.filter(a=>a.success === true).length;
  const failed = accounts.filter(a=>a.success === false).length;
  const count = Math.max(number(run.accountsTotal)||0, number(totals.accountsProcessed)||0, accounts.length);
  const unknown = Math.max(0, count-success-failed);
  const stopped = ['stopped','cancelled'].includes(run.status) || ['SIGINT','SIGTERM','SIGKILL','SIGHUP'].includes(status.lastExit?.signal) || [130,137,143].includes(status.lastExit?.code);
  const failure = Boolean(status.lastExit?.error || status.lastExit?.signal || (status.lastExit?.code != null && status.lastExit.code !== 0) || ['failed','partial','interrupted'].includes(run.status) || failed || unknown || !run.finished || !run.totals || !count);
  const title = stopped ? 'Rewards 任务已停止' : failure ? 'Rewards 任务异常汇总' : 'Rewards 任务完成';
  const gained = number(totals.collected) ?? number(run.collected);
  const balance = number(totals.newTotal);
  const minutes = number(totals.runtimeMinutes);
  const lines = [title, `账号：${success} 个成功，${failed} 个失败，${unknown} 个未完成`,
    `本次新增：${gained == null ? '未知' : gained+' 积分'}`,
    `${failure ? '已统计账号总积分' : '当前总积分'}：${balance == null ? '未知（未取得完整汇总）' : balance+' 积分'}`];
  if (failure && balance != null) lines.push('异常或未完成账号的积分可能未计入。');
  if (minutes != null) lines.push(`耗时：${minutes} 分钟`);
  if (stopped) lines.push('任务已停止，以下为已取得的结果。');
  else if (failure && !failed && !unknown) lines.push('任务未正常结束，请在面板查看详情。');
  for (const a of accounts.slice(0,30)) {
    lines.push('',...accountLines(a));
  }
  if (accounts.length > 30) lines.push('其余账号请在面板查看。');
  // run/exit timestamps are structured ISO dates, never arbitrary log content.
  if (Number.isFinite(Date.parse(status.lastExit?.at))) lines.push('结束时间：'+new Date(status.lastExit.at).toISOString());
  return {title, content:lines.join('\n'), failure:failure || stopped};
}
function summarizeHistory(row,accounts=[]) {
  if (!row) throw publicError('找不到这条运行记录。',404);
  if (row.status === 'running' || !Number.isFinite(Date.parse(row.endTs))) throw publicError('只能发送已结束的运行记录。',409);
  const labels={done:'已完成',success:'已完成',partial:'部分完成',error:'失败',failed:'失败',stopped:'已停止',cancelled:'已取消',interrupted:'已中断'};
  const status=labels[row.status] || '已结束';
  const date=value=>Number.isFinite(Date.parse(value))?new Date(value).toISOString():'未记录';
  const points=value=>number(value)==null?'未记录':value+' 积分';
  const runtime=number(row.runtimeMin) ?? (Number.isFinite(Date.parse(row.startTs))?Math.max(0,(Date.parse(row.endTs)-Date.parse(row.startTs))/60000):null);
  const lines=['手动发送的已结束运行记录',`状态：${status}`,`开始时间：${date(row.startTs)}`,`结束时间：${date(row.endTs)}`,
    `已处理账号：${number(row.accountsProcessed) ?? '未记录'}${number(row.totalAccounts)==null?'':' / '+row.totalAccounts}`,
    `本次新增：${points(row.totalGained)}`,`已统计账号总积分：${points(row.newTotal)}`];
  if(runtime!=null)lines.push(`耗时：${Math.round(runtime*10)/10} 分钟`);
  if(!['done','success'].includes(row.status))lines.push('本轮未全部完成，积分可能只包含部分账号。');
  for(const account of accounts.slice(0,30))lines.push('',...accountLines(account));
  lines.push(accounts.length?'以上为该轮已保存的账号明细，缺失的来源不会推测补齐。':'内容来自该轮已保存的运行汇总；不包含原始日志或未保存的账号明细。');
  return {title:'Rewards 运行记录：'+status, content:lines.join('\n')};
}
function accountMessage(account,endedAt,manual=false){
  const a=sanitizeAccount(account),failed=a?.success!==true;
  const title=manual?'Rewards 账号历史明细':failed?'Rewards 账号异常提醒':'Rewards 账号积分明细';
  const lines=[title,...accountLines(a)];
  if(Number.isFinite(Date.parse(endedAt)))lines.push('结束时间：'+new Date(endedAt).toISOString());
  return {title,content:lines.join('\n'),failure:failed};
}
class PushPlus {
  constructor({file, fetchImpl=globalThis.fetch, now=Date.now, delay=ms=>new Promise(r=>setTimeout(r,ms)), log=()=>{}}) {
    this.file=file; this.fetch=fetchImpl; this.now=now; this.delay=delay; this.log=log;
    this.started=now(); this.busy=false; this.testing=false; this.lastTest=-Infinity; this.testTimes=new Map(); this.jobs=new Set();
    this.state={config:{...DEFAULTS}, seen:[], lastResult:null, lastManualAt:null};
    try {
      const stat=fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size>131072) throw Error('invalid');
      const saved=JSON.parse(fs.readFileSync(file,'utf8'));
      this.state={config:this.validate(saved.config, DEFAULTS), seen:Array.isArray(saved.seen)?saved.seen.filter(s=>typeof s==='string').slice(-100):[], lastResult:saved.lastResult||null, lastManualAt:number(saved.lastManualAt)};
    } catch (error) { if (error.code !== 'ENOENT') throw Error('PushPlus 配置无法读取，请检查数据文件。'); }
    this.registerConfig(this.state.config);
  }
  register(token) { globalThis[Symbol.for('rewards-stack.register-secret')]?.(token); }
  registerConfig(config){this.register(config.token);for(const route of config.routes)this.register(route.friendToken);}
  validate(input, previous=this.state.config) {
    if (!input || Array.isArray(input) || typeof input!=='object' || Object.keys(input).some(k=>!['enabled','notifySuccess','notifyFailure','token','clearToken','deliveryMode','routes'].includes(k))) throw publicError('通知配置格式无效。');
    const config={...previous};
    for (const key of ['enabled','notifySuccess','notifyFailure']) if (Object.hasOwn(input,key)) {
      if (typeof input[key]!=='boolean') throw publicError('通知开关格式无效。');
      config[key]=input[key];
    }
    if (Object.hasOwn(input,'clearToken') && typeof input.clearToken!=='boolean') throw publicError('清除令牌选项无效。');
    if (Object.hasOwn(input,'token')) {
      if (typeof input.token!=='string' || (input.token && !/^[a-z0-9_-]{16,256}$/i.test(input.token))) throw publicError('Token 格式无效，请复制 PushPlus 的用户或消息 Token。');
      if (input.token) config.token=input.token;
    }
    if (input.clearToken) config.token='';
    if(Object.hasOwn(input,'deliveryMode')){
      if(!['summary','accounts'].includes(input.deliveryMode))throw publicError('请选择汇总或按账号分发。');config.deliveryMode=input.deliveryMode;
    }
    if(Object.hasOwn(input,'routes')){
      if(!Array.isArray(input.routes)||input.routes.length>50)throw publicError('账号收件配置无效。');
      const emails=new Set();
      config.routes=input.routes.map(route=>{
        if(!route||Array.isArray(route)||typeof route!=='object'||Object.keys(route).some(k=>!['email','target','friendToken','clearFriendToken'].includes(k))||!validEmail(route.email)||!['off','self','friend'].includes(route.target))throw publicError('账号收件配置格式无效。');
        const email=route.email.toLowerCase();if(emails.has(email))throw publicError('同一个账号只能配置一个接收人。');emails.add(email);
        const previousRoute=previous.routes.find(r=>r.email===email);
        let friendToken=previousRoute?.friendToken||'';
        if(Object.hasOwn(route,'friendToken')){
          if(typeof route.friendToken!=='string'||(route.friendToken&&!/^[a-z0-9]{32}$/i.test(route.friendToken)))throw publicError('好友令牌应为 32 位字母或数字，不能填写多个接收人。');
          if(route.friendToken)friendToken=route.friendToken;
        }
        if(Object.hasOwn(route,'clearFriendToken')&&typeof route.clearFriendToken!=='boolean')throw publicError('清除好友令牌选项无效。');
        if(route.clearFriendToken)friendToken='';
        if(route.target==='friend'&&!friendToken)throw publicError('请先填写该账号接收人的好友令牌。');
        return {email,target:route.target,friendToken};
      });
    }
    if (config.enabled && !config.token) throw publicError('请先填写 PushPlus Token，再启用通知。');
    if(config.enabled&&config.deliveryMode==='accounts'&&!config.routes.some(r=>r.target!=='off'))throw publicError('按账号分发时请至少绑定一个接收人。');
    return config;
  }
  persist(next) { atomicWrite(this.file,next); this.state=next; }
  view() {
    const {token,routes,...config}=this.state.config;
    return {...config,routes:routes.map(({email,target,friendToken})=>({email,target,friendTokenConfigured:Boolean(friendToken)})), tokenConfigured:Boolean(token), lastResult:this.state.lastResult};
  }
  save(input) {
    if (this.busy || this.testing) throw publicError('通知正在发送，请稍后保存。',409);
    const config=this.validate(input);
    this.persist({...this.state,config}); this.registerConfig(config);
    return this.view();
  }
  async send(message, config) {
    if (!config.token) throw publicError('请先保存 PushPlus Token。');
    for (let attempt=0;attempt<2;attempt++) {
      let response, data;
      try {
        response=await this.fetch(ENDPOINT, {method:'POST', redirect:'error', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({token:config.token, title:message.title, content:message.content, template:'txt', channel:'wechat',...(config.target==='friend'?{to:config.friendToken}:{})}), signal:AbortSignal.timeout(10000)});
        // Retry only an explicit temporary HTTP rejection, never an ambiguous timeout.
        if ([429,502,503,504].includes(response.status) && attempt===0) { await response.body?.cancel(); await this.delay(1500); continue; }
        data=await response.json();
      } catch { throw publicError('PushPlus 连接失败或超时，请检查网络及手机是否已收到，避免重复发送。',502); }
      if (!response.ok) throw publicError(`PushPlus 服务暂不可用（HTTP ${response.status}）。`,502);
      if (data?.code!==200) {
        const code=Number.isSafeInteger(data?.code)?data.code:'未知';
        throw publicError(`PushPlus 未受理通知（代码 ${code}），请检查 Token、实名状态和发送额度。`,502);
      }
      return {accepted:true, message:'PushPlus 已受理，请在手机微信确认收到通知。'};
    }
  }
  record(ok, kind,counts) {
    const lastResult={ok,kind,at:new Date(this.now()).toISOString(),message:ok?'PushPlus 已受理，请在手机确认。':'通知未成功提交，请检查网络、Token 或额度。',...(counts||{})};
    if(counts)lastResult.message=`已受理 ${counts.acceptedCount}/${counts.totalCount} 个接收人的通知。`+(counts.failedCount?'请检查未成功的接收人绑定或额度。':'请在手机确认。');
    this.persist({...this.state,lastResult});
  }
  async test(email) {
    if (!this.state.config.token) throw publicError('请先保存 PushPlus Token。');
    const route=email?this.state.config.routes.find(r=>r.email===email.toLowerCase()&&r.target!=='off'):null;
    if(email&&!route)throw publicError('该账号尚未绑定接收人。');
    if(this.busy)throw publicError('通知正在发送，请稍后再试。',409);
    const key=route?.target==='friend'?'friend:'+route.friendToken:'self';
    if (this.testing || this.now()-(this.testTimes.get(key)??-Infinity)<30000) throw publicError('每个接收人的测试通知每 30 秒最多发送一次，请稍后重试。',429);
    this.testing=true; this.lastTest=this.now();this.testTimes.set(key,this.now());
    try {
      const result=await this.send({title:'Rewards 微信推送测试',content:'这是一条来自 Microsoft Rewards 管理面板的测试通知。\n'+(route?'账号：'+maskEmail(route.email)+'\n':'')+'收到此消息说明微信推送渠道可用。'},{...this.state.config,...(route||{})});
      this.record(true,'test'); return result;
    } catch (error) { this.record(false,'test'); throw error; }
    finally { this.testing=false; }
  }
  plans(accounts,config,{endedAt,manual=false}={}){
    const safe=(accounts||[]).map(sanitizeAccount).filter(Boolean),plans=[];
    for(const route of config.routes){
      if(route.target==='off')continue;
      const a=safe.find(a=>a.email===route.email);if(!a)continue;
      const message=accountMessage(a,endedAt,manual);
      if(!manual&&!(message.failure?config.notifyFailure:config.notifySuccess))continue;
      plans.push({message,config:{token:config.token,target:route.target,friendToken:route.friendToken}});
    }
    return plans;
  }
  async dispatch(plans,kind){
    let acceptedCount=0;let firstError;
    for(let i=0;i<plans.length;i++){
      if(i)await this.delay(1200);
      try{await this.send(plans[i].message,plans[i].config);acceptedCount++;}catch(error){firstError||=error;}
    }
    const counts={acceptedCount,totalCount:plans.length,failedCount:plans.length-acceptedCount};
    this.record(acceptedCount===plans.length,kind,counts);
    if(acceptedCount!==plans.length)throw publicError(`已受理 ${acceptedCount}/${plans.length} 个接收人的通知。${firstError?.message||'请检查绑定和发送额度。'}`,502);
    return {accepted:true,...counts,message:plans.length===1?'PushPlus 已受理，请在手机微信确认收到通知。':`PushPlus 已受理 ${plans.length} 个接收人的通知，请分别在微信确认。`};
  }
  async sendHistory(row,accounts=[]) {
    const message=summarizeHistory(row,accounts);
    if(!this.state.config.token)throw publicError('请先在配置页保存 PushPlus Token。');
    if(this.testing || this.busy)throw publicError('通知正在发送，请稍后再试。',409);
    if(this.state.lastManualAt!=null && this.now()-this.state.lastManualAt<30000)throw publicError('手动发送每 30 秒最多一次，请稍后再试。',429);
    const config=structuredClone(this.state.config);
    const plans=config.deliveryMode==='accounts'?this.plans(accounts,config,{endedAt:row.endTs,manual:true}):[{message,config}];
    if(!plans.length)throw publicError('该历史记录没有可分发的账号明细，或没有匹配的接收人。',409);
    // Checkpoint before the request, including ambiguous timeouts; survives Dashboard restarts.
    this.persist({...this.state,lastManualAt:this.now()});
    this.testing=true;
    try {return await this.dispatch(plans,'manual');}
    finally {this.testing=false;}
  }
  observe(status) {
    // Wait for the actual process exit: RUN-END alone cannot establish a clean exit.
    const at=status?.lastExit?.at;
    if (!status || status.state!=='idle' || !at || !Number.isFinite(Date.parse(at)) || this.state.seen.includes(at)) return;
    const message=summarize(status), config=structuredClone(this.state.config);
    // Persist before enqueueing: SSE replay, polling and restarts must not repeat a run.
    this.persist({...this.state,seen:[...this.state.seen,at].slice(-100)});
    if (Date.parse(at)<this.started || !config.enabled) return;
    const plans=config.deliveryMode==='accounts'?this.plans(status.run?.accounts,config,{endedAt:at}):((message.failure?config.notifyFailure:config.notifySuccess)?[{message,config}]:[]);
    if(!plans.length)return;
    const job=(async()=>{
      this.busy=true;
      try { await this.dispatch(plans,'run'); }
      catch { this.log('warn','PushPlus 通知未成功提交，请检查通知设置。'); }
      finally { this.jobs.delete(job); this.busy=this.jobs.size>0; }
    })();
    this.jobs.add(job);
  }
  async drain() { await Promise.allSettled([...this.jobs]); }
}
module.exports={PushPlus,summarize,maskEmail,summarizeHistory};
