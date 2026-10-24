import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
const {NotificationDetails,sanitizeAccount,accountLines}=createRequire(import.meta.url)('../docker/notification-details.cjs');
function fixture(t){const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('CREATE TABLE runs(id TEXT PRIMARY KEY,status TEXT,start_ts TEXT,end_ts TEXT);CREATE TABLE activity(id INTEGER PRIMARY KEY,ts TEXT,kind TEXT,title TEXT,email TEXT,user_name TEXT,message TEXT)');return {db,details:new NotificationDetails(db)};}
const start='2026-10-22T01:00:00Z',end='2026-10-22T01:10:00Z';
const event=(overrides={})=>({ts:start,kind:'account-start',title:'ACCOUNT-START',email:'person@example.invalid',userName:'person',message:'Starting account: person@example.invalid | geoLocale: auto',...overrides});
test('Archive persists only numeric account facts and classified failures, sources are allowlisted',t=>{
  const {db,details}=fixture(t);db.prepare('INSERT INTO runs VALUES (?,?,?,?)').run(start,'running',start,null);
  details.ingest(event(),start);
  details.ingest(event({kind:'generic',title:'READ-TO-EARN',email:null,message:'Read article 1 | pointsGained=3 | currentBalance=103'}),start);
  details.ingest(event({kind:'generic',title:'SEARCH-MANAGER',email:null,message:'Search summary | mobile=10 | desktop=20 | bonus=0 | total=30'}),start);
  details.ingest(event({kind:'account-end',title:'ACCOUNT-END',message:'Completed account: person@example.invalid | pointsGained=33 | previousBalance=100 | currentBalance=133 | durationSeconds=60'}),start);
  details.ingest(event({kind:'account-error',title:'ACCOUNT-ERROR',error:'login secret-password=482617',message:'person@example.invalid: login secret-password=482617'}),start);
  const accounts=new NotificationDetails(db).forRun({id:start,startTs:start,endTs:end});assert.equal(accounts.length,1);const a=accounts[0];assert.equal(a.initialPoints,100);assert.equal(a.finalPoints,133);assert.equal(a.bySource.read,3);assert.equal(a.searchSummary.desktop,20);assert.equal(a.success,true);assert.equal(a.errorKind,'login');
  const stored=db.prepare('SELECT facts FROM pushplus_account_details').get().facts;assert(!stored.includes('482617'));assert(!stored.includes('secret-password'));
});
test('Old details backfill requires exact original run boundary and never uses current account balances',t=>{
  const {db,details}=fixture(t);const put=db.prepare('INSERT INTO activity(ts,kind,title,email,user_name,message) VALUES (?,?,?,?,?,?)');
  put.run(start,'run-start','RUN-START',null,'MAIN','Starting run');put.run(start,'account-start','ACCOUNT-START','old@example.invalid','old','Starting account: old@example.invalid | geoLocale: auto');
  put.run(end,'account-end','ACCOUNT-END','old@example.invalid','old','Completed account: old@example.invalid | pointsGained=20 | previousBalance=1000 | currentBalance=1020 | durationSeconds=20');
  const row={id:'old',startTs:start,endTs:end};const a=details.forRun(row);assert.equal(a.length,1);assert.equal(a[0].collectedPoints,20);assert.equal(a[0].finalPoints,1020);
  db.exec('DELETE FROM activity');assert.equal(new NotificationDetails(db).forRun(row)[0].finalPoints,1020);
  assert.deepEqual(details.forRun({id:'different-run',startTs:'2026-10-21T00:00:00Z',endTs:end}),[]);
});
test('Ambiguous account aliases do not assign another account point gains',t=>{
  const {details}=fixture(t);details.record('run',event({email:'same@one.invalid'}));details.record('run',event({email:'same@two.invalid',message:'Starting account: same@two.invalid | geoLocale: auto'}));
  // First start's explicit message matches person@example.invalid; add exact same alias pair.
  details.record('run',event({email:'same@one.invalid',message:'Starting account: same@one.invalid | geoLocale: auto'}));
  details.record('run',event({kind:'generic',title:'SEARCH-BING',email:null,userName:'same',message:'pointsGained=5 | currentBalance=100'}));
  for(const a of details.accounts('run'))assert.equal(a.bySource.search,undefined);
});
test('Account sanitizer strips arbitrary text, credentials and unknown source keys',()=>{
  const a=sanitizeAccount({email:'Person@example.invalid',success:true,initialPoints:Infinity,finalPoints:400,raw:'secret',error:'timeout password=secret',live:{gained:20,bySource:{read:3,'password=secret':7}},searchSummary:{mobile:10,desktop:10,bonus:0,url:'secret'}});
  assert.equal(a.email,'person@example.invalid');assert.equal(a.initialPoints,null);assert.equal(a.collectedPoints,20);assert.equal(a.errorKind,'timeout');assert(!JSON.stringify(a).includes('secret'));assert(!accountLines(a).join('\n').includes('Person@'));assert.equal(sanitizeAccount({email:'invalid'}),null);
});
