import fs from 'node:fs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
function extractApplication(gz,repo) {
  const b=gunzipSync(gz);
  const prefix=repo.startsWith('mgrimace')?'usr/src/rewards-dashboard/':'usr/src/microsoft-rewards-script/';
  const dest=repo.startsWith('mgrimace')?'.test-work/image/dashboard':'.test-work/image/script';
  for(let off=0;off+512<=b.length;) {
    const header=b.subarray(off,off+512);
    const name=header.subarray(0,100).toString().replace(/\0.*$/,'');
    const size=parseInt(header.subarray(124,136).toString().replace(/\0.*$/,'').trim()||'0',8);
    if(!Number.isFinite(size))throw new Error('Invalid tar size');
    const type=header[156];
    if(name.startsWith(prefix)&&!name.split('/').includes('..')&&(type===48||type===0)) {
      const target=path.join(dest,name.slice(prefix.length));
      fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.writeFileSync(target,b.subarray(off+512,off+512+size));
    }
    off+=512+Math.ceil(size/512)*512;
  }
}
const images = [
  ['thenetsky/microsoft-rewards-script', '4'],
  ['thenetsky/microsoft-rewards-script', '4.3.2'],
  ['mgrimace/rewards-dashboard', 'latest'],
];
const results = [];
for (const [repo, tag] of images) {
  try {
    const auth = await fetch(`https://ghcr.io/token?service=ghcr.io&scope=repository:${repo}:pull`, {signal: AbortSignal.timeout(20000)});
    if (!auth.ok) throw new Error(`registry auth HTTP ${auth.status}`);
    const {token} = await auth.json();
    const r = await fetch(`https://ghcr.io/v2/${repo}/manifests/${tag}`, {
      headers: {Authorization: `Bearer ${token}`, Accept: 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json'},
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(`manifest HTTP ${r.status}`);
    const m = await r.json();
    const amd=m.manifests?.find(x=>x.platform?.os==='linux'&&x.platform?.architecture==='amd64');
    const manifest=amd?await (await fetch(`https://ghcr.io/v2/${repo}/manifests/${amd.digest}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.oci.image.manifest.v1+json'},signal:AbortSignal.timeout(20000)})).json():m;
    const config=await (await fetch(`https://ghcr.io/v2/${repo}/blobs/${manifest.config.digest}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)})).json();
    results.push({image:`ghcr.io/${repo}:${tag}`, digest:r.headers.get('docker-content-digest'), platforms:m.manifests?.map(x=>x.platform), created:config.created, labels:config.config?.Labels, layers:manifest.layers.map(x=>({digest:x.digest,size:x.size})), verified:'manifest and amd64 configuration; layers not pulled'});
    if(tag!=='4') {
      // Extract only regular application files from small layers for image/source compatibility checks.
      const selected=repo.startsWith('mgrimace')?[6,7,8,9]:[7,8,11,12,13,14,15,16,18];
      for(const layer of selected.map(i=>manifest.layers[i]).filter(x=>x&&x.size<2000000)) {
        const blob=await fetch(`https://ghcr.io/v2/${repo}/blobs/${layer.digest}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(45000)});
        if(!blob.ok)throw new Error('Application layer fetch failed');
        extractApplication(Buffer.from(await blob.arrayBuffer()),repo);
      }
      results.at(-1).verified='manifest, amd64 configuration, and selected application layers; no container pull/start';
    }
  } catch (e) { results.push({image:`ghcr.io/${repo}:${tag}`, error:e.message}); }
}
fs.mkdirSync('reports', {recursive:true});
fs.writeFileSync('reports/images.json', JSON.stringify({checkedAt:new Date().toISOString(),results},null,2)+'\n');
console.log(JSON.stringify(results.map(({layers,...r})=>r),null,2));
