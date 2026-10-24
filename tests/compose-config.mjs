import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const version='v5.6.0';
const base=`https://github.com/docker/compose/releases/download/${version}/`;
const exe=path.join(root,'.test-work/docker-compose.exe');
const asset='docker-compose-windows-x86_64.exe';
if(process.platform!=='win32')throw new Error('This optional fixture downloads the Windows Compose binary only. On Linux run docker compose config -q.');
fs.mkdirSync(path.dirname(exe),{recursive:true});
const release=await (await fetch(`https://api.github.com/repos/docker/compose/releases/tags/${version}`,{signal:AbortSignal.timeout(30000)})).json();
const binary=release.assets.find(x=>x.name===asset);
const expected=binary.digest?.replace(/^sha256:/,'');assert.match(expected,/^[a-f0-9]{64}$/);
if(!fs.existsSync(exe)){
  const r=await fetch(binary.url,{headers:{Accept:'application/octet-stream'},signal:AbortSignal.timeout(120000)});
  assert(r.ok);fs.writeFileSync(exe,Buffer.from(await r.arrayBuffer()));
}
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex'),expected);
const envPath=path.join(root,'.env');
// Never overwrite an actual .env. Fake, temporary credentials only.
fs.writeFileSync(envPath,fs.readFileSync(path.join(root,'.env.example'),'utf8').replace(/^API_TOKEN=$/m,'API_TOKEN='+crypto.randomBytes(32).toString('hex')).replace(/^DASHBOARD_PASSWORD=$/m,'DASHBOARD_PASSWORD='+crypto.randomBytes(24).toString('hex')),{flag:'wx',mode:0o600});
try {
  const run=args=>{
    const r=spawnSync(exe,['--project-directory',root,'--env-file',envPath,'-f',path.join(root,'compose.yaml'),...args],{cwd:root,encoding:'utf8',windowsHide:true});
    if(r.error)throw r.error;
    assert.equal(r.status,0,r.stderr);return r.stdout;
  };
  run(['config','-q']);
  const c=JSON.parse(run(['config','--format','json']));
  assert.equal(c.services.script.environment.API_TOKEN,c.services.dashboard.environment.CONTROL_API_TOKEN);
  assert.equal(c.services.dashboard.ports[0].host_ip,'127.0.0.1');
  assert(!c.services.script.ports);
  const report={checkedAt:new Date().toISOString(),compose:version,binarySha256:expected,config:'PASS',resolvedSecurityInvariants:'PASS',scope:'Standalone official Compose config -q, no Docker daemon or container startup; temporary fake .env removed'};
  fs.writeFileSync(path.join(root,'reports/compose-config.json'),JSON.stringify(report,null,2)+'\n');
  console.log('PASS: official Docker Compose '+version+' config -q and resolved security invariants. No daemon used.');
} finally {fs.unlinkSync(envPath);}
