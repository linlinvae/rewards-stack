import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const fields=new Set(['email','password','geoLocale','langCode']);
const secretRegistrar=Symbol.for('rewards-stack.register-secret');
function invalid(message,status=400){return Object.assign(new Error(message),{status,public:true});}
function normalize(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!fields.has(k)))throw invalid('账号字段无效，请检查邮箱、密码、地区和语言。');
  const {email,password='',geoLocale='auto',langCode='en'}=input;
  if(typeof email!=='string'||email.length>254||! /^[^\s@\x00-\x1f\x7f]+@[^\s@\x00-\x1f\x7f]+\.[^\s@\x00-\x1f\x7f]+$/.test(email.trim()))throw invalid('请输入有效的邮箱地址。');
  if(typeof password!=='string'||password.length>1024||/[\x00-\x1f\x7f]/.test(password)||password!==password.trim())throw invalid('密码格式无效，不能含控制字符或首尾空白。');
  if(typeof geoLocale!=='string'||!/^(auto|[a-z]{2})$/i.test(geoLocale))throw invalid('地区请填写 auto 或两位国家代码，例如 JP。');
  if(typeof langCode!=='string'||langCode.length>35||!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(langCode))throw invalid('语言代码无效，例如 en 或 zh-CN。');
  let language;try{language=new Intl.Locale(langCode).toString();}catch{throw invalid('语言代码无效，例如 en 或 zh-CN。');}
  return {email:email.trim(),password,geoLocale:geoLocale.toLowerCase()==='auto'?'auto':geoLocale.toUpperCase(),langCode:language};
}

export class ManagedAccountStore {
  constructor({file,env=process.env,registerSecret=value=>globalThis[secretRegistrar]?.(value)}={}){
    this.file=file;this.env=env;this.registerSecret=registerSecret;this.records=[];this.disabledEnvironmentAccounts=[];
    this.enabled=env.STACK_ALLOW_ACCOUNT_CREATE==='true';
    if(!fs.existsSync(file))return;
    const stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)throw Error('Managed account storage is unsafe; existing data preserved.');
    let saved;try{saved=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw Error('Managed account storage JSON is invalid; existing data preserved.');}
    if(saved?.format!==1||!Array.isArray(saved.accounts)||saved.accounts.length>1000)throw Error('Managed account storage format is invalid.');
    const disabled=saved.disabledEnvironmentAccounts??[];
    if(!Array.isArray(disabled)||disabled.length>1000)throw Error('Invalid removed environment account list');
    const disabledSlots=new Set();
    for(const entry of disabled){
      if(!entry||!Number.isSafeInteger(entry.index)||entry.index<1||entry.index>10000||typeof entry.email!=='string'||disabledSlots.has(entry.index))throw Error('Invalid removed environment account identity');
      const email=normalize({email:entry.email}).email;
      const configured=env[`ACCOUNT_${entry.index}_EMAIL`];
      if(configured&&configured.trim().toLowerCase()!==email.toLowerCase())throw Error('Removed environment account identity changed; existing data preserved.');
      disabledSlots.add(entry.index);this.disabledEnvironmentAccounts.push({index:entry.index,email});
    }
    const emails=new Set(Object.entries(env).filter(([k,v])=>/^ACCOUNT_[1-9]\d*_EMAIL$/.test(k)&&v&&!disabledSlots.has(Number(/^ACCOUNT_(\d+)_/.exec(k)[1]))).map(([,v])=>v.trim().toLowerCase()));
    const slots=new Set(Object.keys(env).map(k=>/^ACCOUNT_([1-9]\d*)_/.exec(k)?.[1]).filter(Boolean).map(Number));
    for(const savedAccount of saved.accounts){
      const {index,...input}=savedAccount;
      if(!Number.isSafeInteger(index)||index<1||index>10000||slots.has(index))throw Error('Managed account slot conflicts with environment; existing accounts preserved.');
      const account=normalize(input);
      if(emails.has(account.email.toLowerCase()))throw Error('Managed account email conflicts with existing accounts.');
      slots.add(index);emails.add(account.email.toLowerCase());this.records.push({index,...account});
    }
    for(const record of this.disabledEnvironmentAccounts)this.clearSlot(record.index);
    for(const record of this.records)this.apply(record);
  }
  apply(record){
    const prefix=`ACCOUNT_${record.index}_`;
    for(const [key,value] of Object.entries({EMAIL:record.email,PASSWORD:record.password,GEO_LOCALE:record.geoLocale,LANG_CODE:record.langCode}))this.env[prefix+key]=value;
    if(record.password)this.registerSecret(record.password);
  }
  status(idle,authenticated){return {enabled:this.enabled&&authenticated,writable:this.enabled&&authenticated&&idle,managedCount:this.records.length,removalSupported:true};}
  clearSlot(index){for(const key of Object.keys(this.env))if(key.startsWith(`ACCOUNT_${index}_`))this.env[key]='';}
  remove(email,{idle=true}={}){
    if(!this.enabled)throw invalid('网页账号管理尚未启用。',403);
    if(!idle)throw invalid('任务正在运行，请等待结束后再删除账号。',409);
    const normalized=normalize({email}).email.toLowerCase();
    const matches=Object.entries(this.env).filter(([key,value])=>/^ACCOUNT_[1-9]\d*_EMAIL$/.test(key)&&value?.trim().toLowerCase()===normalized);
    if(!matches.length)return {removed:false};
    if(matches.length!==1)throw invalid('存在重复账号配置，请先检查部署配置。',409);
    const [key,configuredEmail]=matches[0],index=Number(/^ACCOUNT_(\d+)_/.exec(key)[1]);
    const managed=this.records.some(record=>record.index===index);
    const records=this.records.filter(record=>record.index!==index);
    const disabled=managed?this.disabledEnvironmentAccounts:[...this.disabledEnvironmentAccounts,{index,email:configuredEmail}];
    if(disabled.length>1000)throw invalid('账号移除记录达到上限，请检查部署配置。',409);
    this.persist(records,disabled);
    this.records=records;this.disabledEnvironmentAccounts=disabled;this.clearSlot(index);
    return {removed:true,index,email:configuredEmail,sessionsRetained:true};
  }
  add(input,{idle=true}={}){
    if(!this.enabled)throw invalid('网页添加账号尚未启用。',403);
    if(!idle)throw invalid('任务正在运行，请等待结束后再添加账号。',409);
    const account=normalize(input);
    const duplicate=Object.entries(this.env).some(([key,value])=>/^ACCOUNT_[1-9]\d*_EMAIL$/.test(key)&&value?.trim().toLowerCase()===account.email.toLowerCase());
    if(duplicate)throw invalid('这个邮箱已经添加，请勿重复保存。',409);
    if(this.records.length>=1000)throw invalid('已达到网页账号数量上限。',409);
    const indexes=Object.keys(this.env).map(k=>Number(/^ACCOUNT_([1-9]\d*)_/.exec(k)?.[1]||0));
    const index=Math.max(0,...indexes)+1;
    if(index>10000)throw invalid('账号序号超出支持范围。',409);
    const record={index,...account};
    this.persist([...this.records,record],this.disabledEnvironmentAccounts);
    this.records.push(record);this.apply(record);
    return {index,email:account.email,geoLocale:account.geoLocale,langCode:account.langCode,hasPassword:Boolean(account.password)};
  }
  persist(records,disabledEnvironmentAccounts){
    const serialized=JSON.stringify({format:1,accounts:records,disabledEnvironmentAccounts},null,2)+'\n';
    if(Buffer.byteLength(serialized)>1024*1024)throw invalid('账号配置已达到存储大小上限。',409);
    const parent=path.dirname(this.file);
    const directory=fs.lstatSync(parent);
    if(!directory.isDirectory()||directory.isSymbolicLink())throw Error('Unsafe account storage directory');
    if(fs.existsSync(this.file)&&(!fs.lstatSync(this.file).isFile()||fs.lstatSync(this.file).isSymbolicLink()))throw Error('Unsafe account storage file');
    const temp=path.join(parent,`.managed-accounts-${crypto.randomBytes(12).toString('hex')}.tmp`);
    let fd;
    try{
      fd=fs.openSync(temp,'wx',0o600);
      fs.writeFileSync(fd,serialized);
      fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
      fs.renameSync(temp,this.file);
      // The rename is committed before memory is updated; no task starts during this synchronous operation.
    }finally{
      if(fd!==undefined)fs.closeSync(fd);
      if(fs.existsSync(temp))fs.unlinkSync(temp);
    }
  }
}
