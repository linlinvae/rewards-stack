import fs from 'node:fs';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
function replace(text,before,after){if(text.split(before).length!==2)throw Error('Pinned web login anchor mismatch');return text.replace(before,after);}
export function patchLoginScriptServer(text,moduleURL='/stack/login-broker.mjs'){
  text=`import { attachLoginBroker } from ${JSON.stringify(moduleURL)};\n`+text;
  text=replace(text,'const startedAt = Date.now()',`const webLogin = attachLoginBroker(pm, PORT, {enabled:Boolean(TOKEN)})\nconst startedAt = Date.now()`);
  return replace(text,'        // index',`        // Deployment extension: human input; values never enter logs or persistent storage.
        if (pathname.startsWith('/login-input')) {
            res.setHeader('Cache-Control','no-store')
            if (!TOKEN) return sendJson(res,403,{error:'登录验证需要启用 API 认证。'})
            if (method === 'GET' && pathname === '/login-input') return sendJson(res,200,{challenges:webLogin.list()})
            try {
                if (method !== 'POST') return sendJson(res,404,{error:'Not found'})
                const bridge=pathname.startsWith('/login-input/bridge')
                if (bridge && (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || !webLogin.authorize(req.headers['x-rewards-login-run']))) return sendJson(res,403,{error:'验证通道不可用。'})
                const body=await readJsonBody(req,2048)
                if (pathname === '/login-input/answer') { webLogin.answer(body);return sendJson(res,200,{ok:true}) }
                if (pathname === '/login-input/bridge') return sendJson(res,200,webLogin.create(body))
                if (pathname === '/login-input/bridge/read') return sendJson(res,200,webLogin.read(body?.id))
                if (pathname === '/login-input/bridge/cancel') { webLogin.cancel(body?.id);return sendJson(res,200,{ok:true}) }
                return sendJson(res,404,{error:'Not found'})
            } catch(error) { return sendJson(res,error.public?error.status:400,{error:error.public?error.message:'登录验证请求无效。'}) }
        }
        // index`);
}
export function patchLoginDashboardServer(text){
  return replace(text,'  // live\n',`  if (pathname === "/api/login-input" && method === "GET") {
    res.setHeader("Cache-Control","no-store");
    return forward(res,"GET","/login-input");
  }
  if (pathname === "/api/login-input" && method === "POST") {
    res.setHeader("Cache-Control","no-store");
    let sameOrigin=true;
    if(req.headers.origin){try{const u=new URL(req.headers.origin);sameOrigin=["http:","https:"].includes(u.protocol)&&u.host===req.headers.host;}catch{sameOrigin=false;}}
    if(req.headers["x-rewards-login-write"]!=="1" || !/^application\\/json(?:;|$)/i.test(req.headers["content-type"]||"") || !sameOrigin || req.headers["sec-fetch-site"]==="cross-site")return sendJson(res,403,{error:"请通过当前面板完成登录验证。"});
    let body;try{body=await readJsonBody(req,2048);}catch{return sendJson(res,400,{error:"验证请求格式无效。"});}
    if(!body||typeof body.id!=="string"||!Object.keys(body).every(key=>["id","value","cancel"].includes(key)))return sendJson(res,400,{error:"验证请求格式无效。"});
    return forward(res,"POST","/login-input/answer",body);
  }
  // live
`);
}
const hashes={LoginUtils:'b6d5a1bffc41f5d817e11051840cd10e0cfbd64cce1be16db169801e7aa355b3',GetACodeLogin:'882de88fcd00bcd6f24927aee917d1761113109bff4e4b2893714c85f0ebedc8',RecoveryEmailLogin:'2ee7149e43de143331a4e63e82deca8aeb0831b7873c46e56958edb60b6a249e',Totp2FALogin:'f5585a0284d35ea3f5a87e0fd8cbcb77a89293fcfd14f80a7228cafdf0592867'};
export function patchLoginHelper(name,text,clientPath='/stack/login-client.cjs'){
  if(crypto.createHash('sha256').update(text).digest('hex')!==hashes[name])throw Error('Web login requires the pinned '+name+' helper');
  if(name==='LoginUtils'){
    text='const webLoginInput = require('+JSON.stringify(clientPath)+');\n'+text;
    text=replace(text,'return process.stdin.isTTY === true;','return webLoginInput.available() || process.stdin.isTTY === true;');
    return replace(text,'function promptInput(options) {','function promptInput(options) {\n    if (webLoginInput.available()) return webLoginInput.prompt(options);');
  }
  const anchor='(0, LoginUtils_1.promptInput)({';
  if(!text.includes(anchor))throw Error('Missing login input call');
  return text.split(anchor).join(anchor+'\n                    accountEmail: this.bot.currentAccountEmail, platform: this.bot.isMobile ? "mobile" : "desktop",');
}
export function patchLoginController(text,clientPath='/stack/login-client.cjs'){
  if(crypto.createHash('sha256').update(text).digest('hex')!=='f6828845c2dba6c0db2c6df09887eb571e5b0c012b6300853da50aaea6d53dcb')throw Error('Web login requires the pinned login state machine');
  text='const webLoginInput = require('+JSON.stringify(clientPath)+');\n'+text;
  text=replace(text,'if (account.password && passwordOption) {','if (account.password && passwordOption && !(webLoginInput.available() && emailOption)) {');
  return replace(text,"case 'EMAIL_VERIFICATION_INPUT': {\n                if (!account.password) {","case 'EMAIL_VERIFICATION_INPUT': {\n                if (!account.password || webLoginInput.available()) {");
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const role=process.argv[2],root=role==='script'?'/usr/src/microsoft-rewards-script':'/usr/src/rewards-dashboard';
  if(!['script','dashboard'].includes(role))throw Error('Expected script or dashboard');
  const file=root+(role==='script'?'/scripts/api/server.js':'/server.js');
  fs.writeFileSync(file,role==='script'?patchLoginScriptServer(fs.readFileSync(file,'utf8')):patchLoginDashboardServer(fs.readFileSync(file,'utf8')));
  if(role==='script')for(const name of Object.keys(hashes)){
    const file=root+'/dist/browser/auth/methods/'+name+'.js';fs.writeFileSync(file,patchLoginHelper(name,fs.readFileSync(file,'utf8')));
  }
  if(role==='script'){
    const file=root+'/dist/browser/auth/Login.js';fs.writeFileSync(file,patchLoginController(fs.readFileSync(file,'utf8')));
  }
  console.log('PASS: guarded '+role+' human login input installed');
}
