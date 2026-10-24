import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..');
let require=createRequire(import.meta.url);
try{require.resolve('acorn');}catch{require=createRequire(path.join(root,'.test-work/tools/package.json'));}
const acorn=require('acorn'),walk=require('acorn-walk'),parse5=require('parse5');
const original=path.join(root,'.test-work/image/dashboard'),localized=path.join(root,'dashboard-zh-CN');
const results=[];
function check(name,fn){fn();results.push({name,status:'PASS'});console.log('PASS: '+name);}
function cron(dir){const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(dir,'lib/cron.js'),'utf8'),{module,Date,Set});return module.exports;}
const en=cron(original),zh=cron(localized);
check('Cron validation and next-run calculations unchanged',()=>{
  for(let i=0;i<250;i++) {
    const expr=`${i%60} ${i%24} * * ${i%8}`;assert.equal(zh.isValidCron(expr),en.isValidCron(expr));
  }
  for(const expr of ['0 9 * * *','*/15 * * * *','0 */6 * * *','30 8 * * 1-5','0 9,21 * * *','0 0 1 * *','0 0 29 2 *','bad','99 99 * * *']) {
    const after=new Date('2026-10-15T01:30:00Z');
    assert.equal(zh.nextRun(expr,after)?.toISOString(),en.nextRun(expr,after)?.toISOString());
  }
  assert.equal(zh.describeCron('0 9 * * *'),'每天 09:00');
  assert.equal(zh.describeCron('0 8 * * 1-5'),'工作日 08:00');
  assert.equal(zh.describeCron('*/15 * * * *'),'每 15 分钟');
});
const files=['app.js','api.js','util.js','charts.js',...fs.readdirSync(path.join(original,'public/views')).map(x=>'views/'+x)];
function nodes(file){const ast=acorn.parse(fs.readFileSync(file,'utf8'),{ecmaVersion:'latest',sourceType:'module'});const keys=[],strings=[];walk.simple(ast,{Property:n=>{if(!n.computed)keys.push(n.key.name||n.key.value);},Literal:n=>{if(typeof n.value==='string')strings.push(n.value);}});return {keys:keys.sort(),strings};}
check('Config/data property keys and control protocol values preserved',()=>{
  for(const file of files) {
    const a=nodes(path.join(original,'public',file)),b=nodes(path.join(localized,'public',file));
    const expectedKeys=file==='util.js'?[...a.keys,'hour12','timeZone'].sort():file==='api.js'?[...a.keys,'accountManagement','createAccount'].sort():a.keys;
    assert.deepEqual(b.keys,expectedKeys,file);
    const critical=s=>s.startsWith('/api/')||s.startsWith('#')||['GET','POST','PUT','PATCH','DELETE','start','stop','restart','shutdown','idle','running','starting','stopping','success','warn','error','local','remote','skip','grace-period','run-on-startup','whitelist','blacklist','***REDACTED***'].includes(s);
    const addedProtocol=file==='api.js'?['POST','POST','GET','DELETE','/api/dashboard-accounts/','/api/account-management','/api/accounts','/api/accounts']:[];
    assert.deepEqual(b.strings.filter(critical).sort(),[...a.strings.filter(critical),...addedProtocol].sort(),file);
  }
});
check('Static control IDs and non-translatable attributes preserved',()=>{
  const index=dir=>{
    const tree=parse5.parse(fs.readFileSync(path.join(dir,'public/index.html'),'utf8')),ids={};
    function visit(n){const id=n.attrs?.find(x=>x.name==='id')?.value;if(id)ids[id]=Object.fromEntries(n.attrs.filter(a=>!['aria-label','title','placeholder','alt'].includes(a.name)).map(a=>[a.name,a.value]));for(const c of n.childNodes||[])visit(c);}visit(tree);return ids;
  };
  assert.deepEqual(index(localized),index(original));
});
const util=await import(pathToFileURL(path.join(localized,'public/util.js')).href);
check('Chinese display formatting leaves raw state/config values intact',()=>{
  util.setTimeZone('Asia/Jakarta');
  assert.equal(util.pillParts('running').label,'运行中');
  assert.equal(util.pillParts('running').cls,'pill-running');
  assert.equal(util.fmtDuration(65),'1 分 5 秒');
  assert.equal(util.tzDayKey('2026-10-14T18:00:00Z'),'2026-10-15');
  assert(!/[AP]M/.test(util.fmtDateTime('2026-10-15T02:00:00Z')));
  assert(util.displayMessage('Schedule writes are disabled. Set API_ALLOW_SCHEDULE_WRITE=true to enable.').includes('此管理面板'));
  assert.equal(util.displayMessage('unrecognized original log text'),'unrecognized original log text');
});
fs.mkdirSync(path.join(root,'reports'),{recursive:true});
fs.writeFileSync(path.join(root,'reports/zh-CN-unit-tests.json'),JSON.stringify({checkedAt:new Date().toISOString(),results},null,2)+'\n');
