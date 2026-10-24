// Applied after the existing pinned account/login integrations, without changing upstream.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
function replace(text,before,after) {
  if(text.split(before).length!==2)throw Error('Pinned PushPlus integration anchor mismatch: '+before.slice(0,60));
  return text.replace(before,after);
}
export function patchPushPlusDashboard(text,modulePath='/stack/pushplus.cjs',detailsPath='/stack/notification-details.cjs') {
  text=replace(text,'const pendingLoginCodes = new PendingLoginCodes();',`const pendingLoginCodes = new PendingLoginCodes();
const { PushPlus } = require(${JSON.stringify(modulePath)});
const { NotificationDetails, validEmail: validNotificationEmail } = require(${JSON.stringify(detailsPath)});
const notificationDetails = new NotificationDetails(store.db);
const pushplus = new PushPlus({file:path.join(process.env.DATA_DIR || "/data", "pushplus.json"), log:(level,message)=>log(level,message)});
function observePushPlus(status) { try { pushplus.observe(status); } catch { log("warn","PushPlus 通知状态保存失败，请检查数据目录权限。"); } }
function notificationRun(id) {
  if(typeof id!=="string" || !id || id.length>256 || /[\\u0000-\\u001f\\u007f]/.test(id))throw Object.assign(new Error("请选择一条运行记录。"),{public:true,status:400});
  return store.db.prepare("SELECT id,status,start_ts AS startTs,end_ts AS endTs,total_accounts AS totalAccounts,accounts_processed AS accountsProcessed,total_gained AS totalGained,new_total AS newTotal,runtime_min AS runtimeMin FROM runs WHERE id = ?").get(id);
}`);
  text=replace(text,'      store.apply(event);',`      const notificationRunBefore = notificationDetails.runningId();
      const notificationApplied = store.apply(event);
      if(notificationApplied){try{notificationDetails.ingest(event,notificationRunBefore);}catch{log("warn","通知账号明细保存失败，缺失项目将显示未记录。");}}`);
  text=replace(text,'      store.deleteAccount(email);','      store.db.prepare("DELETE FROM pushplus_account_details WHERE lower(email)=lower(?)").run(email);\n      store.deleteAccount(email);');
  text=replace(text,'  backend.bot = status;','  backend.bot = status;\n  observePushPlus(status);');
  text=replace(text,'    backend.bot = await client.get("/status");','    backend.bot = await client.get("/status");\n    observePushPlus(backend.bot);');
  text=replace(text,'  // live\n',`  // Notification endpoints share the existing dashboard authentication.
  if (pathname === "/api/notifications/pushplus" || pathname === "/api/notifications/pushplus/test" || pathname === "/api/notifications/pushplus/send-run" || pathname === "/api/notifications/pushplus/run-details") {
    if (!DASHBOARD_AUTH_ENABLED) return sendJson(res,403,{error:"通知配置需要启用面板登录认证。"});
    if (pathname === "/api/notifications/pushplus" && method === "GET") return sendJson(res,200,pushplus.view());
    if (pathname.endsWith("/run-details") && method === "GET") {
      try {
        const row=notificationRun(searchParams.get("runId"));
        if(!row)return sendJson(res,404,{error:"找不到这条运行记录。"});
        return sendJson(res,200,{run:row,accounts:notificationDetails.forRun(row),sourceNotice:"只展示该轮已保存的明细，未记录的来源不会推测补齐。"});
      }catch(error){return sendJson(res,error.public?error.status:500,{error:error.public?error.message:"读取积分明细失败。"});}
    }
    if (method !== "POST") return sendJson(res,405,{error:"请求方法不支持。"});
    let sameOrigin=true;
    if(req.headers.origin){try{const origin=new URL(req.headers.origin);sameOrigin=["http:","https:"].includes(origin.protocol)&&origin.host===req.headers.host;}catch{sameOrigin=false;}}
    if(req.headers["x-rewards-notification-write"]!=="1" || !/^application\\/json(?:;|$)/i.test(req.headers["content-type"]||"") || !sameOrigin || req.headers["sec-fetch-site"]==="cross-site")return sendJson(res,403,{error:"请通过当前面板的通知设置操作。"});
    let body;
    try{body=await readJsonBody(req,32768);}catch{return sendJson(res,400,{error:"通知请求格式无效或内容过大。"});}
    try {
      if(pathname.endsWith("/send-run")) {
        if(!body || Array.isArray(body) || typeof body!=="object" || Object.keys(body).length!==1 || typeof body.runId!=="string" || !body.runId || body.runId.length>256 || /[\\u0000-\\u001f\\u007f]/.test(body.runId))return sendJson(res,400,{error:"请选择一条已结束的运行记录。"});
        const row=notificationRun(body.runId);
        return sendJson(res,200,await pushplus.sendHistory(row,notificationDetails.forRun(row)));
      }
      if(pathname.endsWith("/test")) {
        if(!body || Array.isArray(body) || typeof body!=="object" || Object.keys(body).some(k=>k!=="email") || (Object.hasOwn(body,"email")&&!validNotificationEmail(body.email)))return sendJson(res,400,{error:"测试通知只使用已保存的配置。"});
        return sendJson(res,200,await pushplus.test(body.email));
      }
      return sendJson(res,200,pushplus.save(body));
    } catch(error) {return sendJson(res,error.public?error.status:500,{error:error.public?error.message:"通知设置操作失败，请检查数据目录权限。"});}
  }

  // live
`);
  return text;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const file='/usr/src/rewards-dashboard/server.js';
  fs.writeFileSync(file,patchPushPlusDashboard(fs.readFileSync(file,'utf8')));
  console.log('PASS: PushPlus dashboard notification integration installed');
}
