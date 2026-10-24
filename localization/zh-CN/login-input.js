// Global human login prompt, available from every Dashboard tab.
export function mountLoginInput(){
  if(document.querySelector('#webLoginBanner'))return;
  const link=document.createElement('link');link.rel='stylesheet';link.href='/login-input.css';document.head.append(link);
  const banner=document.createElement('aside');banner.id='webLoginBanner';banner.hidden=true;banner.setAttribute('aria-live','polite');
  banner.innerHTML='<span>账号正在等待登录验证</span><button type="button" class="btn btn-primary">填写验证信息</button>';
  document.body.prepend(banner);
  const dialog=document.createElement('dialog');dialog.className='web-login-dialog';dialog.setAttribute('aria-labelledby','webLoginTitle');
  dialog.innerHTML=`<form autocomplete="off"><h2 id="webLoginTitle">完成账号登录验证</h2>
    <p data-login-account></p><p class="hint" data-login-instruction></p>
    <label for="webLoginValue" data-login-label></label>
    <input class="input" id="webLoginValue" name="answer" required autocomplete="off" spellcheck="false">
    <p class="hint" data-login-expiry></p><p class="hint">提交后将继续登录。验证码仅用于本次请求，不会保存到日志或配置中。</p>
    <p class="notice notice--error" role="alert" data-login-error hidden></p>
    <div class="web-login-actions"><button class="btn" type="button" data-login-later>稍后填写</button><button class="btn" type="button" data-login-cancel>取消本次验证</button><button class="btn btn-primary" type="submit">提交验证</button></div>
  </form>`;
  document.body.append(dialog);
  const form=dialog.querySelector('form'),input=form.elements.answer,error=dialog.querySelector('[data-login-error]');
  let current=null,busy=false,lastSeen=null,polling=false;
  const clear=()=>{input.value='';error.textContent='';error.hidden=true;};
  const open=()=>{if(current&&!dialog.open&&!document.querySelector('dialog[open]')){dialog.showModal();input.focus();}};
  const setBusy=value=>{busy=value;for(const button of form.querySelectorAll('button'))button.disabled=value;input.disabled=value;};
  const close=()=>{dialog.close();clear();};
  banner.querySelector('button').addEventListener('click',open);
  form.querySelector('[data-login-later]').addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();else clear();});
  dialog.addEventListener('close',clear);
  async function submit(cancel){
    if(!current||busy||(!cancel&&!form.reportValidity()))return;
    const id=current.id,body=cancel?{id,cancel:true}:{id,value:input.value};
    setBusy(true);error.hidden=true;
    try{
      const response=await fetch('/api/login-input',{method:'POST',headers:{'Content-Type':'application/json','X-Rewards-Login-Write':'1'},body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(8000)});
      const result=await response.json();if(!response.ok)throw Error(result.error||'提交失败，请重试。');
      if(current?.id===id){current=null;banner.hidden=true;close();}
    }catch(failure){error.textContent=failure.message||'提交失败，请重试。';error.hidden=false;}
    finally{body.value='';input.value='';setBusy(false);}
  }
  form.addEventListener('submit',event=>{event.preventDefault();void submit(false);});
  form.querySelector('[data-login-cancel]').addEventListener('click',()=>void submit(true));
  async function poll(){
    if(polling||busy)return;polling=true;
    try{
      const response=await fetch('/api/login-input',{cache:'no-store',signal:AbortSignal.timeout(5000)});
      if(!response.ok)throw Error('unavailable');
      const list=(await response.json()).challenges||[],next=list.find(item=>item.id===current?.id)||list[0];
      if(!next){current=null;banner.hidden=true;if(dialog.open)close();return;}
      if(next.id!==current?.id){
        current=next;clear();
        dialog.querySelector('[data-login-account]').textContent=next.email+' · '+(next.platform==='mobile'?'移动端':'桌面端');
        const email=next.kind==='email',totp=next.kind==='totp';
        dialog.querySelector('[data-login-label]').textContent=email?'完整验证邮箱地址':totp?'验证器中的 6 位动态码':'邮箱收到的 6 位验证码';
        dialog.querySelector('[data-login-instruction]').textContent=email?(next.hint?'请补全微软提示的验证邮箱：'+next.hint:'请输入该账号绑定的验证邮箱，以便微软发送验证码。'):totp?'请查看 Microsoft Authenticator 或账号绑定的验证器。':'请查看刚收到的微软验证邮件。';
        input.type=email?'email':'password';input.inputMode=email?'email':'numeric';input.maxLength=email?254:6;
        if(email)input.removeAttribute('pattern');else input.pattern='[0-9]{6}';
      }
      banner.hidden=false;banner.querySelector('span').textContent=next.email+' 正在等待登录验证';
      dialog.querySelector('[data-login-expiry]').textContent='剩余 '+Math.max(0,Math.ceil((next.expiresAt-Date.now())/1000))+' 秒';
      if(lastSeen!==next.id&&!document.querySelector('dialog[open]')){open();lastSeen=next.id;}
    }catch{current=null;banner.hidden=true;if(dialog.open)close();}
    finally{polling=false;}
  }
  void poll();setInterval(()=>void poll(),1500);
}
