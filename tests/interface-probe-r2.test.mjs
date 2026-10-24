import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
const {probe,cookieHeader}=createRequire(import.meta.url)('../scripts/rewards-interface-probe-r2.cjs');
fs.mkdirSync('.test-work',{recursive:true});
const directory=fs.mkdtempSync(path.resolve('.test-work/interface-probe-fixture-'));fs.mkdirSync(path.join(directory,'dist/util'),{recursive:true});
const payload={url:'https://www.bing.com/rewards/test',source:'flyout',headers:{Cookie:'private-cookie-never-log'}};
const launch=(exe,args,options)=>spawn(exe,args,{...options,cwd:directory});
test('Actual worker exits with a complete sanitized response even with live handles in the HTTP client',async()=>{
 fs.writeFileSync(path.join(directory,'package.json'),'{}');
 fs.writeFileSync(path.join(directory,'dist/util/Http.js'),`exports.default=class {async request(){setInterval(()=>{},1000);return {status:200,data:{userInfo:{isRewardsUser:true,profile:{},balance:100,private:'private-cookie-never-log'},flyoutResult:{userStatus:{isRewardsUser:true,counters:{PCSearch:[{pointProgress:6,pointProgressMax:60}]}}}}}}}`);
 const r=await probe(payload,launch);assert.equal(r.http,200);assert.equal(r.validAccount,true);assert.equal(r.mobileFieldPresent,false);assert.equal(r.mobile.known,false);assert.equal(r.desktop.max,60);assert(!JSON.stringify(r).includes('private-cookie'));
});
test('A hanging transport is killed independently and returns a timeout fact',async()=>{
 fs.writeFileSync(path.join(directory,'dist/util/Http.js'),`exports.default=class {request(){return new Promise(()=>{});}}`);
 const start=Date.now();assert.deepEqual(await probe(payload,launch,200),{error:'timeout'});assert(Date.now()-start<2500);
});
test('Only destination cookies and unexpired values enter the intended request',()=>{
 const cookies=[{domain:'.bing.com',name:'valid',value:'yes',expires:-1,path:'/'},{domain:'evil-bing.com',name:'invalid',value:'no',expires:-1,path:'/'},{domain:'.bing.com',name:'expired',value:'no',expires:1,path:'/'}];
 assert.equal(cookieHeader(cookies,payload.url),'valid=yes');
});
test('Receiver discards arbitrary text, full identities, credentials and unknown fields',async()=>{
 const {cleanInterfaceReport:cleanReport}=await import('../scripts/clean-probe-report.mjs');
 const clean=cleanReport({readOnly:true,rewardsTaskStarted:false,version:2,complete:true,token:'secret',accounts:[{account:1,email:'full@example.invalid',accountHint:'1234',platform:'mobile',endpoints:[{source:'flyout',http:200,password:'secret',bodyType:'object',error:'secret',mobile:{known:false},desktop:{known:true,max:60}}]}]});
 assert(!JSON.stringify(clean).includes('secret'));assert(!JSON.stringify(clean).includes('full@example'));assert.equal(clean.accounts[0].endpoints[0].mobile.known,false);
});
