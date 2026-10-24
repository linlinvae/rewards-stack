// Adds manual send actions to persisted history rows; all content is selected server-side.
import {showNotificationDetails} from './notification-view.js';
const states=new WeakMap();
export function renderRunPushPlus(root,runs) {
  let state=states.get(root);
  if(!state){state={pending:false,nextAt:0,feedback:new Map(),buttons:[],timer:null};states.set(root,state);}
  const table=root.querySelector('#runsBody')?.closest('table');if(!table)return;
  const heading=table.querySelector('thead tr');
  if(!heading.querySelector('[data-run-notification-heading]')){
    const th=document.createElement('th');th.dataset.runNotificationHeading='';th.textContent='微信通知';heading.append(th);
  }
  const body=table.querySelector('tbody'),rows=Array.from(body.rows);state.buttons=[];
  if(!runs.length){const cell=rows[0]?.cells[0];if(cell)cell.colSpan=8;return;}
  function update(){
    if(!root.isConnected){clearTimeout(state.timer);return;}
    const seconds=Math.max(0,Math.ceil((state.nextAt-Date.now())/1000));
    for(const item of state.buttons){
      item.button.disabled=!item.finished||state.pending||seconds>0;
      item.button.textContent=!item.finished?'运行中':state.pending&&item.id===state.active?'正在发送…':seconds>0?`请稍候 ${seconds} 秒`:'发送本次汇总';
      item.button.title=item.finished?'将这条已结束运行记录的汇总发送到微信，不启动任务':'任务结束后才能发送';
    }
    clearTimeout(state.timer);if(seconds>0)state.timer=setTimeout(update,1000);
  }
  runs.forEach((run,index)=>{
    const row=rows[index];if(!row)return;
    const cell=document.createElement('td'),button=document.createElement('button'),notice=document.createElement('p');
    button.type='button';button.className='btn btn-small';button.dataset.sendRun=run.id;button.style.whiteSpace='nowrap';
    notice.className='hint';notice.setAttribute('role','status');notice.style.minWidth='10em';
    notice.textContent=state.feedback.get(run.id)||'';notice.hidden=!notice.textContent;
    const details=document.createElement('button');details.type='button';details.className='btn btn-small';details.textContent='查看积分明细';details.dataset.viewRun=run.id;details.style.whiteSpace='nowrap';details.style.marginBottom='6px';details.addEventListener('click',()=>showNotificationDetails(root,run.id));
    cell.append(details,document.createElement('br'),button,notice);row.append(cell);
    const finished=run.status!=='running'&&Number.isFinite(Date.parse(run.endTs));
    state.buttons.push({button,id:run.id,finished});
    button.addEventListener('click',async()=>{
      if(state.pending||Date.now()<state.nextAt||!finished)return;
      state.pending=true;state.active=run.id;state.feedback.set(run.id,'正在发送…');notice.textContent='正在发送…';notice.hidden=false;update();
      try {
        const response=await fetch('/api/notifications/pushplus/send-run',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Rewards-Notification-Write':'1'},body:JSON.stringify({runId:run.id}),signal:AbortSignal.timeout(25000)});
        const data=await response.json();
        if(response.ok||[429,502,500].includes(response.status))state.nextAt=Date.now()+30000;
        if(!response.ok)throw Error(data.error||'发送失败，请稍后再试。');
        state.feedback.set(run.id,data.message||'PushPlus 已受理，请在手机确认。');
      } catch(error) {
        if(error.name==='TimeoutError'||error.name==='TypeError')state.nextAt=Date.now()+30000;
        state.feedback.set(run.id,error.name==='TimeoutError'?'请求超时，请先查看手机是否收到。':error.message||'发送失败，请稍后再试。');
      } finally {
        state.pending=false;
        for(const item of state.buttons){
          const p=item.button.nextElementSibling;p.textContent=state.feedback.get(item.id)||'';p.hidden=!p.textContent;
        }
        update();
      }
    });
  });
  update();
}
