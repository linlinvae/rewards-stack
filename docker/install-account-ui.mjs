// Guarded build-time integration with the exact pinned release APIs.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
function replace(text,before,after){if(text.split(before).length!==2)throw Error('Pinned account integration anchor mismatch');return text.replace(before,after);}
export function patchScriptServer(text,moduleURL='/stack/account-manager.mjs'){
  if(hash(text)!=='f135eaf0f8ff0f0404ce661f82d9e2135f26aa7c1482003f7c38cdd591f81d75')throw Error('Account UI requires the pinned Script API');
  text=`import { ManagedAccountStore } from ${JSON.stringify(moduleURL)};\n`+text;
  text=replace(text,'loadEnvFile(projectRoot)','loadEnvFile(projectRoot)\nconst managedAccountStore = new ManagedAccountStore({file:path.join(projectRoot,"config","managed-accounts.json")})');
  return replace(text,'        // account overview',`        // Deployment extension: authenticated account registry.
        if (method === 'POST' && pathname === '/accounts/remove') {
            res.setHeader('Cache-Control','no-store')
            if (!TOKEN) return sendJson(res,403,{error:'账号管理需要认证。'})
            try {
                const body=await readJsonBody(req,2048)
                if(!body||Object.keys(body).some(key=>key!=='email'))return sendJson(res,400,{error:'账号请求格式无效。'})
                return sendJson(res,200,managedAccountStore.remove(body.email,{idle:pm.state==='idle'}))
            } catch(error) {
                return sendJson(res,error.public?error.status:500,{error:error.public?error.message:'删除配置失败，原有账号保持不变。'})
            }
        }
        if (method === 'GET' && pathname === '/accounts/management') {
            res.setHeader('Cache-Control','no-store')
            return sendJson(res,200,managedAccountStore.status(pm.state==='idle',Boolean(TOKEN)))
        }
        if (method === 'POST' && pathname === '/accounts/managed') {
            res.setHeader('Cache-Control','no-store')
            if (!TOKEN || !managedAccountStore.enabled) return sendJson(res,403,{error:'网页添加账号尚未启用。'})
            let body
            try { body=await readJsonBody(req,16384) } catch { return sendJson(res,400,{error:'账号请求格式无效或内容过大。'}) }
            try {
                const account=managedAccountStore.add(body,{idle:pm.state==='idle'})
                return sendJson(res,201,{account,appliesOnNextRun:true})
            } catch (error) {
                return sendJson(res,error.public?error.status:500,{error:error.public?error.message:'保存账号失败，原有账号保持不变。'})
            }
        }

        // account overview`);
}
export function patchDashboardServer(text){
  if(hash(text)!=='4bb5b43368902f66517554d94a279df394517282bc9cf5b5eaf27ae12cf5dd62')throw Error('Account UI requires the pinned Dashboard API');
  text=replace(text,'      store.deleteAccount(email);',`      let sameOrigin=true;
      if(req.headers.origin){try{const u=new URL(req.headers.origin);sameOrigin=["http:","https:"].includes(u.protocol)&&u.host===req.headers.host;}catch{sameOrigin=false;}}
      if(req.headers["x-rewards-account-write"]!=="1"||!sameOrigin||req.headers["sec-fetch-site"]==="cross-site")return sendJson(res,403,{error:"请通过当前面板确认删除账号。"});
      await client.request("POST","/accounts/remove",{body:{email}});
      store.deleteAccount(email);`);
  text=replace(text,'return sendJson(res, 500, { error: e.message });\n    }\n  }\n\n  // control', 'return sendJson(res, e.statusCode || 500, { error: e.body?.error || e.message });\n    }\n  }\n\n  // control');
  return replace(text,'  // live\n',`  // Deployment extension: same-origin JSON request, existing Basic authentication.
  if (pathname === "/api/account-management" && method === "GET") {
    res.setHeader("Cache-Control", "no-store");
    return forward(res,"GET","/accounts/management");
  }
  if (pathname === "/api/accounts" && method === "POST") {
    res.setHeader("Cache-Control", "no-store");
    const origin=req.headers.origin;
    let sameOrigin=true;
    if(origin){try{const parsed=new URL(origin);sameOrigin=["http:","https:"].includes(parsed.protocol)&&parsed.host===req.headers.host;}catch{sameOrigin=false;}}
    if(req.headers["x-rewards-account-write"]!=="1" || !/^application\\/json(?:;|$)/i.test(req.headers["content-type"]||"") || !sameOrigin || req.headers["sec-fetch-site"]==="cross-site") {
      return sendJson(res,403,{error:"请通过当前面板的添加账号表单保存。"});
    }
    let body;
    try{body=await readJsonBody(req,16384);}catch{return sendJson(res,400,{error:"账号请求格式无效或内容过大。"});}
    return forward(res,"POST","/accounts/managed",body);
  }

  // live
`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const role=process.argv[2];
  const file=role==='script'?'/usr/src/microsoft-rewards-script/scripts/api/server.js':role==='dashboard'?'/usr/src/rewards-dashboard/server.js':null;
  if(!file)throw Error('Expected script or dashboard role');
  const source=fs.readFileSync(file,'utf8');
  fs.writeFileSync(file,role==='script'?patchScriptServer(source):patchDashboardServer(source));
  console.log('PASS: guarded '+role+' account creation integration installed');
}
