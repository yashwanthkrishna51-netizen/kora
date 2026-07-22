const KOGNOZ_LOGO="/kognoz_Iogo.png";
// ─── STATE ────────────────────────────────────────────────────────
const S={user:null,clients:[],archivedClients:[],users:[],usersForDropdown:[],shas:{clients:null,users:null},sessionToken:null,view:'login',params:{},adminTab:'integrations',filter:'all',search:'',modal:null,toast:null,sidebarCollapsed:false,sidebarClientsOpen:false,sort:{key:'name',dir:'asc'},editingTimelineId:null,expandedHistory:new Set(),amsFrom:'',amsTo:'',amsQuick:'',editingAmsEntryId:null,expandedAmsHistory:new Set(),cmdPaletteOpen:false,cmdQuery:'',recentlyViewed:[],darkMode:false,bulkImplMode:false,bulkImplCid:null,bulkSelected:new Set(),offlineMode:false,bulkIntegMode:false,bulkIntegCid:null,bulkIntegSelected:new Set(),dashAttnSort:{key:'reason',dir:'desc'},dashClientSort:{key:'name',dir:'asc'},dashAssigneeSort:{key:'total',dir:'desc'},dashAssigneeSearch:'',dashAssigneeExpanded:new Set(),dashAssigneeFilter:'all',adminSearch:''};

try{S.sidebarCollapsed=localStorage.getItem('itk_sb_collapsed')==='1';}catch(e){}
try{const r=localStorage.getItem('itk_recent');if(r)S.recentlyViewed=JSON.parse(r);}catch(e){}
try{S.darkMode=localStorage.getItem('itk_dark')==='1';}catch(e){}
if(S.darkMode)document.documentElement.classList.add('dark');

// ─── CONSTANTS — KOGNOZ BRAND ─────────────────────────────────────
const STATUSES=['Not Started','In Progress','At Risk','On Hold — Internal','On Hold — Client','Pending Client','Under Review','Delayed','Cancelled','Completed'];
const ROLES=['viewer','editor','admin'];
const PHASES=['BPU','BPU Signoff','CRP','CRP Signoff','UAT','UAT Signoff','Data Migration / Production Migration','Go Live','Hypercare'];
const SIGNOFF_PHASES=['BPU Signoff','CRP Signoff','UAT Signoff'];
const CURRENCIES={INR:{symbol:'₹',code:'INR'},USD:{symbol:'$',code:'USD'}};
const MILESTONE_STATUSES=['Pending','Achieved','Missed'];
const AMS_TYPES=['Bug Fix','Enhancement','Config Change','Support Ticket','Reporting','Training','Meeting','Consultation'];
const AMS_QUERY_LEVELS=['L1 - Low','L2 - Medium','L3 - High','L4 - Critical'];
const AMS_ENTRY_STATUSES=['Open','In Progress','Closed'];
const AMS_MODES=['Online / Remote','Offline / In-person'];
const HOURS_PER_DAY=8;
const TEAL='0e7490',TEAL_DARK='0d3d4f',MAGENTA='b5179e',VIOLET='7c3aed';
const SBG={'Completed':'k-status k-status-completed','In Progress':'k-status k-status-inprogress','At Risk':'k-status k-status-atrisk','On Hold — Internal':'k-status k-status-onhold','On Hold — Client':'k-status k-status-onhold','Pending Client':'k-status k-status-pending','Under Review':'k-status k-status-review','Delayed':'k-status k-status-delayed','Cancelled':'k-status k-status-cancelled','Not Started':'k-status k-status-notstarted'};
const SHEX={'Completed':'22c55e','In Progress':'0e7490','At Risk':'be185d','On Hold — Internal':'7c3aed','On Hold — Client':'9333ea','Pending Client':'d97706','Under Review':'0284c7','Delayed':'ea580c','Cancelled':'94a3b8','Not Started':'64748b'};
const SDOT=Object.fromEntries(Object.entries(SHEX).map(([s,hex])=>[s,`#${hex}`]));
const SRGB={'Completed':[34,197,94],'In Progress':[14,116,144],'At Risk':[190,24,93],'On Hold — Internal':[124,58,237],'On Hold — Client':[147,51,234],'Pending Client':[217,119,6],'Under Review':[2,132,199],'Delayed':[234,88,12],'Cancelled':[148,163,184],'Not Started':[100,116,139]};

// ─── UTILS ────────────────────────────────────────────────────────
async function sha256(str){const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(str));return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');}
function persistSession(token,user){try{localStorage.setItem('itk_sess',btoa(JSON.stringify({token,user})));}catch(e){}}
function clearSession(){try{localStorage.removeItem('itk_sess');localStorage.removeItem('itk_view');}catch(e){}}
function restoreSession(){try{const r=localStorage.getItem('itk_sess');return r?JSON.parse(atob(r)):null;}catch(e){return null;}}
function persistView(view,params){try{if(view==='login')return;localStorage.setItem('itk_view',JSON.stringify({view,params}));}catch(e){}}
function restoreView(){try{const r=localStorage.getItem('itk_view');return r?JSON.parse(r):null;}catch(e){return null;}}
function validateView(view,params){
  if(['dashboard','clients','impl','ams','admin'].includes(view))return true;
  if(view==='client-detail'||view==='impl-client-detail'||view==='ams-client-detail')return!!S.clients.find(x=>x.id===params.clientId);
  if(view==='integ-detail'){const c=S.clients.find(x=>x.id===params.clientId);return!!(c&&c.integrations.find(x=>x.id===params.integId));}
  if(view==='impl-phase-detail'){const c=S.clients.find(x=>x.id===params.clientId);if(!c)return false;const m=(c.modules||[]).find(x=>x.id===params.moduleId);return!!(m&&(m.phases||[]).find(p=>p.name===params.phase));}
  return false;
}
// Offline detection
window.addEventListener('online',()=>{S.offlineMode=false;render();});
window.addEventListener('offline',()=>{S.offlineMode=true;render();});
// Undo delete
let _undoTimer=null,_undoFn=null;
function scheduleUndo(label,undoFn){
  if(_undoTimer)clearTimeout(_undoTimer);
  _undoFn=undoFn;
  showToast(`${label} — undo?`,'warn',5000,'undo-delete');
  _undoTimer=setTimeout(()=>{_undoFn=null;_undoTimer=null;},5000);
}
function execUndo(){if(_undoFn){_undoFn();_undoFn=null;if(_undoTimer){clearTimeout(_undoTimer);_undoTimer=null;}showToast('Restored ✓');}}
function assigneeSelect(id,currentVal='',extra=''){
  const users=(S.usersForDropdown||[]).filter(u=>u.role==='admin'||u.role==='editor');
  if(!users.length)return`<input id="${id}" type="text" value="${esc(currentVal)}" placeholder="Assignee name" ${extra} class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/>`;
  return`<select id="${id}" ${extra} class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"><option value="">— Unassigned —</option>${users.map(u=>`<option value="${esc(u.name)}"${u.name===currentVal?' selected':''}>${esc(u.name)}</option>`).join('')}</select>`;
}
function assigneeOptionsOnly(currentVal=''){
  const users=(S.usersForDropdown||[]).filter(u=>u.role==='admin'||u.role==='editor');
  return`<option value="">— Unassigned —</option>${users.map(u=>`<option value="${esc(u.name)}"${u.name===currentVal?' selected':''}>${esc(u.name)}</option>`).join('')}`;
}
function fileIcon(url='',mimeType=''){
  const u=url.toLowerCase();const m=mimeType.toLowerCase();
  if(m.includes('pdf')||u.endsWith('.pdf'))return'📄';
  if(m.includes('sheet')||m.includes('excel')||u.endsWith('.xlsx')||u.endsWith('.xls'))return'📊';
  if(m.includes('image')||u.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/))return'🖼';
  return'📎';
}
async function uploadAttachment(file){
  const MAX=3*1024*1024;
  const ALLOWED=['application/pdf','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','image/jpeg','image/jpg','image/png','image/gif','image/webp'];
  if(!ALLOWED.includes(file.type)&&file.type!=='')throw new Error('Unsupported file type. Use PDF, Excel (.xlsx/.xls), or images (JPG, PNG, GIF, WEBP).');
  if(file.size>MAX)throw new Error(`File too large (${(file.size/1024/1024).toFixed(1)}MB). Max is 3MB.`);
  const ext='.'+file.name.split('.').pop().toLowerCase();
  const ok=['.pdf','.xlsx','.xls','.jpg','.jpeg','.png','.gif','.webp'];
  if(!ok.includes(ext))throw new Error(`Extension "${ext}" not supported.`);
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=async e=>{
      const base64=e.target.result.split(',')[1];
      try{
        const r=await fetch('/api/upload',{method:'POST',headers:{'Content-Type':'application/json','x-session-token':S.sessionToken||''},body:JSON.stringify({base64,fileName:file.name,mimeType:file.type||'application/octet-stream'})});
        const data=await r.json();
        if(!r.ok)throw new Error(data.error||'Upload failed');
        resolve(data);
      }catch(err){reject(err);}
    };
    reader.onerror=()=>reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
function attachmentChip(att){
  if(!att?.url)return'';
  const icon=fileIcon(att.url,att.mimeType||'');
  const name=att.fileName||att.label||'Attachment';
  return`<a href="${esc(att.url)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 text-[11px] text-[#0e7490] hover:underline mt-1.5 bg-[#0e7490]/8 px-2 py-0.5 rounded-full max-w-full" title="${esc(name)}">${icon} <span class="truncate max-w-[200px]">${esc(name)}</span></a>`;
}
function parseUsersCsv(text){
  const lines=text.trim().split('\n').filter(l=>l.trim());
  if(!lines.length)return[];
  const hasHeader=lines[0].toLowerCase().includes('username');
  const dataLines=hasHeader?lines.slice(1):lines;
  return dataLines.map((line,i)=>{
    const p=line.split(',').map(c=>c.trim().replace(/^"|"$/g,''));
    const [username,full_name,role,email,password]=p;
    let error=null;
    if(!username)error='Username required';
    else if(!full_name)error='Full name required';
    else if(!role||!ROLES.includes(role.toLowerCase()))error=`Role must be: ${ROLES.join('/')}`;
    else if(!password)error='Password required';
    else if((S.users||[]).find(u=>u.username===username))error=`"${username}" already exists`;
    return{username,name:full_name,role:role?.toLowerCase(),email:email||'',password,error,row:i+(hasHeader?2:1)};
  });
}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6);}
function esc(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function fmtDate(s){if(!s)return'—';try{return new Date(s).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});}catch{return s;}}
function can(p){if(!S.user)return false;const r={admin:3,editor:2,viewer:1};return(r[S.user.role]||0)>=(r[p]||0);}
function recordRecent(view,params){
  let entry=null;
  if(view==='client-detail'){const c=S.clients.find(x=>x.id===params.clientId);if(c)entry={type:'client',label:c.name,sub:'Integration Client',view,params:{clientId:c.id}};}
  else if(view==='integ-detail'){const c=S.clients.find(x=>x.id===params.clientId);const i=c?.integrations.find(x=>x.id===params.integId);if(c&&i)entry={type:'integ',label:i.name,sub:`Integration · ${c.name}`,view,params:{clientId:c.id,integId:i.id}};}
  else if(view==='impl-client-detail'){const c=S.clients.find(x=>x.id===params.clientId);if(c)entry={type:'implClient',label:c.name,sub:'Implementation Client',view,params:{clientId:c.id}};}
  else if(view==='ams-client-detail'){const c=S.clients.find(x=>x.id===params.clientId);if(c)entry={type:'amsClient',label:c.name,sub:'AMS Client',view,params:{clientId:c.id}};}
  if(!entry)return;
  const key=`${entry.view}:${entry.params.integId||entry.params.projectId||entry.params.clientId}`;
  S.recentlyViewed=S.recentlyViewed.filter(r=>`${r.view}:${r.params.integId||r.params.projectId||r.params.clientId}`!==key);
  S.recentlyViewed.unshift(entry);
  S.recentlyViewed=S.recentlyViewed.slice(0,8);
  try{localStorage.setItem('itk_recent',JSON.stringify(S.recentlyViewed));}catch(e){}
}
function navigate(view,params={}){
  const isRealNav=S.view!==view;
  const go=()=>{S.view=view;S.params=params;S.filter='all';S.search='';S.modal=null;S.sort={key:'name',dir:'asc'};S.editingTimelineId=null;S.expandedHistory=new Set();S.bulkImplMode=false;S.bulkImplCid=null;S.bulkSelected=new Set();recordRecent(view,params);persistView(view,params);render();};
  if(isRealNav&&document.startViewTransition)document.startViewTransition(go);else go();
}
function todayStr(){return new Date().toISOString().slice(0,10);}
function daysDiff(dateStr){if(!dateStr)return null;const d=new Date(dateStr+'T00:00:00');const t=new Date(todayStr()+'T00:00:00');return Math.round((t-d)/86400000);}
function isOverdue(i){if(i.status==='Completed'||!i.dueDate)return false;return daysDiff(i.dueDate)>0;}
function daysOverdue(i){return daysDiff(i.dueDate);}
function lastUpdateDate(i){return i.timeline?.[0]?.date||null;}
function isStale(i,days=7){if(i.status==='Completed')return false;const lu=lastUpdateDate(i);if(!lu)return true;return daysDiff(lu)>=days;}
function overdueBadge(i){if(!isOverdue(i))return'';const d=daysOverdue(i);return`<span class="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">⏰ ${d}d overdue</span>`;}
function healthColor(c){const ar=c.integrations.filter(i=>i.status==='At Risk').length;const od=c.integrations.filter(isOverdue).length;if(ar>0||od>0)return'bg-rose-500';const oh=c.integrations.filter(i=>i.status==='On Hold — Internal'||i.status==='On Hold — Client').length;if(oh>0)return'bg-violet-400';return'bg-green-500';}
function emptyIcon(type){const icons={search:'🔍',inbox:'📭',clock:'🕐',chart:'📊',doc:'📄',hours:'⏱️',team:'👥'};return`<div class="text-3xl mb-2 opacity-30">${icons[type]||'📭'}</div>`;}

let _tt;
function showToast(msg,type='success',duration=3500,action=null){
  S.toast={msg,type};
  const el=document.getElementById('toast');
  const bg={success:'#15803d',error:'#b91c1c',info:'#18181b',warn:'#a16207'}[type]||'#18181b';
  const icon={success:'✓',error:'✕',info:'i',warn:'!'}[type]||'✓';
  const style=`position:fixed;bottom:20px;right:20px;z-index:100;background:${bg};color:#fff;font-size:13px;font-weight:500;padding:10px 14px;border-radius:6px;box-shadow:0 8px 24px -4px rgba(0,0,0,.25);display:flex;align-items:center;gap:8px;letter-spacing:-0.005em;`;
  const undoBtn=action==='undo-delete'?`<button data-act="exec-undo" style="margin-left:6px;padding:2px 8px;background:rgba(255,255,255,.15);border-radius:3px;color:#fff;font-weight:600;font-size:11px;letter-spacing:0.02em;text-transform:uppercase;">Undo</button>`:'';
  const html=`<span style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:rgba(255,255,255,.15);font-size:10px;font-weight:700;">${icon}</span><span>${esc(msg)}</span>${undoBtn}`;
  if(el){el.className='toast-in';el.style.cssText=style;el.innerHTML=html;el.style.display='flex';}
  else{const d=document.createElement('div');d.id='toast';d.className='toast-in';d.style.cssText=style;d.innerHTML=html;document.body.appendChild(d);}
  if(_tt)clearTimeout(_tt);_tt=setTimeout(()=>{const x=document.getElementById('toast');if(x)x.style.display='none';},duration);
}

// ─── GLOBAL LOADING BAR ───────────────────────────────────────────
let _loadingCount=0;
function startLoading(){
  _loadingCount++;
  const b=document.getElementById('loading-bar');if(!b)return;
  b.style.opacity='1';b.style.width='65%';
}
function stopLoading(){
  _loadingCount=Math.max(0,_loadingCount-1);
  const b=document.getElementById('loading-bar');if(!b)return;
  if(_loadingCount===0){
    b.style.width='100%';
    setTimeout(()=>{if(_loadingCount===0){b.style.opacity='0';b.style.width='0%';}},250);
  }
}
function spinnerSvg(extra=''){return`<svg class="animate-spin h-3.5 w-3.5 ${extra}" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>`;}
function setBtnBusy(el,label){if(!el)return;el.dataset._origHtml=el.innerHTML;el.disabled=true;el.classList.add('btn-busy');el.innerHTML=`<span class="inline-flex items-center justify-center gap-2">${spinnerSvg()}${label||'Working…'}</span>`;}
function clearBtnBusy(el){if(!el)return;if(el.dataset._origHtml!==undefined){el.innerHTML=el.dataset._origHtml;delete el.dataset._origHtml;}el.disabled=false;el.classList.remove('btn-busy');}
// ─── API ──────────────────────────────────────────────────────────
async function apiRead(path){
  startLoading();
  try{
    const r=await fetch(`/api/read?path=${encodeURIComponent(path)}`,{headers:{'x-session-token':S.sessionToken||''}});
    if(!r.ok)throw new Error(`Read ${r.status}`);
    const d=await r.json();
    if(d.message&&!d.content)throw new Error(d.message);
    return{content:JSON.parse(atob(d.content.replace(/\n/g,''))),sha:d.sha};
  }finally{stopLoading();}
}
async function apiWrite(path,obj,sha,msg){
  startLoading();
  try{
    const r=await fetch('/api/write',{method:'POST',headers:{'Content-Type':'application/json','x-session-token':S.sessionToken||''},body:JSON.stringify({path,content:JSON.stringify(obj,null,2),sha,message:msg})});
    if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error||e.message||`Write ${r.status}`);}
    const d=await r.json();return d.sha||d.content?.sha;
  }finally{stopLoading();}
}
async function saveClients(msg){
  // The server-side write.js always fetches the fresh SHA from GitHub before
  // writing, so stale-SHA conflicts are resolved there. We still update our
  // local S.shas.clients with the new SHA returned by the server so the NEXT
  // save has the freshest possible starting point.
  // On any error we also refresh our SHA from GitHub so a retry attempt
  // doesn't compound a stale-SHA problem.
  try{
    S.shas.clients=await apiWrite('data/clients.json',S.clients,S.shas.clients,msg||'Update clients');
  }catch(err){
    // Refresh our local SHA so the next save attempt starts clean.
    try{const cl=await apiRead('data/clients.json');S.shas.clients=cl.sha;}catch(_){}
    throw err;
  }
}
async function saveUsers(msg){
  try{
    S.shas.users=await apiWrite('data/users.json',S.users,S.shas.users,msg||'Update users');
  }catch(err){
    try{const ul=await apiRead('data/users.json');S.shas.users=ul.sha;}catch(_){}
    throw err;
  }
}