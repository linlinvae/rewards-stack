// Human-entered login challenges live only in memory, scoped to one child run.
import crypto from 'node:crypto';
const emailRE=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const fail=(status,message)=>Object.assign(new Error(message),{status,public:true});
export class LoginBroker {
  constructor({now=Date.now,ttlMs=180000}={}){this.now=now;this.ttlMs=ttlMs;this.reset();}
  reset(){this.entries=new Map();this.secret=null;this.emails=new Set();}
  begin(env){
    this.reset();this.secret=crypto.randomBytes(32).toString('hex');
    this.emails=new Set(Object.entries(env).filter(([key,value])=>/^ACCOUNT_\d+_EMAIL$/.test(key)&&value).map(([,value])=>value.toLowerCase()));
    globalThis[Symbol.for('rewards-stack.register-secret')]?.(this.secret);
    return this.secret;
  }
  authorize(secret){
    if(typeof secret!=='string'||!this.secret)return false;
    const a=Buffer.from(secret),b=Buffer.from(this.secret);
    return a.length===b.length&&crypto.timingSafeEqual(a,b);
  }
  prune(){for(const [id,entry] of this.entries)if(entry.expiresAt<=this.now())this.entries.delete(id);}
  create(body){
    this.prune();
    if(!body||!['email','code','totp'].includes(body.kind)||typeof body.email!=='string'||!this.emails.has(body.email.toLowerCase())||!['mobile','desktop'].includes(body.platform))throw fail(400,'登录验证请求无效。');
    if(this.entries.size>=8||[...this.entries.values()].some(e=>e.email.toLowerCase()===body.email.toLowerCase()))throw fail(409,'该账号已有登录验证请求。');
    const id=crypto.randomUUID(),entry={id,email:body.email,platform:body.platform,kind:body.kind,expiresAt:this.now()+this.ttlMs,state:'pending'};
    // Only a masked email hint is accepted; never store arbitrary page HTML or prompts.
    if(typeof body.hint==='string'&&body.hint.length<=254&&emailRE.test(body.hint)&&body.hint.includes('*'))entry.hint=body.hint;
    this.entries.set(id,entry);return {id,expiresAt:entry.expiresAt};
  }
  list(){this.prune();return [...this.entries.values()].filter(e=>e.state==='pending').map(({state,...entry})=>entry);}
  answer(body){
    this.prune();const e=this.entries.get(body?.id);
    if(!e||e.state!=='pending')throw fail(409,'验证请求已过期或已处理，请等待新的提示。');
    if(body.cancel===true){e.state='answered';e.value=null;return;}
    const value=typeof body.value==='string'?body.value.trim():'';
    if(value.length>254||/[\x00-\x1f\x7f]/.test(value)||!(e.kind==='email'?emailRE.test(value):/^\d{6}$/.test(value)))throw fail(400,e.kind==='email'?'请输入完整的验证邮箱地址。':'请输入 6 位数字验证码。');
    // Redact before the child can log a provider error containing submitted input.
    if(e.kind!=='email')globalThis[Symbol.for('rewards-stack.register-secret')]?.(value);
    e.value=value;e.state='answered';
  }
  read(id){
    this.prune();const entry=this.entries.get(id);
    if(!entry)return {state:'expired',value:null};
    if(entry.state==='pending')return {state:'pending'};
    this.entries.delete(id);return {state:'answered',value:entry.value};
  }
  cancel(id){this.entries.delete(id);}
}
export function attachLoginBroker(pm,port,{enabled=true}={}){
  const broker=new LoginBroker(),resolve=pm._resolveEnv;
  pm._resolveEnv=function(...args){
    const env=resolve.apply(this,args);
    delete env.STACK_LOGIN_BRIDGE_SECRET;delete env.STACK_LOGIN_BRIDGE_URL;
    if(enabled){env.STACK_LOGIN_BRIDGE_SECRET=broker.begin(env);env.STACK_LOGIN_BRIDGE_URL=`http://127.0.0.1:${port}`;}
    return env;
  };
  pm.on('status',status=>{if(['stopping','idle'].includes(status.state))broker.reset();});
  return broker;
}
