// Build-time localization of display strings in the pinned Dashboard assets.
// IDs, CSS classes, request paths, config keys, enum values and raw logs are untouched.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {adapt} from '../localization/zh-CN/overrides.mjs';
const root=path.resolve(import.meta.dirname,'..');
let require=createRequire(import.meta.url);
try {require.resolve('acorn');}catch{require=createRequire(path.join(root,'.test-work/tools/package.json'));}
const acorn=require('acorn'),walk=require('acorn-walk'),parse5=require('parse5');
const source=path.join(root,'.test-work/image/dashboard');
const output=path.join(root,'dashboard-zh-CN');
const catalogFile=path.join(root,'localization/zh-CN/catalog.json');
const catalog=fs.existsSync(catalogFile)?JSON.parse(fs.readFileSync(catalogFile,'utf8')):{};
const inventory=new Map(),used=new Set(),hashes={};
const lockFile=path.join(root,'localization/zh-CN/source-lock.json');
const locked=JSON.parse(fs.readFileSync(lockFile,'utf8'));
const normalized=s=>s.trim().replace(/\s+/g,' ');
const keyOf=s=>normalized(s.replace(/__UI_SLOT_(\d+)__/g,'{$1}'));
function lookup(text,file,htmlContext=false) {
  const key=keyOf(text);
  if(/[A-Za-z]{2}/.test(key)&&!/^\{\d+\}$/.test(key)) {
    const item=inventory.get(key)||{text:key,files:new Set()};item.files.add(file);inventory.set(key,item);
  }
  const catalogKey=htmlContext&&Object.hasOwn(catalog,'@html:'+key)?'@html:'+key:key;
  if(!Object.hasOwn(catalog,catalogKey))return text;
  used.add(key);
  const translated=catalog[catalogKey].replace(/\{(\d+)\}/g,'__UI_SLOT_$1__');
  const leading=text.match(/^\s*/)[0],trailing=text.match(/\s*$/)[0];
  return leading+translated+trailing;
}
const htmlEscape=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const attrEscape=s=>htmlEscape(s).replace(/"/g,'&quot;');
function html(text,file) {
  const tree=parse5.parseFragment(text,{sourceCodeLocationInfo:true});const edits=[];
  function visit(node) {
    const loc=node.sourceCodeLocation;
    if(node.nodeName==='#text'&&loc) {
      const translated=lookup(node.value,file,true);
      if(translated!==node.value)edits.push([loc.startOffset,loc.endOffset,htmlEscape(translated)]);
    }
    for(const a of node.attrs||[])if(['title','aria-label','placeholder','alt'].includes(a.name)&&loc?.attrs?.[a.name]) {
      const translated=lookup(a.value,file,true);
      if(translated!==a.value){const l=loc.attrs[a.name];edits.push([l.startOffset,l.endOffset,`${a.name}="${attrEscape(translated)}"`]);}
    }
    for(const child of node.childNodes||[])visit(child);
    if(node.content)visit(node.content);
  }
  visit(tree);
  for(const [start,end,value] of edits.sort((a,b)=>b[0]-a[0]))text=text.slice(0,start)+value+text.slice(end);
  return text;
}
const isHtml=s=>/<\/?[a-zA-Z][\s\S]*?>/.test(s);
function js(text,file) {
  const ast=acorn.parse(text,{ecmaVersion:'latest',sourceType:file.startsWith('lib/')?'script':'module'}),edits=[];
  walk.ancestor(ast,{
    Literal(node,ancestors) {
      if(typeof node.value!=='string')return;
      const parent=ancestors.at(-2);
      // Object keys are data/protocol identifiers, even if they look like words.
      if(parent?.type==='Property'&&parent.key===node&&!parent.computed)return;
      if(parent?.type==='ImportDeclaration'||parent?.type==='ExportNamedDeclaration')return;
      const value=isHtml(node.value)?html(node.value,file):lookup(node.value,file);
      if(value!==node.value)edits.push([node.start,node.end,JSON.stringify(value)]);
    },
    TemplateLiteral(node) {
      let value='';node.quasis.forEach((q,i)=>{value+=q.value.cooked;if(i<node.expressions.length)value+=`__UI_SLOT_${i}__`;});
      const translated=isHtml(value)?html(value,file):lookup(value,file);
      if(translated===value)return;
      for(let i=0;i<node.expressions.length;i++)if(!translated.includes(`__UI_SLOT_${i}__`)) {
        const e=node.expressions[i];
        if(e.type!=='ConditionalExpression'||JSON.stringify([e.consequent.value,e.alternate.value].sort())!==JSON.stringify(['','s']))throw new Error(`Translation removes a non-plural expression ${i} (${text.slice(e.start,e.end)}) in ${file}`);
      }
      const chunks=translated.split(/(__UI_SLOT_\d+__)/);
      const result='`'+chunks.map(part=>{
        const match=/^__UI_SLOT_(\d+)__$/.exec(part);
        if(match){const e=node.expressions[Number(match[1])];return '${'+text.slice(e.start,e.end)+'}';}
        return part.replace(/\\/g,'\\\\').replace(/`/g,'\\`').replace(/\$\{/g,'\\${');
      }).join('')+'`';
      edits.push([node.start,node.end,result]);
    }
  });
  // Child expressions must be localized before embedding their original text.
  // Apply outer edits only after folding any enclosed edits into placeholder expressions.
  function fold(edit) {
    const children=edits.filter(e=>e!==edit&&e[0]>edit[0]&&e[1]<edit[1]);
    let value=edit[2];
    for(const child of children.filter(c=>!children.some(p=>p!==c&&p[0]<c[0]&&p[1]>c[1]))) {
      const original=text.slice(child[0],child[1]);const replacement=fold(child);
      if(value.includes(original))value=value.replace(original,replacement);
    }
    return value;
  }
  const outer=edits.filter(e=>!edits.some(p=>p!==e&&p[0]<e[0]&&p[1]>e[1]));
  for(const e of outer.sort((a,b)=>b[0]-a[0]))text=text.slice(0,e[0])+fold(e)+text.slice(e[1]);
  acorn.parse(text,{ecmaVersion:'latest',sourceType:file.startsWith('lib/')?'script':'module'});
  return text;
}
const files=['public/index.html','public/app.js','public/api.js','public/util.js','public/charts.js',...fs.readdirSync(path.join(source,'public/views')).filter(f=>f.endsWith('.js')).map(f=>'public/views/'+f),'lib/cron.js'];
for(const file of files) {
  const original=fs.readFileSync(path.join(source,file),'utf8');hashes[file]=crypto.createHash('sha256').update(original).digest('hex');
  if(hashes[file]!==locked.hashes[file])throw new Error(`Pinned v1.3.9 asset differs: ${file}; review translations before updating the source lock.`);
  let translated=file.endsWith('.html')?html(original,file):js(original,file);
  translated=adapt(file,translated);
  if(file==='public/index.html')translated=translated.replace('<html lang="en">','<html lang="zh-CN">').replace('</head>','    <link rel="stylesheet" href="/zh-CN.css" />\n  </head>');
  fs.mkdirSync(path.dirname(path.join(output,file)),{recursive:true});fs.writeFileSync(path.join(output,file),translated);
}
const manifest=JSON.parse(fs.readFileSync(path.join(source,'public/manifest.json'),'utf8'));
manifest.name='Microsoft Rewards 管理面板';manifest.short_name='Rewards 管理面板';manifest.description='查看 Microsoft Rewards 脚本的账号、积分、日志、运行记录和调度计划。';manifest.lang='zh-CN';
fs.writeFileSync(path.join(output,'public/manifest.json'),JSON.stringify(manifest,null,2)+'\n');
fs.writeFileSync(path.join(output,'public/package.json'),'{"type":"module"}\n');
fs.writeFileSync(path.join(output,'public/version.js'),'window.APP_VERSION = "v1.3.9 · 简体中文";\n');
fs.writeFileSync(path.join(output,'public/zh-CN.css'),'body { font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif; }\n');
fs.copyFileSync(path.join(root,'localization/zh-CN/runtime.js'),path.join(output,'public/zh-CN.js'));
for(const file of ['account-create.js','account-create.css','login-input.js','login-input.css','pushplus.js','run-pushplus.js','notification-view.js'])fs.copyFileSync(path.join(root,'localization/zh-CN',file),path.join(output,'public',file));
fs.writeFileSync(path.join(output,'public/sw.js'),fs.readFileSync(path.join(source,'public/sw.js'),'utf8').replace('rewards-dashboard-pwa-v1','rewards-dashboard-pwa-zh-CN-pushplus-routing-v7-reliability-v8'));
fs.mkdirSync(path.join(root,'localization/zh-CN'),{recursive:true});
fs.writeFileSync(path.join(root,'localization/zh-CN/inventory.json'),JSON.stringify([...inventory.values()].map(x=>({text:x.text,files:[...x.files],translated:used.has(x.text)})),null,2)+'\n');
fs.writeFileSync(path.join(root,'localization/zh-CN/source-lock.json'),JSON.stringify({baseImage:'ghcr.io/mgrimace/rewards-dashboard@sha256:b0363471e6a17323dc8a3a61616c4c8e4f47a8e4cdd897e9b84b304922b95e59',version:'v1.3.9',hashes},null,2)+'\n');
console.log(`Generated zh-CN assets. ${used.size}/${inventory.size} display candidates have catalog entries.`);
