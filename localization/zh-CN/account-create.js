// Account creation form. Credentials never enter browser storage or rendered HTML.
const instances=new WeakMap();
export function mountAccountCreator(root,ctx){
  if(instances.has(root))return;
  if(!document.querySelector('link[data-account-create-style]')){
    const link=document.createElement('link');link.rel='stylesheet';link.href='/account-create.css';link.dataset.accountCreateStyle='';document.head.append(link);
  }
  const section=document.createElement('section');section.className='panel account-create-toolbar';
  section.innerHTML=`<div><h2>账号管理</h2><p class="hint">添加后即可在下次运行中使用，原有账号和记录会保留。</p></div><button type="button" class="btn btn-primary" data-open-account-create disabled>添加账号</button>`;
  root.prepend(section);
  const dialog=document.createElement('dialog');dialog.className='account-create-dialog';dialog.setAttribute('aria-labelledby','accountCreateTitle');
  dialog.innerHTML=`<form id="accountCreateForm" autocomplete="off">
    <div class="account-create-heading"><h2 id="accountCreateTitle">添加账号</h2><button type="button" class="btn" data-close-account-create aria-label="关闭添加账号">×</button></div>
    <p class="hint">仅保存账号，不会自动登录或启动任务。首次登录可能需要你完成微软验证。</p>
    <label class="account-create-field" for="accountCreateEmail">微软账号邮箱 <span aria-hidden="true">*</span></label>
    <input class="input" id="accountCreateEmail" name="email" type="email" required maxlength="254" autocomplete="off" placeholder="name@example.com">
    <label class="account-create-field" for="accountCreatePassword">密码（可选）</label>
    <input class="input" id="accountCreatePassword" name="password" type="password" maxlength="1024" autocomplete="new-password" aria-describedby="accountCreatePasswordHelp">
    <p class="hint" id="accountCreatePasswordHelp">密码不会在列表中显示。首次运行时请保持面板打开，按提示填写验证邮箱或验证码；无密码登录取决于账号提供的验证方式。</p>
    <details><summary>地区与语言</summary><div class="account-create-options">
      <div><label class="account-create-field" for="accountCreateGeo">地区</label><input class="input" id="accountCreateGeo" name="geoLocale" value="auto" maxlength="4" spellcheck="false"><p class="hint">auto 自动识别，或填写两位国家代码。</p></div>
      <div><label class="account-create-field" for="accountCreateLanguage">语言</label><select class="input" id="accountCreateLanguage" name="langCode"><option value="en">英语（en）</option><option value="zh-CN">简体中文（zh-CN）</option><option value="ja-JP">日语（ja-JP）</option></select></div>
    </div></details>
    <p class="notice notice--error" id="accountCreateError" role="alert" hidden></p>
    <div class="account-create-actions"><button type="button" class="btn" data-close-account-create>取消</button><button type="submit" class="btn btn-primary" id="accountCreateSave">保存账号</button></div>
  </form>`;
  root.append(dialog);
  const form=dialog.querySelector('form'),open=section.querySelector('button'),error=dialog.querySelector('#accountCreateError'),save=dialog.querySelector('#accountCreateSave');
  const state={ctx,dialog,open,form,error,save,saving:false,capability:null};instances.set(root,state);
  const clearError=()=>{error.hidden=true;error.textContent='';};
  const close=()=>{if(!state.saving)dialog.close();};
  open.addEventListener('click',()=>{clearError();dialog.showModal();form.elements.email.focus();});
  dialog.querySelectorAll('[data-close-account-create]').forEach(button=>button.addEventListener('click',close));
  dialog.addEventListener('cancel',event=>{if(state.saving)event.preventDefault();});
  dialog.addEventListener('close',()=>{form.reset();clearError();open.focus();});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(state.saving||!form.reportValidity())return;
    const payload={email:form.elements.email.value.trim(),password:form.elements.password.value,geoLocale:form.elements.geoLocale.value.trim(),langCode:form.elements.langCode.value};
    state.saving=true;save.disabled=true;save.textContent='正在保存…';clearError();
    try{
      await state.ctx.api.createAccount(payload);
      form.reset();dialog.close();state.ctx.invalidate();state.ctx.toast('账号已添加，下次运行生效。','success');
      await state.ctx.refresh();
    }catch(failure){error.textContent=failure.message||'保存失败，请稍后重试。';error.hidden=false;}
    finally{payload.password='';state.saving=false;save.disabled=false;save.textContent='保存账号';updateAccountCreator(root,state.ctx);}
  });
}
export function updateAccountCreator(root,ctx){
  const state=instances.get(root);if(!state)return;
  state.ctx=ctx||state.ctx;
  const status=state.ctx.status;
  state.open.disabled=state.saving||!state.capability?.enabled||!status?.reachable||status.authOk===false||Boolean(status.botRunning);
  state.open.title=status?.botRunning?'请等待当前任务结束后再添加账号':state.capability?.enabled?'添加一个微软账号':'添加账号功能暂不可用';
}
export async function refreshAccountCreator(root,ctx){
  const state=instances.get(root);if(!state)return;
  state.ctx=ctx;
  try{state.capability=await ctx.api.accountManagement();}catch{state.capability={enabled:false};}
  updateAccountCreator(root,ctx);
}
