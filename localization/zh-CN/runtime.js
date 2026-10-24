export function displayPlatform(value) {
  return {desktop:'桌面端',mobile:'移动端'}[value]||value;
}
export function displayLevel(value) {
  return {debug:'调试',info:'信息',warn:'警告',error:'错误'}[value]||value;
}
export function themeLabel(value) {return value==='Default'?'默认':value;}
const messages={
  'Not scheduled':'未设置计划',
  'started':'已启动',
  'started after dashboard restart':'管理面板重启后已补跑',
  'skipped (a run was already in progress)':'已跳过：已有任务正在运行',
  'skipped (the API already had a run active)':'已跳过：API 已有任务正在运行',
  'missed run skipped after dashboard restart':'已跳过管理面板离线期间错过的任务',
  'Control API unreachable':'无法连接控制 API',
  'Control API request timed out':'控制 API 请求超时',
  'Dashboard server unreachable':'无法连接管理面板服务',
  'Internal server error':'服务器内部错误',
  'Not found':'未找到资源',
  'Authentication required':'需要身份认证',
  'Invalid JSON body':'JSON 请求格式无效',
  'Config writes are disabled. Set API_ALLOW_CONFIG_WRITE=true to enable.':'配置写入已关闭。需在脚本环境中设置 API_ALLOW_CONFIG_WRITE=true 后重建容器。',
  'Schedule writes are disabled. Set API_ALLOW_SCHEDULE_WRITE=true to enable.':'脚本容器计划写入已关闭。此部署使用管理面板调度器，请选择“此管理面板”。',
  'Per-request env overrides are disabled. Set API_ALLOW_ENV_OVERRIDES=true to enable.':'任意环境变量覆盖已关闭。',
  'Control API rejected our token - CONTROL_API_TOKEN must match the API\'s API_TOKEN.':'控制 API 拒绝了令牌。请核对 CONTROL_API_TOKEN 与 API_TOKEN 是否一致。',
  'Invalid cron expression (needs 5 fields).':'cron 表达式无效，需要 5 个字段。',
  'Invalid cron expression (5 fields, e.g. "0 9 * * *").':'cron 表达式无效，需要 5 个字段，例如 "0 9 * * *"。',
};
export function displayMessage(value) {
  if(value==null)return '';
  const text=String(value);
  if(Object.hasOwn(messages,text))return messages[text];
  if(text.startsWith('failed: '))return '启动失败：'+displayMessage(text.slice(8));
  const grace=/^missed run skipped \(outside (\d+)-minute grace period\)$/.exec(text);
  if(grace)return `已跳过错过的任务：超过 ${grace[1]} 分钟宽限期`;
  // Unknown task errors and log content remain verbatim for diagnosis.
  return text;
}
