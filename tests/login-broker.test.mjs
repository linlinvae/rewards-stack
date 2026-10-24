import test from 'node:test';
import assert from 'node:assert/strict';
import {LoginBroker,attachLoginBroker} from '../docker/login-broker.mjs';
import {EventEmitter} from 'node:events';
test('Account binding, validation, one-use answer and no secret in public listing',()=>{
  const broker=new LoginBroker();broker.begin({ACCOUNT_1_EMAIL:'first@example.invalid',ACCOUNT_2_EMAIL:'second@example.invalid'});
  assert.throws(()=>broker.create({email:'other@example.invalid',kind:'code',platform:'mobile'}));
  const a=broker.create({email:'first@example.invalid',kind:'code',platform:'mobile'}),b=broker.create({email:'second@example.invalid',kind:'email',platform:'desktop'});
  assert.throws(()=>broker.answer({id:a.id,value:'not-a-code'}));
  broker.answer({id:a.id,value:'654321'});assert(!JSON.stringify(broker.list()).includes('654321'));assert.equal(broker.list().length,1);
  assert.throws(()=>broker.answer({id:a.id,value:'111111'}));
  assert.deepEqual(broker.read(a.id),{state:'answered',value:'654321'});assert.equal(broker.read(a.id).state,'expired');
  broker.answer({id:b.id,value:'recovery@example.invalid'});assert.equal(broker.read(b.id).value,'recovery@example.invalid');
});
test('Expiry, cancellation and previous-run authorization are rejected',()=>{
  let now=1;const broker=new LoginBroker({now:()=>now,ttlMs:100});
  const first=broker.begin({ACCOUNT_1_EMAIL:'first@example.invalid'});assert(broker.authorize(first));
  const a=broker.create({email:'first@example.invalid',kind:'code',platform:'mobile'});
  now=102;assert.equal(broker.list().length,0);assert.throws(()=>broker.answer({id:a.id,value:'123456'}));
  const b=broker.create({email:'first@example.invalid',kind:'code',platform:'mobile'});broker.answer({id:b.id,cancel:true});assert.equal(broker.read(b.id).value,null);
  broker.begin({ACCOUNT_1_EMAIL:'first@example.invalid'});assert(!broker.authorize(first));assert(!broker.authorize(''));
});
test('Child run rotation and stop cleanup use the final selected account environment',()=>{
  const pm=new EventEmitter();pm._resolveEnv=env=>env;
  const broker=attachLoginBroker(pm,3010);
  const env=pm._resolveEnv({ACCOUNT_3_EMAIL:'third@example.invalid'});assert(broker.authorize(env.STACK_LOGIN_BRIDGE_SECRET));
  assert.throws(()=>broker.create({email:'first@example.invalid',kind:'code',platform:'mobile'}));
  broker.create({email:'third@example.invalid',kind:'code',platform:'mobile'});
  pm.emit('status',{state:'stopping'});assert.equal(broker.list().length,0);assert(!broker.authorize(env.STACK_LOGIN_BRIDGE_SECRET));
});
test('Only OTP values join log redaction; account email remains available for run accounting',()=>{
  const key=Symbol.for('rewards-stack.register-secret'),original=globalThis[key],registered=[];
  globalThis[key]=value=>registered.push(value);
  try{
    const broker=new LoginBroker();broker.begin({ACCOUNT_1_EMAIL:'first@example.invalid'});
    const email=broker.create({email:'first@example.invalid',kind:'email',platform:'mobile'});
    broker.answer({id:email.id,value:'first@example.invalid'});broker.read(email.id);
    const code=broker.create({email:'first@example.invalid',kind:'code',platform:'mobile'});
    broker.answer({id:code.id,value:'654321'});
    assert(registered.includes('654321'));assert(!registered.includes('first@example.invalid'));
  }finally{if(original)globalThis[key]=original;else delete globalThis[key];}
});
