// Narrow input bridge for the pinned login helpers. No terminal or arbitrary commands.
'use strict';
function available(){
  return /^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.STACK_LOGIN_BRIDGE_URL||'')&&/^[a-f0-9]{64}$/.test(process.env.STACK_LOGIN_BRIDGE_SECRET||'')&&Boolean(process.env.API_TOKEN);
}
async function prompt(options){
  if(!available())return null;
  const question=String(options.question||'');
  const kind=/email/i.test(question)?'email':/6-digit TOTP code/i.test(question)?'totp':/6-digit code/i.test(question)?'code':null;
  if(!kind)return null;
  const hint=question.match(/[A-Za-z0-9._*+-]+@[A-Za-z0-9.*-]+\.[A-Za-z]{2,}/)?.[0];
  const headers={'Content-Type':'application/json',Authorization:'Bearer '+process.env.API_TOKEN,'X-Rewards-Login-Run':process.env.STACK_LOGIN_BRIDGE_SECRET};
  async function call(path,body){
    const response=await fetch(process.env.STACK_LOGIN_BRIDGE_URL+'/login-input/bridge'+path,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw Error('Login input bridge unavailable');return response.json();
  }
  let id;
  try{
    const entry=await call('',{kind,email:options.accountEmail,platform:options.platform,hint});id=entry.id;
    const deadline=Math.min(Number(entry.expiresAt),Date.now()+180000);
    while(Date.now()<deadline){
      const answer=await call('/read',{id});
      if(answer.state==='expired')throw Error('expired');
      if(answer.state==='answered'){
        if(typeof answer.value!=='string')throw Error('cancelled');
        let value=answer.value.trim();if(options.transform)value=options.transform(value);
        if(kind!=='email')globalThis[Symbol.for('rewards-stack.register-secret')]?.(value);
        return !options.validate||options.validate(value)?value:null;
      }
      await new Promise(resolve=>setTimeout(resolve,600));
    }
    throw Error('expired');
  }catch{throw Error('网页登录验证已取消、过期或连接中断，请重新运行该账号。');}
  finally{if(id)await call('/cancel',{id}).catch(()=>{});}
}
module.exports={available,prompt};
