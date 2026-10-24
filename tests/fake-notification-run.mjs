// Local notification fixture only: never connects to Microsoft or PushPlus.
const stamp=new Date().toLocaleString('en-US',{timeZone:'Asia/Jakarta'});
const line=(title,message,level='INFO')=>console.log(`[${stamp}] [fixture] [${level}] MAIN [${title}] ${message}`);
line('RUN-START','Starting Microsoft Rewards Script | v4.3.2 | Accounts: 1 | Clusters: 1');
line('ACCOUNT-START','Starting account: fixture@example.invalid | geoLocale: auto | locale: en-US');
const failure=process.argv.includes('--partial')||process.argv.includes('--fail');
if(failure)line('ACCOUNT-ERROR','fixture@example.invalid: login failed (simulated)', 'ERROR');
else line('ACCOUNT-END','Completed account: fixture@example.invalid | pointsGained=120 | previousBalance=1000 | currentBalance=1120 | durationSeconds=60');
if(process.argv.includes('--partial')){
  line('POINTS','Earnable today | Mobile: unknown | Browser: 60 | App: 40 | fixture@example.invalid | locale: en-US');
  line('SEARCH-QUOTA','Mobile: unknown | Desktop: known');
  line('ACCOUNT-PARTIAL','Partial account: fixture@example.invalid | pointsGained=42 | previousBalance=1000 | currentBalance=1042 | durationSeconds=60','WARN');
}
if(!process.argv.includes('--fail'))line('RUN-END',`Completed all accounts | accountsProcessed=1 | pointsGained=${failure?42:120} | previousBalance=1000 | currentBalance=${failure?1042:1120} | runtimeMinutes=1`);
process.exitCode=process.argv.includes('--fail')?2:0;
