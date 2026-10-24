import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
const {parseQuotaSource}=createRequire(import.meta.url)('../scripts/quota-source-parser.cjs');
const rows=[{pointProgress:12,pointProgressMax:60}];
test('Direct authenticated JSON provides independent mobile quota only when explicitly returned',()=>{
 const r=parseQuotaSource({dashboard:{userStatus:{availablePoints:100,counters:{pcSearch:rows,mobileSearch:rows}}}});assert.equal(r.mobile.known,true);assert.equal(r.mobile.remaining,48);
 assert.equal(parseQuotaSource({dashboard:{userStatus:{availablePoints:100,counters:{pcSearch:rows}}}}).mobile.known,false);
});
test('Flight parsing reads page data without executing downloaded scripts or copying identity fields',()=>{
 const object={userStatus:{availablePoints:100,counters:{MobileSearch:rows}},email:'private@example.invalid',cookie:'private'};
 const chunk='1:'+JSON.stringify(object)+'\n';const html='<script>globalThis.bad=true;self.__next_f.push([1,'+JSON.stringify(chunk)+']);</script>';
 const r=parseQuotaSource(html);assert.equal(r.flightChunks,1);assert.equal(r.mobile.earned,12);assert.equal(globalThis.bad,undefined);assert(!JSON.stringify(r).includes('private'));
});
test('An unauthenticated page, public labels or an ambiguous stream never become a guessed quota',()=>{
 assert.equal(parseQuotaSource('<p>Mobile search: 60</p>').mobile.known,false);
 assert.equal(parseQuotaSource({mobileSearch:rows}).mobile.known,false);
 const chunk='1:'+JSON.stringify({availablePoints:100,mobileSearch:rows})+'\n2:'+JSON.stringify({availablePoints:100,mobileSearch:[{pointProgress:18,pointProgressMax:60}]})+'\n';
 const r=parseQuotaSource('self.__next_f.push([1,'+JSON.stringify(chunk)+']);');assert.equal(r.mobile.conflicting,true);assert.equal(r.mobile.known,false);
});
test('The consolidated actual worker returns sanitized page evidence and exits with HTTP handles alive',async()=>{
 const require=createRequire(import.meta.url),{probe}=require('../scripts/rewards-quota-candidates.cjs');
 fs.mkdirSync('.test-work',{recursive:true});
 const dir=fs.mkdtempSync(path.resolve('.test-work/quota-worker-'));fs.mkdirSync(path.join(dir,'dist/util'),{recursive:true});fs.writeFileSync(path.join(dir,'package.json'),'{}');
 fs.writeFileSync(path.join(dir,'dist/util/Http.js'),'exports.default=class {async request(){setInterval(()=>{},1000);return {status:200,data:{dashboard:{userStatus:{availablePoints:100,counters:{mobileSearch:[{pointProgress:3,pointProgressMax:60}]}}}}};}}');
 const r=await probe({source:'xhr',url:'https://rewards.bing.com/api/getuserinfo?type=1',headers:{Cookie:'private'}},(exe,args,opt)=>spawn(exe,args,{...opt,cwd:dir}));
 assert.equal(r.http,200);assert.equal(r.mobile.known,true);assert.equal(r.mobile.remaining,57);assert(!JSON.stringify(r).includes('private'));
});
test('The candidate receiver keeps all four source results and removes private response fields',async()=>{
 const {cleanQuotaReport:cleanReport}=await import('../scripts/clean-probe-report.mjs');
 const sources=['xhr','earn','dashboard','flyout'];
 const r=cleanReport({readOnly:true,rewardsTaskStarted:false,version:3,complete:true,raw:'private',accounts:[{account:1,accountHint:'1234',platform:'mobile',email:'private@example.invalid',endpoints:sources.map(source=>({source,http:200,accountDataPresent:true,mobile:{present:true,known:true,max:60,earned:3,remaining:57},pc:{known:false},raw:'private',headers:{Cookie:'private'}}))}]});
 assert.equal(r.version,3);assert.deepEqual(r.accounts[0].endpoints.map(e=>e.source),sources);assert.equal(r.accounts[0].endpoints[0].mobile.remaining,57);assert(!JSON.stringify(r).includes('private'));
});
