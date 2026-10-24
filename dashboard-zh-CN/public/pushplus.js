// Separate from the script config editor: notifications apply immediately.
const instances=new WeakMap();
export async function refreshPushPlus(root){await instances.get(root)?.reload();}
export function mountPushPlus(root) {
  const section=document.createElement('section');
  section.className='panel';section.setAttribute('aria-labelledby','pushplusHeading');
  section.innerHTML=`<div class="panel-head"><h2 id="pushplusHeading">PushPlus 微信推送</h2><span class="panel-sub">保存后立即生效</span></div>
    <p class="hint">每轮结束后发送积分明细。可汇总到当前微信，或为每个账号绑定不同接收人。其他微信需先扫码添加为 PushPlus 好友，再填写对应好友令牌。</p>
    <form autocomplete="off" data-pushplus-form>
      <p><label class="check"><input type="checkbox" name="enabled" disabled>启用微信推送</label></p>
      <p><label class="check"><input type="checkbox" name="notifySuccess" disabled>成功时发送积分明细</label></p>
      <p><label class="check"><input type="checkbox" name="notifyFailure" disabled>失败、未完成或停止时提醒</label></p>
      <label class="field" for="pushplusToken"><span class="hint-text">PushPlus Token</span>
        <input class="input" id="pushplusToken" name="token" type="password" autocomplete="new-password" maxlength="256" spellcheck="false" placeholder="填写 Token 后保存" disabled></label>
      <p class="hint" data-pushplus-token-status>正在读取通知配置…</p>
      <p><label class="check"><input type="checkbox" name="clearToken" disabled>清除已保存的 Token（需同时关闭推送）</label></p>
      <label class="field" for="pushplusDeliveryMode"><span class="hint-text">发送方式</span><select class="input" id="pushplusDeliveryMode" name="deliveryMode" disabled><option value="summary">所有账号汇总到当前微信</option><option value="accounts">按账号分别发送（只发送对应账号明细）</option></select></label>
      <p class="hint">“当前微信”指 Token 所属微信。好友令牌和 Token 留空保存时保留原值；账号不参与本轮运行时不会通知其接收人。</p>
      <div data-pushplus-routes></div>
      <div class="form-actions"><button type="submit" class="btn btn-primary" disabled>保存通知设置</button><button type="button" class="btn" data-pushplus-test disabled>发送测试通知</button></div>
      <p class="notice notice--info" role="status" aria-live="polite" data-pushplus-message hidden></p>
      <p class="hint" data-pushplus-result></p>
    </form>`;
  root.prepend(section);
  const form=section.querySelector('form'), fields=form.elements;
  const message=section.querySelector('[data-pushplus-message]'),test=section.querySelector('[data-pushplus-test]');
  let loaded=false, busy=false, configured=false,dirty=false,accountEmails=[],routeRows=[];
  function status(text,error=false) { message.textContent=text;message.hidden=false;message.className='notice '+(error?'notice--error':'notice--info'); }
  function lock(value) {
    busy=value;
    form.querySelectorAll('input,button,select').forEach(el=>el.disabled=value||!loaded);
    test.disabled=value||!loaded||!configured||dirty;
    for(const row of routeRows){row.token.disabled=value||!loaded||row.target.value!=='friend';row.test.disabled=value||!loaded||!configured||dirty||row.target.value==='off';}
  }
  function renderRoutes(routes){
    const host=section.querySelector('[data-pushplus-routes]');host.replaceChildren();routeRows=[];
    const emails=[...new Set([...accountEmails,...routes.map(r=>r.email)])];
    if(!emails.length){const hint=document.createElement('p');hint.className='hint';hint.textContent='添加账号后即可配置接收人。';host.append(hint);return;}
    emails.forEach((email,index)=>{
      const saved=routes.find(r=>r.email===email)||{target:'off',friendTokenConfigured:false};
      const box=document.createElement('fieldset');box.style.cssText='margin:12px 0;padding:12px;border:1px solid var(--border, #ccd2d8);border-radius:8px;min-width:0';
      const legend=document.createElement('legend');legend.textContent=email;legend.style.overflowWrap='anywhere';box.append(legend);
      const targetLabel=document.createElement('label');targetLabel.className='field';targetLabel.textContent='接收人';
      const target=document.createElement('select');target.className='input';target.name='routeTarget'+index;
      for(const [value,label]of [['off','不发送此账号'],['self','当前微信'],['friend','指定 PushPlus 好友']]){const option=document.createElement('option');option.value=value;option.textContent=label;target.append(option);}target.value=saved.target;targetLabel.append(target);
      const tokenLabel=document.createElement('label');tokenLabel.className='field';tokenLabel.textContent='好友令牌';
      const token=document.createElement('input');token.className='input';token.name='routeToken'+index;token.type='password';token.maxLength=32;token.autocomplete='new-password';token.spellcheck=false;token.placeholder=saved.friendTokenConfigured?'已保存，留空保留':'32 位好友令牌';tokenLabel.append(token);
      const clearLabel=document.createElement('label');clearLabel.className='check';const clear=document.createElement('input');clear.type='checkbox';clear.name='routeClear'+index;clearLabel.append(clear,document.createTextNode('清除好友令牌（需先切换接收方式）'));
      const routeTest=document.createElement('button');routeTest.type='button';routeTest.className='btn btn-small';routeTest.textContent='测试此接收人';routeTest.style.marginTop='8px';
      const feedback=document.createElement('p');feedback.className='hint';feedback.setAttribute('role','status');
      box.append(targetLabel,tokenLabel,clearLabel,document.createElement('br'),routeTest,feedback);host.append(box);
      routeRows.push({email,target,token,clear,test:routeTest});
      routeTest.addEventListener('click',async()=>{
        if(busy||dirty||target.value==='off')return;lock(true);feedback.textContent='正在提交测试…';
        try{const result=await request('/test',{email});feedback.textContent=result.message;}
        catch(error){feedback.textContent=error.name==='TimeoutError'?'请求超时，请先查看手机是否收到。':error.message;}
        finally{lock(false);}
      });
    });
  }
  function display(data) {
    for(const key of ['enabled','notifySuccess','notifyFailure'])fields[key].checked=data[key];
    fields.token.value='';fields.clearToken.checked=false;configured=data.tokenConfigured;dirty=false;
    fields.deliveryMode.value=data.deliveryMode||'summary';renderRoutes(data.routes||[]);
    fields.token.placeholder=configured?'已保存，留空保留；填写新值可替换':'填写 Token 后保存';
    section.querySelector('[data-pushplus-token-status]').textContent=configured?'Token 已保存在服务器，页面不会回显。':'尚未保存 Token。';
    section.querySelector('[data-pushplus-result]').textContent=data.lastResult?'最近一次'+(data.lastResult.kind==='test'?'测试':data.lastResult.kind==='manual'?'手动发送':'任务通知')+'：'+data.lastResult.message+'（'+new Date(data.lastResult.at).toLocaleString('zh-CN')+'）':'';
  }
  async function request(suffix='',body) {
    const response=await fetch('/api/notifications/pushplus'+suffix,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',
      headers:body===undefined?{}:{'Content-Type':'application/json','X-Rewards-Notification-Write':'1'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
    const data=await response.json();
    if(!response.ok)throw Error(data.error||'通知设置操作失败。');
    return data;
  }
  form.addEventListener('input',()=>{dirty=true;lock(busy);});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!loaded)return;
    const body={enabled:fields.enabled.checked,notifySuccess:fields.notifySuccess.checked,notifyFailure:fields.notifyFailure.checked,token:fields.token.value.trim(),clearToken:fields.clearToken.checked,deliveryMode:fields.deliveryMode.value,routes:routeRows.map(row=>({email:row.email,target:row.target.value,friendToken:row.token.value.trim(),clearFriendToken:row.clear.checked}))};
    lock(true);
    try{display(await request('',body));status('通知设置已保存，立即生效。');}
    catch(error){status(error.name==='TimeoutError'?'保存超时，请重新进入配置页确认。':error.message,true);}
    finally{body.token='';body.routes.forEach(r=>r.friendToken='');fields.token.value='';routeRows.forEach(row=>row.token.value='');lock(false);}
  });
  test.addEventListener('click',async()=>{
    if(busy||!configured||dirty)return;
    lock(true);status('正在提交测试通知…');
    try{const result=await request('/test',{});status(result.message);display(await request());}
    catch(error){status(error.name==='TimeoutError'?'测试请求超时，请先查看手机是否收到。':error.message,true);}
    finally{lock(false);}
  });
  let sequence=0;
  async function reload(){
    if(dirty||busy)return;const current=++sequence;
    try{
      const [data,accounts]=await Promise.all([request(),fetch('/api/accounts',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000)}).then(async r=>r.ok?await r.json():{accounts:[]}).catch(()=>({accounts:[]}))]);
      if(current!==sequence||dirty||busy)return;
      accountEmails=(accounts.accounts||[]).map(a=>a.email).filter(Boolean);display(data);loaded=true;lock(false);
    }catch(error){status('无法读取通知配置：'+error.message,true);}
  }
  instances.set(root,{reload});reload();
}
