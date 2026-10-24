import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ManagedAccountStore} from '../docker/account-manager.mjs';
function fixture(){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'rewards-accounts-'));const file=path.join(directory,'managed-accounts.json');return {directory,file,env:{STACK_ALLOW_ACCOUNT_CREATE:'true',ACCOUNT_1_EMAIL:'existing@example.invalid',ACCOUNT_1_PASSWORD:'existing-secret'},cleanup:()=>fs.rmSync(directory,{recursive:true,force:true})};}
test('append, persist and reload without changing environment accounts or returning credentials',()=>{
  const f=fixture();try{
    const secrets=[];const store=new ManagedAccountStore({...f,registerSecret:secret=>secrets.push(secret)});
    const password='a$#\'"中文-unique-password';
    const result=store.add({email:'new@example.invalid',password});
    assert.equal(result.index,2);assert(!JSON.stringify(result).includes(password));assert.deepEqual(secrets,[password]);
    assert.equal(f.env.ACCOUNT_1_PASSWORD,'existing-secret');assert.equal(f.env.ACCOUNT_2_PASSWORD,password);
    const env={STACK_ALLOW_ACCOUNT_CREATE:'true',ACCOUNT_1_EMAIL:'existing@example.invalid',ACCOUNT_1_PASSWORD:'existing-secret'};
    const restored=new ManagedAccountStore({file:f.file,env});
    assert.equal(env.ACCOUNT_2_PASSWORD,password);assert.equal(restored.records.length,1);
    if(process.platform!=='win32')assert.equal(fs.statSync(f.file).mode&0o777,0o600);
  }finally{f.cleanup();}
});
test('duplicate, busy and disabled requests preserve data and environment',()=>{
  const f=fixture();try{
    const store=new ManagedAccountStore(f);store.add({email:'one@example.invalid'});const before=fs.readFileSync(f.file,'utf8');
    for(const [body,options,status] of [[{email:'EXISTING@example.invalid'},undefined,409],[{email:'ONE@example.invalid'},undefined,409],[{email:'busy@example.invalid'},{idle:false},409]])assert.throws(()=>store.add(body,options),e=>e.status===status);
    assert.equal(fs.readFileSync(f.file,'utf8'),before);assert(!f.env.ACCOUNT_3_EMAIL);
    const disabled=new ManagedAccountStore({file:path.join(f.directory,'other.json'),env:{}});
    assert.throws(()=>disabled.add({email:'no@example.invalid'}),e=>e.status===403);
  }finally{f.cleanup();}
});
test('untrusted fields, controls and invalid values never create an account',()=>{
  const f=fixture();try{
    const store=new ManagedAccountStore(f);
    const bad=[null,[],{email:'bad'},{email:'ok@example.invalid',password:'secret\0value'},{email:'ok@example.invalid',password:' padded '},{email:'ok@example.invalid',password:23},{email:'ok@example.invalid',geoLocale:'../JP'},{email:'ok@example.invalid',langCode:'../../config'},{email:'ok@example.invalid',env:{NODE_OPTIONS:'x'}},JSON.parse('{"email":"ok@example.invalid","__proto__":{"polluted":true}}')];
    for(const input of bad)assert.throws(()=>store.add(input),e=>e.status===400);
    assert(!fs.existsSync(f.file));assert.equal({}.polluted,undefined);
  }finally{f.cleanup();}
});
test('failed disk write leaves live account environment unchanged; reserved slots are respected',()=>{
  const f=fixture();try{
    f.env.ACCOUNT_5_PASSWORD='reserved';const store=new ManagedAccountStore(f);
    fs.mkdirSync(f.file);assert.throws(()=>store.add({email:'new@example.invalid',password:'secret'}));assert(!f.env.ACCOUNT_6_EMAIL);
    fs.rmdirSync(f.file);assert.equal(store.add({email:'new@example.invalid'}).index,6);
  }finally{f.cleanup();}
});
test('startup refuses collisions or symbolic files without overwriting existing accounts',()=>{
  const f=fixture();try{
    const store=new ManagedAccountStore(f);store.add({email:'new@example.invalid'});
    const env={ACCOUNT_1_EMAIL:'existing@example.invalid',ACCOUNT_2_EMAIL:'different@example.invalid'};
    assert.throws(()=>new ManagedAccountStore({file:f.file,env}),/conflicts/);
    assert.equal(env.ACCOUNT_2_EMAIL,'different@example.invalid');
  }finally{f.cleanup();}
});
test('Delete managed account, restart and add same email again preserves unrelated accounts',()=>{
  const f=fixture();try{
    const store=new ManagedAccountStore(f);store.add({email:'new@example.invalid',password:'old-new-secret'});store.add({email:'keep@example.invalid',password:'keep-secret'});
    const before=fs.readFileSync(f.file,'utf8');
    assert.throws(()=>store.remove('new@example.invalid',{idle:false}),e=>e.status===409);assert.equal(fs.readFileSync(f.file,'utf8'),before);
    const removed=store.remove('NEW@example.invalid');assert.equal(removed.removed,true);assert.equal(f.env.ACCOUNT_2_EMAIL,'');assert.equal(f.env.ACCOUNT_2_PASSWORD,'');assert.equal(f.env.ACCOUNT_3_PASSWORD,'keep-secret');
    const saved=fs.readFileSync(f.file,'utf8');assert(!saved.includes('old-new-secret'));assert(saved.includes('keep-secret'));
    const env={STACK_ALLOW_ACCOUNT_CREATE:'true',ACCOUNT_1_EMAIL:'existing@example.invalid',ACCOUNT_1_PASSWORD:'existing-secret'};
    const restored=new ManagedAccountStore({file:f.file,env});assert(!env.ACCOUNT_2_EMAIL);assert.equal(env.ACCOUNT_3_PASSWORD,'keep-secret');
    restored.add({email:'new@example.invalid',password:'replacement-secret'});assert.equal(restored.records.length,2);assert.equal(env.ACCOUNT_1_PASSWORD,'existing-secret');
  }finally{f.cleanup();}
});
test('Environment account removal persists without editing env file and permits re-add',()=>{
  const f=fixture();try{
    const store=new ManagedAccountStore(f);store.add({email:'keep@example.invalid'});store.remove('existing@example.invalid');assert.equal(f.env.ACCOUNT_1_EMAIL,'');
    store.add({email:'existing@example.invalid',password:'new-secret'});
    const env={STACK_ALLOW_ACCOUNT_CREATE:'true',ACCOUNT_1_EMAIL:'existing@example.invalid',ACCOUNT_1_PASSWORD:'original-secret'};
    const restored=new ManagedAccountStore({file:f.file,env});assert.equal(env.ACCOUNT_1_EMAIL,'');assert.equal(env.ACCOUNT_1_PASSWORD,'');assert.equal(env.ACCOUNT_3_PASSWORD,'new-secret');assert.equal(restored.records.length,2);
    const changed={STACK_ALLOW_ACCOUNT_CREATE:'true',ACCOUNT_1_EMAIL:'different@example.invalid',ACCOUNT_1_PASSWORD:'unrelated'};
    assert.throws(()=>new ManagedAccountStore({file:f.file,env:changed}),/identity changed/);assert.equal(changed.ACCOUNT_1_PASSWORD,'unrelated');
  }finally{f.cleanup();}
});
test('Delete disk failure, disabled access and invalid identities preserve live account configuration',()=>{
  const f=fixture();try{
    const store=new ManagedAccountStore(f);store.add({email:'new@example.invalid'});
    const saved=fs.readFileSync(f.file);fs.unlinkSync(f.file);fs.mkdirSync(f.file);
    assert.throws(()=>store.remove('new@example.invalid'));assert.equal(f.env.ACCOUNT_2_EMAIL,'new@example.invalid');assert.equal(store.records.length,1);
    fs.rmdirSync(f.file);fs.writeFileSync(f.file,saved);assert.throws(()=>store.remove('../bad'));assert.equal(store.remove('absent@example.invalid').removed,false);
    store.enabled=false;assert.throws(()=>store.remove('new@example.invalid'),e=>e.status===403);
  }finally{f.cleanup();}
});
