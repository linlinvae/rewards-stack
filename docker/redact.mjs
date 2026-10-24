// Small deployment overlay; upstream UI and task execution stay intact.
// Removes known credential values and common secret assignments from text logs.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {installBrowserStartupGuard} from './browser-startup-guard.mjs';

const secretKey = /password|token|secret|cookie|authorization|storage.?state/i;
const known = new Set();
for (const [key,value] of Object.entries(process.env)) {
  if (secretKey.test(key) && value) known.add(value);
}
function collect(value, key='') {
  if (value && typeof value === 'object') {
    for (const [k,v] of Object.entries(value)) collect(v,k);
  } else if (typeof value === 'string' && value && (secretKey.test(key) || key === 'url')) known.add(value);
}
try { collect(JSON.parse(fs.readFileSync(path.join(process.cwd(),'config','config.json'),'utf8')).webhook); } catch {}
const values = [...known].sort((a,b)=>b.length-a.length);
// New passwords saved via the authenticated account form must be redacted immediately.
globalThis[Symbol.for('rewards-stack.register-secret')] = value => {
  if(typeof value==='string'&&value&&!known.has(value)){known.add(value);values.push(value);values.sort((a,b)=>b.length-a.length);}
};
export function redact(text) {
  let s = String(text);
  for (const value of values) s = s.split(value).join('***REDACTED***');
  s = s.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+/gi,'$1 ***REDACTED***');
  s = s.replace(/((?:cookie|set-cookie|authorization)["']?\s*[:=]\s*)[^\r\n]*/gi,'$1***REDACTED***');
  s = s.replace(/((?:password|access_token|refresh_token|id_token|api_token|cookie|set-cookie|authorization)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,'$1***REDACTED***');
  return s;
}
function clean(value) {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,clean(v)]));
  return value;
}
// Sanitize before upstream buffers/emits logs, so SSE and SQLite see safe text.
if (process.env.STACK_ROLE === 'script') {
  const file = path.join(process.cwd(),'scripts','api','processManager.js');
  const {ProcessManager} = await import(pathToFileURL(file).href);
  const append = ProcessManager.prototype._appendLog;
  ProcessManager.prototype._appendLog = function(entry) {
    Object.assign(entry,clean(entry));
    return append.call(this,entry);
  };
  installBrowserStartupGuard(ProcessManager);
}
for (const stream of [process.stdout,process.stderr]) {
  const write = stream.write.bind(stream);
  stream.write = function(chunk,encoding,callback) {
    const text = typeof chunk === 'string' ? chunk : chunk.toString(typeof encoding === 'string' ? encoding : 'utf8');
    return write(redact(text),encoding,callback);
  };
}
