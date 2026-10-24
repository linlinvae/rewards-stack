// Tests real patched promptInput and HTTP bridge without Microsoft or a browser login.
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{canPromptForInput,promptInput}=require(path.join(process.cwd(),'dist/browser/auth/methods/LoginUtils.js'));
if(!canPromptForInput())throw Error('Web input unavailable');
const accountEmail=Object.entries(process.env).find(([key,value])=>/^ACCOUNT_\d+_EMAIL$/.test(key)&&value)?.[1];
try{for(const kind of ['email','code']){
  const value=await promptInput({accountEmail,platform:'mobile',question:kind==='email'?'Enter the email address to send the code to (waiting 60s): ':'Enter the 6-digit code (waiting 60s): ',validate:value=>kind==='email'?value.includes('@'):/^\d{6}$/.test(value)});
  if(!value)process.exit(3);
  console.log('LOGIN-FIXTURE '+kind+' accepted');
  if(kind==='code'&&value!=='482617')process.exit(4);
}}catch{process.exit(3);}
process.exit(0);
