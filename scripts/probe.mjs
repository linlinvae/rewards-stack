import fs from 'node:fs';
const mode = process.argv[2] || 'full';
async function request(url,headers={}) {
  return fetch(url,{headers,signal:AbortSignal.timeout(7000)});
}
async function json(url,headers) {
  const r=await request(url,headers);
  if(!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).pathname}`);
  return r.json();
}
try {
  if (mode==='script') {
    const t=process.env.API_TOKEN;
    if(!t || t.length<32) throw new Error('API token absent/weak');
    const b=`http://127.0.0.1:${process.env.API_PORT||3010}`;
    const h={Authorization:`Bearer ${t}`};
    const v=await json(`${b}/health`,h);
    if(!v.ok || !v.authRequired) throw new Error('API health/auth invariant failed');
    const s=await json(`${b}/schedule`,h);
    if(s.enabled || s.writable) throw new Error('Script scheduler must be disabled and read-only');
    const management=await json(`${b}/accounts/management`,h);
    if(typeof management.enabled!=='boolean'||typeof management.writable!=='boolean')throw new Error('Account management API missing');
  } else {
    const u=process.env.DASHBOARD_USERNAME,p=process.env.DASHBOARD_PASSWORD;
    if(!u||!p) throw new Error('Dashboard authentication missing');
    const b=`http://127.0.0.1:${process.env.PORT||8890}`;
    const h={Authorization:`Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`};
    const v=await json(`${b}/api/health`,h);
    if(!v.ok||!v.controlApi||!v.controlApiAuthOk) throw new Error('Dashboard cannot reach authenticated Control API');
    if(mode==='full') {
      const remote=process.env.CONTROL_API_URL;
      if(!remote) throw new Error('CONTROL_API_URL missing');
      const t={Authorization:`Bearer ${process.env.CONTROL_API_TOKEN}`};
      const a=await json(`${remote}/health`,t);
      if(!a.ok||!a.authRequired) throw new Error('Remote API health/auth failed');
      for(const headers of [{},{Authorization:'Bearer intentionally-invalid-token'}]) {
        if((await request(`${remote}/status`,headers)).status!==401) throw new Error('API accepted absent/invalid token');
      }
      for(const page of ['/','/api/health']) {
        if((await request(`${b}${page}`)).status!==401) throw new Error('Dashboard accepted anonymous request');
      }
      for(const page of ['/api/summary','/api/accounts','/api/account-management','/api/logs','/api/runs','/api/schedule','/api/config','/api/config/diff','/api/diagnostics','/api/sessions']) await json(`${b}${page}`,h);
      if(!(await request(`${b}/`,h)).ok) throw new Error('Dashboard HTML failed');
      const s=await json(`${remote}/schedule`,t);
      if(s.enabled||s.writable) throw new Error('Second scheduler is enabled');
      fs.accessSync(process.env.DATA_DIR||'/data',fs.constants.R_OK|fs.constants.W_OK);
      console.log('PASS: API auth, Docker DNS connection, Dashboard auth, seven views, single scheduler, data permissions');
    }
  }
} catch(e) {console.error(`FAIL: ${e.message}`);process.exitCode=1;}
