// No browser, network, account login, or Rewards actions. Test fixture only.
const stamp = new Date().toLocaleString('en-US',{timeZone:'Asia/Jakarta'});
const line=(title,message,level='INFO')=>console.log(`[${stamp}] [test] [${level}] MAIN [${title}] ${message}`);
line('RUN-START','Starting Microsoft Rewards Script | v4.3.2 | Accounts: 1 | Clusters: 1');
line('ACCOUNT-START','Starting account: fixture@example.invalid | geoLocale: auto | locale: en-US');
line('TEST',`password=${process.env.ACCOUNT_1_PASSWORD} access_token=unknown-fixture-secret Cookie=fixture-cookie; other=second-cookie-secret`);
line('ACCOUNT-ERROR','fixture@example.invalid: Needs manual verification (simulated)', 'ERROR');
if(process.argv.includes('--account-probe')) {
  const emails=Object.entries(process.env).filter(([key,value])=>/^ACCOUNT_\d+_EMAIL$/.test(key)&&value).map(([,value])=>value);
  line('ACCOUNT-PROBE',JSON.stringify({emails}));
  process.exit(0);
}
if(process.argv.includes('--exit')) process.exit(2);
setInterval(()=>{},1000);
