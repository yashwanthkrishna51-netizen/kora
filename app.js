const KOGNOZ_LOGO="/kognoz_Iogo.png";
// ─── STATE ────────────────────────────────────────────────────────
const S={user:null,clients:[],archivedClients:[],users:[],usersForDropdown:[],shas:{clients:null,users:null},sessionToken:null,view:'login',params:{},adminTab:'integrations',filter:'all',search:'',modal:null,toast:null,sidebarCollapsed:false,sidebarClientsOpen:false,sort:{key:'name',dir:'asc'},editingTimelineId:null,expandedHistory:new Set(),amsFrom:'',amsTo:'',amsQuick:'',editingAmsEntryId:null,expandedAmsHistory:new Set(),cmdPaletteOpen:false,cmdQuery:'',recentlyViewed:[],darkMode:false,bulkImplMode:false,bulkImplCid:null,bulkSelected:new Set(),offlineMode:false,bulkIntegMode:false,bulkIntegCid:null,bulkIntegSelected:new Set()};

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
function clearSession(){try{localStorage.removeItem('itk_sess');}catch(e){}}
function restoreSession(){try{const r=localStorage.getItem('itk_sess');return r?JSON.parse(atob(r)):null;}catch(e){return null;}}
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
  const go=()=>{S.view=view;S.params=params;S.filter='all';S.search='';S.modal=null;S.sort={key:'name',dir:'asc'};S.editingTimelineId=null;S.expandedHistory=new Set();S.bulkImplMode=false;S.bulkImplCid=null;S.bulkSelected=new Set();recordRecent(view,params);render();};
  if(isRealNav&&document.startViewTransition)document.startViewTransition(go);else go();
}
function todayStr(){return new Date().toISOString().slice(0,10);}
function daysDiff(dateStr){if(!dateStr)return null;const d=new Date(dateStr+'T00:00:00');const t=new Date(todayStr()+'T00:00:00');return Math.round((t-d)/86400000);}
function isOverdue(i){if(i.status==='Completed'||!i.dueDate)return false;return daysDiff(i.dueDate)>0;}
function daysOverdue(i){return daysDiff(i.dueDate);}
function lastUpdateDate(i){return i.timeline?.[0]?.date||null;}
function isStale(i,days=7){if(i.status==='Completed')return false;const lu=lastUpdateDate(i);if(!lu)return true;return daysDiff(lu)>=days;}
function overdueBadge(i){if(!isOverdue(i))return'';const d=daysOverdue(i);return`<span class="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">⏰ ${d}d overdue</span>`;}
function healthColor(c){const ar=c.integrations.filter(i=>i.status==='At Risk').length;const od=c.integrations.filter(isOverdue).length;if(ar>0||od>0)return'bg-rose-500';const oh=c.integrations.filter(i=>i.status==='On Hold').length;if(oh>0)return'bg-violet-400';return'bg-green-500';}
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
// ─── HELPERS ──────────────────────────────────────────────────────
function sbadge(s){return`<span class="${SBG[s]||SBG['Not Started']}">${esc(s)}</span>`;}
function sBar(integs){if(!integs.length)return'';const c={};integs.forEach(i=>c[i.status]=(c[i.status]||0)+1);return Object.entries(c).map(([s,n])=>`<div class="h-1.5 rounded" style="width:${Math.round(n/integs.length*100)}%;background:${SDOT[s]||'#9ca3af'};"></div>`).join('');}
function sCounts(integs){const c={};integs.forEach(i=>c[i.status]=(c[i.status]||0)+1);return Object.entries(c).map(([s,n])=>`<span class="flex items-center gap-1 text-xs text-gray-500"><span class="w-2 h-2 inline-block rounded-full" style="background:${SDOT[s]||'#9ca3af'};"></span>${n} ${esc(s)}</span>`).join('');}
// Clients are shared across all sections now. This lets a modal offer "pick an
// existing client not yet in this section" alongside "create a new one".
function clientPickerHtml(excludeFn){
  const avail=S.clients.filter(c=>!excludeFn(c)).sort((a,b)=>a.name.localeCompare(b.name));
  return`<div><label class="block text-xs font-medium text-gray-500 mb-1">Existing Client</label>
    <select id="m0" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]">
      <option value="">— Create a new client below —</option>
      ${avail.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}
    </select>
  </div>`;
}

// ─── BRAND WORDMARK ───────────────────────────────────────────────
function brandMark(big){
  const h=big?36:24;
  return`<div class="flex flex-col items-start gap-0.5">
    <img src="${KOGNOZ_LOGO}" alt="Kognoz" style="height:${h}px;width:auto;object-fit:contain;" />
    <span class="text-[13px] font-bold tracking-[0.2em] uppercase" style="color:#0e7490;letter-spacing:0.18em;">KORA</span>
  </div>`;
}
let _cmdpResults=[];
function renderCmdPalette(){
  const q=S.cmdQuery.toLowerCase().trim();
  const icon={client:'🔗',integ:'⚡',implClient:'🏗️',amsClient:'🧾'};
  let list;
  if(q){
    const results=[];
    S.clients.forEach(c=>{
      if(c.name.toLowerCase().includes(q))results.push({type:'client',label:c.name,sub:'Integration Client',view:'client-detail',params:{clientId:c.id}});
      (c.integrations||[]).forEach(i=>{if(i.name.toLowerCase().includes(q))results.push({type:'integ',label:i.name,sub:`Integration · ${c.name}`,view:'integ-detail',params:{clientId:c.id,integId:i.id}});});
      if(c.modules!==undefined&&c.name.toLowerCase().includes(q))results.push({type:'implClient',label:c.name,sub:'Implementation Client',view:'impl-client-detail',params:{clientId:c.id}});
      if(c.workLog!==undefined&&c.name.toLowerCase().includes(q))results.push({type:'amsClient',label:c.name,sub:'AMS Client',view:'ams-client-detail',params:{clientId:c.id}});
    });
    list=results.slice(0,20);
  }else{
    list=S.recentlyViewed.filter(r=>{
      const c=S.clients.find(x=>x.id===r.params.clientId);if(!c)return false;
      if(r.view==='integ-detail')return!!c.integrations.find(x=>x.id===r.params.integId);

      return true;
    });
  }
  _cmdpResults=list;
  return`<div class="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-24 p-4 fade" id="cmdp-overlay">
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg modal-pop overflow-hidden">
      <div class="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
        <svg class="w-5 h-5 text-gray-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"/></svg>
        <input id="cmdp-input" data-act="cmdp-input" type="text" value="${esc(S.cmdQuery)}" placeholder="Search clients, integrations, projects…" autocomplete="off" class="flex-1 text-sm outline-none"/>
        <kbd class="text-[10px] text-gray-300 border border-gray-200 rounded px-1.5 py-0.5">Esc</kbd>
      </div>
      <div class="max-h-80 overflow-y-auto p-2">
        ${!q&&!list.length?`<p class="text-sm text-gray-400 text-center py-8">${emptyIcon('search')}Start typing to search everything.</p>`:''}
        ${!q&&list.length?`<div class="px-2 pt-1 pb-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Recently Viewed</div>`:''}
        ${q&&!list.length?`<p class="text-sm text-gray-400 text-center py-8">${emptyIcon('search')}No matches for "${esc(S.cmdQuery)}"</p>`:''}
        ${list.map((r,idx)=>`<button data-act="cmdp-go" data-idx="${idx}" style="animation-delay:${idx*15}ms" class="row-in w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-[#0e7490]/8 transition-colors">
          <span class="text-base shrink-0">${icon[r.type]||'📄'}</span>
          <div class="min-w-0 flex-1"><div class="text-sm font-medium text-gray-800 truncate">${esc(r.label)}</div><div class="text-xs text-gray-400 truncate">${esc(r.sub||'')}</div></div>
        </button>`).join('')}
      </div>
    </div>
  </div>`;
}
function renderAppSkeleton(){
  return`<aside class="fixed inset-y-0 left-0 bg-white border-r border-gray-100 z-40 flex flex-col" style="width:15.5rem">
    <div class="flex items-center px-4 h-16 border-b border-gray-100 shrink-0">${brandMark(true)}</div>
    <div class="flex-1 px-2.5 py-4 space-y-2">${[1,2,3,4].map(()=>`<div class="skel rounded-xl h-9"></div>`).join('')}</div>
  </aside>
  <main class="min-h-screen" style="margin-left:15.5rem">
    <div class="max-w-7xl mx-auto px-6 py-7">
      <div class="skel rounded-lg h-7 w-48 mb-2"></div>
      <div class="skel rounded-lg h-4 w-72 mb-6"></div>
      <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">${[1,2,3,4,5].map(()=>`<div class="skel rounded-2xl h-20"></div>`).join('')}</div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div class="skel rounded-2xl h-64"></div>
        <div class="skel rounded-2xl h-64"></div>
      </div>
    </div>
  </main>`;
}

// ─── RENDER ───────────────────────────────────────────────────────
function render(){
  const app=document.getElementById('app');
  if(S.view==='login'){app.innerHTML=renderLogin();return;}
  let content='';
  if(S.view==='dashboard')content=renderDashboard();
  else if(S.view==='clients')content=renderClientList();
  else if(S.view==='client-detail')content=renderClientDetail(S.params.clientId);
  else if(S.view==='integ-detail')content=renderIntegDetail(S.params.clientId,S.params.integId);
  else if(S.view==='impl-clients')content=renderImplClientList();
  else if(S.view==='impl-client-detail')content=renderImplClientDetail(S.params.clientId);
  else if(S.view==='impl-phase-detail')content=renderImplPhaseDetail(S.params.clientId,S.params.moduleId,S.params.phase);
  else if(S.view==='ams-clients')content=renderAmsClientList();
  else if(S.view==='ams-client-detail')content=renderAmsClientDetail(S.params.clientId);
  else if(S.view==='admin')content=can('admin')?renderAdmin():`<div class="p-8 text-rose-500">Access denied</div>`;
  const isMobile=window.innerWidth<768;
  const sbw=isMobile?'0':(S.sidebarCollapsed?'56px':'232px');
  app.innerHTML=`${S.offlineMode?`<div style="position:fixed;top:0;left:0;right:0;z-index:200;background:var(--red);color:#fff;font-size:12px;font-weight:500;text-align:center;padding:6px;letter-spacing:0.02em;">You appear to be offline — saves will fail until your connection is restored</div>`:''}${renderSidebar()}<main class="min-h-screen" style="margin-left:${sbw};transition:margin-left 200ms ease;${S.offlineMode?'padding-top:28px;':''}">${isMobile?`<div style="position:fixed;top:12px;left:12px;z-index:50;"><button data-act="toggle-sidebar" class="k-btn k-btn-secondary" style="width:36px;height:36px;padding:0;box-shadow:var(--shadow);"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="2" y1="4" x2="14" y2="4"/><line x1="2" y1="8" x2="14" y2="8"/><line x1="2" y1="12" x2="14" y2="12"/></svg></button></div>`:''}${content}</main>${S.modal?renderModal():''}${S.cmdPaletteOpen?renderCmdPalette():''}${isMobile&&!S.sidebarCollapsed?`<div data-act="toggle-sidebar" style="position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:30;"></div>`:''}`;

}

function renderSidebar(){
  const collapsed=S.sidebarCollapsed;
  const isMobile=window.innerWidth<768;
  const w=collapsed&&!isMobile?'56px':'232px';
  const hidden=isMobile&&collapsed;
  const isActive=v=>{
    if(v==='clients')return['clients','client-detail','integ-detail'].includes(S.view);
    if(v==='impl')return['impl-clients','impl-client-detail','impl-phase-detail'].includes(S.view);
    if(v==='ams')return['ams-clients','ams-client-detail'].includes(S.view);
    return S.view===v;
  };
  const ico={
    dash:`<svg class="k-side-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>`,
    integ:`<svg class="k-side-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 2L3 9h4l-1 5 5-7H7l1-5z" stroke-linejoin="round"/></svg>`,
    impl:`<svg class="k-side-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="3" height="10" rx="0.5"/><rect x="6.5" y="3" width="3" height="10" rx="0.5"/><rect x="11" y="3" width="3" height="10" rx="0.5"/></svg>`,
    ams:`<svg class="k-side-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M8 4v4l2.5 2.5"/></svg>`,
    admin:`<svg class="k-side-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="2.5"/><path d="M8 1v2M8 13v2M13.5 8h1M1.5 8h1M12.24 3.76l-1.06 1.06M4.82 11.18l-1.06 1.06M12.24 12.24l-1.06-1.06M4.82 4.82L3.76 3.76"/></svg>`,
    search:`<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4.5"/><path d="M13 13l-2.5-2.5"/></svg>`,
    logout:`<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 2H3v12h3M10 5l3 3-3 3M13 8H6"/></svg>`,
    chevron:`<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 4l4 4-4 4"/></svg>`,
    sun:`<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="3"/><path d="M8 1v1M8 14v1M15 8h-1M2 8H1M12.95 3.05l-.7.7M3.75 12.25l-.7.7M12.95 12.95l-.7-.7M3.75 3.75l-.7-.7"/></svg>`,
    moon:`<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a6 6 0 1 0 7 7z"/></svg>`,
  };
  const navItem=(view,label,icon)=>`<button data-act="nav-${view}" class="k-side-item ${isActive(view)?'active':''}" ${collapsed?`title="${label}"`:''}>
    ${icon}${collapsed?'':`<span class="truncate label-fade">${label}</span>`}
  </button>`;
  const grp=t=>collapsed?'':`<div class="k-side-group">${t}</div>`;

  return`<aside class="k-sidebar fixed inset-y-0 left-0 z-40 flex flex-col" style="width:${w};transform:${hidden?'translateX(-100%)':'translateX(0)'};transition:transform 200ms ease,width 200ms ease">
  <div class="k-side-header shrink-0 flex flex-col items-center justify-center ${collapsed?'px-1 py-3':'px-4 py-5'}" style="background:#ffffff;">
    ${collapsed
      ? `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
          <img src="${KOGNOZ_LOGO}" alt="Kognoz" style="height:26px;width:auto;object-fit:contain;display:block;" />
          <span style="font-size:9px;font-weight:700;letter-spacing:0.14em;color:var(--teal);text-transform:uppercase;line-height:1;">Kora</span>
        </div>`
      : `<img src="${KOGNOZ_LOGO}" alt="Kognoz" style="height:52px;width:auto;max-width:180px;object-fit:contain;display:block;margin-bottom:6px;" />
        <span style="font-size:22px;font-weight:700;letter-spacing:0.18em;color:var(--teal);text-transform:uppercase;line-height:1;">Kora</span>`}
  </div>
  <div class="px-3 pt-3 pb-1">
    <button data-act="cmdp-open" class="w-full flex items-center gap-2 k-side-search rounded-md px-2.5 ${collapsed?'justify-center':''}">
      ${ico.search}
      ${collapsed?'':`<span class="flex-1 text-left label-fade" style="font-size:12px;">Search…</span><kbd style="font-size:10px;padding:1px 5px;border:1px solid rgba(255,255,255,.1);border-radius:3px;color:#71717a;font-family:var(--font);">⌘K</kbd>`}
    </button>
  </div>
  <nav class="flex-1 overflow-y-auto sidebar-scroll pt-2 pb-3">
    ${!collapsed?'<div class="k-side-group" style="margin-top:8px;">Main</div>':''}
    ${navItem('dashboard','Dashboard',ico.dash)}
    ${grp('Trackers')}
    ${navItem('clients','Integrations',ico.integ)}
    ${navItem('impl','Implementations',ico.impl)}
    ${navItem('ams','AMS & Support',ico.ams)}
    ${can('admin')?grp('System'):''}
    ${can('admin')?navItem('admin','Admin',ico.admin):''}
  </nav>
  <div class="k-side-profile shrink-0">
    ${!collapsed?`<button data-act="open-profile" class="w-full flex items-center gap-2.5 mb-2 rounded-md p-1.5 hover:bg-white/5 text-left" style="transition:background 120ms ease;">
      <div style="width:28px;height:28px;border-radius:50%;background:var(--teal);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;flex-shrink:0;">${esc((S.user?.name||'?')[0].toUpperCase())}</div>
      <div class="min-w-0 flex-1">
        <div style="font-size:12px;font-weight:500;color:#fafafa;" class="truncate">${esc(S.user?.name)}</div>
        <div class="k-side-tag" style="text-transform:capitalize;">${esc(S.user?.role)}</div>
      </div>
    </button>`:``}
    <div class="${collapsed?'flex flex-col items-center gap-1.5':'flex items-center gap-1'}">
      <button data-act="toggle-dark" title="Toggle theme" class="k-side-item ${collapsed?'':'flex-1'}" style="justify-content:center;padding:0;margin:0;height:28px;${collapsed?'width:32px;':''}">
        ${S.darkMode?ico.moon:ico.sun}
      </button>
      <button data-act="logout" title="Sign out" class="k-side-item ${collapsed?'':'flex-1'}" style="justify-content:center;padding:0;margin:0;height:28px;${collapsed?'width:32px;':''}color:var(--mute-2);">
        ${ico.logout}
      </button>
      <button data-act="toggle-sidebar" title="${collapsed?'Expand':'Collapse'}" class="k-side-item" style="justify-content:center;padding:0;margin:0;height:28px;width:32px;">
        <span style="display:inline-block;transform:rotate(${collapsed?'0':'180'}deg);transition:transform 200ms ease;">${ico.chevron}</span>
      </button>
    </div>
  </div>
</aside>`;
}

function lockIcon(cls='w-3.5 h-3.5'){return`<svg class="${cls} shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-12V7a4 4 0 10-8 0v4h8z"/></svg>`;}
function encBadge(opts={}){
  const{compact=false}=opts;
  if(compact){
    return`<div class="flex items-center justify-center" title="Secured with AES-256 industry-grade encryption">
      <div class="w-8 h-8 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center text-base">🔒</div>
    </div>`;
  }
  return`<div class="inline-flex items-center gap-2 bg-gray-50 border border-gray-200 text-gray-500 text-[11px] font-medium px-3.5 py-2 rounded-2xl leading-tight text-center">
    <span class="text-sm">🔒</span><span>Secured with AES-256 industry-grade encryption</span>
  </div>`;
}
function renderLogin(){
  return`<div class="min-h-screen flex items-center justify-center p-4" style="background:var(--surface);">
  <div class="fade" style="width:100%;max-width:380px;">
    <div class="k-card" style="padding:40px 32px;box-shadow:var(--shadow);">
      <div class="text-center" style="margin-bottom:32px;">
        <img src="${KOGNOZ_LOGO}" alt="Kognoz" style="height:52px;width:auto;object-fit:contain;margin:0 auto 12px;display:block;" />
        <div style="font-size:26px;font-weight:700;letter-spacing:0.18em;color:var(--teal);text-transform:uppercase;line-height:1;">Kora</div>
        <p style="font-size:12px;color:var(--mute);margin-top:14px;">Delivery Intelligence Platform</p>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div>
          <label style="display:block;margin-bottom:6px;">Username</label>
          <input id="lu" type="text" autocomplete="username" placeholder="username"/>
        </div>
        <div>
          <label style="display:block;margin-bottom:6px;">Password</label>
          <input id="lp" type="password" autocomplete="current-password" placeholder="••••••••"/>
        </div>
        <div id="lerr" class="hidden" style="font-size:12px;color:var(--red);background:var(--red-hi);padding:8px 12px;border-radius:var(--radius);text-align:center;"></div>
        <button data-act="login" class="k-btn k-btn-primary k-btn-lg" style="width:100%;margin-top:4px;">Sign In</button>
      </div>
    </div>
    <div style="text-align:center;margin-top:20px;font-size:11px;color:var(--mute);">
      Secured with AES-256 encryption
    </div>
  </div>
</div>`;
}

// ─── DASHBOARD ────────────────────────────────────────────────────
function renderDashboard(){
  const all=S.clients.flatMap(c=>c.integrations.map(i=>({...i,clientName:c.name,clientId:c.id})));
  const ti=all.length;
  const ar=all.filter(i=>i.status==='At Risk').length;
  const ip=all.filter(i=>i.status==='In Progress').length;
  const co=all.filter(i=>i.status==='Completed').length;
  const overdue=all.filter(isOverdue);
  const stale=all.filter(i=>isStale(i,7)&&!isOverdue(i));
  const weekAgo=new Date(Date.now()-7*86400000);
  const thisWeekUpdates=all.reduce((n,i)=>n+(i.timeline||[]).filter(t=>new Date(t.date)>=weekAgo).length,0);
  const needsAttn=[...overdue.map(i=>({...i,reason:'overdue'})),...stale.map(i=>({...i,reason:'stale'}))].sort((a,b)=>(a.reason==='overdue'&&b.reason!=='overdue')?-1:1);

  const implClients=S.clients.filter(c=>c.modules!==undefined);
  const allModules=implClients.flatMap(c=>(c.modules||[]).map(m=>({...m,clientName:c.name,clientId:c.id})));
  const allPhases=allModules.flatMap(m=>(m.phases||[]).map(ph=>({...ph})));
  const implTotalPhases=allPhases.length;
  const implAtRiskClients=implClients.filter(c=>implAutoRag(c)==='Red');
  const implAmberClients=implClients.filter(c=>implAutoRag(c)==='Amber');
  const implActiveClients=implClients.filter(c=>implProgress(c).pct<100);

  const amsClients=S.clients.filter(c=>c.workLog!==undefined);
  const now=new Date();
  const monthStart=new Date(now.getFullYear(),now.getMonth(),1).toISOString().slice(0,10);
  const monthEnd=todayStr();
  let amsHoursThisMonth=0,amsAmountThisMonth=0,amsRevenueINR=0,amsRevenueUSD=0;
  const amsLowBalance=[];

  // Team productivity this week
  const userUpdates={};
  const weekAgoStr=weekAgo.toISOString().slice(0,10);
  S.clients.forEach(c=>{
    (c.integrations||[]).forEach(i=>(i.timeline||[]).filter(t=>t.date>=weekAgoStr).forEach(t=>{const u=t.addedBy||'?';userUpdates[u]=(userUpdates[u]||0)+1;}));
    (c.modules||[]).forEach(m=>(m.phases||[]).forEach(ph=>(ph.updates||[]).filter(u=>u.date>=weekAgoStr).forEach(u=>{const n=u.addedBy||'?';userUpdates[n]=(userUpdates[n]||0)+1;})));
    (c.workLog||[]).filter(e=>entryDate(e)>=weekAgoStr).forEach(e=>{const u=entryRaisedBy(e);userUpdates[u]=(userUpdates[u]||0)+1;});
  });
  const topUsers=Object.entries(userUpdates).sort((a,b)=>b[1]-a[1]).slice(0,3);

  // At-risk % for integrations
  const atRiskPct=ti>0?Math.round(ar/ti*100):0;
  amsClients.forEach(c=>{
    const tm=amsTotals(c,monthStart,monthEnd);
    amsHoursThisMonth+=tm.totalHours;
    if(tm.totalAmount){
      if((c.currency||'INR')==='USD')amsRevenueUSD+=tm.totalAmount;
      else amsRevenueINR+=tm.totalAmount;
    }
    amsAmountThisMonth+=tm.totalAmount||0;
    if(tm.hasBucket&&tm.balanceAvailable<=Math.max(2,tm.totalAvailableHours*0.15)){amsLowBalance.push({name:c.name,id:c.id,balance:tm.balanceAvailable,total:tm.totalAvailableHours});}
  });

  return`<div class="k-page fade">
  <div class="k-page-header">
    <div>
      <h1 class="k-h1">Dashboard</h1>
      <p style="font-size:13px;color:var(--mute);margin-top:4px;">Overview across all clients and integrations</p>
    </div>
    ${can('admin')?`<button data-act="portfolio-export" class="k-btn k-btn-primary">Portfolio Export</button>`:''}
  </div>

  <div class="k-card" style="padding:22px 0;margin-bottom:24px;">
    <div class="k-metric-row" style="grid-template-columns:repeat(5,1fr);">
      ${[
        ['Clients',S.clients.length,'',''],
        ['Integrations',ti,'',''],
        ['In Progress',ip,'','teal'],
        ['At Risk',ar,atRiskPct?`${atRiskPct}% of total`:'',ar?'red':''],
        ['Updates',thisWeekUpdates,'past 7 days','']
      ].map(([l,v,sub,rail])=>`<div class="k-metric${rail?` k-metric-${rail}`:''}">
        <div class="k-num-l">${v}</div>
        <div class="k-eyebrow" style="margin-top:8px;">${l}</div>
        ${sub?`<div class="k-metric-sub">${sub}</div>`:''}
      </div>`).join('')}
    </div>
  </div>

  <div class="k-eyebrow" style="margin-bottom:12px;">Across your trackers</div>
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
    <div class="k-card" style="padding:20px;">
      <div class="k-card-head">
        <h3 class="k-h3">Implementations</h3>
        <button data-act="nav-impl" class="k-link">View all →</button>
      </div>
      <div class="grid grid-cols-2 gap-4 mb-4">
        <div class="k-metric k-metric-teal"><div class="k-num-m">${implActiveClients.length}</div><div class="k-eyebrow" style="margin-top:4px;">Active Clients</div></div>
        <div class="k-metric${implAtRiskClients.length?' k-metric-red':''}"><div class="k-num-m" style="${implAtRiskClients.length?'color:var(--red);':''}">${implAtRiskClients.length}</div><div class="k-eyebrow" style="margin-top:4px;">Need Attention</div></div>
      </div>
      ${implTotalPhases?`<div class="flex gap-0.5 h-1.5 rounded overflow-hidden mb-2" style="background:var(--line-2);">
        ${STATUSES.map(s=>{const n=allPhases.filter(ph=>ph.status===s).length;const c={'Completed':'var(--green)','In Progress':'var(--teal)','At Risk':'var(--red)','Delayed':'var(--red)','Not Started':'var(--mute-2)'}[s]||'var(--mute-2)';return n?`<div class="bar-fill" style="width:${Math.round(n/implTotalPhases*100)}%;background:${c}!important" title="${s}: ${n}"></div>`:'';}).join('')}
      </div>
      <div style="font-size:12px;color:var(--mute);margin-bottom:8px;">${implTotalPhases} phases tracked across ${implClients.length} client${implClients.length!==1?'s':''}</div>`:`<div class="k-empty" style="padding:12px;">No implementation data yet.</div>`}
      ${implAtRiskClients.length?`<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line-2);display:flex;flex-direction:column;gap:2px;">${implAtRiskClients.slice(0,3).map((c,idx)=>`<div data-act="open-impl-client" data-id="${c.id}" style="animation-delay:${idx*25}ms;font-size:12px;" class="row-in k-list-row">
        <span class="truncate k-rag k-rag-red" title="${esc(c.name)}">${esc(c.name)}</span>
      </div>`).join('')}</div>`:''}
    </div>

    <div class="k-card" style="padding:20px;">
      <div class="k-card-head">
        <h3 class="k-h3">AMS &amp; Support</h3>
        <button data-act="nav-ams" class="k-link">View all →</button>
      </div>
      <div class="grid grid-cols-2 gap-4 mb-4">
        <div class="k-metric k-metric-teal"><div class="k-num-m">${amsHoursThisMonth.toFixed(1)}h</div><div class="k-eyebrow" style="margin-top:4px;">Hours This Month</div></div>
        ${can('admin')?`<div class="k-metric${amsRevenueINR||amsRevenueUSD?' k-metric-green':''}">
          ${amsRevenueINR>0?`<div class="k-num-m">₹${amsRevenueINR.toLocaleString('en-IN',{maximumFractionDigits:0})}</div>`:''}
          ${amsRevenueUSD>0?`<div class="k-num-m">$${amsRevenueUSD.toLocaleString('en-US',{maximumFractionDigits:0})}</div>`:''}
          ${!amsRevenueINR&&!amsRevenueUSD?`<div class="k-num-m" style="color:var(--mute-2);">—</div>`:''}
          <div class="k-eyebrow" style="margin-top:4px;">Billable This Month</div>
        </div>`:`<div class="k-metric"><div class="k-num-m">${amsClients.length}</div><div class="k-eyebrow" style="margin-top:4px;">Active Clients</div></div>`}
      </div>
      ${amsLowBalance.length?`<div style="display:flex;flex-direction:column;gap:2px;">${amsLowBalance.slice(0,3).map((c,idx)=>`<div data-act="open-ams-client" data-id="${c.id}" style="animation-delay:${idx*25}ms;font-size:12px;color:var(--red);" class="row-in k-list-row">
        <span class="truncate" title="${esc(c.name)}">${esc(c.name)} pool running low</span><span class="shrink-0 k-num" style="font-size:11px;">${c.balance.toFixed(1)}/${c.total.toFixed(1)}h</span>
      </div>`).join('')}</div>`:amsClients.length?`<p class="k-empty" style="padding:8px 0;">All hour pools healthy ✓</p>`:`<div class="k-empty">${emptyIcon('hours')}No AMS clients yet.</div>`}
    </div>
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
    <div class="k-card" style="padding:20px;">
      <div class="k-card-head" style="margin-bottom:12px;">
        <h3 class="k-h3">⚠️ Needs Attention</h3>
        <span class="k-eyebrow">${needsAttn.length}</span>
      </div>
      <div class="max-h-80 overflow-y-auto pr-1" style="display:flex;flex-direction:column;gap:2px;">
        ${needsAttn.length?needsAttn.slice(0,12).map((i,idx)=>`<div data-act="open-integ" data-cid="${i.clientId}" data-iid="${i.id}" style="animation-delay:${Math.min(idx*20,250)}ms" class="row-in k-list-row">
          <div class="min-w-0 flex-1">
            <div style="font-size:13px;font-weight:500;color:var(--ink);" class="truncate" title="${esc(i.name)}">${esc(i.name)}</div>
            <div class="k-eyebrow" style="margin-top:2px;text-transform:none;letter-spacing:0;">${esc(i.clientName)} · ${esc(i.assignee||'Unassigned')}</div>
          </div>
          ${i.reason==='overdue'?overdueBadge(i):`<span class="k-status" style="white-space:nowrap;"><span style="color:var(--amber);">No update ${lastUpdateDate(i)?daysDiff(lastUpdateDate(i))+'d':''}</span></span>`}
        </div>`).join(''):`<p class="k-empty">All caught up — nothing overdue or stale 🎉</p>`}
      </div>
    </div>

    <div class="k-card" style="padding:20px;">
      <h3 class="k-h3" style="margin-bottom:16px;">Status by Client</h3>
      <div class="max-h-80 overflow-y-auto pr-1" style="display:flex;flex-direction:column;gap:10px;">
        ${S.clients.map((c,idx)=>{
          const tot=c.integrations.length||1;
          return`<div data-act="open-client" data-id="${c.id}" style="animation-delay:${Math.min(idx*20,250)}ms;padding:6px 8px;margin:0 -8px;" class="row-in k-list-row" data-block="1">
            <div style="width:100%;">
              <div class="flex items-center justify-between" style="font-size:12px;margin-bottom:4px;">
                <span style="font-weight:500;color:var(--ink-3);" class="truncate" title="${esc(c.name)}">${esc(c.name)}</span>
                <span style="color:var(--mute);">${c.integrations.length}</span>
              </div>
              <div class="flex gap-0.5 h-2 rounded-full overflow-hidden" style="background:var(--line-2);">
                ${STATUSES.map(s=>{const n=c.integrations.filter(i=>i.status===s).length;return n?`<div class="bar-fill" style="width:${Math.round(n/tot*100)}%;background:${SDOT[s]};" title="${s}: ${n}"></div>`:'';}).join('')}
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>
      <div class="flex flex-wrap gap-3 mt-4 pt-3" style="border-top:1px solid var(--line-2);">
        ${STATUSES.map(s=>`<span class="flex items-center gap-1.5" style="font-size:11px;color:var(--mute);"><span class="w-2.5 h-2.5 rounded-full" style="background:${SDOT[s]};"></span>${s}</span>`).join('')}
      </div>
    </div>
  </div>

  <div class="k-card" style="padding:20px;">
    <h3 class="k-h3" style="margin-bottom:16px;">Overall Status Distribution</h3>
    <div class="flex gap-1.5 h-4 rounded-full overflow-hidden mb-3" style="background:var(--line-2);">
      ${STATUSES.map(s=>{const n=all.filter(i=>i.status===s).length;return n?`<div class="bar-fill" style="width:${Math.round(n/(ti||1)*100)}%;background:${SDOT[s]};" title="${s}: ${n}"></div>`:'';}).join('')}
    </div>
    <div class="flex flex-wrap gap-4">
      ${STATUSES.map(s=>{const n=all.filter(i=>i.status===s).length;return`<span class="flex items-center gap-1.5" style="font-size:12px;color:var(--ink-3);"><span class="w-2.5 h-2.5 rounded-full" style="background:${SDOT[s]};"></span>${s}: <b class="k-num" style="font-size:12px;">${n}</b></span>`;}).join('')}
    </div>
  </div>
  ${topUsers.length?`<div class="k-card mt-5" style="padding:20px;">
    <h3 class="k-h3" style="margin-bottom:14px;">Team Activity This Week</h3>
    <div style="display:flex;flex-direction:column;gap:10px;">
      ${topUsers.map(([name,count],i)=>`<div class="flex items-center gap-3">
        <div class="flex items-center justify-center shrink-0" style="width:22px;height:22px;border-radius:50%;background:var(--teal-hi);color:var(--teal);font-size:11px;font-weight:600;">${i+1}</div>
        <div class="flex-1 min-w-0" style="font-size:13px;font-weight:500;color:var(--ink);" class="truncate">${esc(name)}</div>
        <div class="k-num" style="font-size:13px;color:var(--teal);">${count}</div>
        <div class="k-eyebrow" style="text-transform:none;letter-spacing:0;">update${count!==1?'s':''}</div>
        <div class="w-20 h-1.5 rounded-full overflow-hidden" style="background:var(--line-2);"><div class="h-full rounded-full" style="width:${Math.round(count/topUsers[0][1]*100)}%;background:var(--teal);"></div></div>
      </div>`).join('')}
    </div>
  </div>`:''}
</div>`;
}

// ─── CLIENT LIST ──────────────────────────────────────────────────
function renderClientList(){
  const q=S.search.toLowerCase();
  const fl=S.clients.filter(c=>c.name.toLowerCase().includes(q));
  const ti=S.clients.reduce((a,c)=>a+c.integrations.length,0);
  const ar=S.clients.reduce((a,c)=>a+c.integrations.filter(i=>i.status==='At Risk').length,0);
  const ip=S.clients.reduce((a,c)=>a+c.integrations.filter(i=>i.status==='In Progress').length,0);
  return`<div class="k-page fade">
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
    ${[['Clients',S.clients.length,'text-[#0e7490]','bg-[#0e7490]/10'],['Total Integrations',ti,'text-gray-700','bg-gray-100'],['In Progress',ip,'text-[#0e7490]','bg-cyan-50'],['At Risk',ar,'text-rose-600','bg-rose-50']].map(([l,v,tc,bg])=>`<div class="${bg} rounded-2xl p-4"><div class="text-2xl font-bold ${tc}">${v}</div><div class="text-xs text-gray-500 mt-0.5">${l}</div></div>`).join('')}
  </div>
  <div class="flex flex-wrap items-center justify-between gap-3 mb-5">
    <h1 class="text-xl font-bold text-gray-900">Clients</h1>
    <div class="flex items-center gap-2">
      <input id="search-inp" data-act="search" type="text" placeholder="Search clients…" value="${esc(S.search)}" class="border border-gray-200 rounded-xl px-3 py-2 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/>
      <button data-act="modal-open" data-modal="add-client" class="whitespace-nowrap btn-grad text-white text-sm font-semibold px-4 py-2 rounded-xl transition">+ Add Client</button>
    </div>
  </div>
  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
    ${fl.length?fl.map((c,idx)=>{
      const ar2=c.integrations.filter(i=>i.status==='At Risk').length;
      const od2=c.integrations.filter(isOverdue).length;
      return`<div data-act="open-client" data-id="${c.id}" style="animation-delay:${Math.min(idx*35,400)}ms" class="row-in card-hover bg-white rounded-2xl border border-gray-100 p-5 hover:border-[#0e7490]/30 transition cursor-pointer relative overflow-hidden">
        <div class="absolute left-0 top-0 bottom-0 w-1 ${healthColor(c)}"></div>
        <div class="flex items-start justify-between mb-3 pl-1.5">
          <div class="flex-1 min-w-0 pr-2"><div class="font-semibold text-gray-900" title="${esc(c.name)}">${esc(c.name)}</div>${c.description?`<div class="text-xs text-gray-400 mt-0.5 truncate" title="${esc(c.description)}">${esc(c.description)}</div>`:''}</div>
          <span class="text-2xl font-extrabold text-[#0e7490] opacity-60 shrink-0">${c.integrations.length}</span>
        </div>
        <div class="text-xs text-gray-400 pl-1.5">${c.integrations.length} integration${c.integrations.length!==1?'s':''}</div>
        <div class="flex gap-1 mt-2 mb-1 h-1 pl-1.5">${sBar(c.integrations)}</div>
        <div class="flex gap-2 pl-1.5 mt-2">
          ${ar2>0?`<span class="text-xs font-medium text-rose-600 bg-rose-50 rounded-lg px-2.5 py-1 inline-block">⚠ ${ar2} at risk</span>`:''}
          ${od2>0?`<span class="text-xs font-medium text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1 inline-block">⏰ ${od2} overdue</span>`:''}
        </div>
      </div>`;
    }).join(''):`<div class="col-span-3 text-center py-16 text-gray-400">${emptyIcon('search')}No clients match "${esc(S.search)}"</div>`}
  </div>
</div>`;
}

// ─── IMPLEMENTATIONS ──────────────────────────────────────────────
function implProgress(client){
  let total=0,completed=0,atRisk=0;
  (client.modules||[]).forEach(m=>(m.phases||[]).forEach(ph=>{total++;if(ph.status==='Completed')completed++;if(ph.status==='At Risk')atRisk++;}));
  return{total,completed,atRisk,pct:total?Math.round(completed/total*100):0};
}
function renderImplClientList(){
  const implClients=S.clients.filter(c=>c.modules!==undefined);
  const totalModules=implClients.reduce((a,c)=>a+(c.modules?.length||0),0);
  const atRiskClients=implClients.filter(c=>implAutoRag(c)==='Red').length;
  const amberClients=implClients.filter(c=>implAutoRag(c)==='Amber').length;
  return`<div class="k-page fade">
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
    ${[['Clients',implClients.length,'text-[#0e7490]','bg-[#0e7490]/10'],['Total Modules',totalModules,'text-gray-700','bg-gray-100'],['Amber',amberClients,'text-amber-600','bg-amber-50'],['Red',atRiskClients,'text-rose-600','bg-rose-50']].map(([l,v,tc,bg])=>`<div class="${bg} rounded-2xl p-4"><div class="text-2xl font-bold ${tc}">${v}</div><div class="text-xs text-gray-500 mt-0.5">${l}</div></div>`).join('')}
  </div>
  <div class="flex flex-wrap items-center justify-between gap-3 mb-5">
    <h1 class="text-xl font-bold text-gray-900">Implementations</h1>
    <button data-act="modal-open" data-modal="add-impl-client" class="btn-grad text-white text-sm font-semibold px-4 py-2 rounded-xl transition">+ Add Client</button>
  </div>
  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
    ${implClients.length?implClients.map((c,idx)=>{
      const mods=c.modules||[];
      const pr=implProgress(c);
      const rag=implAutoRag(c);
      const barColor=rag==='Red'?'bg-rose-500':rag==='Amber'?'bg-amber-500':'bg-green-500';
      return`<div data-act="open-impl-client" data-id="${c.id}" style="animation-delay:${Math.min(idx*35,400)}ms" class="row-in card-hover bg-white rounded-2xl border border-gray-100 p-5 hover:border-[#0e7490]/30 transition cursor-pointer relative overflow-hidden">
        <div class="absolute left-0 top-0 bottom-0 w-1 ${barColor}"></div>
        <div class="flex items-start justify-between mb-2 pl-1.5">
          <div class="flex-1 min-w-0 pr-2"><div class="font-semibold text-gray-900" title="${esc(c.name)}">${esc(c.name)}</div>${c.description?`<div class="text-xs text-gray-400 mt-0.5 truncate" title="${esc(c.description)}">${esc(c.description)}</div>`:''}</div>
          ${rag?ragBadge(rag):''}
        </div>
        <div class="text-xs text-gray-400 pl-1.5">${mods.length} module${mods.length!==1?'s':''} · ${pr.completed}/${pr.total} phases</div>
        ${pr.total>0?`<div class="h-1 bg-gray-100 rounded-full overflow-hidden mt-2 pl-0"><div class="h-full rounded-full ${barColor==='bg-rose-500'?'bg-rose-400':barColor==='bg-amber-500'?'bg-amber-400':'bg-[#0e7490]'}" style="width:${pr.pct}%"></div></div>`:''}
      </div>`;
    }).join(''):`<div class="col-span-3 text-center py-16 text-gray-400">${emptyIcon('inbox')}No implementation clients yet. Add one to get started.</div>`}
  </div>
</div>`;
}

function renderImplClientDetail(clientId){
  const c=S.clients.find(x=>x.id===clientId);
  if(!c)return`<div class="p-8 text-gray-400">Client not found</div>`;
  const pr=implProgress(c);
  const bulk=S.bulkImplMode&&S.bulkImplCid===c.id;
  const sel=S.bulkSelected;
  const selCount=sel.size;
  return`<div class="k-page fade">
  <div class="flex items-center gap-2 text-sm text-gray-400 mb-4">
    <button data-act="nav-impl" class="hover:text-[#0e7490]">Implementations</button><span>›</span>
    <span class="text-gray-900 font-medium">${esc(c.name)}</span>
  </div>
  <div class="flex flex-wrap items-start justify-between gap-4 mb-5">
    <div>
      <div class="flex items-center gap-3 flex-wrap">
        <h1 class="text-xl font-bold text-gray-900">${esc(c.name)}</h1>
        ${(()=>{const r=implAutoRag(c);return r?ragBadge(r):''})()}
      </div>
      ${c.description?`<p class="text-sm text-gray-400 mt-0.5">${esc(c.description)}</p>`:''}
      ${pr.total>0?`<p class="text-xs text-gray-400 mt-1">${pr.completed}/${pr.total} phases complete · ${pr.pct}%${pr.atRisk>0?` · <span class="text-rose-500">${pr.atRisk} at risk</span>`:''}</p>`:''}
    </div>
    <div class="flex gap-2 flex-wrap">
      ${bulk?`<span class="text-xs text-[#0e7490] bg-[#0e7490]/10 px-3 py-2 rounded-xl font-medium">Select phases to mark complete</span>
        <button data-act="toggle-bulk-impl" data-cid="${c.id}" class="text-xs text-gray-500 border border-gray-200 px-3 py-2 rounded-xl hover:bg-gray-50 transition">✕ Cancel</button>`
      :`${can('admin')?`<button data-act="toggle-bulk-impl" data-cid="${c.id}" class="bg-amber-50 border border-amber-200 text-amber-700 text-xs font-medium px-3 py-2 rounded-xl hover:bg-amber-100 transition">✓ Bulk Mark Complete</button>`:''}
        <button data-act="modal-open" data-modal="add-impl-module" data-cid="${c.id}" class="bg-green-50 border border-green-200 text-green-700 text-xs font-medium px-3 py-2 rounded-xl hover:bg-green-100 transition">+ Add Module</button>
        <button data-act="exp-impl-pdf" data-cid="${c.id}" class="btn-grad text-white text-sm font-medium px-4 py-2 rounded-xl transition">📄 Export PDF</button>
      <button data-act="exp-excel" data-etype="impl" data-cid="${c.id}" class="bg-green-50 border border-green-200 text-green-700 text-xs font-medium px-3 py-2 rounded-xl hover:bg-green-100 transition">📊 Excel</button>
        ${can('admin')?`<button data-act="delete-impl-client" data-id="${c.id}" class="text-rose-400 hover:text-rose-600 text-xs px-2">Remove Client</button>`:''}`}
    </div>
  </div>
  ${pr.total>0?`<div class="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-5"><div class="h-full bg-[#0e7490] rounded-full bar-fill" style="width:${pr.pct}%"></div></div>`:''}
  <div class="bg-white rounded-2xl border border-gray-100 overflow-hidden overflow-x-auto${bulk?' ring-2 ring-amber-300':''}">
    <table class="w-full text-sm">
      <thead class="border-b border-gray-100 bg-gray-50 sticky-head">
        <tr><th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide sticky left-0 bg-gray-50 min-w-[160px]">Module</th>
        ${PHASES.map(ph=>`<th class="px-3 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide min-w-[120px]">${ph}</th>`).join('')}</tr>
      </thead>
      <tbody class="divide-y divide-gray-50">
        ${(c.modules||[]).length?(c.modules||[]).map(m=>`<tr>
          <td class="px-4 py-3 font-medium text-gray-900 whitespace-nowrap sticky left-0 bg-white">
            <div class="flex items-center justify-between gap-2">
              <span>${esc(m.name)}</span>
              ${!bulk&&can('admin')?`<button data-act="delete-impl-module" data-cid="${c.id}" data-mid="${m.id}" title="Delete module" class="text-gray-200 hover:text-rose-500 transition text-sm leading-none shrink-0">✕</button>`:''}
            </div>
          </td>
          ${PHASES.map(phName=>{
            const ph=(m.phases||[]).find(x=>x.name===phName)||{name:phName,status:'Not Started',updates:[]};
            const isDone=ph.status==='Completed';
            const key=`${m.id}:${phName}`;
            const isSel=sel.has(key);
            if(bulk){
              if(isDone){
                return`<td class="px-2 py-2 text-center opacity-30" title="Already completed">
                  ${sbadge(ph.status)}
                </td>`;
              }
              return`<td class="px-2 py-2 text-center">
                <button data-act="toggle-bulk-phase" data-cid="${c.id}" data-mid="${m.id}" data-phase="${esc(phName)}" class="w-full relative group">
                  <div class="absolute inset-0.5 rounded-lg pointer-events-none ${isSel?'ring-2 ring-[#0e7490] ring-offset-1 bg-[#0e7490]/5':'group-hover:ring-1 group-hover:ring-amber-300 group-hover:bg-amber-50'}"></div>
                  ${sbadge(ph.status)}
                  <div class="text-[10px] font-semibold mt-0.5 ${isSel?'text-[#0e7490]':'text-gray-300'}">${isSel?'✓ Selected':'tap to select'}</div>
                </button>
              </td>`;
            }
            return`<td class="px-2 py-2 text-center">
              <button data-act="open-impl-phase" data-cid="${c.id}" data-mid="${m.id}" data-phase="${esc(phName)}" class="w-full">
                ${sbadge(ph.status)}
                ${ph.updates?.length?`<div class="text-[10px] text-gray-400 mt-0.5">${ph.updates.length} update${ph.updates.length!==1?'s':''}</div>`:''}
                ${ph.assignee?`<div class="text-[10px] text-gray-400 truncate mt-0.5" title="${esc(ph.assignee)}">${esc(ph.assignee)}</div>`:''}
              </button>
            </td>`;
          }).join('')}
        </tr>`).join(''):`<tr><td colspan="${PHASES.length+1}" class="text-center py-12 text-gray-400 text-sm">${emptyIcon('inbox')}No modules yet. Add one to start tracking phases.</td></tr>`}
      </tbody>
    </table>
  </div>
  ${bulk?`<div class="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-200 shadow-xl px-6 py-4 flex items-center justify-between gap-4">
    <div class="flex items-center gap-3">
      <div class="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center text-sm font-bold text-amber-700">${selCount}</div>
      <div>
        <div class="font-semibold text-gray-900 text-sm">${selCount===0?'No phases selected':selCount===1?'1 phase selected':`${selCount} phases selected`}</div>
        <div class="text-xs text-gray-400">Already-completed phases are excluded and shown greyed out</div>
      </div>
    </div>
    <div class="flex items-center gap-3">
      <button data-act="toggle-bulk-impl" data-cid="${c.id}" class="text-sm text-gray-500 border border-gray-200 px-4 py-2 rounded-xl hover:bg-gray-50 transition">Cancel</button>
      <button data-act="bulk-mark-complete" data-cid="${c.id}" ${selCount===0?'disabled class="bg-gray-100 text-gray-400 text-sm font-semibold px-5 py-2 rounded-xl cursor-not-allowed"':'class="btn-grad text-white text-sm font-semibold px-5 py-2 rounded-xl transition"'}>
        ✓ Mark ${selCount||''} Phase${selCount===1?'':'s'} Complete
      </button>
    </div>
  </div>
  <div class="h-20"></div>`:''}
</div>`;
}

function renderImplPhaseDetail(clientId,moduleId,phaseName){
  const c=S.clients.find(x=>x.id===clientId);
  const mod=(c?.modules||[]).find(x=>x.id===moduleId);
  const ph=mod?.phases?.find(x=>x.name===phaseName);
  if(!c||!mod||!ph)return`<div class="p-8 text-gray-400">Not found</div>`;
  if(!ph.updates)ph.updates=[];
  return`<div class="max-w-6xl mx-auto px-6 py-7 fade">
  <div class="flex items-center gap-2 text-sm text-gray-400 mb-4 flex-wrap">
    <button data-act="nav-impl" class="hover:text-[#0e7490]">Implementations</button><span>›</span>
    <button data-act="open-impl-client" data-id="${c.id}" class="hover:text-[#0e7490]">${esc(c.name)}</button><span>›</span>
    <span class="text-gray-900 font-medium truncate max-w-xs" title="${esc(mod.name)} · ${esc(phaseName)}">${esc(mod.name)} · ${esc(phaseName)}</span>
  </div>
  <div class="flex items-center gap-3 mb-2 flex-wrap">
    <h1 class="text-xl font-bold text-gray-900">${esc(mod.name)} — ${esc(phaseName)}</h1>${sbadge(ph.status)}
  </div>
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-5">
    <div class="bg-white rounded-2xl border border-gray-100 p-6">
      <h3 class="font-semibold text-gray-900 mb-4 text-sm">Details</h3>
      <div class="space-y-4">
        <div><label class="block text-xs font-medium text-gray-400 mb-1.5">Status</label>
          ${can('edit')?`<select id="ip-status" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]">${STATUSES.map(s=>`<option${s===ph.status?' selected':''}>${s}</option>`).join('')}</select>`:sbadge(ph.status)}
        </div>
        <div><label class="block text-xs font-medium text-gray-400 mb-1.5">Assignee</label>
          ${can('edit')?assigneeSelect('ip-assignee',ph.assignee||''):
          `<p class="text-sm text-gray-700">${esc(ph.assignee||'—')}</p>`}
        </div>
        <div><label class="block text-xs font-medium text-gray-400 mb-1.5">Start Date</label>
          ${can('edit')?`<input id="ip-start" type="date" value="${esc(ph.startDate||'')}" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/>`:
          `<p class="text-sm text-gray-700">${fmtDate(ph.startDate)}</p>`}
        </div>
        <div><label class="block text-xs font-medium text-gray-400 mb-1.5">Target Date</label>
          ${can('edit')?`<input id="ip-target" type="date" value="${esc(ph.targetDate||'')}" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/>`:
          `<p class="text-sm text-gray-700">${fmtDate(ph.targetDate)}</p>`}
        </div>
        <div><label class="block text-xs font-medium text-gray-400 mb-1.5">Current Activity</label>
          ${can('edit')?`<textarea id="ip-activity" rows="3" placeholder="What is currently happening in this phase?" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490] resize-none">${esc(ph.currentActivity||'')}</textarea>`:
          `<p class="text-sm text-gray-700 leading-relaxed">${esc(ph.currentActivity||'—')}</p>`}
        </div>
        <div><label class="block text-xs font-medium text-gray-400 mb-1.5">Next Action</label>
          ${can('edit')?`<textarea id="ip-next" rows="2" placeholder="What is the next planned step?" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490] resize-none">${esc(ph.nextAction||'')}</textarea>`:
          `<p class="text-sm text-gray-700">${esc(ph.nextAction||'—')}</p>`}
        </div>
        ${can('edit')?`<button data-act="save-impl-phase" data-cid="${c.id}" data-mid="${mod.id}" data-phase="${esc(phaseName)}" class="w-full btn-grad text-white font-semibold rounded-xl py-2.5 text-sm transition">Save Changes</button>`:''}
      </div>
    </div>
    <div class="bg-white rounded-2xl border border-gray-100 p-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-semibold text-gray-900 text-sm">Updates <span class="text-gray-400 font-normal">(${ph.updates.length})</span></h3>
      </div>
      ${can('edit')?`<div class="mb-4">
        <textarea id="ip-update-input" rows="3" placeholder="What happened? Current status?" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490] resize-none mb-2"></textarea>
        <div class="flex gap-2 mb-2">
          <input id="ip-attach-label" type="text" placeholder="File label e.g. Signoff Mail (optional)" class="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/>
          <label class="cursor-pointer flex items-center gap-1.5 text-xs font-medium text-[#0e7490] bg-[#0e7490]/8 border border-[#0e7490]/30 px-3 py-2 rounded-xl hover:bg-[#0e7490]/15 transition whitespace-nowrap shrink-0">
            📎 Attach File
            <input id="ip-attach-file" type="file" class="hidden" accept=".pdf,.xlsx,.xls,.jpg,.jpeg,.png,.gif,.webp"/>
          </label>
        </div>
        <div id="ip-attach-preview" class="hidden mb-2 text-xs text-[#0e7490] bg-[#0e7490]/8 px-2.5 py-1.5 rounded-xl flex items-center gap-2">
          <span id="ip-attach-icon">📎</span><span id="ip-attach-name" class="flex-1 truncate"></span>
          <button data-act="clear-attach" data-prefix="ip" class="text-gray-400 hover:text-rose-500 shrink-0">✕</button>
        </div>
        <div class="text-[10px] text-gray-400 mb-2">PDF, Excel (.xlsx/.xls) or image · max 3MB</div>
        <input id="ip-attach-url" type="hidden" value=""/>
        <input id="ip-attach-mimetype" type="hidden" value=""/>
        <input id="ip-attach-filename" type="hidden" value=""/>
        <button data-act="add-impl-update" data-cid="${c.id}" data-mid="${mod.id}" data-phase="${esc(phaseName)}" class="w-full text-sm font-medium bg-gray-50 hover:bg-[#0e7490]/10 hover:text-[#0e7490] text-gray-700 border border-gray-200 rounded-xl py-2 transition">+ Add Update</button>
      </div>`:''}
      <div class="space-y-3 max-h-[440px] overflow-y-auto pr-1">
        ${!ph.updates.length?`<div class="text-sm text-gray-400 text-center py-8">${emptyIcon('clock')}No updates yet</div>`:
        ph.updates.map((t,idx,arr)=>{
          const isEditing=S.editingTimelineId===t.id;
          const hasHistory=t.edits&&t.edits.length>0;
          const isExpanded=S.expandedHistory.has(t.id);
          if(isEditing){
            return`<div class="relative pl-5 ${idx<arr.length-1?'pb-3 border-l-2 border-gray-100':''}">
              <div class="absolute -left-[5px] top-1 w-2.5 h-2.5 bg-[#0e7490] rounded-full border-2 border-white ring-1 ring-[#0e7490]/30"></div>
              <div class="text-xs font-semibold text-[#0e7490] mb-1">${esc(t.date)} · ${esc(t.addedBy||'')}</div>
              <textarea id="edit-tl-${t.id}" rows="3" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490] resize-none mb-2">${esc(t.update)}</textarea>
              <div class="flex gap-2 mb-1">
                <input id="eat-label-${t.id}" type="text" placeholder="File label (optional)" value="${esc(t.attachment?.label||t.attachment?.fileName||'')}" class="flex-1 border border-gray-200 rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/>
                <label class="cursor-pointer flex items-center gap-1 text-xs font-medium text-[#0e7490] bg-[#0e7490]/8 border border-[#0e7490]/30 px-2.5 py-1.5 rounded-xl hover:bg-[#0e7490]/15 transition whitespace-nowrap shrink-0">
                  📎 ${t.attachment?.url?'Replace':'Attach'}
                  <input id="eat-file-${t.id}" type="file" class="hidden" accept=".pdf,.xlsx,.xls,.jpg,.jpeg,.png,.gif,.webp" data-tid="${t.id}"/>
                </label>
              </div>
              ${t.attachment?.url?`<div id="eat-preview-${t.id}" class="mb-1 text-xs text-[#0e7490] bg-[#0e7490]/8 px-2 py-1 rounded-xl flex items-center gap-2">
                <span>${fileIcon(t.attachment.url,t.attachment.mimeType||'')}</span>
                <span class="flex-1 truncate" id="eat-name-${t.id}">${esc(t.attachment.fileName||t.attachment.label||'Attachment')}</span>
                <button data-act="clear-attach" data-prefix="eat" data-tid="${t.id}" class="text-gray-400 hover:text-rose-500 shrink-0">✕</button>
              </div>`:`<div id="eat-preview-${t.id}" class="hidden mb-1 text-xs text-[#0e7490] bg-[#0e7490]/8 px-2 py-1 rounded-xl flex items-center gap-2">
                <span id="eat-icon-${t.id}">📎</span>
                <span class="flex-1 truncate" id="eat-name-${t.id}"></span>
                <button data-act="clear-attach" data-prefix="eat" data-tid="${t.id}" class="text-gray-400 hover:text-rose-500 shrink-0">✕</button>
              </div>`}
              <input id="eat-url-${t.id}" type="hidden" value="${esc(t.attachment?.url||'')}"/>
              <input id="eat-mimetype-${t.id}" type="hidden" value="${esc(t.attachment?.mimeType||'')}"/>
              <input id="eat-filename-${t.id}" type="hidden" value="${esc(t.attachment?.fileName||'')}"/>
              <div class="flex gap-2 mt-2">
                <button data-act="cancel-edit-timeline" class="flex-1 text-xs font-medium text-gray-500 border border-gray-200 rounded-lg py-1.5 hover:bg-gray-50 transition">Cancel</button>
                <button data-act="save-edit-impl-update" data-cid="${c.id}" data-mid="${mod.id}" data-phase="${esc(phaseName)}" data-tid="${t.id}" class="flex-1 text-xs font-semibold text-white bg-[#0e7490] rounded-lg py-1.5 hover:bg-[#0d3d4f] transition">Save Edit</button>
              </div>
            </div>`;
          }
          return`<div class="relative pl-5 ${idx<arr.length-1?'pb-3 border-l-2 border-gray-100':''}">
          <div class="absolute -left-[5px] top-1 w-2.5 h-2.5 bg-[#0e7490] rounded-full border-2 border-white ring-1 ring-[#0e7490]/30"></div>
          <div class="flex items-start justify-between gap-2">
            <div class="text-xs font-semibold text-[#0e7490] mb-1">${esc(t.date)} · ${esc(t.addedBy||'')}</div>
            <div class="flex items-center gap-2 shrink-0">
              ${can('edit')?`<button data-act="edit-timeline" data-tid="${t.id}" class="text-[10px] text-gray-300 hover:text-[#0e7490]">Edit</button>`:''}
              ${can('admin')?`<button data-act="delete-impl-update" data-cid="${c.id}" data-mid="${mod.id}" data-phase="${esc(phaseName)}" data-tid="${t.id}" class="text-[10px] text-gray-300 hover:text-rose-500">Delete</button>`:''}
              <button data-act="copy-update" data-text="${esc(t.update)}" class="text-[10px] text-gray-300 hover:text-[#0e7490]">Copy</button>
            </div>
          </div>
          <p class="text-sm text-gray-700 leading-relaxed">${esc(t.update)}</p>
          ${t.attachment?.url?attachmentChip(t.attachment):''}
          <div class="flex items-center gap-3 mt-1 flex-wrap">
            ${t.addedAt?`<span class="text-xs text-gray-400">${fmtDate(t.addedAt)}</span>`:''}
            ${hasHistory?`<button data-act="toggle-history" data-tid="${t.id}" class="text-xs text-amber-600 hover:text-amber-700 font-medium">✎ edited${t.edits.length>1?` (${t.edits.length}×)`:''} — ${isExpanded?'hide':'view'} history</button>`:''}
          </div>
          ${isExpanded&&hasHistory?`<div class="mt-2 pl-3 border-l-2 border-amber-200 space-y-2">
            ${[...t.edits].reverse().map(e=>`<div class="text-xs"><div class="text-gray-400 mb-0.5">${fmtDate(e.editedAt)} · ${esc(e.editedBy||'')} changed it from:</div><div class="text-gray-500">${esc(e.text)}</div></div>`).join('')}
          </div>`:''}
        </div>`;
        }).join('')}
      </div>
    </div>
  </div>
</div>`;
}

// ─── AMS ──────────────────────────────────────────────────────────
function amsEntryAmount(hours,rate){if(!rate)return null;return(hours/HOURS_PER_DAY)*rate;}
function amsStatusBadge(s){const m={'Open':'bg-blue-50 text-blue-700 border-blue-200','In Progress':'bg-amber-50 text-amber-700 border-amber-200','Closed':'bg-green-50 text-green-700 border-green-200'};return`<span class="text-xs font-medium border ${m[s]||'bg-gray-50 text-gray-600 border-gray-200'} px-2 py-0.5 rounded-full">${esc(s||'Open')}</span>`;}
function entryDate(e){return e.dateRaised||e.date||''}
function entryType(e){return e.type||e.category||'—'}
function entryRaisedBy(e){return e.raisedBy||e.loggedBy||'—'}
function currencySymbol(client){return CURRENCIES[client?.currency||'INR']?.symbol||'₹';}
function implAutoRag(client){
  const today=todayStr();let hasRed=false,hasAmber=false,hasInProgress=false;
  (client.modules||[]).forEach(m=>(m.phases||[]).forEach(ph=>{
    if(ph.status==='Completed'||ph.status==='Not Started')return;
    hasInProgress=true;
    if(ph.status==='At Risk'){hasRed=true;return;}
    if(ph.targetDate){
      const d=daysDiff(ph.targetDate);
      if(d>=14){hasRed=true;return;}
      if(d>=1){hasAmber=true;return;}
    }
    const updates=ph.updates||[];
    if(!updates.length){hasAmber=true;return;}
    const lastUpd=updates.reduce((a,u)=>{ const dt=u.addedAt||u.date||''; return dt>a?dt:a; },'');
    const daysAgo=lastUpd?Math.floor((Date.now()-new Date(lastUpd))/86400000):99;
    if(daysAgo>=14)hasRed=true;
    else if(daysAgo>=7)hasAmber=true;
  }));
  if(!hasInProgress&&(client.modules||[]).length>0)return'Green';
  if(hasRed)return'Red';
  if(hasAmber)return'Amber';
  if(!hasInProgress)return null;
  return'Green';
}
function parseAmsEntriesCsv(text){
  const lines=text.trim().split('\n').filter(l=>l.trim());
  if(!lines.length)return[];
  const hasHeader=lines[0].toLowerCase().includes('date_raised')||lines[0].toLowerCase().includes('date raised');
  const dataLines=hasHeader?lines.slice(1):lines;
  return dataLines.map((line,i)=>{
    const p=line.split(',').map(c=>c.trim().replace(/^"|"$/g,''));
    const [date_raised,due_date,raised_by,module,project,description,type,query_level,entry_status,mode_of_support,hours]=p;
    let error=null;
    if(!date_raised)error='date_raised required';
    else if(!hours||isNaN(parseFloat(hours)))error='hours required (number)';
    else if(!description)error='description required';
    return{dateRaised:date_raised,dueDate:due_date||'',raisedBy:raised_by||'',module:module||'',project:project||'',description:description||'',type:type||AMS_TYPES[0],queryLevel:query_level||AMS_QUERY_LEVELS[0],entryStatus:entry_status||'Open',modeOfSupport:mode_of_support||AMS_MODES[0],hours:parseFloat(hours)||0,error,row:i+(hasHeader?2:1)};
  });
}
function parseIntegrationsCsv(text,existingIntegs=[]){
  const lines=text.trim().split('\n').filter(l=>l.trim());
  if(!lines.length)return[];
  const hasHeader=lines[0].toLowerCase().includes('name')||lines[0].toLowerCase().includes('integration');
  const dataLines=hasHeader?lines.slice(1):lines;
  return dataLines.map((line,i)=>{
    const p=line.split(',').map(c=>c.trim().replace(/^"|"$/g,''));
    const [name,status,assignee,due_date,description,next_action]=p;
    let error=null;
    if(!name)error='name required';
    else if(existingIntegs.find(x=>x.name.toLowerCase()===name.toLowerCase()))error=`"${name}" already exists`;
    return{name:name||'',status:STATUSES.includes(status)?status:'Not Started',assignee:assignee||'',dueDate:due_date||'',description:description||'',nextAction:next_action||'',error,row:i+(hasHeader?2:1)};
  });
}
const RAG_BADGE={Red:'k-rag k-rag-red',Amber:'k-rag k-rag-amber',Green:'k-rag k-rag-green'};
const RAG_DOT={Red:'k-rag-red',Amber:'k-rag-amber',Green:'k-rag-green'};
function ragBadge(rag,size='sm'){if(!rag)return'<span class="text-xs" style="color:var(--mute-2)">—</span>';return`<span class="${RAG_BADGE[rag]||''}">${rag}</span>`;}
function amsClientRag(client){
  const entries=client.workLog||[];
  const open=entries.filter(e=>(e.entryStatus||'Open')!=='Closed');
  if(!entries.length)return null;
  if(open.some(e=>e.ragStatus==='Red'))return'Red';
  if(open.some(e=>e.dueDate&&e.dueDate<todayStr()))return'Red';
  if(open.some(e=>e.ragStatus==='Amber'))return'Amber';
  const threeDays=new Date();threeDays.setDate(threeDays.getDate()+3);const soonStr=threeDays.toISOString().slice(0,10);
  if(open.some(e=>e.dueDate&&e.dueDate<=soonStr&&e.dueDate>=todayStr()))return'Amber';
  if(open.length===0&&entries.length>0)return'Green';
  if(open.every(e=>!e.ragStatus||e.ragStatus==='Green'))return'Green';
  return'Green';
}
function amsTotals(client,fromDate,toDate){
  const allLog=client.workLog||[];
  const log=allLog.filter(e=>(!fromDate||entryDate(e)>=fromDate)&&(!toDate||entryDate(e)<=toDate));
  const totalHours=log.reduce((a,e)=>a+Number(e.hours||0),0);
  const allTimeHours=allLog.reduce((a,e)=>a+Number(e.hours||0),0);
  const bucket=client.totalAvailableHours;
  const hasBucket=bucket!==undefined&&bucket!==null&&bucket>0;
  const hasRate=!!(client.manDayRate>0);
  let billableHours=totalHours,coveredHours=0,balanceAvailable=null;
  if(hasBucket){
    const hoursBeforePeriod=fromDate?allLog.filter(e=>entryDate(e)<fromDate).reduce((a,e)=>a+Number(e.hours||0),0):0;
    const remainingAtPeriodStart=Math.max(0,bucket-hoursBeforePeriod);
    coveredHours=Math.min(totalHours,remainingAtPeriodStart);
    billableHours=Math.max(0,totalHours-remainingAtPeriodStart);
    balanceAvailable=Math.max(0,bucket-allTimeHours);
  }
  const totalAmount=hasRate?(amsEntryAmount(billableHours,client.manDayRate)||0):null;
  const byType={};
  log.forEach(e=>{const tp=entryType(e);byType[tp]=(byType[tp]||0)+Number(e.hours||0);});
  return{log,totalHours,totalAmount,byType,hasRate,hasBucket,totalAvailableHours:bucket,billableHours,coveredHours,consumedAllTime:allTimeHours,balanceAvailable};
}
function renderAmsClientList(){
  return`<div class="k-page fade">
  <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
    <h1 class="text-xl font-bold text-gray-900">AMS &amp; Support Retainers</h1>
    ${can('admin')?`<button data-act="modal-open" data-modal="add-ams-client" class="btn-grad text-white text-sm font-semibold px-4 py-2 rounded-xl transition">+ Add Client</button>`:''}
  </div>
  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
    ${(()=>{const amsClients=S.clients.filter(c=>c.workLog!==undefined);return amsClients.length?amsClients.map((c,idx)=>{
      const t=amsTotals(c,'','');
      return`<div data-act="open-ams-client" data-id="${c.id}" style="animation-delay:${Math.min(idx*35,400)}ms" class="row-in card-hover bg-white rounded-2xl border border-gray-100 p-5 hover:border-[#0e7490]/30 transition cursor-pointer">
        <div class="flex items-start justify-between mb-1">
          <div class="font-semibold text-gray-900" title="${esc(c.name)}">${esc(c.name)}</div>
          ${ragBadge(amsClientRag(c))}
        </div>
        ${c.description?`<div class="text-xs text-gray-400 mb-3 truncate" title="${esc(c.description)}">${esc(c.description)}</div>`:''}
        <div class="text-xs text-gray-500">${t.totalHours.toFixed(1)} hours logged total</div>
        ${can('admin')&&c.manDayRate?`<div class="text-xs text-gray-400 mt-1">${currencySymbol(c)}${c.manDayRate.toLocaleString('en-IN')}/day rate</div>`:can('admin')?`<div class="text-xs text-gray-400 mt-1">Retainer (no rate)</div>`:''}
        ${t.hasBucket?`<div class="text-xs mt-1 ${t.balanceAvailable>0?'text-green-600':'text-rose-600'} font-medium">${t.balanceAvailable.toFixed(1)} / ${t.totalAvailableHours.toFixed(1)} hrs available</div>`:''}
      </div>`;
    }).join(''):`<div class="col-span-3 text-center py-16 text-gray-400">${emptyIcon('hours')}No AMS clients yet.</div>`;})()}
  </div>
</div>`;
}

function renderAmsClientDetail(clientId){
  const c=S.clients.find(x=>x.id===clientId);
  if(!c)return`<div class="p-8 text-gray-400">Client not found</div>`;
  const t=amsTotals(c,S.amsFrom,S.amsTo);
  const sorted=[...t.log].sort((a,b)=>entryDate(b).localeCompare(entryDate(a)));
  const COLS=['#','Date Raised','Due Date','Raised / Attended By','Module / Meeting','Project','Description','Type','Query Level','Dependencies','Status','RAG','Solution Discussed','Mode of Support','Hours'];
  return`<div class="max-w-full mx-auto px-6 py-7 fade">
  <div class="flex items-center gap-2 text-sm text-gray-400 mb-4">
    <button data-act="nav-ams" class="hover:text-[#0e7490]">AMS</button><span>›</span>
    <span class="text-gray-900 font-medium">${esc(c.name)}</span>
  </div>
  <div class="flex flex-wrap items-start justify-between gap-4 mb-5">
    <div>
      <div class="flex items-center gap-3 mb-0.5"><h1 class="text-xl font-bold text-gray-900">${esc(c.name)}</h1>${(()=>{const r=amsClientRag(c);return r?ragBadge(r):''})()}</div>
      ${c.description?`<p class="text-sm text-gray-400 mt-0.5">${esc(c.description)}</p>`:''}
    </div>
    ${can('admin')?`<div class="flex gap-2 flex-wrap">
      <button data-act="edit-ams-client" data-id="${c.id}" class="text-gray-400 hover:text-[#0e7490] text-xs px-2 border border-gray-200 rounded-lg py-1.5">Edit Client</button>
      <button data-act="delete-ams-client" data-id="${c.id}" class="text-rose-400 hover:text-rose-600 text-xs px-2">Delete Client</button>
    </div>`:''}
  </div>
  ${can('edit')?`<div class="mb-5"><button data-act="modal-open" data-modal="add-ams-entry" data-cid="${c.id}" class="btn-grad text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition">+ Add Entry</button></div>`:''}
  ${can('admin')&&t.hasRate?`<div class="bg-white rounded-2xl border border-gray-100 p-5 mb-6">
    <h3 class="font-semibold text-gray-900 text-sm mb-3">Billing</h3>
    ${t.hasBucket?`<div class="grid grid-cols-3 gap-4 mb-4">
      <div class="bg-gray-50 rounded-xl p-4"><div class="text-2xl font-bold text-gray-700">${t.totalAvailableHours.toFixed(1)}</div><div class="text-xs text-gray-500">Total Available</div></div>
      <div class="bg-gray-50 rounded-xl p-4"><div class="text-2xl font-bold text-gray-700">${t.consumedAllTime.toFixed(1)}</div><div class="text-xs text-gray-500">Consumed (all-time)</div></div>
      <div class="${t.balanceAvailable>0?'bg-green-50':'bg-rose-50'} rounded-xl p-4"><div class="text-2xl font-bold ${t.balanceAvailable>0?'text-green-600':'text-rose-600'}">${t.balanceAvailable.toFixed(1)}</div><div class="text-xs text-gray-500">Balance Available</div></div>
    </div>`:''}
    <div class="flex flex-wrap items-end gap-3 mb-4">
      <div><label class="block text-xs text-gray-400 mb-1">From</label><input id="ams-from" data-act="ams-range" type="date" value="${esc(S.amsFrom)}" class="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <div><label class="block text-xs text-gray-400 mb-1">To</label><input id="ams-to" data-act="ams-range" type="date" value="${esc(S.amsTo)}" class="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <div class="flex gap-1.5 items-end pb-0.5">
        ${[['This Month','this-month'],['Last Month','last-month'],['This Quarter','this-quarter'],['All Time','all-time']].map(([l,k])=>`<button data-act="ams-quick" data-range="${k}" class="text-xs px-2.5 py-2 rounded-lg border transition ${S.amsQuick===k?'bg-[#0e7490] text-white border-[#0e7490]':'border-gray-200 text-gray-500 hover:border-[#0e7490] hover:text-[#0e7490]'}">${l}</button>`).join('')}
      </div>
      <button data-act="exp-ams-activity" data-cid="${c.id}" class="bg-white border border-[#0e7490] text-[#0e7490] text-sm font-medium px-4 py-2 rounded-xl hover:bg-[#0e7490]/5 transition">📋 Activity Report</button>
      <button data-act="exp-excel" data-etype="ams" data-cid="${c.id}" class="bg-green-50 border border-green-200 text-green-700 text-sm font-medium px-3 py-2 rounded-xl hover:bg-green-100 transition">📊 Excel</button>
      <button data-act="open-import-ams" data-cid="${c.id}" class="bg-amber-50 border border-amber-200 text-amber-700 text-sm font-medium px-3 py-2 rounded-xl hover:bg-amber-100 transition">⬆ Import</button>
    </div>
    <div class="grid grid-cols-3 gap-4 mb-4">
      <div class="bg-gray-50 rounded-xl p-4"><div class="text-2xl font-bold text-gray-700">${t.totalHours.toFixed(1)}</div><div class="text-xs text-gray-500">Hours This Period${t.hasBucket?` (${t.coveredHours.toFixed(1)} covered)`:''}</div></div>
      <div class="bg-gray-50 rounded-xl p-4"><div class="text-2xl font-bold text-gray-700">${currencySymbol(c)}${(c.manDayRate||0).toLocaleString('en-IN')}</div><div class="text-xs text-gray-500">Day Rate</div></div>
      <div class="bg-[#0e7490]/10 rounded-xl p-4"><div class="text-2xl font-bold text-[#0e7490]">${currencySymbol(c)}${(t.totalAmount||0).toLocaleString('en-IN',{maximumFractionDigits:0})}</div><div class="text-xs text-gray-500">Billable Amount</div></div>
    </div>
    <div class="flex flex-wrap gap-2">
      ${Object.entries(t.byType).map(([tp,hrs])=>`<span class="text-xs bg-gray-50 border border-gray-200 rounded-full px-3 py-1 text-gray-600">${esc(tp)}: ${hrs.toFixed(1)}h</span>`).join('')||'<span class="text-xs text-gray-400">No entries in this range</span>'}
    </div>
  </div>`:can('admin')&&!t.hasRate?`<div class="bg-white rounded-2xl border border-gray-100 p-5 mb-6">
    <div class="flex flex-wrap items-end gap-3 mb-4">
      <div><label class="block text-xs text-gray-400 mb-1">From</label><input id="ams-from" data-act="ams-range" type="date" value="${esc(S.amsFrom)}" class="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <div><label class="block text-xs text-gray-400 mb-1">To</label><input id="ams-to" data-act="ams-range" type="date" value="${esc(S.amsTo)}" class="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <button data-act="exp-ams-activity" data-cid="${c.id}" class="btn-grad text-white text-sm font-medium px-4 py-2 rounded-xl transition">📋 Activity Report</button>
    </div>
    <div class="bg-gray-50 rounded-xl p-4 inline-block"><div class="text-2xl font-bold text-gray-700">${t.totalHours.toFixed(1)}</div><div class="text-xs text-gray-500">Total Hours (Retainer)</div></div>
  </div>`:''}
  <div class="bg-white rounded-2xl border border-gray-100 overflow-hidden overflow-x-auto">
    <table class="w-full text-sm min-w-[1600px]">
      <thead class="border-b border-gray-100 bg-gray-50 sticky-head"><tr>
        ${COLS.map((h,i)=>`<th class="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide ${i===0?'w-8 text-center':''}">${h}</th>`).join('')}
        ${can('edit')?`<th class="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>`:''}
      </tr></thead>
      <tbody class="divide-y divide-gray-50">
        ${sorted.length?sorted.map((e,idx)=>{
          const isExpanded=S.expandedAmsHistory.has(e.id);
          const hasHistory=e.edits&&e.edits.length>0;
          return`<tr class="hover:bg-gray-50/50 transition">
            <td class="px-3 py-2 text-center text-xs text-gray-400 font-medium">${sorted.length-idx}</td>
            <td class="px-3 py-2 text-gray-600 whitespace-nowrap text-xs">${fmtDate(entryDate(e))}</td>
            <td class="px-3 py-2 text-xs ${e.dueDate&&e.dueDate<todayStr()&&(e.entryStatus||'Open')!=='Closed'?'text-rose-600 font-semibold':'text-gray-600'} whitespace-nowrap">${e.dueDate?fmtDate(e.dueDate):'—'}</td>
            <td class="px-3 py-2 text-gray-700 text-xs">${esc(entryRaisedBy(e))}</td>
            <td class="px-3 py-2 text-gray-700 text-xs">${esc(e.module||'—')}</td>
            <td class="px-3 py-2 text-gray-700 text-xs">${esc(e.project||'—')}</td>
            <td class="px-3 py-2 text-gray-700 text-xs max-w-[180px]">
              ${esc(e.description||'—')}
              ${hasHistory?`<div><button data-act="toggle-ams-history" data-eid="${e.id}" class="text-[10px] text-amber-600 hover:text-amber-700 font-medium mt-0.5">✎ edited — ${isExpanded?'hide':'view'}</button></div>`:''}
              ${isExpanded&&hasHistory?`<div class="mt-1 pl-2 border-l-2 border-amber-200 space-y-1">${[...e.edits].reverse().map(h=>`<div class="text-[10px] text-gray-400">${fmtDate(h.editedAt)}: ${esc(h.description||'—')}</div>`).join('')}</div>`:''}
            </td>
            <td class="px-3 py-2 text-xs"><span class="bg-gray-50 border border-gray-200 rounded-full px-2 py-0.5 text-gray-600">${esc(entryType(e))}</span></td>
            <td class="px-3 py-2 text-xs text-gray-600">${esc(e.queryLevel||'—')}</td>
            <td class="px-3 py-2 text-xs text-gray-600 max-w-[120px]">${esc(e.dependencies||'—')}</td>
            <td class="px-3 py-2">${amsStatusBadge(e.entryStatus||'Open')}</td>
            <td class="px-3 py-2">${e.ragStatus?ragBadge(e.ragStatus):`<span class="text-gray-300 text-xs">—</span>`}</td>
            <td class="px-3 py-2 text-xs text-gray-600 max-w-[160px]">${esc(e.solution||'—')}</td>
            <td class="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">${esc(e.modeOfSupport||'—')}</td>
            <td class="px-3 py-2 text-gray-700 font-medium text-xs text-right">${Number(e.hours||0).toFixed(1)}</td>
            ${can('edit')?`<td class="px-3 py-2"><div class="flex gap-2"><button data-act="edit-ams-entry" data-cid="${c.id}" data-eid="${e.id}" class="text-xs text-gray-300 hover:text-[#0e7490]">Edit</button>${can('admin')?`<button data-act="delete-ams-entry" data-cid="${c.id}" data-eid="${e.id}" class="text-xs text-gray-300 hover:text-rose-500">Delete</button>`:''}</div></td>`:''}
          </tr>`;
        }).join(''):`<tr><td colspan="${COLS.length+(can('edit')?1:0)}" class="text-center py-12 text-gray-400 text-sm">${emptyIcon('hours')}No entries yet. Add one to get started.</td></tr>`}
      </tbody>
    </table>
  </div>
</div>`;
}

// ─── CLIENT DETAIL (sortable table) ──────────────────────────────
function sortIntegs(list){
  const{key,dir}=S.sort;const m=dir==='asc'?1:-1;
  return[...list].sort((a,b)=>{
    let av,bv;
    if(key==='due'){av=a.dueDate||'9999';bv=b.dueDate||'9999';}
    else if(key==='lastUpdate'){av=lastUpdateDate(a)||'0000';bv=lastUpdateDate(b)||'0000';}
    else if(key==='status'){av=a.status;bv=b.status;}
    else if(key==='assignee'){av=a.assignee||'';bv=b.assignee||'';}
    else{av=a.name;bv=b.name;}
    return av<bv?-1*m:av>bv?1*m:0;
  });
}
function sortArrow(key){if(S.sort.key!==key)return'<span class="text-gray-300">↕</span>';return S.sort.dir==='asc'?'<span class="text-[#0e7490]">↑</span>':'<span class="text-[#0e7490]">↓</span>';}

function renderClientDetail(clientId){
  const c=S.clients.find(x=>x.id===clientId);
  if(!c)return`<div class="p-8 text-gray-400">Client not found</div>`;
  const fl=S.filter==='all'?c.integrations:c.integrations.filter(i=>i.status===S.filter);
  const sorted=sortIntegs(fl);
  const cols=[['name','Integration'],['status','Status'],['assignee','Assignee'],['due','Due Date'],['lastUpdate','Last Update']];
  return`<div class="k-page fade">
  <div class="flex items-center gap-2 text-sm text-gray-400 mb-4">
    <button data-act="nav-clients" class="hover:text-[#0e7490]">Clients</button><span>›</span>
    <span class="text-gray-900 font-medium">${esc(c.name)}</span>
  </div>
  <div class="flex flex-wrap items-start justify-between gap-4 mb-5">
    <div><h1 class="text-xl font-bold text-gray-900">${esc(c.name)}</h1>${c.description?`<p class="text-sm text-gray-400 mt-0.5">${esc(c.description)}</p>`:''}</div>
    <div class="relative group">
      <button class="flex items-center gap-1.5 btn-grad text-white text-sm font-medium px-4 py-2 rounded-xl transition">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>Export ▾
      </button>
      <div class="absolute right-0 top-full mt-1 bg-white border border-gray-100 rounded-xl shadow-xl w-52 py-1 hidden group-hover:block z-10">
        <button data-act="exp-pptx" data-id="${c.id}" class="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">📊 PowerPoint</button>
        <button data-act="exp-pdf"  data-id="${c.id}" class="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">📄 PDF</button>
        <button data-act="exp-excel" data-etype="integrations" data-cid="${c.id}" class="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">📋 Excel (Integrations)</button>
        <button data-act="exp-excel" data-etype="milestones" data-cid="${c.id}" class="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">🎯 Excel (Milestones)</button>
        <div class="border-t border-gray-100 my-1"></div>
        <button data-act="open-import-integ" data-cid="${c.id}" class="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">⬆ Import Integrations (CSV)</button>
      </div>
    </div>
  </div>
  <div class="flex gap-2 overflow-x-auto pb-1 mb-5 items-center">
    ${['all',...STATUSES].map(st=>`<button data-act="filter" data-filter="${st}" class="whitespace-nowrap text-xs font-medium px-3 py-1.5 rounded-full transition ${S.filter===st?'bg-[#0e7490] text-white':'bg-white border border-gray-200 text-gray-600 hover:border-[#0e7490]/40'}">${st==='all'?`All (${c.integrations.length})`:esc(st)+` (${c.integrations.filter(i=>i.status===st).length})`}</button>`).join('')}
    <button data-act="modal-open" data-modal="add-integ" data-cid="${c.id}" class="whitespace-nowrap text-xs font-medium px-3 py-1.5 rounded-full bg-green-50 border border-green-200 text-green-700 hover:bg-green-100 ml-auto">+ Add Integration</button>
  </div>
  <div class="bg-white rounded-2xl border border-gray-100 overflow-hidden">
    <table class="w-full text-sm">
      <thead class="border-b border-gray-100 bg-gray-50 sticky-head">
        <tr>${cols.map(([k,l])=>`<th data-act="sort" data-key="${k}" data-sort class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer transition select-none">${l} ${sortArrow(k)}</th>`).join('')}</tr>
      </thead>
      <tbody class="divide-y divide-gray-50">
        ${sorted.length?sorted.map(i=>{
          const lu=lastUpdateDate(i);
          return`<tr data-act="open-integ" data-cid="${c.id}" data-iid="${i.id}" class="hover:bg-gray-50/60 cursor-pointer transition">
          <td class="px-4 py-3"><div class="font-medium text-gray-900" title="${esc(i.name)}">${esc(i.name)}</div>${i.description?`<div class="text-xs text-gray-400 truncate max-w-xs" title="${esc(i.description)}">${esc(i.description)}</div>`:''}</td>
          <td class="px-4 py-3">${sbadge(i.status)}</td>
          <td class="px-4 py-3 text-gray-600">${esc(i.assignee||'—')}</td>
          <td class="px-4 py-3"><div class="flex flex-col gap-1"><span class="text-gray-600">${fmtDate(i.dueDate)}</span>${overdueBadge(i)}</div></td>
          <td class="px-4 py-3 text-gray-500">${lu?fmtDate(lu):'<span class="text-amber-600 text-xs font-medium">No updates</span>'}</td>
        </tr>`;}).join(''):`<tr><td colspan="5" class="text-center py-12 text-gray-400 text-sm">No integrations match this filter</td></tr>`}
      </tbody>
    </table>
  </div>
</div>`;
}

// ─── INTEG DETAIL ─────────────────────────────────────────────────
function renderIntegDetail(clientId,integId){
  const c=S.clients.find(x=>x.id===clientId);
  const i=c?.integrations.find(x=>x.id===integId);
  if(!c||!i)return`<div class="p-8 text-gray-400">Not found</div>`;
  return`<div class="max-w-6xl mx-auto px-6 py-7 fade">
  <div class="flex items-center gap-2 text-sm text-gray-400 mb-4">
    <button data-act="nav-clients" class="hover:text-[#0e7490]">Clients</button><span>›</span>
    <button data-act="open-client" data-id="${c.id}" class="hover:text-[#0e7490]">${esc(c.name)}</button><span>›</span>
    <span class="text-gray-900 font-medium truncate max-w-xs" title="${esc(i.name)}">${esc(i.name)}</span>
  </div>
  <div class="flex items-center gap-3 mb-2 flex-wrap">
    <h1 class="text-xl font-bold text-gray-900">${esc(i.name)}</h1>${sbadge(i.status)}${overdueBadge(i)}
  </div>
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-5">
    <div class="bg-white rounded-2xl border border-gray-100 p-6">
      <h3 class="font-semibold text-gray-900 mb-4 text-sm">Details</h3>
      <div class="space-y-4">
        <div><label class="block text-xs font-medium text-gray-400 mb-1.5">Status</label>
          ${can('edit')?`<select id="f-status" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]">${STATUSES.map(s=>`<option${s===i.status?' selected':''}>${s}</option>`).join('')}</select>`:sbadge(i.status)}
        </div>
        <div><label class="block text-xs font-medium text-gray-400 mb-1.5">Assignee</label>
          ${can('edit')?assigneeSelect('f-assignee',i.assignee||''):
          `<p class="text-sm text-gray-700">${esc(i.assignee||'—')}</p>`}
        </div>
        <div><label class="block text-xs font-medium text-gray-400 mb-1.5">Due Date</label>
          ${can('edit')?`<input id="f-due" type="date" value="${esc(i.dueDate||'')}" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/>`:
          `<p class="text-sm text-gray-700">${fmtDate(i.dueDate)}</p>`}
        </div>
        <div><label class="block text-xs font-medium text-gray-400 mb-1.5">Description</label>
          ${can('edit')?`<textarea id="f-desc" rows="4" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490] resize-none">${esc(i.description||'')}</textarea>`:
          `<p class="text-sm text-gray-700 leading-relaxed">${esc(i.description||'—')}</p>`}
        </div>
        <div><label class="block text-xs font-medium text-gray-400 mb-1.5">Next Action</label>
          ${can('edit')?`<textarea id="f-next" rows="2" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490] resize-none">${esc(i.nextAction||'')}</textarea>`:
          `<p class="text-sm text-gray-700">${esc(i.nextAction||'—')}</p>`}
        </div>
        ${can('edit')?`<button data-act="save-integ" data-cid="${c.id}" data-iid="${i.id}" class="w-full btn-grad text-white font-semibold rounded-xl py-2.5 text-sm transition">Save Changes</button>`:''}
        ${can('edit')&&i.status!=='Completed'?`<button data-act="mark-complete" data-cid="${c.id}" data-iid="${i.id}" class="w-full text-green-700 bg-green-50 hover:bg-green-100 font-medium rounded-xl py-2 text-xs transition">✓ Mark as Complete</button>`:''}
        ${can('admin')?`<button data-act="delete-integ" data-cid="${c.id}" data-iid="${i.id}" class="w-full text-rose-400 hover:text-rose-600 text-xs py-1 transition">Delete Integration</button>`:''}
      </div>
    </div>
    <div class="bg-white rounded-2xl border border-gray-100 p-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-semibold text-gray-900 text-sm">Timeline <span class="text-gray-400 font-normal">(${i.timeline?.length||0})</span></h3>
      </div>
      ${can('edit')?`<div class="mb-4">
        <textarea id="tl-input" rows="3" placeholder="What happened? Current status?" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490] resize-none mb-2"></textarea>
        <button data-act="add-timeline" data-cid="${c.id}" data-iid="${i.id}" class="w-full text-sm font-medium bg-gray-50 hover:bg-[#0e7490]/10 hover:text-[#0e7490] text-gray-700 border border-gray-200 rounded-xl py-2 transition">+ Add Update</button>
      </div>`:''}
      <div class="space-y-3 max-h-[440px] overflow-y-auto pr-1">
        ${!(i.timeline?.length)?`<div class="text-sm text-gray-400 text-center py-8">${emptyIcon('clock')}No updates yet</div>`:
        i.timeline.map((t,idx,arr)=>{
          const isEditing=S.editingTimelineId===t.id;
          const hasHistory=t.edits&&t.edits.length>0;
          const isExpanded=S.expandedHistory.has(t.id);
          if(isEditing){
            return`<div class="relative pl-5 ${idx<arr.length-1?'pb-3 border-l-2 border-gray-100':''}">
              <div class="absolute -left-[5px] top-1 w-2.5 h-2.5 bg-[#0e7490] rounded-full border-2 border-white ring-1 ring-[#0e7490]/30"></div>
              <div class="text-xs font-semibold text-[#0e7490] mb-1">${esc(t.date)} · ${esc(t.addedBy||'')}</div>
              <textarea id="edit-tl-${t.id}" rows="3" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490] resize-none">${esc(t.update)}</textarea>
              <div class="flex gap-2 mt-2">
                <button data-act="cancel-edit-timeline" class="flex-1 text-xs font-medium text-gray-500 border border-gray-200 rounded-lg py-1.5 hover:bg-gray-50 transition">Cancel</button>
                <button data-act="save-edit-timeline" data-cid="${c.id}" data-iid="${i.id}" data-tid="${t.id}" class="flex-1 text-xs font-semibold text-white bg-[#0e7490] rounded-lg py-1.5 hover:bg-[#0d3d4f] transition">Save Edit</button>
              </div>
            </div>`;
          }
          return`<div class="relative pl-5 ${idx<arr.length-1?'pb-3 border-l-2 border-gray-100':''}">
          <div class="absolute -left-[5px] top-1 w-2.5 h-2.5 bg-[#0e7490] rounded-full border-2 border-white ring-1 ring-[#0e7490]/30"></div>
          <div class="flex items-start justify-between gap-2">
            <div class="text-xs font-semibold text-[#0e7490] mb-1">${esc(t.date)} · ${esc(t.addedBy||'')}</div>
            <div class="flex items-center gap-2 shrink-0">
              ${can('edit')?`<button data-act="edit-timeline" data-tid="${t.id}" class="text-[10px] text-gray-300 hover:text-[#0e7490]">Edit</button>`:''}
              ${can('admin')?`<button data-act="delete-timeline-entry" data-cid="${c.id}" data-iid="${i.id}" data-tid="${t.id}" class="text-[10px] text-gray-300 hover:text-rose-500">Delete</button>`:''}
              <button data-act="copy-update" data-text="${esc(t.update)}" class="text-[10px] text-gray-300 hover:text-[#0e7490]">Copy</button>
            </div>
          </div>
          <p class="text-sm text-gray-700 leading-relaxed">${esc(t.update)}</p>
          <div class="flex items-center gap-3 mt-1 flex-wrap">
            ${t.addedAt?`<span class="text-xs text-gray-400">${fmtDate(t.addedAt)}</span>`:''}
            ${hasHistory?`<button data-act="toggle-history" data-tid="${t.id}" class="text-xs text-amber-600 hover:text-amber-700 font-medium">✎ edited${t.edits.length>1?` (${t.edits.length}×)`:''} — ${isExpanded?'hide':'view'} history</button>`:''}
          </div>
          ${isExpanded&&hasHistory?`<div class="mt-2 pl-3 border-l-2 border-amber-200 space-y-2">
            ${[...t.edits].reverse().map(e=>`<div class="text-xs"><div class="text-gray-400 mb-0.5">${fmtDate(e.editedAt)} · ${esc(e.editedBy||'')} changed it from:</div><div class="text-gray-500">${esc(e.text)}</div></div>`).join('')}
          </div>`:''}
        </div>`;
        }).join('')}
      </div>
    </div>
  </div>
  <div class="mt-6 bg-white rounded-2xl border border-gray-100 p-6">
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-semibold text-gray-900 text-sm">Milestones</h3>
      ${can('edit')?`<button data-act="add-milestone-btn" data-cid="${c.id}" data-iid="${i.id}" class="text-xs text-[#0e7490] font-semibold border border-[#0e7490]/30 bg-[#0e7490]/5 px-3 py-1.5 rounded-xl hover:bg-[#0e7490]/10 transition">+ Add Milestone</button>`:''}
    </div>
    ${(i.milestones||[]).length?`<div class="space-y-2">
      ${(i.milestones||[]).map(ms=>{
        const msColor=ms.status==='Achieved'?'green':ms.status==='Missed'?'rose':'amber';
        return`<div class="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:border-gray-200 transition">
          <div class="w-2 h-2 rounded-full bg-${msColor}-500 shrink-0"></div>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium text-gray-900">${esc(ms.name)}</div>
            <div class="text-xs text-gray-400 mt-0.5">${ms.owner?`Owner: ${esc(ms.owner)} · `:''}${ms.dueDate?`Due: ${fmtDate(ms.dueDate)}`:'No due date'}${ms.notes?` · ${esc(ms.notes)}`:''}</div>
          </div>
          <span class="text-xs font-semibold bg-${msColor}-50 text-${msColor}-700 border border-${msColor}-200 px-2 py-0.5 rounded-full shrink-0">${ms.status}</span>
          ${can('edit')?`<div class="flex gap-2 shrink-0">
            <button data-act="edit-milestone-btn" data-cid="${c.id}" data-iid="${i.id}" data-mid="${ms.id}" class="text-xs text-gray-300 hover:text-[#0e7490]">Edit</button>
            ${can('admin')?`<button data-act="delete-milestone" data-cid="${c.id}" data-iid="${i.id}" data-mid="${ms.id}" class="text-xs text-gray-300 hover:text-rose-500">Delete</button>`:''}
          </div>`:''}
        </div>`;
      }).join('')}
    </div>`:`<div class="text-center py-8 text-gray-400 text-sm">No milestones yet. Add key checkpoints for this integration.</div>`}
  </div>
</div>`;
}

// ─── ADMIN ────────────────────────────────────────────────────────
function renderAdmin(){
  return`<div class="k-page fade">
  <h1 class="text-xl font-bold text-gray-900 mb-5">Admin</h1>
  <div class="flex border-b border-gray-200 mb-6 gap-1 overflow-x-auto">
    ${[['integrations','Clients & Integrations'],['implementations','Implementation Clients'],['ams','AMS Clients'],['users','Users']].map(([t,l])=>`<button data-act="admin-tab" data-tab="${t}" class="whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 transition ${S.adminTab===t?'border-[#0e7490] text-[#0e7490]':'border-transparent text-gray-500 hover:text-gray-800'}">${l}</button>`).join('')}
  </div>
  ${S.adminTab==='integrations'?renderAdminClients():S.adminTab==='implementations'?renderAdminImpl():S.adminTab==='ams'?renderAdminAms():renderAdminUsers()}
</div>`;
}

function renderAdminImpl(){
  const implClients=S.clients.filter(c=>c.modules!==undefined);
  return`<div>
  <div class="flex justify-end mb-4"><button data-act="modal-open" data-modal="add-impl-client" class="btn-grad text-white text-sm font-semibold px-4 py-2 rounded-xl transition">+ Add Client</button></div>
  <div class="bg-white rounded-2xl border border-gray-100 overflow-hidden">
    <table class="w-full text-sm">
      <thead class="border-b border-gray-100 bg-gray-50 sticky-head"><tr>
        ${['Client','Modules','At Risk Phases','Actions'].map(h=>`<th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">${h}</th>`).join('')}
      </tr></thead>
      <tbody class="divide-y divide-gray-50">
        ${implClients.length?implClients.map(c=>{
          const pr=implProgress(c);
          return`<tr class="hover:bg-gray-50/50 transition">
          <td class="px-4 py-3"><div class="font-medium text-gray-900" title="${esc(c.name)}">${esc(c.name)}</div>${c.description?`<div class="text-xs text-gray-400 truncate max-w-[180px]" title="${esc(c.description)}">${esc(c.description)}</div>`:''}</td>
          <td class="px-4 py-3 font-semibold text-gray-700">${(c.modules||[]).length}</td>
          <td class="px-4 py-3">${pr.atRisk>0?`<span class="text-rose-600 font-semibold">${pr.atRisk}</span>`:`<span class="text-gray-400">0</span>`}</td>
          <td class="px-4 py-3"><div class="flex gap-2">
            <button data-act="modal-open" data-modal="add-impl-module" data-cid="${c.id}" class="text-xs text-[#0e7490] hover:text-[#0d3d4f] font-medium">+ Module</button>
            <button data-act="delete-impl-client" data-id="${c.id}" class="text-xs text-rose-400 hover:text-rose-600 font-medium">Remove from Implementations</button>
          </div></td>
        </tr>`;}).join(''):`<tr><td colspan="4" class="text-center py-8 text-gray-400 text-sm">No implementation clients yet</td></tr>`}
      </tbody>
    </table>
  </div>
</div>`;
}

function renderAdminAms(){
  const amsClients=S.clients.filter(c=>c.workLog!==undefined);
  return`<div>
  <div class="flex justify-end mb-4"><button data-act="modal-open" data-modal="add-ams-client" class="btn-grad text-white text-sm font-semibold px-4 py-2 rounded-xl transition">+ Add Client</button></div>
  <div class="bg-white rounded-2xl border border-gray-100 overflow-hidden">
    <table class="w-full text-sm">
      <thead class="border-b border-gray-100 bg-gray-50 sticky-head"><tr>
        ${['Client','Day Rate','Total Hours Logged','Actions'].map(h=>`<th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">${h}</th>`).join('')}
      </tr></thead>
      <tbody class="divide-y divide-gray-50">
        ${amsClients.length?amsClients.map(c=>{
          const t=amsTotals(c,'','');
          return`<tr class="hover:bg-gray-50/50 transition">
          <td class="px-4 py-3"><div class="font-medium text-gray-900" title="${esc(c.name)}">${esc(c.name)}</div>${c.description?`<div class="text-xs text-gray-400 truncate max-w-[180px]" title="${esc(c.description)}">${esc(c.description)}</div>`:''}</td>
          <td class="px-4 py-3 font-semibold text-gray-700">${c.manDayRate?`₹${c.manDayRate.toLocaleString('en-IN')}`:'Retainer (no rate)'}</td>
          <td class="px-4 py-3 text-gray-600">${t.totalHours.toFixed(1)}</td>
          <td class="px-4 py-3"><button data-act="delete-ams-client" data-id="${c.id}" class="text-xs text-rose-400 hover:text-rose-600 font-medium">Remove from AMS</button></td>
        </tr>`;}).join(''):`<tr><td colspan="4" class="text-center py-8 text-gray-400 text-sm">No AMS clients yet</td></tr>`}
      </tbody>
    </table>
  </div>
</div>`;
}

function renderAdminClients(){
  return`<div>
  <div class="flex justify-end mb-4"><button data-act="modal-open" data-modal="add-client" class="btn-grad text-white text-sm font-semibold px-4 py-2 rounded-xl transition">+ Add Client</button></div>
  <div class="bg-white rounded-2xl border border-gray-100 overflow-hidden">
    <table class="w-full text-sm">
      <thead class="border-b border-gray-100 bg-gray-50 sticky-head"><tr>
        ${['Client','Integrations','At Risk','Completed','Actions'].map(h=>`<th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">${h}</th>`).join('')}
      </tr></thead>
      <tbody class="divide-y divide-gray-50">
        ${S.clients.map(c=>`<tr class="hover:bg-gray-50/50 transition">
          <td class="px-4 py-3"><div class="font-medium text-gray-900" title="${esc(c.name)}">${esc(c.name)}</div>${c.description?`<div class="text-xs text-gray-400 truncate max-w-[180px]" title="${esc(c.description)}">${esc(c.description)}</div>`:''}</td>
          <td class="px-4 py-3 font-semibold text-gray-700">${c.integrations.length}</td>
          <td class="px-4 py-3">${c.integrations.filter(i=>i.status==='At Risk').length>0?`<span class="text-rose-600 font-semibold">${c.integrations.filter(i=>i.status==='At Risk').length}</span>`:`<span class="text-gray-400">0</span>`}</td>
          <td class="px-4 py-3">${c.integrations.filter(i=>i.status==='Completed').length>0?`<span class="text-green-600 font-semibold">${c.integrations.filter(i=>i.status==='Completed').length}</span>`:`<span class="text-gray-400">0</span>`}</td>
          <td class="px-4 py-3"><div class="flex gap-2">
            <button data-act="modal-open" data-modal="add-integ" data-cid="${c.id}" class="text-xs text-[#0e7490] hover:text-[#0d3d4f] font-medium">+ Integ</button>
            <button data-act="delete-client" data-id="${c.id}" class="text-xs text-rose-400 hover:text-rose-600 font-medium">Remove from Integrations</button>
          </div></td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>
</div>`;
}


function renderAdminUsers(){
  return`<div>
  <div class="flex justify-end gap-2 mb-4">
    <button data-act="send-welcome-all" class="bg-green-50 border border-green-200 text-green-700 text-sm font-semibold px-4 py-2 rounded-xl hover:bg-green-100 transition">✉ Send Welcome to All</button>
    <button data-act="modal-open" data-modal="bulk-import-users" class="bg-amber-50 border border-amber-200 text-amber-700 text-sm font-semibold px-4 py-2 rounded-xl hover:bg-amber-100 transition">⬆ Import Users (CSV)</button>
    <button data-act="modal-open" data-modal="add-user" class="btn-grad text-white text-sm font-semibold px-4 py-2 rounded-xl transition">+ Add User</button>
  </div>
  <div class="bg-white rounded-2xl border border-gray-100 overflow-hidden">
    <table class="w-full text-sm">
      <thead class="border-b border-gray-100 bg-gray-50 sticky-head"><tr>
        ${['Username','Full Name','Email','Role','Actions'].map(h=>`<th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">${h}</th>`).join('')}
      </tr></thead>
      <tbody class="divide-y divide-gray-50">
        ${S.users.length?S.users.map(u=>`<tr class="hover:bg-gray-50/50 transition">
          <td class="px-4 py-3 font-mono text-xs text-gray-700">${esc(u.username)}</td>
          <td class="px-4 py-3 font-medium text-gray-900">${esc(u.name)}</td>
          <td class="px-4 py-3 text-xs text-gray-500">${esc(u.email||'—')}</td>
          <td class="px-4 py-3">${can('admin')&&u.id!==S.user?.id
            ?`<select data-act="change-role" data-uid="${u.id}" class="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[#0e7490]">${ROLES.map(r=>`<option${r===u.role?' selected':''}>${r}</option>`).join('')}</select>`
            :`<span class="text-xs px-2 py-0.5 rounded-full font-medium ${u.role==='admin'?'bg-violet-100 text-violet-700':u.role==='editor'?'bg-cyan-100 text-cyan-800':'bg-gray-100 text-gray-600'}">${u.role}</span>`}
          </td>
          <td class="px-4 py-3">${u.id!==S.user?.id
            ?`<div class="flex gap-3">
                <button data-act="edit-user" data-uid="${u.id}" class="text-xs text-[#0e7490] hover:text-[#0d3d4f] font-medium">Edit</button>
                <button data-act="send-welcome-one" data-uid="${u.id}" class="text-xs text-green-600 hover:text-green-800 font-medium">✉ Welcome</button>
                <button data-act="delete-user" data-uid="${u.id}" class="text-xs text-rose-400 hover:text-rose-600 font-medium">Delete</button>
              </div>`
            :`<span class="text-xs text-gray-300">current user</span>`}</td>
        </tr>`).join(''):`<tr><td colspan="5" class="text-center py-8 text-gray-400 text-sm">No users yet</td></tr>`}
      </tbody>
    </table>
  </div>
</div>`;
}

// ─── MODAL ────────────────────────────────────────────────────────
function renderModal(){
  const m=S.modal;if(!m)return'';
  let title='',body='',btnLabel='Create',btnCls='btn-grad';
  if(m.type==='add-client'){
    title='Add Client';
    body=`<div class="space-y-3">
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Client Name *</label><input id="m1" type="text" placeholder="e.g. HDFC Bank" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Description</label><textarea id="m2" rows="2" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490] resize-none"></textarea></div>
    </div>`;
  } else if(m.type==='add-integ'){
    const cid=m.cid||'';title='Add Integration';
    body=`<div class="space-y-3">
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Client</label>
        <select id="m0" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]">${S.clients.map(c=>`<option value="${c.id}"${c.id===cid?' selected':''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Integration Name *</label><input id="m1" type="text" placeholder="e.g. Darwinbox → SAP SF" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="block text-xs font-medium text-gray-500 mb-1">Status</label>
          <select id="m2" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]">${STATUSES.map(s=>`<option>${s}</option>`).join('')}</select></div>
        <div><label class="block text-xs font-medium text-gray-500 mb-1">Assignee</label>${assigneeSelect('m3')}</div>
      </div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Due Date</label><input id="m4" type="date" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Description</label><textarea id="m5" rows="2" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490] resize-none"></textarea></div>
    </div>`;
  } else if(m.type==='add-user'){
    title='Add User';
    body=`<div class="space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <div><label class="block text-xs font-medium text-gray-500 mb-1">Username *</label><input id="m1" type="text" placeholder="john.doe" autocomplete="off" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
        <div><label class="block text-xs font-medium text-gray-500 mb-1">Full Name *</label><input id="m2" type="text" placeholder="John Doe" autocomplete="off" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      </div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Email</label><input id="m5" type="email" placeholder="john@kognoz.in" autocomplete="off" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Password *</label><input id="m3" type="password" placeholder="••••••••" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Role</label>
        <select id="m4" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]">${ROLES.map(r=>`<option>${r}</option>`).join('')}</select></div>
    </div>`;
  } else if(m.type==='my-profile'){
    title='My Profile';btnLabel='Save Changes';
    body=`<div class="space-y-4">
      <div class="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
        <div class="w-10 h-10 rounded-full bg-[#0e7490] text-white flex items-center justify-center text-sm font-bold shrink-0">${esc((S.user?.name||'?')[0])}</div>
        <div><div class="font-semibold text-gray-900">${esc(S.user?.name)}</div><div class="text-xs text-gray-400 capitalize">${esc(S.user?.role)}</div></div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="block text-xs font-medium text-gray-500 mb-1">Username</label><div class="px-3 py-2 bg-gray-50 rounded-xl text-sm text-gray-500 font-mono">${esc(S.user?.username)}</div></div>
        <div><label class="block text-xs font-medium text-gray-500 mb-1">Email</label><input id="pr-email" type="email" value="${esc(S.user?.email||'')}" autocomplete="off" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      </div>
      <div class="border-t border-gray-100 pt-3">
        <div class="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wide">Change Password <span class="font-normal normal-case text-gray-400">— leave blank to keep current</span></div>
        <div class="space-y-2.5">
          <div><label class="block text-xs font-medium text-gray-500 mb-1">Current Password *</label><input id="pr-curr" type="password" placeholder="Required to save any changes" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="block text-xs font-medium text-gray-500 mb-1">New Password</label><input id="pr-new" type="password" placeholder="Leave blank to keep current" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">Confirm New Password</label><input id="pr-conf" type="password" placeholder="Repeat new password" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
          </div>
        </div>
      </div>
    </div>`;
  } else if(m.type==='send-welcome'){
    title='Send Welcome Email';
    const emailUsers=(m.targets||[]).filter(u=>u.email);
    btnLabel=`Send to ${emailUsers.length} User${emailUsers.length===1?'':'s'}`;
    body=`<div class="space-y-3">
      <div class="bg-[#0e7490]/8 border border-[#0e7490]/20 rounded-xl p-3 text-xs text-[#0d3d4f] leading-relaxed">Sends a branded welcome email to each recipient with the app URL, their username, and the password you set below. Their password is also updated to match so login works immediately.</div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Recipients (${(m.targets||[]).length} selected)</label>
        <div class="bg-gray-50 rounded-xl px-3 py-2 text-xs text-gray-600 max-h-28 overflow-y-auto space-y-0.5">
          ${(m.targets||[]).map(u=>`<div class="${u.email?'':'text-amber-600'}">${esc(u.name)} <span class="text-gray-400">(${esc(u.username)})</span> ${u.email?`<span class="text-gray-400">${esc(u.email)}</span>`:'<span class="text-amber-500 font-medium">— no email set, will skip</span>'}</div>`).join('')}
        </div>
      </div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Application URL *</label><input id="sw-url" type="url" value="${esc(window?.location?.origin||'https://your-app.vercel.app')}" placeholder="https://your-app.vercel.app" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Password to send & set *</label><input id="sw-pass" type="text" placeholder="e.g. Kognoz@123" autocomplete="off" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/>
      <p class="text-xs text-gray-400 mt-1">This becomes their login password immediately. Tell them to change it after first login via My Profile.</p></div>
    </div>`;
  } else if(m.type==='edit-user'){
    title='Edit User';btnLabel='Save Changes';
    body=`<div class="space-y-3">
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Username</label><div class="px-3 py-2 bg-gray-50 rounded-xl text-sm text-gray-500 font-mono">${esc(m.username||'')}</div></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Full Name *</label><input id="eu-name" type="text" value="${esc(m.uname||'')}" autocomplete="off" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Email</label><input id="eu-email" type="email" value="${esc(m.email||'')}" autocomplete="off" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">New Password <span class="text-gray-400 font-normal">leave blank to keep current</span></label><input id="eu-pass" type="password" placeholder="••••••••" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
    </div>`;
  } else if(m.type==='bulk-import-users'){
    title='Import Users from CSV';
    const rows=m.csvRows||[];
    const valid=rows.filter(r=>!r.error);
    const errors=rows.filter(r=>r.error);
    btnLabel=rows.length?`Import ${valid.length} User${valid.length!==1?'s':''}`:'Preview';
    body=`<div class="space-y-3">
      <div class="flex items-center justify-between">
        <p class="text-xs text-gray-500">Paste CSV or use the template. One user per row.</p>
        <button data-act="download-user-template" class="text-xs text-[#0e7490] font-semibold hover:underline">⬇ Download Template</button>
      </div>
      <textarea id="bulk-csv" rows="8" placeholder="username,full_name,role,email,password&#10;yashwanth.k,Yashwanth K,admin,yashwanth@kognoz.in,Kognoz@123&#10;priya.s,Priya S,editor,priya@kognoz.in,Kognoz@123" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#0e7490] resize-none">${esc(m.csvText||'')}</textarea>
      <button data-act="preview-users-csv" class="w-full text-sm font-medium bg-gray-50 hover:bg-[#0e7490]/10 hover:text-[#0e7490] text-gray-700 border border-gray-200 rounded-xl py-2 transition">Preview Rows</button>
      ${rows.length?`<div class="text-xs font-semibold text-gray-700 mt-1">${rows.length} rows parsed · <span class="text-green-600">${valid.length} valid</span>${errors.length?` · <span class="text-rose-600">${errors.length} errors</span>`:''}
      </div>
      <div class="max-h-48 overflow-y-auto space-y-1">
        ${rows.map(r=>`<div class="flex items-start gap-2 text-xs px-2 py-1.5 rounded-lg ${r.error?'bg-rose-50':'bg-green-50'}">
          <span class="${r.error?'text-rose-500':'text-green-600'} shrink-0">${r.error?'✕':'✓'}</span>
          <div class="min-w-0 flex-1"><span class="font-medium">${esc(r.name)}</span> <span class="text-gray-400">(${esc(r.username)}, ${esc(r.role)})</span>${r.error?`<div class="text-rose-500">${esc(r.error)}</div>`:''}</div>
        </div>`).join('')}
      </div>`:''}
    </div>`;
  } else if(m.type==='add-impl-client'){
    title='Add Client to Implementations';
    body=`<div class="space-y-3">
      ${clientPickerHtml(c=>c.modules!==undefined)}
      <p class="text-xs text-gray-400 text-center">— or create a new client —</p>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">New Client Name</label><input id="m1" type="text" placeholder="e.g. HDFC Bank" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Description</label><textarea id="m2" rows="2" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490] resize-none"></textarea></div>
    </div>`;
  } else if(m.type==='add-impl-module'){
    title='Add Module';
    body=`<div class="space-y-3">
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Module Name *</label><input id="m1" type="text" placeholder="e.g. Core HR, Payroll, Leave & Attendance" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <p class="text-xs text-gray-400">All ${PHASES.length} phases (BPU through Hypercare) will start as "Not Started" for this module.</p>
    </div>`;
  } else if(m.type==='add-ams-client'){
    title='Add Client to AMS';
    body=`<div class="space-y-3">
      ${clientPickerHtml(c=>c.workLog!==undefined)}
      <p class="text-xs text-gray-400 text-center">— or create a new client —</p>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">New Client Name</label><input id="m1" type="text" placeholder="e.g. HDFC Bank" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Description</label><textarea id="m2" rows="2" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490] resize-none"></textarea></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Man-Day Rate (₹) <span class="text-gray-400 font-normal">optional — leave blank for retainer/hours-only</span></label><input id="m3" type="number" min="0" placeholder="e.g. 15000" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Total Available Hours <span class="text-gray-400 font-normal">optional</span></label><input id="m4" type="number" min="0" step="0.5" autocomplete="off" placeholder="Leave blank if not applicable" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/>
      <p class="text-xs text-gray-400 mt-1">If set, hours are deducted from this pool first — only overages get billed.</p></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Billing Currency</label>
        <select id="m5" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]">
          <option value="INR">INR (₹ Indian Rupee)</option>
          <option value="USD">USD ($ US Dollar)</option>
        </select>
      </div>
    </div>`;
  } else if(m.type==='edit-ams-client'){
    title='Edit AMS Client';
    body=`<div class="space-y-3">
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Description</label><textarea id="m1" rows="2" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490] resize-none">${esc(m.description||'')}</textarea></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Man-Day Rate (₹) <span class="text-gray-400 font-normal">optional</span></label><input id="m2" type="number" min="0" value="${m.manDayRate||''}" placeholder="Leave blank for retainer/hours-only" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Total Available Hours <span class="text-gray-400 font-normal">optional</span></label><input id="m3" type="number" min="0" step="0.5" value="${m.totalAvailableHours??''}" placeholder="Leave blank if not applicable" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Billing Currency</label>
        <select id="m4" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]">
          <option value="INR"${(m.currency||'INR')==='INR'?' selected':''}>INR (₹ Indian Rupee)</option>
          <option value="USD"${m.currency==='USD'?' selected':''}>USD ($ US Dollar)</option>
        </select>
      </div>
    </div>`;
    btnLabel='Save';
  } else if(m.type==='add-ams-entry'||m.type==='edit-ams-entry'){
    const isEdit=m.type==='edit-ams-entry';
    title=isEdit?'Edit Entry':'Add AMS Entry';btnLabel=isEdit?'Save Changes':'Add Entry';
    const fg=(id,label,el,hint='')=>`<div><label class="block text-xs font-medium text-gray-500 mb-1">${label}${hint?`<span class="text-gray-400 font-normal ml-1">${hint}</span>`:''}</label>${el}</div>`;
    const inp=(id,type,val='',ph='',extra='')=>`<input id="${id}" type="${type}" value="${esc(val)}" placeholder="${ph}" ${extra} class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/>`;
    const sel=(id,opts,cur='')=>`<select id="${id}" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]">${opts.map(o=>`<option${o===cur?' selected':''}>${o}</option>`).join('')}</select>`;
    const ta=(id,val='',ph='',rows=2)=>`<textarea id="${id}" rows="${rows}" placeholder="${ph}" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490] resize-none">${esc(val)}</textarea>`;
    const ragSel=`<select id="ae-rag" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]">
      <option value=""${!m.ragStatus?' selected':''}>— Not Set —</option>
      <option value="Green"${m.ragStatus==='Green'?' selected':''}>🟢 Green — On Track</option>
      <option value="Amber"${m.ragStatus==='Amber'?' selected':''}>🟡 Amber — At Risk</option>
      <option value="Red"${m.ragStatus==='Red'?' selected':''}>🔴 Red — Blocked</option>
    </select>`;
    body=`<div class="grid grid-cols-2 gap-3">
      ${fg('ae-date','Date Raised',inp('ae-date','date',m.dateRaised||todayStr()))}
      ${fg('ae-due','Due Date',inp('ae-due','date',m.dueDate||''),'optional')}
      ${fg('ae-raised','Raised / Attended By',assigneeSelect('ae-raised',m.raisedBy||S.user?.name||''))}
      ${fg('ae-module','Module / Meeting',inp('ae-module','text',m.module||'','e.g. Payroll, UAT Meeting'))}
      ${fg('ae-project','Project',inp('ae-project','text',m.project||'','Project name'))}
      ${fg('ae-type','Type',sel('ae-type',AMS_TYPES,m.etype||AMS_TYPES[0]))}
      ${fg('ae-level','Query Level',sel('ae-level',AMS_QUERY_LEVELS,m.queryLevel||AMS_QUERY_LEVELS[0]))}
      ${fg('ae-mode','Mode of Support',sel('ae-mode',AMS_MODES,m.modeOfSupport||AMS_MODES[0]))}
      ${fg('ae-status','Status',sel('ae-status',AMS_ENTRY_STATUSES,m.entryStatus||'Open'))}
      ${fg('ae-rag','Entry RAG Status',ragSel,'optional')}
      ${fg('ae-hours','Hours Consumed',inp('ae-hours','number',m.hours||'','e.g. 1.5','step="0.5" min="0"'))}
      ${fg('ae-deps','Any Dependencies',inp('ae-deps','text',m.dependencies||'','Dependencies or blockers'),'optional')}
    </div>
    <div class="mt-3 space-y-3">
      ${fg('ae-desc','Description',ta('ae-desc',m.description||'','What was the issue, query or activity?',2))}
      ${fg('ae-solution','Solution Discussed',ta('ae-solution',m.solution||'','Summary of resolution or discussion',2),'optional')}
    </div>`;
  } else if(m.type==='import-ams-entries'){
    const rows=m.csvRows||[];const valid=rows.filter(r=>!r.error);const errs=rows.filter(r=>r.error);
    title='Import AMS Entries';btnLabel=rows.length?`Import ${valid.length} ${valid.length===1?'Entry':'Entries'}`:'Preview';
    body=`<div class="space-y-3">
      <div class="flex items-center justify-between">
        <p class="text-xs text-gray-500">Paste CSV content below. First row can be headers.</p>
        <button data-act="download-ams-template" class="text-xs text-[#0e7490] font-semibold hover:underline">⬇ Download Template</button>
      </div>
      <textarea id="bulk-csv" rows="7" placeholder="date_raised,due_date,raised_by,module,project,description,type,query_level,entry_status,mode_of_support,hours&#10;2026-07-15,,Yashwanth K,Payroll,HDFC Bank,Issue with payroll run,Bug Fix,L2 - Medium,Open,Online / Remote,2.5" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#0e7490] resize-none">${esc(m.csvText||'')}</textarea>
      <button data-act="preview-ams-csv" class="w-full text-sm font-medium bg-gray-50 hover:bg-[#0e7490]/10 hover:text-[#0e7490] text-gray-700 border border-gray-200 rounded-xl py-2 transition">Preview Rows</button>
      ${rows.length?`<div class="text-xs font-semibold text-gray-700">${rows.length} rows · <span class="text-green-600">${valid.length} valid</span>${errs.length?` · <span class="text-rose-600">${errs.length} errors</span>`:''}</div>
      <div class="max-h-40 overflow-y-auto space-y-1">${rows.map(r=>`<div class="text-xs px-2 py-1 rounded-lg ${r.error?'bg-rose-50':'bg-green-50'} flex gap-2"><span class="${r.error?'text-rose-500':'text-green-600'}">${r.error?'✕':'✓'}</span><span>${esc(r.description||r.dateRaised)}${r.error?` — ${esc(r.error)}`:''}</span></div>`).join('')}</div>`:''}
    </div>`;
  } else if(m.type==='import-integrations'){
    const rows=m.csvRows||[];const valid=rows.filter(r=>!r.error);const errs=rows.filter(r=>r.error);
    title='Import Integrations';btnLabel=rows.length?`Import ${valid.length} ${valid.length===1?'Integration':'Integrations'}`:'Preview';
    body=`<div class="space-y-3">
      <div class="flex items-center justify-between">
        <p class="text-xs text-gray-500">Paste CSV content below.</p>
        <button data-act="download-integ-template" class="text-xs text-[#0e7490] font-semibold hover:underline">⬇ Download Template</button>
      </div>
      <textarea id="bulk-csv" rows="6" placeholder="name,status,assignee,due_date,description,next_action&#10;SAP Payroll Sync,In Progress,Yashwanth K,2026-08-15,SAP to Darwinbox payroll integration,Finish API mapping" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#0e7490] resize-none">${esc(m.csvText||'')}</textarea>
      <button data-act="preview-integ-csv" class="w-full text-sm font-medium bg-gray-50 hover:bg-[#0e7490]/10 hover:text-[#0e7490] text-gray-700 border border-gray-200 rounded-xl py-2 transition">Preview Rows</button>
      ${rows.length?`<div class="text-xs font-semibold text-gray-700">${rows.length} rows · <span class="text-green-600">${valid.length} valid</span>${errs.length?` · <span class="text-rose-600">${errs.length} errors</span>`:''}</div>
      <div class="max-h-40 overflow-y-auto space-y-1">${rows.map(r=>`<div class="text-xs px-2 py-1 rounded-lg ${r.error?'bg-rose-50':'bg-green-50'} flex gap-2"><span class="${r.error?'text-rose-500':'text-green-600'}">${r.error?'✕':'✓'}</span><span>${esc(r.name)}${r.error?` — ${esc(r.error)}`:` · ${esc(r.status)}`}</span></div>`).join('')}</div>`:''}
    </div>`;
  } else if(m.type==='add-milestone'||m.type==='edit-milestone'){
    const isEdit=m.type==='edit-milestone';
    title=isEdit?'Edit Milestone':'Add Milestone';btnLabel=isEdit?'Save Changes':'Add Milestone';
    body=`<div class="space-y-3">
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Milestone Name *</label><input id="ms-name" type="text" value="${esc(m.msName||'')}" placeholder="e.g. API spec agreed, Signoff received" autocomplete="off" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="block text-xs font-medium text-gray-500 mb-1">Due Date</label><input id="ms-due" type="date" value="${esc(m.msDue||'')}" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
        <div><label class="block text-xs font-medium text-gray-500 mb-1">Status</label>
          <select id="ms-status" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]">
            ${MILESTONE_STATUSES.map(s=>`<option${s===(m.msStatus||'Pending')?' selected':''}>${s}</option>`).join('')}
          </select>
        </div>
      </div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Owner</label>${assigneeSelect('ms-owner',m.msOwner||'')}</div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Notes</label><input id="ms-notes" type="text" value="${esc(m.msNotes||'')}" placeholder="Any context or dependencies" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
    </div>`;
  } else if(m.type==='portfolio-export'){
    title='Portfolio Export';btnLabel='Generate PDF';
    const implC=S.clients.filter(c=>c.modules!==undefined);
    const integC=S.clients.filter(c=>(c.integrations||[]).length>0);
    const amsC=S.clients.filter(c=>c.workLog!==undefined);
    const allC=[...new Set([...implC,...integC,...amsC])];
    body=`<div class="space-y-4">
      <div>
        <div class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Select Clients</div>
        <div class="max-h-48 overflow-y-auto space-y-1.5">
          ${allC.map(c=>`<label class="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 cursor-pointer">
            <input type="checkbox" data-act="portfolio-client-toggle" data-cid="${c.id}" class="rounded" checked/>
            <span class="text-sm text-gray-800">${esc(c.name)}</span>
            <span class="text-xs text-gray-400 ml-auto">${[c.modules&&'Impl',((c.integrations||[]).length>0)&&'Integ',c.workLog&&'AMS'].filter(Boolean).join(' · ')}</span>
          </label>`).join('')}
        </div>
      </div>
      <div>
        <div class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Include Sections</div>
        <div class="flex gap-3">
          ${[['impl','Implementations'],['integrations','Integrations'],['ams','AMS']].map(([k,l])=>`<label class="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer"><input type="checkbox" data-act="portfolio-section-toggle" data-section="${k}" class="rounded" checked/>${l}</label>`).join('')}
        </div>
      </div>
      <p class="text-xs text-gray-400">Sections are skipped if a client has no data in that section.</p>
    </div>`;
  } else if(m.type==='confirm'){
    title='Confirm';btnLabel='Delete';btnCls='bg-rose-600 hover:bg-rose-700';
    body=`<p class="text-sm text-gray-600">${esc(m.msg||'Are you sure? This cannot be undone.')}</p>`;
  }
  const busy=!!m.busy;
  const busyLabel=m.type==='confirm'?'Deleting…':'Saving…';
  return`<div class="k-modal-overlay fade" id="modal-overlay">
  <div class="k-modal modal-pop" style="max-width:${['add-ams-entry','edit-ams-entry','bulk-import-users','portfolio-export','import-ams-entries','import-integrations'].includes(m.type)?'640px':'440px'};">
    <div class="k-modal-header flex items-center justify-between">
      <h2 class="k-h2">${esc(title)}</h2>
      <button data-act="modal-close" ${busy?'disabled':''} class="k-btn k-btn-ghost k-btn-sm" style="height:28px;width:28px;padding:0;">✕</button>
    </div>
    <div class="k-modal-body">${body}</div>
    <div class="k-modal-footer">
      <button data-act="modal-close" ${busy?'disabled':''} class="k-btn k-btn-secondary">Cancel</button>
      <button data-act="modal-confirm" ${busy?'disabled':''} class="k-btn k-btn-primary" style="min-width:120px;">${busy?spinnerSvg()+busyLabel:btnLabel}</button>
    </div>
  </div>
</div>`;
}
// ─── EXPORT: PPTX (Kognoz branded) ────────────────────────────────

function addLogoToDoc(doc, x, y, maxH){
  // maxH in mm — logo is 315x94px, so w = maxH*(315/94)
  const w=maxH*(315/94);
  try{doc.addImage(KOGNOZ_LOGO,'PNG',x,y-(maxH*0.75),w,maxH);}catch(e){}
}
async function exportPptx(clientId){
  const c=S.clients.find(x=>x.id===clientId);if(!c)return;
  showToast('Generating PPTX…','info');
  try{
    const pptx=new PptxGenJS();pptx.layout='LAYOUT_WIDE';
    const NV=TEAL_DARK,MG=MAGENTA;
    // Cover
    const s1=pptx.addSlide();s1.background={color:NV};
    s1.addText('INTEGRATION STATUS REPORT',{x:.5,y:1.0,w:12.5,h:.4,fontSize:10,color:'7dd3e8',align:'center',charSpacing:4});
    s1.addText(c.name,{x:.5,y:1.6,w:12.5,h:1.2,fontSize:44,color:'FFFFFF',bold:true,align:'center'});
    try{s1.addImage({data:KOGNOZ_LOGO,x:5.15,y:2.9,w:2.8,h:0.84});}catch(e){s1.addText('Kognoz',{x:.5,y:3.0,w:12.5,h:.4,fontSize:14,color:'7dd3e8',align:'center'});}
    s1.addShape(pptx.ShapeType.rect,{x:5.65,y:3.55,w:2,h:.05,fill:{color:MG},line:{type:'none'}});
    s1.addText(new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'}),{x:.5,y:6.7,w:12.5,h:.3,fontSize:10,color:'64748b',align:'center'});
    // Summary
    const s2=pptx.addSlide();s2.background={color:'f5f9fa'};
    s2.addShape(pptx.ShapeType.rect,{x:0,y:0,w:13.3,h:.7,fill:{color:NV},line:{type:'none'}});
    try{s2.addImage({data:KOGNOZ_LOGO,x:.2,y:.05,w:1.2,h:0.36});}catch(e){}
    s2.addText('Integration Summary',{x:1.6,y:.1,w:11,h:.5,fontSize:15,color:'FFFFFF',bold:true});
    s2.addText(c.name,{x:.4,y:.1,w:12.5,h:.5,fontSize:11,color:'7dd3e8',align:'right'});
    const sg={};c.integrations.forEach(i=>sg[i.status]=(sg[i.status]||0)+1);
    [{l:'Total',v:c.integrations.length,col:NV},{l:'In Progress',v:sg['In Progress']||0,col:SHEX['In Progress']},{l:'At Risk',v:sg['At Risk']||0,col:SHEX['At Risk']},{l:'Completed',v:sg['Completed']||0,col:SHEX['Completed']},{l:'On Hold',v:sg['On Hold']||0,col:SHEX['On Hold']}]
    .forEach(({l,v,col},i)=>{const x=.4+i*2.5;s2.addShape(pptx.ShapeType.rect,{x,y:.85,w:2.2,h:.85,fill:{color:col},line:{type:'none'}});s2.addText(String(v),{x,y:.88,w:2.2,h:.48,fontSize:22,color:'FFFFFF',bold:true,align:'center'});s2.addText(l,{x,y:1.36,w:2.2,h:.28,fontSize:7.5,color:'FFFFFF',align:'center'});});
    const rows=[['Integration','Status','Assignee','Due Date'].map(t=>({text:t,options:{bold:true,fill:{color:NV},color:'FFFFFF',fontSize:9}})),
      ...c.integrations.map((i,idx)=>[
        {text:i.name,options:{fontSize:8.5,color:'1f2937',fill:{color:idx%2?'FFFFFF':'f9fafb'}}},
        {text:i.status,options:{fontSize:8.5,bold:true,color:SHEX[i.status]||'64748b',fill:{color:idx%2?'FFFFFF':'f9fafb'}}},
        {text:i.assignee||'—',options:{fontSize:8.5,color:'4b5563',fill:{color:idx%2?'FFFFFF':'f9fafb'}}},
        {text:i.dueDate?fmtDate(i.dueDate):'—',options:{fontSize:8.5,color:'4b5563',fill:{color:idx%2?'FFFFFF':'f9fafb'}}},
      ])];
    s2.addTable(rows,{x:.3,y:1.9,w:12.7,colW:[5.2,2.2,2.8,2.5],border:{type:'solid',color:'e5e7eb',pt:.5}});
    // Integration Details — paginated table (replaces one-slide-per-integration)
    // No truncation: rows are packed per slide based on ESTIMATED rendered height
    // (PptxGenJS has no native auto-pagination with custom branding, so we pack manually,
    // erring conservative so nothing overflows the slide edge).
    const CHARS_PER_LINE=95,LINE_H=0.15;
    const estLines=(text)=>!text?1:text.split('\n').reduce((s,l)=>s+Math.max(1,Math.ceil(l.length/CHARS_PER_LINE)),0);
    const detailRows=c.integrations.map(i=>{
      const latest=i.timeline?.[0];
      const updateText=latest?latest.update:'No updates yet.';
      const updateDate=latest?fmtDate(latest.date):'';
      const nextText=i.nextAction||'';
      const overdueTxt=isOverdue(i)?`⚠ ${daysOverdue(i)}d overdue`:'';
      const blockLines=1+estLines(updateText)+1+1+estLines(nextText||'No next action noted.');
      const estHeight=Math.max(0.6,blockLines*LINE_H+0.12);
      return{name:i.name,assignee:i.assignee||'Unassigned',status:i.status,due:i.dueDate?fmtDate(i.dueDate):'—',overdueTxt,updateText,updateDate,nextText,estHeight};
    });
    const SLIDE_BODY_H=5.7; // conservative usable height per slide, after header bar + table header row
    const chunks=[];let cur=[],curH=0;
    detailRows.forEach(row=>{
      if(cur.length&&curH+row.estHeight>SLIDE_BODY_H){chunks.push(cur);cur=[];curH=0;}
      cur.push(row);curH+=row.estHeight;
    });
    if(cur.length)chunks.push(cur);
    chunks.forEach((chunk,pageIdx)=>{
      const sl=pptx.addSlide();sl.background={color:'FFFFFF'};
      sl.addShape(pptx.ShapeType.rect,{x:0,y:0,w:13.3,h:.7,fill:{color:NV},line:{type:'none'}});
      sl.addText('Integration Details',{x:.4,y:.1,w:8,h:.5,fontSize:15,color:'FFFFFF',bold:true});
      sl.addText(`${c.name}${chunks.length>1?`  ·  Page ${pageIdx+1} of ${chunks.length}`:''}`,{x:.4,y:.1,w:12.5,h:.5,fontSize:10,color:'7dd3e8',align:'right'});
      const headerRow=[
        {text:'',options:{fill:{color:NV}}},
        {text:'Integration',options:{bold:true,fill:{color:NV},color:'FFFFFF',fontSize:9}},
        {text:'Assignee',options:{bold:true,fill:{color:NV},color:'FFFFFF',fontSize:9}},
        {text:'Status',options:{bold:true,fill:{color:NV},color:'FFFFFF',fontSize:9}},
        {text:'Due Date',options:{bold:true,fill:{color:NV},color:'FFFFFF',fontSize:9}},
        {text:'Latest Update & Next Steps',options:{bold:true,fill:{color:NV},color:'FFFFFF',fontSize:9}},
      ];
      const bodyRows=chunk.map((row,ri)=>{
        const bg=ri%2?'FFFFFF':'f5f9fa';
        return[
          {text:'',options:{fill:{color:SHEX[row.status]||'64748b'}}},
          {text:row.name,options:{bold:true,fontSize:9,color:'1f2937',fill:{color:bg},valign:'top'}},
          {text:row.assignee,options:{fontSize:8.5,color:'4b5563',fill:{color:bg},valign:'top'}},
          {text:row.status,options:{bold:true,fontSize:8.5,color:SHEX[row.status]||'64748b',fill:{color:bg},valign:'top'}},
          {text:row.overdueTxt?[{text:row.due+'\n',options:{fontSize:8.5,color:'374151'}},{text:row.overdueTxt,options:{fontSize:7,bold:true,color:'be185d'}}]:row.due,options:{fill:{color:bg},valign:'top',fontSize:8.5,color:'374151'}},
          {text:[
            {text:'Update:'+(row.updateDate?` (${row.updateDate})`:'')+'\n',options:{bold:true,fontSize:8,color:'1f2937'}},
            {text:row.updateText+'\n\n',options:{fontSize:8,color:'4b5563'}},
            {text:'Next:\n',options:{bold:true,fontSize:8,color:'1f2937'}},
            row.nextText?{text:row.nextText,options:{fontSize:8,color:'4b5563'}}:{text:'No next action noted.',options:{fontSize:8,italic:true,color:'9ca3af'}},
          ],options:{fill:{color:bg},valign:'top'}},
        ];
      });
      sl.addTable([headerRow,...bodyRows],{x:.3,y:.9,w:12.7,colW:[0.12,2.0,1.5,1.2,1.5,6.38],border:{type:'solid',color:'e5e7eb',pt:.5}});
    });
    // Thank you
    const sL=pptx.addSlide();sL.background={color:NV};
    sL.addText('Thank You',{x:.5,y:2.3,w:12.5,h:1.1,fontSize:44,color:'FFFFFF',bold:true,align:'center'});
    sL.addShape(pptx.ShapeType.rect,{x:5.9,y:3.3,w:1.5,h:.05,fill:{color:MG},line:{type:'none'}});
    sL.addText('Kognoz · HR Transformation & Consulting',{x:.5,y:3.5,w:12.5,h:.5,fontSize:14,color:'7dd3e8',align:'center'});
    await pptx.writeFile({fileName:`${c.name}_Integration_Report.pptx`});
    showToast('PPTX downloaded ✓');
  }catch(e){console.error(e);showToast('PPTX failed: '+e.message,'error');}
}

// ─── EXPORT: PDF (Kognoz branded) ──────────────────────────────────
function exportPdf(clientId){
  const c=S.clients.find(x=>x.id===clientId);if(!c)return;
  showToast('Generating PDF…','info');
  try{
    const{jsPDF}=window.jspdf;const doc=new jsPDF({orientation:'landscape',format:'a4',unit:'mm'});
    const W=297,H=210,NV=[13,61,79],MG=[181,23,158];
    // Cover
    doc.setFillColor(...NV);doc.rect(0,0,W,H,'F');
    doc.setFont('helvetica','normal');doc.setFontSize(10);doc.setTextColor(125,211,232);doc.text('INTEGRATION STATUS REPORT',W/2,58,{align:'center'});
    doc.setFont('helvetica','bold');doc.setFontSize(34);doc.setTextColor(255,255,255);doc.text(c.name,W/2,80,{align:'center'});
    addLogoToDoc(doc,W/2-30,92,18);doc.setFont('helvetica','normal');doc.setFontSize(11);doc.setTextColor(125,211,232);doc.text('Prepared by Kognoz Consulting',W/2,98,{align:'center'});
    doc.setFillColor(...MG);doc.rect(W/2-12,100,24,1,'F');
    doc.setFontSize(10);doc.setTextColor(100,116,139);doc.text(new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'}),W/2,H-8,{align:'center'});
    // Summary
    doc.addPage();doc.setFillColor(...NV);doc.rect(0,0,W,14,'F');addLogoToDoc(doc,10,13,10);
    doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(255,255,255);doc.text('Integration Summary',58,9.5);doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text(c.name,W-10,9.5,{align:'right'});
    const sg={};c.integrations.forEach(i=>sg[i.status]=(sg[i.status]||0)+1);
    [{l:'Total',v:c.integrations.length,rgb:NV},{l:'In Progress',v:sg['In Progress']||0,rgb:SRGB['In Progress']},{l:'At Risk',v:sg['At Risk']||0,rgb:SRGB['At Risk']},{l:'Completed',v:sg['Completed']||0,rgb:SRGB['Completed']},{l:'On Hold',v:sg['On Hold']||0,rgb:SRGB['On Hold']}]
    .forEach(({l,v,rgb},i)=>{const x=10+i*57;doc.setFillColor(...rgb);doc.roundedRect(x,18,50,20,2,2,'F');doc.setFont('helvetica','bold');doc.setFontSize(18);doc.setTextColor(255,255,255);doc.text(String(v),x+25,30,{align:'center'});doc.setFontSize(7.5);doc.setFont('helvetica','normal');doc.text(l,x+25,37,{align:'center'});});
    doc.autoTable({startY:42,head:[['Integration','Status','Assignee','Due Date']],body:c.integrations.map(i=>[i.name,i.status,i.assignee||'—',i.dueDate?fmtDate(i.dueDate):'—']),headStyles:{fillColor:NV,textColor:[255,255,255],fontStyle:'bold',fontSize:9},styles:{fontSize:8.5,cellPadding:3},alternateRowStyles:{fillColor:[245,249,250]},columnStyles:{0:{cellWidth:105},1:{cellWidth:40},2:{cellWidth:60},3:{cellWidth:50}},didParseCell:d=>{if(d.column.index===1&&d.section==='body'){const rgb=SRGB[d.cell.raw];if(rgb){d.cell.styles.textColor=rgb;d.cell.styles.fontStyle='bold';}}},margin:{left:10,right:10}});
    // Integration Details — single autoTable call, natively paginates across as many pages as needed
    doc.addPage();
    const detailRows=c.integrations.map(i=>{
      const latest=i.timeline?.[0];
      const updateText=latest?latest.update:'No updates yet.';
      const updateDate=latest?fmtDate(latest.date):'';
      const nextText=i.nextAction||'';
      const overdue=isOverdue(i);
      const dueCell=i.dueDate?fmtDate(i.dueDate):'—';
      // Sizing string: autoTable wraps this to compute row height. Line count here must
      // match what didDrawCell below actually draws, so nothing gets cut off.
      const sizingStr=`Update:${updateDate?` (${updateDate})`:''}\n${updateText}\n\nNext:\n${nextText||'No next action noted.'}`;
      return{
        status:i.status,overdue,updateText,updateDate,nextText,
        row:['',i.name,i.assignee||'Unassigned',i.status,overdue?`${dueCell}\n${daysOverdue(i)}d OVERDUE`:dueCell,sizingStr],
      };
    });
    doc.autoTable({
      startY:16,
      margin:{top:16,left:10,right:10,bottom:10},
      head:[['','Integration','Assignee','Status','Due Date','Latest Update & Next Steps']],
      body:detailRows.map(d=>d.row),
      headStyles:{fillColor:NV,textColor:[255,255,255],fontStyle:'bold',fontSize:9},
      styles:{fontSize:8,cellPadding:3,valign:'top'},
      alternateRowStyles:{fillColor:[245,249,250]},
      columnStyles:{0:{cellWidth:3},1:{cellWidth:50},2:{cellWidth:35},3:{cellWidth:28},4:{cellWidth:32},5:{cellWidth:'auto'}},
      didParseCell:d=>{
        if(d.section!=='body')return;
        const meta=detailRows[d.row.index];if(!meta)return;
        if(d.column.index===0){d.cell.styles.fillColor=SRGB[meta.status]||[100,116,139];d.cell.text=[''];}
        if(d.column.index===3){const rgb=SRGB[meta.status];if(rgb){d.cell.styles.textColor=rgb;d.cell.styles.fontStyle='bold';}}
        if(d.column.index===4&&meta.overdue){d.cell.styles.textColor=[190,24,93];d.cell.styles.fontStyle='bold';}
      },
      didDrawCell:d=>{
        // Custom render for the Update/Next column: bold labels, bold date, blank line gap.
        // We let autoTable draw+size the cell normally (so pagination/height stays exact),
        // then cover that plain text here and redraw it styled, using the same line count.
        if(d.section!=='body'||d.column.index!==5)return;
        const meta=detailRows[d.row.index];if(!meta)return;
        const bg=d.row.index%2?[255,255,255]:[245,249,250];
        doc.setFillColor(...bg);doc.rect(d.cell.x,d.cell.y,d.cell.width,d.cell.height,'F');
        const x=d.cell.x+3,maxW=d.cell.width-6;let y=d.cell.y+4;const lh=3.3;
        doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(31,41,55);
        doc.text('Update:'+(meta.updateDate?` (${meta.updateDate})`:''),x,y);y+=lh;
        doc.setFont('helvetica','normal');doc.setTextColor(75,85,99);
        const updLines=doc.splitTextToSize(meta.updateText,maxW);
        doc.text(updLines,x,y);y+=updLines.length*lh;
        y+=lh;
        doc.setFont('helvetica','bold');doc.setTextColor(31,41,55);
        doc.text('Next:',x,y);y+=lh;
        if(meta.nextText){
          doc.setFont('helvetica','normal');doc.setTextColor(75,85,99);
          doc.text(doc.splitTextToSize(meta.nextText,maxW),x,y);
        }else{
          doc.setFont('helvetica','italic');doc.setTextColor(156,163,175);
          doc.text('No next action noted.',x,y);
        }
      },
      didDrawPage:()=>{
        doc.setFillColor(...NV);doc.rect(0,0,W,14,'F');
        doc.setFont('helvetica','bold');doc.setFontSize(12);doc.setTextColor(255,255,255);doc.text('Integration Details',10,9.5);
        doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text(c.name,W-10,9.5,{align:'right'});
      },
    });
    // Thank you
    doc.addPage();doc.setFillColor(...NV);doc.rect(0,0,W,H,'F');
    doc.setFont('helvetica','bold');doc.setFontSize(36);doc.setTextColor(255,255,255);doc.text('Thank You',W/2,H/2-8,{align:'center'});
    doc.setFillColor(...MG);doc.rect(W/2-10,H/2,20,1,'F');
    doc.setFont('helvetica','normal');doc.setFontSize(13);doc.setTextColor(125,211,232);doc.text('Kognoz · HR Transformation & Consulting',W/2,H/2+10,{align:'center'});
    doc.save(`${c.name}_Integration_Report.pdf`);showToast('PDF downloaded ✓');
  }catch(e){console.error(e);showToast('PDF failed: '+e.message,'error');}
}

// ─── EXPORT: Implementation Module Progress (PDF) ──────────────────
function exportImplPdf(clientId){
  const c=S.clients.find(x=>x.id===clientId);if(!c)return;
  showToast('Generating PDF…','info');
  try{
    const{jsPDF}=window.jspdf;const doc=new jsPDF({orientation:'landscape',format:'a4',unit:'mm'});
    const W=297,H=210,NV=[13,61,79],MG=[181,23,158];
    const mods=c.modules||[];

    // ── COVER ──────────────────────────────────────────────────────
    doc.setFillColor(...NV);doc.rect(0,0,W,H,'F');
    doc.setFont('helvetica','normal');doc.setFontSize(10);doc.setTextColor(125,211,232);doc.text('IMPLEMENTATION STATUS REPORT',W/2,58,{align:'center'});
    doc.setFont('helvetica','bold');doc.setFontSize(34);doc.setTextColor(255,255,255);doc.text(c.name,W/2,80,{align:'center'});
    addLogoToDoc(doc,W/2-30,92,18);doc.setFont('helvetica','normal');doc.setFontSize(11);doc.setTextColor(125,211,232);doc.text('Prepared by Kognoz Consulting',W/2,98,{align:'center'});
    doc.setFillColor(...MG);doc.rect(W/2-12,100,24,1,'F');
    doc.setFontSize(10);doc.setTextColor(100,116,139);doc.text(new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'}),W/2,H-8,{align:'center'});

    // ── SUMMARY PAGE ───────────────────────────────────────────────
    doc.addPage();doc.setFillColor(...NV);doc.rect(0,0,W,14,'F');
    doc.setFont('helvetica','bold');doc.setFontSize(12);doc.setTextColor(255,255,255);doc.text('Implementation Summary',10,9.5);
    doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text(c.name,W-10,9.5,{align:'right'});
    // Stat boxes — total phases across all modules broken down by status
    const allPhases=mods.flatMap(m=>m.phases||[]);
    const sg={};allPhases.forEach(ph=>sg[ph.status]=(sg[ph.status]||0)+1);
    const totalPhases=allPhases.length;
    [{l:'Modules',v:mods.length,rgb:NV},{l:'Total Phases',v:totalPhases,rgb:[100,116,139]},{l:'In Progress',v:sg['In Progress']||0,rgb:SRGB['In Progress']},{l:'At Risk',v:sg['At Risk']||0,rgb:SRGB['At Risk']},{l:'Completed',v:sg['Completed']||0,rgb:SRGB['Completed']}]
    .forEach(({l,v,rgb},i)=>{const x=10+i*57;doc.setFillColor(...rgb);doc.roundedRect(x,18,50,20,2,2,'F');doc.setFont('helvetica','bold');doc.setFontSize(18);doc.setTextColor(255,255,255);doc.text(String(v),x+25,30,{align:'center'});doc.setFontSize(7.5);doc.setFont('helvetica','normal');doc.text(l,x+25,37,{align:'center'});});
    // Matrix table (condensed — one row per module, columns = phases)
    const matrixBody=mods.map(m=>{
      const row=[m.name];
      PHASES.forEach(phName=>{
        const ph=(m.phases||[]).find(x=>x.name===phName)||{status:'Not Started'};
        const cell=ph.status+(ph.targetDate?`\n${fmtDate(ph.targetDate)}`:'')+(ph.assignee?`\n${ph.assignee}`:'');
        row.push(cell);
      });
      return row;
    });
    doc.autoTable({
      startY:42,
      margin:{top:16,left:10,right:10,bottom:10},
      head:[['Module',...PHASES]],
      body:matrixBody,
      headStyles:{fillColor:NV,textColor:[255,255,255],fontStyle:'bold',fontSize:7.5},
      styles:{fontSize:7,cellPadding:2.5,valign:'middle',halign:'center'},
      columnStyles:{0:{halign:'left',fontStyle:'bold',cellWidth:38}},
      alternateRowStyles:{fillColor:[245,249,250]},
      didParseCell:d=>{
        if(d.section!=='body'||d.column.index===0)return;
        const st=String(d.cell.raw).split('\n')[0];
        const rgb=SRGB[st];if(rgb){d.cell.styles.textColor=rgb;d.cell.styles.fontStyle='bold';}
      },
      didDrawPage:()=>{doc.setFillColor(...NV);doc.rect(0,0,W,14,'F');addLogoToDoc(doc,10,13,10);doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(255,255,255);doc.text('Implementation Summary',58,9.5);doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text(c.name,W-10,9.5,{align:'right'});}
    });

    // ── DETAIL PAGES (one row per phase, grouped under module) ─────
    doc.addPage();
    const detailRows=[];
    mods.forEach(m=>{
      // Module header row
      detailRows.push({isHeader:true,moduleName:m.name,row:['',m.name,'','','',''],status:null});
      PHASES.forEach(phName=>{
        const ph=(m.phases||[]).find(x=>x.name===phName)||{name:phName,status:'Not Started',startDate:'',targetDate:'',updates:[]};
        const latest=(ph.updates||[])[0];
        const updateText=latest?latest.update:'No updates yet.';
        const updateDate=latest?fmtDate(latest.date):'';
        const updateCount=(ph.updates||[]).length;
        const nextText=ph.nextAction||'';
        const actText=ph.currentActivity||'';
        const sizingStr=`Update:${updateDate?` (${updateDate})`:''}\n${updateText}\n\nNext:\n${nextText||'No next action noted.'}`;
        detailRows.push({
          isHeader:false,moduleName:m.name,phaseName:phName,
          status:ph.status,updateText,updateDate,updateCount,nextText,actText,
          assignee:ph.assignee||'',
          startDate:ph.startDate?fmtDate(ph.startDate):'-',
          targetDate:ph.targetDate?fmtDate(ph.targetDate):'-',
          row:['',phName,ph.status,ph.startDate?fmtDate(ph.startDate):'-',ph.targetDate?fmtDate(ph.targetDate):'-',sizingStr],
        });
      });
    });
    doc.autoTable({
      startY:16,
      margin:{top:16,left:10,right:10,bottom:10},
      head:[['','Phase','Status','Start Date','Target Date','Latest Update & Next Action']],
      body:detailRows.map(d=>d.row),
      headStyles:{fillColor:NV,textColor:[255,255,255],fontStyle:'bold',fontSize:9},
      styles:{fontSize:8,cellPadding:3,valign:'top'},
      alternateRowStyles:{fillColor:[245,249,250]},
      columnStyles:{0:{cellWidth:3},1:{cellWidth:68},2:{cellWidth:30},3:{cellWidth:30},4:{cellWidth:30},5:{cellWidth:'auto'}},
      didParseCell:d=>{
        if(d.section!=='body')return;
        const meta=detailRows[d.row.index];if(!meta)return;
        if(meta.isHeader){
          // Module header rows span visually — teal background across all cols
          d.cell.styles.fillColor=NV;d.cell.styles.textColor=[255,255,255];d.cell.styles.fontStyle='bold';d.cell.styles.fontSize=9;
          if(d.column.index===0)d.cell.text=[''];
          if(d.column.index!==1)d.cell.text=[''];
          return;
        }
        if(d.column.index===0){d.cell.styles.fillColor=SRGB[meta.status]||[100,116,139];d.cell.text=[''];}
        if(d.column.index===2){const rgb=SRGB[meta.status];if(rgb){d.cell.styles.textColor=rgb;d.cell.styles.fontStyle='bold';}}
      },
      didDrawCell:d=>{
        if(d.section!=='body'||d.column.index!==5)return;
        const meta=detailRows[d.row.index];if(!meta||meta.isHeader)return;
        const bg=d.row.index%2?[255,255,255]:[245,249,250];
        doc.setFillColor(...bg);doc.rect(d.cell.x,d.cell.y,d.cell.width,d.cell.height,'F');
        const x=d.cell.x+3,maxW=d.cell.width-6;let y=d.cell.y+4;const lh=3.3;
        doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(31,41,55);
        doc.text('Update:'+(meta.updateDate?` (${meta.updateDate})`:''),x,y);y+=lh;
        doc.setFont('helvetica','normal');doc.setTextColor(75,85,99);
        const updLines=doc.splitTextToSize(meta.updateText,maxW);
        doc.text(updLines,x,y);y+=updLines.length*lh;
        y+=lh;
        doc.setFont('helvetica','bold');doc.setTextColor(31,41,55);
        doc.text('Next:',x,y);y+=lh;
        if(meta.nextText){
          doc.setFont('helvetica','normal');doc.setTextColor(75,85,99);
          doc.text(doc.splitTextToSize(meta.nextText,maxW),x,y);
        }else{
          doc.setFont('helvetica','italic');doc.setTextColor(156,163,175);
          doc.text('No next action noted.',x,y);
        }
      },
      didDrawPage:()=>{
        doc.setFillColor(...NV);doc.rect(0,0,W,14,'F');
        addLogoToDoc(doc,10,13,10);doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(255,255,255);doc.text('Phase Details & Updates',58,9.5);
        doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text(c.name,W-10,9.5,{align:'right'});
      },
    });

    // ── THANK YOU ──────────────────────────────────────────────────
    doc.addPage();doc.setFillColor(...NV);doc.rect(0,0,W,H,'F');
    doc.setFont('helvetica','bold');doc.setFontSize(36);doc.setTextColor(255,255,255);doc.text('Thank You',W/2,H/2-8,{align:'center'});
    doc.setFillColor(...MG);doc.rect(W/2-10,H/2,20,1,'F');
    doc.setFont('helvetica','normal');doc.setFontSize(13);doc.setTextColor(125,211,232);doc.text('Kognoz · HR Transformation & Consulting',W/2,H/2+10,{align:'center'});

    doc.save(`${c.name}_Implementation_Report.pdf`);showToast('PDF downloaded ✓');
  }catch(e){console.error(e);showToast('PDF failed: '+e.message,'error');}
}

// ─── EXPORT: AMS Billing Breakdown (PDF, admin only) ────────────────
function exportAmsActivityPdf(clientId){
  if(!can('admin'))return;
  const c=S.clients.find(x=>x.id===clientId);if(!c)return;
  showToast('Generating activity report…','info');
  try{
    const{jsPDF}=window.jspdf;const doc=new jsPDF({orientation:'landscape',format:'a4',unit:'mm'});
    const W=297,H=210,NV=[13,61,79],MG=[181,23,158];
    const t=amsTotals(c,S.amsFrom,S.amsTo);
    const sorted=[...t.log].sort((a,b)=>entryDate(a).localeCompare(entryDate(b)));
    const periodLabel=(S.amsFrom||S.amsTo)?`${S.amsFrom?fmtDate(S.amsFrom):'Start'} - ${S.amsTo?fmtDate(S.amsTo):'Today'}`:'All Time';

    // ── COVER ──────────────────────────────────────────────────────
    doc.setFillColor(...NV);doc.rect(0,0,W,H,'F');
    doc.setFont('helvetica','normal');doc.setFontSize(10);doc.setTextColor(125,211,232);doc.text('AMS ACTIVITY REPORT',W/2,58,{align:'center'});
    doc.setFont('helvetica','bold');doc.setFontSize(34);doc.setTextColor(255,255,255);doc.text(c.name,W/2,80,{align:'center'});
    doc.setFont('helvetica','normal');doc.setFontSize(14);doc.setTextColor(125,211,232);doc.text(`Period: ${periodLabel}`,W/2,95,{align:'center'});
    doc.setFillColor(...MG);doc.rect(W/2-12,100,24,1,'F');
    doc.setFont('helvetica','normal');doc.setFontSize(10);doc.setTextColor(100,116,139);
    addLogoToDoc(doc,W/2-30,H-22,18);doc.text('Prepared by Kognoz Consulting',W/2,H-8,{align:'center'});
    doc.text(new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'}),W/2,H-7,{align:'center'});

    // ── SUMMARY PAGE ───────────────────────────────────────────────
    doc.addPage();
    const drawHdr=()=>{doc.setFillColor(...NV);doc.rect(0,0,W,14,'F');addLogoToDoc(doc,10,13,10);doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(255,255,255);doc.text('AMS Activity Log',58,9.5);doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text(c.name,W-10,9.5,{align:'right'});};
    drawHdr();
    // Stat boxes
    const openCount=sorted.filter(e=>(e.entryStatus||'Open')==='Open').length;
    const inprogCount=sorted.filter(e=>e.entryStatus==='In Progress').length;
    const closedCount=sorted.filter(e=>e.entryStatus==='Closed').length;
    [{l:'Total Entries',v:sorted.length,rgb:NV},{l:'Total Hours',v:t.totalHours.toFixed(1),rgb:[100,116,139]},{l:'Open',v:openCount,rgb:[29,78,216]},{l:'In Progress',v:inprogCount,rgb:[146,64,14]},{l:'Closed',v:closedCount,rgb:[21,128,61]}]
    .forEach(({l,v,rgb},i)=>{const x=10+i*57;doc.setFillColor(...rgb);doc.roundedRect(x,18,50,20,2,2,'F');doc.setFont('helvetica','bold');doc.setFontSize(18);doc.setTextColor(255,255,255);doc.text(String(v),x+25,30,{align:'center'});doc.setFontSize(7.5);doc.setFont('helvetica','normal');doc.text(l,x+25,37,{align:'center'});});

    // Activity table
    const HEADS=['#','Date Raised','Raised By','Module','Project','Description','Type','Level','Dependencies','Status','Solution','Mode','Hrs'];
    const body=sorted.map((e,i)=>[
      String(i+1),
      fmtDate(entryDate(e)),
      entryRaisedBy(e),
      e.module||'-',
      e.project||'-',
      e.description||'-',
      entryType(e),
      e.queryLevel||'-',
      e.dependencies||'-',
      e.entryStatus||'Open',
      e.solution||'-',
      e.modeOfSupport||'-',
      Number(e.hours||0).toFixed(1),
    ]);
    const statusColors={'Open':[29,78,216],'In Progress':[146,64,14],'Closed':[21,128,61]};
    doc.autoTable({
      startY:42,
      margin:{top:18,left:8,right:8,bottom:10},
      head:[HEADS],
      body,
      headStyles:{fillColor:NV,textColor:[255,255,255],fontStyle:'bold',fontSize:7.5},
      styles:{fontSize:7,cellPadding:2,valign:'top',overflow:'linebreak'},
      columnStyles:{
        0:{cellWidth:8,halign:'center'},1:{cellWidth:22},2:{cellWidth:24},3:{cellWidth:24},4:{cellWidth:22},
        5:{cellWidth:'auto'},6:{cellWidth:20},7:{cellWidth:18},8:{cellWidth:22},9:{cellWidth:20},
        10:{cellWidth:'auto'},11:{cellWidth:20},12:{cellWidth:12,halign:'right'},
      },
      alternateRowStyles:{fillColor:[245,249,250]},
      didParseCell:d=>{
        if(d.section!=='body'||d.column.index!==9)return;
        const rgb=statusColors[String(d.cell.raw)];
        if(rgb){d.cell.styles.textColor=rgb;d.cell.styles.fontStyle='bold';}
      },
      didDrawPage:drawHdr,
    });

    // ── THANK YOU ──────────────────────────────────────────────────
    doc.addPage();doc.setFillColor(...NV);doc.rect(0,0,W,H,'F');
    doc.setFont('helvetica','bold');doc.setFontSize(36);doc.setTextColor(255,255,255);doc.text('Thank You',W/2,H/2-8,{align:'center'});
    doc.setFillColor(...MG);doc.rect(W/2-10,H/2,20,1,'F');
    doc.setFont('helvetica','normal');doc.setFontSize(13);doc.setTextColor(125,211,232);doc.text('Kognoz · HR Transformation & Consulting',W/2,H/2+10,{align:'center'});

    doc.save(`${c.name}_AMS_Activity_Report.pdf`);showToast('Activity report downloaded ✓');
  }catch(e){console.error(e);showToast('PDF failed: '+e.message,'error');}
}

function exportAmsInvoicePdf(clientId){
  if(!can('admin'))return;
  const c=S.clients.find(x=>x.id===clientId);if(!c)return;
  if(!c.manDayRate){showToast('Invoice not available — no day rate set for this client. Use Activity Report instead.','warn');return;}
  showToast('Generating invoice…','info');
  try{
    const{jsPDF}=window.jspdf;const doc=new jsPDF({orientation:'landscape',format:'a4',unit:'mm'});
    const W=297,H=210,NV=[13,61,79],MG=[181,23,158];
    const t=amsTotals(c,S.amsFrom,S.amsTo);
    const periodLabel=(S.amsFrom||S.amsTo)?`${S.amsFrom?fmtDate(S.amsFrom):'Start'} - ${S.amsTo?fmtDate(S.amsTo):'Today'}`:'All Time';
    const drawHeaderBar=()=>{
      doc.setFillColor(...NV);doc.rect(0,0,W,14,'F');addLogoToDoc(doc,10,13,10);
      doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(255,255,255);doc.text('AMS Work Summary & Internal Billing Breakdown',58,9.5);
      doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text(c.name,W-10,9.5,{align:'right'});
    };
    drawHeaderBar();
    doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(100,116,139);
    doc.text(`Billing Period: ${periodLabel}`,10,21);
    doc.text(`Day Rate: Rs. ${(c.manDayRate||0).toLocaleString('en-IN')} (${HOURS_PER_DAY}-hour day)`,10,26);
    doc.text(`Generated: ${new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'})}`,W-10,21,{align:'right'});
    let boxY=30;
    if(t.hasBucket){
      [{l:'Total Available',v:`${t.totalAvailableHours.toFixed(1)} hrs`},{l:'Consumed (all-time)',v:`${t.consumedAllTime.toFixed(1)} hrs`},{l:'Balance Available',v:`${t.balanceAvailable.toFixed(1)} hrs`}]
      .forEach((s,i)=>{const x=10+i*92;doc.setFillColor(...(i===2?(t.balanceAvailable>0?[34,197,94]:[190,24,93]):[100,116,139]));doc.roundedRect(x,boxY,86,16,2,2,'F');doc.setFont('helvetica','bold');doc.setFontSize(13);doc.setTextColor(255,255,255);doc.text(s.v,x+6,boxY+10);doc.setFontSize(7.5);doc.setFont('helvetica','normal');doc.text(s.l,x+6,boxY+14.5);});
      boxY+=20;
    }
    [{l:'Hours This Period',v:t.totalHours.toFixed(1)},{l:'Total Days',v:(t.totalHours/HOURS_PER_DAY).toFixed(2)},{l:'Billable Amount (Rs.)',v:t.totalAmount.toLocaleString('en-IN',{maximumFractionDigits:0})}]
    .forEach((s,i)=>{const x=10+i*92;doc.setFillColor(...(i===2?MG:NV));doc.roundedRect(x,boxY,86,16,2,2,'F');doc.setFont('helvetica','bold');doc.setFontSize(15);doc.setTextColor(255,255,255);doc.text(String(s.v),x+6,boxY+10);doc.setFontSize(7.5);doc.setFont('helvetica','normal');doc.text(s.l,x+6,boxY+14.5);});
    const tableStartY=boxY+24;
    const sorted=[...t.log].sort((a,b)=>a.date.localeCompare(b.date));
    doc.autoTable({
      startY:tableStartY,
      margin:{top:18,left:10,right:10,bottom:10},
      head:[['Date','Category','Description','Hours','Amount (Rs.)']],
      body:sorted.map(e=>[fmtDate(e.date),e.category,e.description||'-',Number(e.hours).toFixed(1),t.hasBucket?'Pooled':amsEntryAmount(Number(e.hours),c.manDayRate||0).toLocaleString('en-IN',{maximumFractionDigits:0})]),
      headStyles:{fillColor:NV,textColor:[255,255,255],fontStyle:'bold',fontSize:9},
      styles:{fontSize:8.5,cellPadding:3},
      alternateRowStyles:{fillColor:[245,249,250]},
      columnStyles:{0:{cellWidth:28},1:{cellWidth:35},2:{cellWidth:'auto'},3:{cellWidth:22,halign:'right'},4:{cellWidth:30,halign:'right'}},
      didDrawPage:drawHeaderBar,
    });
    const catRows=Object.entries(t.byType).map(([cat,hrs])=>[cat,hrs.toFixed(1),t.hasBucket?'Pooled':(amsEntryAmount(hrs,c.manDayRate||0)||0).toLocaleString('en-IN',{maximumFractionDigits:0})]);
    if(catRows.length){
      doc.autoTable({
        startY:doc.lastAutoTable.finalY+8,
        margin:{top:18,left:10,right:10,bottom:10},
        head:[['Breakdown by Category','Hours','Amount (Rs.)']],
        body:catRows,
        headStyles:{fillColor:[100,116,139],textColor:[255,255,255],fontStyle:'bold',fontSize:9},
        styles:{fontSize:8.5,cellPadding:3},
        columnStyles:{1:{halign:'right'},2:{halign:'right'}},
        didDrawPage:drawHeaderBar,
      });
    }
    doc.setFont('helvetica','italic');doc.setFontSize(7.5);doc.setTextColor(156,163,175);
    doc.text(t.hasBucket?'For internal finance use. Hours within the available pool are not separately billed - only usage beyond the pool is billed. Pre-tax breakdown - GST and other taxes to be applied by finance separately.':'For internal finance use. Pre-tax breakdown - GST and other taxes to be applied by finance separately.',10,H-6);
    doc.save(`${c.name}_AMS_Billing.pdf`);showToast('Invoice downloaded ✓');
  }catch(e){console.error(e);showToast('PDF failed: '+e.message,'error');}
}

function exportExcel(type, clientId){
  if(typeof XLSX==='undefined'){showToast('Excel export not available','error');return;}
  const c=S.clients.find(x=>x.id===clientId);if(!c)return;
  let wb,ws,data,headers,filename;
  if(type==='integrations'){
    headers=['Integration','Status','Assignee','Due Date','Description','Next Action','Last Update'];
    data=(c.integrations||[]).map(i=>[i.name||'',i.status||'',i.assignee||'',i.dueDate?fmtDate(i.dueDate):'',i.description||'',i.nextAction||'',(i.timeline||[])[0]?.date?fmtDate((i.timeline||[])[0].date):'']);
    filename=`${c.name}_Integrations.xlsx`;
  }else if(type==='ams'){
    headers=['#','Date Raised','Due Date','Raised By','Module','Project','Description','Type','Query Level','Entry Status','RAG','Mode','Hours'];
    data=(c.workLog||[]).map((e,i)=>[i+1,fmtDate(entryDate(e)),e.dueDate?fmtDate(e.dueDate):'',entryRaisedBy(e),e.module||'',e.project||'',e.description||'',entryType(e),e.queryLevel||'',e.entryStatus||'Open',e.ragStatus||'',e.modeOfSupport||'',Number(e.hours||0).toFixed(1)]);
    filename=`${c.name}_AMS_Entries.xlsx`;
  }else if(type==='impl'){
    headers=['Module','Phase','Status','Assignee','Start Date','Target Date','Current Activity','Next Action','Updates Count'];
    data=(c.modules||[]).flatMap(m=>(m.phases||[]).map(ph=>[m.name,ph.name,ph.status||'',ph.assignee||'',ph.startDate?fmtDate(ph.startDate):'',ph.targetDate?fmtDate(ph.targetDate):'',ph.currentActivity||'',ph.nextAction||'',(ph.updates||[]).length]));
    filename=`${c.name}_Implementation.xlsx`;
  }else if(type==='milestones'){
    headers=['Integration','Milestone','Status','Due Date','Owner','Notes'];
    data=(c.integrations||[]).flatMap(i=>(i.milestones||[]).map(ms=>[i.name,ms.name,ms.status,ms.dueDate?fmtDate(ms.dueDate):'',ms.owner||'',ms.notes||'']));
    filename=`${c.name}_Milestones.xlsx`;
  }
  ws=XLSX.utils.aoa_to_sheet([headers,...(data||[])]);
  // Bold header row
  const range=XLSX.utils.decode_range(ws['!ref']);
  for(let C=range.s.c;C<=range.e.c;C++){const cell=XLSX.utils.encode_cell({r:0,c:C});if(ws[cell])ws[cell].s={font:{bold:true}};}
  wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Data');
  XLSX.writeFile(wb,filename);showToast('Excel downloaded ✓');
}

function exportConsolidatedPdf(clientIds, sections){
  if(!clientIds.length){showToast('Select at least one client','error');return;}
  const{jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:'landscape',format:'a4',unit:'mm'});
  const W=297,H=210,NV=[13,61,79],MG=[181,23,158];
  // Cover
  doc.setFillColor(...NV);doc.rect(0,0,W,H,'F');
  doc.setFont('helvetica','bold');doc.setFontSize(30);doc.setTextColor(255,255,255);
  doc.text('Portfolio Status Report',W/2,H/2-14,{align:'center'});
  doc.setFont('helvetica','normal');doc.setFontSize(12);doc.setTextColor(125,211,232);
  doc.text(`${clientIds.length} client${clientIds.length!==1?'s':''} · ${new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'})}`,W/2,H/2+2,{align:'center'});
  doc.setFillColor(...MG);doc.rect(W/2-14,H/2+10,28,1,'F');
  addLogoToDoc(doc,W/2-30,H-18,18);doc.setFontSize(10);doc.setTextColor(100,116,139);doc.text('Prepared by Kognoz Consulting',W/2,H-5,{align:'center'});

  const drawHdr=(title,clientName)=>{doc.setFillColor(...NV);doc.rect(0,0,W,14,'F');addLogoToDoc(doc,10,13,10);doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(255,255,255);doc.text(title,58,9.5);doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text(clientName,W-10,9.5,{align:'right'});};

  clientIds.forEach(cid=>{
    const c=S.clients.find(x=>x.id===cid);if(!c)return;
    if(sections.includes('integrations')&&(c.integrations||[]).length){
      doc.addPage();drawHdr('Integrations',c.name);
      doc.autoTable({startY:18,margin:{top:18,left:10,right:10},head:[['Integration','Status','Assignee','Due Date','Latest Update']],
        body:(c.integrations||[]).map(i=>[i.name,i.status,i.assignee||'—',i.dueDate?fmtDate(i.dueDate):'—',(i.timeline||[])[0]?.update?.slice(0,80)||'—']),
        headStyles:{fillColor:NV,textColor:[255,255,255],fontStyle:'bold',fontSize:9},styles:{fontSize:8,cellPadding:3},
        didParseCell:d=>{if(d.section==='body'&&d.column.index===1){const rgb=SRGB[d.cell.raw];if(rgb){d.cell.styles.textColor=rgb;d.cell.styles.fontStyle='bold';}}},
        didDrawPage:()=>drawHdr('Integrations',c.name)});
    }
    if(sections.includes('impl')&&c.modules?.length){
      doc.addPage();drawHdr('Implementations',c.name);
      const rag=implAutoRag(c);const pr=implProgress(c);
      doc.setFont('helvetica','normal');doc.setFontSize(10);doc.setTextColor(31,41,55);
      doc.text(`RAG: ${rag||'—'} · ${pr.completed}/${pr.total} phases complete (${pr.pct}%)`,10,19);
      doc.autoTable({startY:24,margin:{top:24,left:10,right:10},head:[['Module',...PHASES]],
        body:(c.modules||[]).map(m=>{const row=[m.name];PHASES.forEach(ph=>{const p=(m.phases||[]).find(x=>x.name===ph)||{status:'Not Started'};row.push(p.status);});return row;}),
        headStyles:{fillColor:NV,textColor:[255,255,255],fontStyle:'bold',fontSize:7.5},
        styles:{fontSize:7,cellPadding:2.5,halign:'center'},columnStyles:{0:{halign:'left',fontStyle:'bold',cellWidth:38}},
        didParseCell:d=>{if(d.section==='body'&&d.column.index>0){const rgb=SRGB[d.cell.raw];if(rgb){d.cell.styles.textColor=rgb;d.cell.styles.fontStyle='bold';}}},
        didDrawPage:()=>drawHdr('Implementations',c.name)});
    }
    if(sections.includes('ams')&&c.workLog?.length){
      doc.addPage();drawHdr('AMS & Support',c.name);
      const t=amsTotals(c,S.amsFrom,S.amsTo);
      doc.setFont('helvetica','normal');doc.setFontSize(10);doc.setTextColor(31,41,55);
      doc.text(`Total Hours: ${t.totalHours.toFixed(1)}h · Open entries: ${(c.workLog||[]).filter(e=>e.entryStatus!=='Closed').length}`,10,19);
      doc.autoTable({startY:24,margin:{top:24,left:10,right:10},
        head:[['#','Date','Description','Type','Level','Status','Hours']],
        body:(c.workLog||[]).sort((a,b)=>entryDate(b).localeCompare(entryDate(a))).map((e,i)=>[i+1,fmtDate(entryDate(e)),(e.description||'').slice(0,50),entryType(e),e.queryLevel||'',e.entryStatus||'Open',Number(e.hours||0).toFixed(1)]),
        headStyles:{fillColor:NV,textColor:[255,255,255],fontStyle:'bold',fontSize:9},styles:{fontSize:7.5,cellPadding:2.5},
        didDrawPage:()=>drawHdr('AMS & Support',c.name)});
    }
  });
  // Thank you
  doc.addPage();doc.setFillColor(...NV);doc.rect(0,0,W,H,'F');
  doc.setFont('helvetica','bold');doc.setFontSize(36);doc.setTextColor(255,255,255);doc.text('Thank You',W/2,H/2-8,{align:'center'});
  doc.setFillColor(...MG);doc.rect(W/2-10,H/2,20,1,'F');
  doc.setFont('helvetica','normal');doc.setFontSize(13);doc.setTextColor(125,211,232);doc.text('Kognoz · HR Transformation & Consulting',W/2,H/2+10,{align:'center'});
  doc.save(`Portfolio_Report_${new Date().toISOString().slice(0,10)}.pdf`);showToast('Portfolio PDF downloaded ✓');
}

// ─── EVENTS ───────────────────────────────────────────────────────
document.addEventListener('click',async e=>{
  if(e.target.id==='modal-overlay'&&e.target===e.currentTarget){if(S.modal?.busy)return;S.modal=null;render();return;}
  if(e.target.id==='cmdp-overlay'){S.cmdPaletteOpen=false;render();return;}
  const el=e.target.closest('[data-act]');if(!el)return;
  const act=el.dataset.act;

  if(act==='login'){
    const u=document.getElementById('lu')?.value.trim(),p=document.getElementById('lp')?.value;
    const errEl=document.getElementById('lerr');
    if(!u||!p){if(errEl){errEl.textContent='Enter username and password';errEl.classList.remove('hidden');}return;}
    setBtnBusy(el,'Signing in…');
    if(errEl)errEl.classList.add('hidden');
    const hash=await sha256(p);
    let ld;
    try{
      const lr=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,passwordHash:hash})});
      ld=await lr.json();
      if(!lr.ok){clearBtnBusy(el);const e2=document.getElementById('lerr');if(e2){e2.textContent=ld.error||'Login failed';e2.classList.remove('hidden');}return;}
    }catch(err){clearBtnBusy(el);const e2=document.getElementById('lerr');if(e2){e2.textContent='Connection failed. Check repo/env setup.';e2.classList.remove('hidden');}return;}
    S.sessionToken=ld.token;S.user=ld.user;S.shas.users=ld.usersSha;
    document.getElementById('app').innerHTML=renderAppSkeleton();
    try{const cl=await apiRead('data/clients.json');S.clients=cl.content;S.shas.clients=cl.sha;}
    catch(err){S.user=null;S.sessionToken=null;render();const e2=document.getElementById('lerr');if(e2){e2.textContent='Loaded user but failed to load clients.';e2.classList.remove('hidden');}return;}
    try{const ul=await apiRead('data/users.json');S.usersForDropdown=ul.content.map(u=>({id:u.id,name:u.name||u.username,role:u.role,username:u.username}));if(can('admin')){S.users=ul.content;S.shas.users=ul.sha;}}
    catch(err){S.usersForDropdown=[{id:S.user.id,name:S.user.name||S.user.username,role:S.user.role,username:S.user.username}];}
    persistSession(S.sessionToken,S.user);
    navigate('dashboard');return;
  }
  if(act==='logout'){clearSession();S.user=null;S.clients=[];S.users=[];S.usersForDropdown=[];S.shas={clients:null,users:null};S.sessionToken=null;navigate('login');return;}
  if(act==='nav-dashboard'){navigate('dashboard');return;}
  if(act==='nav-clients'){navigate('clients');return;}
  if(act==='nav-impl'){navigate('impl-clients');return;}
  if(act==='nav-ams'){navigate('ams-clients');return;}
  if(act==='nav-admin'){if(can('admin'))navigate('admin');return;}
  if(act==='toggle-sidebar'){S.sidebarCollapsed=!S.sidebarCollapsed;try{localStorage.setItem('itk_sb_collapsed',S.sidebarCollapsed?'1':'0');}catch(e){}render();return;}
  if(act==='toggle-dark'){S.darkMode=!S.darkMode;document.documentElement.classList.toggle('dark',S.darkMode);try{localStorage.setItem('itk_dark',S.darkMode?'1':'0');}catch(e){}render();return;}
  if(act==='cmdp-open'){S.cmdPaletteOpen=true;S.cmdQuery='';render();setTimeout(()=>document.getElementById('cmdp-input')?.focus(),30);return;}
  if(act==='cmdp-go'){
    const r=_cmdpResults[Number(el.dataset.idx)];if(!r)return;
    S.cmdPaletteOpen=false;navigate(r.view,r.params);return;
  }
  if(act==='open-client'){navigate('client-detail',{clientId:el.dataset.id});return;}
  if(act==='open-integ'){navigate('integ-detail',{clientId:el.dataset.cid,integId:el.dataset.iid});return;}
  if(act==='open-impl-client'){navigate('impl-client-detail',{clientId:el.dataset.id});return;}
  if(act==='open-ams-client'){navigate('ams-client-detail',{clientId:el.dataset.id});return;}
  if(act==='filter'){S.filter=el.dataset.filter;render();return;}
  if(act==='sort'){const k=el.dataset.key;if(S.sort.key===k){S.sort.dir=S.sort.dir==='asc'?'desc':'asc';}else{S.sort={key:k,dir:'asc'};}render();return;}
  if(act==='admin-tab'){S.adminTab=el.dataset.tab;render();return;}
  if(act==='exp-pptx'){setBtnBusy(el,'Generating…');try{await exportPptx(el.dataset.id);}finally{clearBtnBusy(el);}return;}
  if(act==='exp-pdf'){setBtnBusy(el,'Generating…');try{await exportPdf(el.dataset.id);}finally{clearBtnBusy(el);}return;}
  if(act==='exp-impl-pdf'){setBtnBusy(el,'Generating…');try{exportImplPdf(el.dataset.cid);}finally{clearBtnBusy(el);}return;}
  if(act==='exp-ams-invoice'){if(!can('admin'))return;setBtnBusy(el,'Generating…');try{exportAmsInvoicePdf(el.dataset.cid);}finally{clearBtnBusy(el);}return;}
  if(act==='copy-update'){try{await navigator.clipboard.writeText(el.dataset.text);showToast('Copied ✓');}catch(e){showToast('Copy failed','error');}return;}
  if(act==='edit-timeline'){if(!can('edit'))return;S.editingTimelineId=el.dataset.tid;render();setTimeout(()=>{const ta=document.getElementById(`edit-tl-${el.dataset.tid}`);if(ta){ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length);}},50);return;}
  if(act==='cancel-edit-timeline'){S.editingTimelineId=null;render();return;}
  if(act==='toggle-history'){const tid=el.dataset.tid;if(S.expandedHistory.has(tid))S.expandedHistory.delete(tid);else S.expandedHistory.add(tid);render();return;}
  if(act==='modal-open'){S.modal={type:el.dataset.modal,cid:el.dataset.cid};render();setTimeout(()=>document.getElementById('m1')?.focus(),50);return;}
  if(act==='open-impl-phase'){
    navigate('impl-phase-detail',{clientId:el.dataset.cid,moduleId:el.dataset.mid,phase:el.dataset.phase});return;
  }
  if(act==='modal-close'){if(S.modal?.busy)return;S.modal=null;render();return;}

  if(act==='mark-complete'){
    if(!can('edit'))return;
    const cid=el.dataset.cid,iid=el.dataset.iid;
    const c=S.clients.find(x=>x.id===cid);const i=c?.integrations.find(x=>x.id===iid);if(!i)return;
    const prevStatus=i.status;i.status='Completed';
    const entry={id:uid(),date:todayStr(),update:'Marked as Completed.',addedBy:S.user.name,addedAt:new Date().toISOString()};
    i.timeline.unshift(entry);
    setBtnBusy(el,'Saving…');
    try{await saveClients(`Complete: ${i.name}`);showToast('Marked complete ✓');navigate('integ-detail',{clientId:cid,integId:iid});}
    catch(err){i.status=prevStatus;i.timeline.shift();showToast('Failed: '+err.message,'error');render();}
    return;
  }
  if(act==='save-integ'){
    if(!can('edit'))return;
    const cid=el.dataset.cid,iid=el.dataset.iid;
    const c=S.clients.find(x=>x.id===cid);const i=c?.integrations.find(x=>x.id===iid);if(!i)return;
    const prev={...i};
    i.status=document.getElementById('f-status')?.value||i.status;
    i.assignee=document.getElementById('f-assignee')?.value?.trim()||i.assignee;
    i.dueDate=document.getElementById('f-due')?.value||'';
    i.description=document.getElementById('f-desc')?.value?.trim()||'';
    i.nextAction=document.getElementById('f-next')?.value?.trim()||'';
    setBtnBusy(el,'Saving…');
    try{await saveClients(`Update ${i.name}`);showToast('Saved ✓');navigate('integ-detail',{clientId:cid,integId:iid});}
    catch(err){Object.assign(i,prev);showToast('Save failed: '+err.message,'error');clearBtnBusy(el);}
    return;
  }
  if(act==='add-timeline'){
    if(!can('edit'))return;
    const cid=el.dataset.cid,iid=el.dataset.iid;
    const text=document.getElementById('tl-input')?.value.trim();
    if(!text){showToast('Enter an update','error');return;}
    const c=S.clients.find(x=>x.id===cid);const i=c?.integrations.find(x=>x.id===iid);if(!i)return;
    const entry={id:uid(),date:todayStr(),update:text,addedBy:S.user.name,addedAt:new Date().toISOString()};
    i.timeline.unshift(entry);setBtnBusy(el,'Saving…');
    try{await saveClients(`Timeline: ${i.name}`);showToast('Update added ✓');navigate('integ-detail',{clientId:cid,integId:iid});}
    catch(err){i.timeline.shift();showToast('Failed: '+err.message,'error');clearBtnBusy(el);}
    return;
  }
  if(act==='save-edit-timeline'){
    if(!can('edit'))return;
    const cid=el.dataset.cid,iid=el.dataset.iid,tid=el.dataset.tid;
    const c=S.clients.find(x=>x.id===cid);const i=c?.integrations.find(x=>x.id===iid);if(!i)return;
    const idx=i.timeline.findIndex(x=>x.id===tid);if(idx<0)return;
    const newText=document.getElementById(`edit-tl-${tid}`)?.value.trim();
    if(!newText){showToast('Update cannot be empty','error');return;}
    const original=i.timeline[idx];
    if(newText===original.update){S.editingTimelineId=null;render();return;}
    const snapshot=JSON.parse(JSON.stringify(original));
    const updated={...original,edits:[...(original.edits||[]),{text:original.update,editedAt:new Date().toISOString(),editedBy:S.user.name}],update:newText,lastEditedAt:new Date().toISOString(),lastEditedBy:S.user.name};
    i.timeline[idx]=updated;
    setBtnBusy(el,'Saving…');
    try{await saveClients(`Edit timeline: ${i.name}`);S.editingTimelineId=null;showToast('Update edited ✓');navigate('integ-detail',{clientId:cid,integId:iid});}
    catch(err){i.timeline[idx]=snapshot;showToast('Failed: '+err.message,'error');clearBtnBusy(el);}
    return;
  }
  if(act==='save-impl-phase'){
    if(!can('edit'))return;
    const cid=el.dataset.cid,mid=el.dataset.mid,phaseName=el.dataset.phase;
    const c=S.clients.find(x=>x.id===cid);const mod=(c?.modules||[]).find(x=>x.id===mid);if(!mod)return;
    const idx=mod.phases.findIndex(x=>x.name===phaseName);
    const ph=idx>=0?mod.phases[idx]:{name:phaseName,status:'Not Started',startDate:'',targetDate:'',updates:[]};
    const prev={...ph};
    ph.status=document.getElementById('ip-status')?.value||ph.status;
    ph.assignee=document.getElementById('ip-assignee')?.value?.trim()||'';
    ph.startDate=document.getElementById('ip-start')?.value||'';
    ph.targetDate=document.getElementById('ip-target')?.value||'';
    ph.currentActivity=document.getElementById('ip-activity')?.value?.trim()||'';
    ph.nextAction=document.getElementById('ip-next')?.value?.trim()||'';
    // Signoff enforcement
    const isSignoff=SIGNOFF_PHASES.includes(phaseName);
    const hasAttachment=(ph.updates||[]).some(u=>u.attachment?.url);
    if(isSignoff&&ph.status==='Completed'&&!hasAttachment){
      showToast(`${phaseName} requires a document attached to an update. Upload a file before marking complete.`,'error');
      return;
    }
    if(!isSignoff&&ph.status==='Completed'&&!hasAttachment){
      showToast('Tip: Consider attaching a reference document to this phase update.','warn');
    }
    if(idx>=0)mod.phases[idx]=ph;else mod.phases.push(ph);
    setBtnBusy(el,'Saving…');
    try{await saveClients(`Update ${phaseName}: ${mod.name}`);showToast('Saved ✓');navigate('impl-phase-detail',{clientId:cid,moduleId:mid,phase:phaseName});}
    catch(err){if(idx>=0)mod.phases[idx]=prev;else mod.phases.pop();showToast('Save failed: '+err.message,'error');clearBtnBusy(el);}
    return;
  }
  if(act==='add-impl-update'){
    if(!can('edit'))return;
    const cid=el.dataset.cid,mid=el.dataset.mid,phaseName=el.dataset.phase;
    const text=document.getElementById('ip-update-input')?.value.trim();
    if(!text){showToast('Enter an update','error');return;}
    const c=S.clients.find(x=>x.id===cid);const mod=(c?.modules||[]).find(x=>x.id===mid);if(!mod)return;
    const ph=mod.phases.find(x=>x.name===phaseName);if(!ph)return;
    if(!ph.updates)ph.updates=[];
    const attachUrl=document.getElementById('ip-attach-url')?.value.trim()||'';
    const attachLabel=document.getElementById('ip-attach-label')?.value.trim()||'';
    const attachMime=document.getElementById('ip-attach-mimetype')?.value||'';
    const attachName=document.getElementById('ip-attach-filename')?.value||'';
    const attachment=attachUrl?{label:attachLabel||attachName||'Attachment',url:attachUrl,fileName:attachName||attachLabel||'Attachment',mimeType:attachMime}:undefined;
    const entry={id:uid(),date:todayStr(),update:text,addedBy:S.user.name,addedAt:new Date().toISOString(),...(attachment?{attachment}:{})};
    ph.updates.unshift(entry);setBtnBusy(el,'Saving…');
    try{await saveClients(`Update ${phaseName}: ${mod.name}`);showToast('Update added ✓');navigate('impl-phase-detail',{clientId:cid,moduleId:mid,phase:phaseName});}
    catch(err){ph.updates.shift();showToast('Failed: '+err.message,'error');clearBtnBusy(el);}
    return;
  }
  if(act==='save-edit-impl-update'){
    if(!can('edit'))return;
    const cid=el.dataset.cid,mid=el.dataset.mid,phaseName=el.dataset.phase,tid=el.dataset.tid;
    const c=S.clients.find(x=>x.id===cid);const mod=(c?.modules||[]).find(x=>x.id===mid);if(!mod)return;
    const ph=mod.phases.find(x=>x.name===phaseName);if(!ph||!ph.updates)return;
    const idx=ph.updates.findIndex(x=>x.id===tid);if(idx<0)return;
    const newText=document.getElementById(`edit-tl-${tid}`)?.value.trim();
    if(!newText){showToast('Update cannot be empty','error');return;}
    const attachUrl=document.getElementById(`eat-url-${tid}`)?.value.trim()||'';
    const attachLabel=document.getElementById(`eat-label-${tid}`)?.value.trim()||'';
    const attachMime=document.getElementById(`eat-mimetype-${tid}`)?.value||'';
    const attachName=document.getElementById(`eat-filename-${tid}`)?.value||'';
    const attachment=attachUrl?{label:attachLabel||attachName||'Attachment',url:attachUrl,fileName:attachName||attachLabel||'Attachment',mimeType:attachMime}:undefined;
    const original=ph.updates[idx];
    const snapshot=JSON.parse(JSON.stringify(original));
    const textChanged=newText!==original.update;
    const updated={...original,...(attachment!==undefined?{attachment}:{attachment:original.attachment}),
      ...(textChanged?{edits:[...(original.edits||[]),{text:original.update,editedAt:new Date().toISOString(),editedBy:S.user.name}],update:newText,lastEditedAt:new Date().toISOString(),lastEditedBy:S.user.name}:{})};
    ph.updates[idx]=updated;setBtnBusy(el,'Saving…');
    try{await saveClients(`Edit update: ${phaseName}, ${mod.name}`);S.editingTimelineId=null;showToast('Update saved ✓');navigate('impl-phase-detail',{clientId:cid,moduleId:mid,phase:phaseName});}
    catch(err){ph.updates[idx]=snapshot;showToast('Failed: '+err.message,'error');clearBtnBusy(el);}
    return;
  }
  if(act==='toggle-ams-history'){
    const eid=el.dataset.eid;
    if(S.expandedAmsHistory.has(eid))S.expandedAmsHistory.delete(eid);else S.expandedAmsHistory.add(eid);
    render();return;
  }
  // ── Milestone handlers ──
  if(act==='add-milestone-btn'){
    if(!can('edit'))return;
    S.modal={type:'add-milestone',cid:el.dataset.cid,iid:el.dataset.iid};render();setTimeout(()=>document.getElementById('ms-name')?.focus(),50);return;
  }
  if(act==='edit-milestone-btn'){
    if(!can('edit'))return;
    const c=S.clients.find(x=>x.id===el.dataset.cid);const i=c?.integrations.find(x=>x.id===el.dataset.iid);const ms=(i?.milestones||[]).find(x=>x.id===el.dataset.mid);if(!ms)return;
    S.modal={type:'edit-milestone',cid:el.dataset.cid,iid:el.dataset.iid,mid:ms.id,msName:ms.name,msDue:ms.dueDate||'',msStatus:ms.status,msOwner:ms.owner||'',msNotes:ms.notes||''};render();setTimeout(()=>document.getElementById('ms-name')?.focus(),50);return;
  }
  if(act==='delete-milestone'){
    if(!can('admin'))return;
    const c=S.clients.find(x=>x.id===el.dataset.cid);const i=c?.integrations.find(x=>x.id===el.dataset.iid);const ms=(i?.milestones||[]).find(x=>x.id===el.dataset.mid);if(!ms)return;
    S.modal={type:'confirm',msg:`Delete milestone "${ms.name}"? Cannot be undone.`,_act:'delete-milestone',_cid:el.dataset.cid,_iid:el.dataset.iid,_mid:ms.id};render();return;
  }
  // ── Excel export handlers ──
  if(act==='exp-excel'){setBtnBusy(el,'Exporting…');try{exportExcel(el.dataset.etype,el.dataset.cid);}finally{clearBtnBusy(el);}return;}
  // ── Bulk CSV import handlers ──
  if(act==='open-import-ams'){
    S.modal={type:'import-ams-entries',cid:el.dataset.cid};render();return;
  }
  if(act==='open-import-integ'){
    S.modal={type:'import-integrations',cid:el.dataset.cid};render();return;
  }
  if(act==='download-ams-template'){
    const csv='date_raised,due_date,raised_by,module,project,description,type,query_level,entry_status,mode_of_support,hours\n2026-07-15,,Yashwanth K,Payroll,HDFC Bank,Issue with payroll run,Bug Fix,L2 - Medium,Open,Online / Remote,2.5\n';
    const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);a.download='ams_entries_template.csv';document.body.appendChild(a);a.click();document.body.removeChild(a);return;
  }
  if(act==='download-integ-template'){
    const csv='name,status,assignee,due_date,description,next_action\nSAP Payroll Sync,In Progress,Yashwanth K,2026-08-15,SAP to Darwinbox payroll integration,Finish API mapping\n';
    const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);a.download='integrations_template.csv';document.body.appendChild(a);a.click();document.body.removeChild(a);return;
  }
  if(act==='preview-ams-csv'){
    const csv=document.getElementById('bulk-csv')?.value||'';
    if(!csv.trim()){showToast('Paste CSV first','error');return;}
    const rows=parseAmsEntriesCsv(csv);
    S.modal={...S.modal,csvRows:rows,csvText:csv};render();return;
  }
  if(act==='preview-integ-csv'){
    const csv=document.getElementById('bulk-csv')?.value||'';
    if(!csv.trim()){showToast('Paste CSV first','error');return;}
    const c=S.clients.find(x=>x.id===S.modal?.cid);
    const rows=parseIntegrationsCsv(csv,c?.integrations||[]);
    S.modal={...S.modal,csvRows:rows,csvText:csv};render();return;
  }
  // ── Portfolio export ──
  if(act==='portfolio-export'){
    S.modal={type:'portfolio-export'};render();return;
  }
  if(act==='clear-attach'){
    const prefix=el.dataset.prefix;const tid=el.dataset.tid||'';
    const uid_=tid?`${prefix}-url-${tid}`:`${prefix}-attach-url`;
    const mid_=tid?`${prefix}-mimetype-${tid}`:`${prefix}-attach-mimetype`;
    const nid_=tid?`${prefix}-filename-${tid}`:`${prefix}-attach-filename`;
    const pid_=tid?`eat-preview-${tid}`:`ip-attach-preview`;
    const urlEl=document.getElementById(uid_);const mEl=document.getElementById(mid_);const nEl=document.getElementById(nid_);const pEl=document.getElementById(pid_);
    if(urlEl)urlEl.value='';if(mEl)mEl.value='';if(nEl)nEl.value='';
    if(pEl){pEl.classList.add('hidden');}
    return;
  }
  if(act==='download-user-template'){
    const csv='username,full_name,role,email,password\npriya.s,Priya S,editor,priya@kognoz.in,Kognoz@123\nrahul.m,Rahul M,editor,rahul@kognoz.in,Kognoz@123\n';
    const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);a.download='integtrack_users_template.csv';document.body.appendChild(a);a.click();document.body.removeChild(a);
    return;
  }
  if(act==='preview-users-csv'){
    const csv=document.getElementById('bulk-csv')?.value||'';
    if(!csv.trim()){showToast('Paste CSV content first','error');return;}
    const rows=parseUsersCsv(csv);
    if(!rows.length){showToast('No rows found in CSV','error');return;}
    S.modal={...S.modal,csvRows:rows,csvText:csv};render();
    return;
  }
  if(act==='toggle-bulk-impl'){
    if(!can('admin'))return;
    const cid=el.dataset.cid;
    if(S.bulkImplMode&&S.bulkImplCid===cid){
      S.bulkImplMode=false;S.bulkImplCid=null;S.bulkSelected=new Set();
    }else{
      S.bulkImplMode=true;S.bulkImplCid=cid;S.bulkSelected=new Set();
    }
    render();return;
  }
  if(act==='toggle-bulk-phase'){
    if(!can('admin'))return;
    const key=`${el.dataset.mid}:${el.dataset.phase}`;
    if(S.bulkSelected.has(key))S.bulkSelected.delete(key);else S.bulkSelected.add(key);
    render();return;
  }
  if(act==='bulk-mark-complete'){
    if(!can('admin'))return;
    const cid=el.dataset.cid;
    const c=S.clients.find(x=>x.id===cid);if(!c||!S.bulkSelected.size)return;
    const now=new Date();const dateStr=todayStr();const isoStr=now.toISOString();
    const byUser=S.user.name;
    const changed=[];
    S.bulkSelected.forEach(key=>{
      const [mid,phaseName]=key.split(/:(.+)/);
      const mod=(c.modules||[]).find(x=>x.id===mid);if(!mod)return;
      const idx=mod.phases.findIndex(x=>x.name===phaseName);
      const ph=idx>=0?mod.phases[idx]:{name:phaseName,status:'Not Started',startDate:'',targetDate:'',updates:[]};
      if(!ph.updates)ph.updates=[];
      ph.status='Completed';
      ph.updates.unshift({id:uid(),date:dateStr,update:`Marked complete via bulk action by ${byUser}.`,addedBy:byUser,addedAt:isoStr});
      if(idx>=0)mod.phases[idx]=ph;else mod.phases.push(ph);
      changed.push(`${phaseName} (${mod.name})`);
    });
    setBtnBusy(el,`Saving…`);
    try{
      await saveClients(`Bulk complete: ${changed.length} phases — ${c.name}`);
      S.bulkImplMode=false;S.bulkImplCid=null;S.bulkSelected=new Set();
      showToast(`${changed.length} phase${changed.length===1?'':'s'} marked complete ✓`);
      navigate('impl-client-detail',{clientId:cid});
    }catch(err){
      showToast('Save failed: '+err.message,'error');clearBtnBusy(el);
    }
    return;
  }
  if(act==='delete-impl-module'){
    if(!can('admin'))return;
    const c=S.clients.find(x=>x.id===el.dataset.cid);const m=(c?.modules||[]).find(x=>x.id===el.dataset.mid);if(!m)return;
    S.modal={type:'confirm',msg:`Delete module "${m.name}" and all its phase data? This cannot be undone.`,_act:'delete-impl-module',_cid:c.id,_mid:m.id};render();return;
  }
  if(act==='delete-timeline-entry'){
    if(!can('admin'))return;
    const c=S.clients.find(x=>x.id===el.dataset.cid);const i=c?.integrations.find(x=>x.id===el.dataset.iid);if(!i)return;
    S.modal={type:'confirm',msg:`Delete this update? This cannot be undone.`,_act:'delete-timeline-entry',_cid:c.id,_iid:i.id,_tid:el.dataset.tid};render();return;
  }
  if(act==='delete-impl-update'){
    if(!can('admin'))return;
    const c=S.clients.find(x=>x.id===el.dataset.cid);const mod=(c?.modules||[]).find(x=>x.id===el.dataset.mid);if(!mod)return;
    const ph=mod.phases?.find(x=>x.name===el.dataset.phase);if(!ph)return;
    S.modal={type:'confirm',msg:`Delete this update? This cannot be undone.`,_act:'delete-impl-update',_cid:c.id,_mid:mod.id,_phase:el.dataset.phase,_tid:el.dataset.tid};render();return;
  }
  if(act==='delete-ams-entry'){
    if(!can('admin'))return;
    const c=S.clients.find(x=>x.id===el.dataset.cid);const e=c?.workLog?.find(x=>x.id===el.dataset.eid);if(!e)return;
    S.modal={type:'confirm',msg:`Delete this entry (${fmtDate(entryDate(e))})? This cannot be undone.`,_act:'delete-ams-entry',_cid:c.id,_eid:e.id};render();return;
  }
  if(act==='edit-ams-entry'){
    if(!can('edit'))return;
    const c=S.clients.find(x=>x.id===el.dataset.cid);const e=c?.workLog?.find(x=>x.id===el.dataset.eid);if(!e)return;
    S.modal={type:'edit-ams-entry',cid:el.dataset.cid,eid:el.dataset.eid,
      dateRaised:entryDate(e),raisedBy:entryRaisedBy(e),module:e.module||'',project:e.project||'',
      description:e.description||'',etype:entryType(e),queryLevel:e.queryLevel||AMS_QUERY_LEVELS[0],
      dependencies:e.dependencies||'',entryStatus:e.entryStatus||'Open',solution:e.solution||'',
      modeOfSupport:e.modeOfSupport||AMS_MODES[0],hours:e.hours||'',
      dueDate:e.dueDate||'',ragStatus:e.ragStatus||''};
    render();setTimeout(()=>document.getElementById('ae-date')?.focus(),50);return;
  }
  if(act==='exp-ams-activity'){if(!can('admin'))return;setBtnBusy(el,'Generating…');try{exportAmsActivityPdf(el.dataset.cid);}finally{clearBtnBusy(el);}return;}
  if(act==='delete-client'){
    if(!can('admin'))return;const c=S.clients.find(x=>x.id===el.dataset.id);if(!c)return;
    const other=c.modules!==undefined||c.workLog!==undefined;
    S.modal={type:'confirm',msg:other?`Remove "${c.name}" from Integrations (their ${c.integrations.length} integrations)? They'll stay in other sections. Cannot be undone.`:`Delete "${c.name}" entirely, including all ${c.integrations.length} integrations? Cannot be undone.`,_act:'delete-client',_id:c.id};render();return;
  }
  if(act==='delete-impl-client'){
    if(!can('admin'))return;const c=S.clients.find(x=>x.id===el.dataset.id);if(!c)return;
    const other=c.integrations.length>0||c.workLog!==undefined;
    S.modal={type:'confirm',msg:other?`Remove "${c.name}" from Implementations (their ${(c.modules||[]).length} modules)? They'll stay in other sections. Cannot be undone.`:`Delete "${c.name}" entirely, including all ${(c.modules||[]).length} modules? Cannot be undone.`,_act:'delete-impl-client',_id:c.id};render();return;
  }
  if(act==='delete-integ'){
    if(!can('admin'))return;const c=S.clients.find(x=>x.id===el.dataset.cid);const i=c?.integrations.find(x=>x.id===el.dataset.iid);if(!i)return;
    S.modal={type:'confirm',msg:`Delete "${i.name}"? Cannot be undone.`,_act:'delete-integ',_cid:c.id,_iid:i.id};render();return;
  }
  if(act==='delete-ams-client'){
    if(!can('admin'))return;const c=S.clients.find(x=>x.id===el.dataset.id);if(!c)return;
    const other=c.integrations.length>0||c.modules!==undefined;
    S.modal={type:'confirm',msg:other?`Remove "${c.name}" from AMS (all logged hours)? They'll stay in other sections. Cannot be undone.`:`Delete "${c.name}" entirely, including all logged hours? Cannot be undone.`,_act:'delete-ams-client',_id:c.id};render();return;
  }
  if(act==='edit-ams-client'){
    if(!can('admin'))return;const c=S.clients.find(x=>x.id===el.dataset.id);if(!c)return;
    S.modal={type:'edit-ams-client',cid:c.id,description:c.description,manDayRate:c.manDayRate,totalAvailableHours:c.totalAvailableHours,currency:c.currency||'INR'};render();return;
  }
  if(act==='exec-undo'){execUndo();return;}
  if(act==='ams-quick'){
    const range=el.dataset.range;S.amsQuick=range;
    const now=new Date();const y=now.getFullYear(),m=now.getMonth();
    if(range==='this-month'){S.amsFrom=`${y}-${String(m+1).padStart(2,'0')}-01`;S.amsTo=todayStr();}
    else if(range==='last-month'){const lmStart=new Date(y,m-1,1);const lmEnd=new Date(y,m,0);S.amsFrom=lmStart.toISOString().slice(0,10);S.amsTo=lmEnd.toISOString().slice(0,10);}
    else if(range==='this-quarter'){const q=Math.floor(m/3);S.amsFrom=`${y}-${String(q*3+1).padStart(2,'0')}-01`;S.amsTo=todayStr();}
    else if(range==='all-time'){S.amsFrom='';S.amsTo='';S.amsQuick='';}
    render();return;
  }
  if(act==='open-profile'){
    S.modal={type:'my-profile'};render();setTimeout(()=>document.getElementById('pr-curr')?.focus(),50);return;
  }
  if(act==='send-welcome-all'){
    if(!can('admin'))return;
    const targets=S.users.filter(u=>u.id!==S.user?.id).map(u=>({id:u.id,name:u.name,username:u.username,email:u.email||''}));
    if(!targets.length){showToast('No other users to send to','warn');return;}
    S.modal={type:'send-welcome',targets};render();setTimeout(()=>document.getElementById('sw-pass')?.focus(),50);return;
  }
  if(act==='send-welcome-one'){
    if(!can('admin'))return;
    const u=S.users.find(x=>x.id===el.dataset.uid);if(!u)return;
    S.modal={type:'send-welcome',targets:[{id:u.id,name:u.name,username:u.username,email:u.email||''}]};render();setTimeout(()=>document.getElementById('sw-pass')?.focus(),50);return;
  }
  if(act==='edit-user'){
    if(!can('admin'))return;
    const u=S.users.find(x=>x.id===el.dataset.uid);if(!u)return;
    S.modal={type:'edit-user',uid:u.id,username:u.username,uname:u.name,email:u.email||''};
    render();setTimeout(()=>document.getElementById('eu-name')?.focus(),50);return;
  }
  if(act==='delete-user'){
    if(!can('admin'))return;const u=S.users.find(x=>x.id===el.dataset.uid);if(!u||u.id===S.user?.id)return;
    S.modal={type:'confirm',msg:`Delete user "${u.name}" (${u.username})?`,_act:'delete-user',_uid:u.id};render();return;
  }
  if(act==='modal-confirm'){
    const m=S.modal;if(!m||m.busy)return;
    if(m.type==='confirm'){
      S.modal={...m,busy:true};render();
      if(m._act==='delete-client'){
        const idx=S.clients.findIndex(x=>x.id===m._id);if(idx<0){S.modal=null;render();return;}
        const c=S.clients[idx];const other=c.modules!==undefined||c.workLog!==undefined;
        const snapshot=JSON.parse(JSON.stringify(c));
        if(other){c.integrations=[];}else{S.clients.splice(idx,1);}
        try{await saveClients(`Remove Integration data: ${snapshot.name}`);S.modal=null;showToast(`${snapshot.name} removed from Integrations`);render();}
        catch(err){if(other){c.integrations=snapshot.integrations;}else{S.clients.splice(idx,0,snapshot);}S.modal=null;showToast('Failed: '+err.message,'error');render();}
      }
      else if(m._act==='delete-integ'){
        const c=S.clients.find(x=>x.id===m._cid);if(!c){S.modal=null;render();return;}
        const idx=c.integrations.findIndex(x=>x.id===m._iid);if(idx<0){S.modal=null;render();return;}
        const[rem]=c.integrations.splice(idx,1);
        S.modal=null;navigate('client-detail',{clientId:m._cid});
        scheduleUndo(`"${rem.name}" deleted`,async()=>{c.integrations.splice(idx,0,rem);await saveClients(`Restore ${rem.name}`);navigate('client-detail',{clientId:m._cid});});
        try{await saveClients(`Delete ${rem.name}`);}
        catch(err){c.integrations.splice(idx,0,rem);showToast('Failed: '+err.message,'error');render();}
      }
      else if(m._act==='delete-user'){
        const idx=S.users.findIndex(x=>x.id===m._uid);if(idx<0){S.modal=null;render();return;}
        const[rem]=S.users.splice(idx,1);
        S.modal=null;render();
        scheduleUndo(`${rem.name} removed`,async()=>{S.users.splice(idx,0,rem);await saveUsers(`Restore ${rem.username}`);render();});
        try{await saveUsers(`Delete ${rem.username}`);}
        catch(err){S.users.splice(idx,0,rem);showToast('Failed: '+err.message,'error');render();}
      }
      else if(m._act==='delete-impl-client'){
        const idx=S.clients.findIndex(x=>x.id===m._id);if(idx<0){S.modal=null;render();return;}
        const c=S.clients[idx];const other=c.integrations.length>0||c.workLog!==undefined;
        const snapshot=JSON.parse(JSON.stringify(c));
        if(other){delete c.modules;}else{S.clients.splice(idx,1);}
        try{await saveClients(`Remove Implementation data: ${snapshot.name}`);S.modal=null;showToast(`${snapshot.name} removed from Implementations`);render();}
        catch(err){if(other){c.modules=snapshot.modules;}else{S.clients.splice(idx,0,snapshot);}S.modal=null;showToast('Failed: '+err.message,'error');render();}
      }
      else if(m._act==='delete-ams-client'){
        const idx=S.clients.findIndex(x=>x.id===m._id);if(idx<0){S.modal=null;render();return;}
        const c=S.clients[idx];const other=c.integrations.length>0||c.modules!==undefined;
        const snapshot=JSON.parse(JSON.stringify(c));
        if(other){delete c.manDayRate;delete c.workLog;}else{S.clients.splice(idx,1);}
        try{await saveClients(`Remove AMS data: ${snapshot.name}`);S.modal=null;showToast(`${snapshot.name} removed from AMS`);navigate('ams-clients');}
        catch(err){if(other){c.manDayRate=snapshot.manDayRate;c.workLog=snapshot.workLog;}else{S.clients.splice(idx,0,snapshot);}S.modal=null;showToast('Failed: '+err.message,'error');render();}
      }
      else if(m._act==='delete-impl-module'){
        const c=S.clients.find(x=>x.id===m._cid);if(!c){S.modal=null;render();return;}
        const idx=(c.modules||[]).findIndex(x=>x.id===m._mid);if(idx<0){S.modal=null;render();return;}
        const[rem]=c.modules.splice(idx,1);
        S.modal=null;navigate('impl-client-detail',{clientId:m._cid});
        scheduleUndo(`Module "${rem.name}" deleted`,async()=>{c.modules.splice(idx,0,rem);await saveClients(`Restore ${rem.name}`);navigate('impl-client-detail',{clientId:m._cid});});
        try{await saveClients(`Delete module: ${rem.name}`);}
        catch(err){c.modules.splice(idx,0,rem);showToast('Failed: '+err.message,'error');navigate('impl-client-detail',{clientId:m._cid});}
      }
      else if(m._act==='delete-timeline-entry'){
        const c=S.clients.find(x=>x.id===m._cid);const i=c?.integrations.find(x=>x.id===m._iid);if(!i){S.modal=null;render();return;}
        const idx=i.timeline.findIndex(x=>x.id===m._tid);if(idx<0){S.modal=null;render();return;}
        const[rem]=i.timeline.splice(idx,1);
        try{await saveClients(`Delete update: ${i.name}`);S.modal=null;showToast('Update deleted');navigate('integ-detail',{clientId:m._cid,integId:m._iid});}
        catch(err){i.timeline.splice(idx,0,rem);S.modal=null;showToast('Failed: '+err.message,'error');render();}
      }
      else if(m._act==='delete-impl-update'){
        const c=S.clients.find(x=>x.id===m._cid);const mod=(c?.modules||[]).find(x=>x.id===m._mid);if(!mod){S.modal=null;render();return;}
        const ph=mod.phases?.find(x=>x.name===m._phase);if(!ph||!ph.updates){S.modal=null;render();return;}
        const idx=ph.updates.findIndex(x=>x.id===m._tid);if(idx<0){S.modal=null;render();return;}
        const[rem]=ph.updates.splice(idx,1);
        try{await saveClients(`Delete update: ${m._phase}`);S.modal=null;showToast('Update deleted');navigate('impl-phase-detail',{clientId:m._cid,moduleId:m._mid,phase:m._phase});}
        catch(err){ph.updates.splice(idx,0,rem);S.modal=null;showToast('Failed: '+err.message,'error');render();}
      }
      else if(m._act==='delete-ams-entry'){
        const c=S.clients.find(x=>x.id===m._cid);if(!c||!c.workLog){S.modal=null;render();return;}
        const idx=c.workLog.findIndex(x=>x.id===m._eid);if(idx<0){S.modal=null;render();return;}
        const[rem]=c.workLog.splice(idx,1);
        try{await saveClients(`Delete entry: ${c.name}`);S.modal=null;showToast('Entry deleted');navigate('ams-client-detail',{clientId:m._cid});}
        catch(err){c.workLog.splice(idx,0,rem);S.modal=null;showToast('Failed: '+err.message,'error');render();}
      }
      else if(m._act==='delete-milestone'){
        const c=S.clients.find(x=>x.id===m._cid);const i=c?.integrations.find(x=>x.id===m._iid);if(!i){S.modal=null;render();return;}
        const idx=(i.milestones||[]).findIndex(x=>x.id===m._mid);if(idx<0){S.modal=null;render();return;}
        const[rem]=(i.milestones||[]).splice(idx,1);
        try{await saveClients(`Delete milestone: ${rem.name}`);S.modal=null;showToast('Milestone deleted');navigate('integ-detail',{clientId:m._cid,integId:m._iid});}
        catch(err){i.milestones.splice(idx,0,rem);S.modal=null;showToast('Failed: '+err.message,'error');render();}
      }
    } else if(m.type==='add-milestone'||m.type==='edit-milestone'){
      const name=document.getElementById('ms-name')?.value.trim();
      if(!name){showToast('Milestone name required','error');return;}
      const c=S.clients.find(x=>x.id===m.cid);const i=c?.integrations.find(x=>x.id===m.iid);if(!i)return;
      if(!i.milestones)i.milestones=[];
      const msObj={id:m.mid||uid(),name,dueDate:document.getElementById('ms-due')?.value||'',status:document.getElementById('ms-status')?.value||'Pending',owner:document.getElementById('ms-owner')?.value||'',notes:document.getElementById('ms-notes')?.value.trim()||''};
      if(m.type==='edit-milestone'){
        const idx=i.milestones.findIndex(x=>x.id===m.mid);if(idx>=0)i.milestones[idx]=msObj;
      }else{i.milestones.push(msObj);}
      S.modal={...m,busy:true};render();
      try{await saveClients(`${m.type==='edit-milestone'?'Edit':'Add'} milestone: ${name}`);S.modal=null;showToast(`Milestone ${m.type==='edit-milestone'?'updated':'added'} ✓`);navigate('integ-detail',{clientId:m.cid,integId:m.iid});}
      catch(err){if(m.type==='add-milestone')i.milestones.pop();S.modal=null;showToast('Failed: '+err.message,'error');render();}
    } else if(m.type==='import-ams-entries'){
      const valid=(m.csvRows||[]).filter(r=>!r.error);
      if(!valid.length){showToast('No valid rows to import','error');return;}
      const c=S.clients.find(x=>x.id===m.cid);if(!c)return;
      if(!c.workLog)c.workLog=[];
      const prev=JSON.parse(JSON.stringify(c.workLog));
      const newEntries=valid.map(r=>({id:uid(),...r,loggedAt:new Date().toISOString()}));
      c.workLog.push(...newEntries);S.modal={...m,busy:true};render();
      try{await saveClients(`Import ${newEntries.length} AMS entries: ${c.name}`);S.modal=null;showToast(`${newEntries.length} entr${newEntries.length===1?'y':'ies'} imported ✓`);navigate('ams-client-detail',{clientId:m.cid});}
      catch(err){c.workLog=prev;S.modal=null;showToast('Import failed: '+err.message,'error');render();}
    } else if(m.type==='import-integrations'){
      const valid=(m.csvRows||[]).filter(r=>!r.error);
      if(!valid.length){showToast('No valid rows to import','error');return;}
      const c=S.clients.find(x=>x.id===m.cid);if(!c)return;
      const prev=JSON.parse(JSON.stringify(c.integrations));
      const newIntegs=valid.map(r=>({id:uid(),name:r.name,status:r.status,assignee:r.assignee,dueDate:r.dueDate,description:r.description,nextAction:r.nextAction,timeline:[],createdAt:new Date().toISOString()}));
      c.integrations.push(...newIntegs);S.modal={...m,busy:true};render();
      try{await saveClients(`Import ${newIntegs.length} integrations: ${c.name}`);S.modal=null;showToast(`${newIntegs.length} integration${newIntegs.length===1?'':'s'} imported ✓`);navigate('client-detail',{clientId:m.cid});}
      catch(err){c.integrations=prev;S.modal=null;showToast('Import failed: '+err.message,'error');render();}
    } else if(m.type==='portfolio-export'){
      const selected=[...document.querySelectorAll('[data-act="portfolio-client-toggle"]:checked')].map(el=>el.dataset.cid);
      const sections=[...document.querySelectorAll('[data-act="portfolio-section-toggle"]:checked')].map(el=>el.dataset.section);
      if(!selected.length){showToast('Select at least one client','error');return;}
      if(!sections.length){showToast('Select at least one section','error');return;}
      S.modal=null;render();
      exportConsolidatedPdf(selected,sections);
    } else if(m.type==='add-client'){
      const name=document.getElementById('m1')?.value.trim(),desc=document.getElementById('m2')?.value.trim();
      if(!name){showToast('Name required','error');return;}
      if(S.clients.find(x=>x.name.toLowerCase()===name.toLowerCase())){showToast(`"${name}" already exists as a client`,'error');return;}
      const nc={id:uid(),name,description:desc||'',createdAt:new Date().toISOString(),integrations:[]};
      S.clients.push(nc);S.modal={...m,busy:true};render();
      try{await saveClients(`Add ${name}`);S.modal=null;showToast(`${name} added`);render();}
      catch(err){S.clients.pop();S.modal=null;showToast('Failed: '+err.message,'error');render();}
    } else if(m.type==='add-integ'){
      const cid=document.getElementById('m0')?.value,name=document.getElementById('m1')?.value.trim();
      if(!name){showToast('Name required','error');return;}
      const c=S.clients.find(x=>x.id===cid);if(!c)return;
      const ni={id:uid(),name,status:document.getElementById('m2')?.value||'Not Started',assignee:document.getElementById('m3')?.value.trim()||'',dueDate:document.getElementById('m4')?.value||'',description:document.getElementById('m5')?.value.trim()||'',nextAction:'',timeline:[]};
      c.integrations.push(ni);S.modal={...m,busy:true};render();
      try{await saveClients(`Add ${name} to ${c.name}`);S.modal=null;showToast(`${name} added`);render();}
      catch(err){c.integrations.pop();S.modal=null;showToast('Failed: '+err.message,'error');render();}
    } else if(m.type==='my-profile'){
      const currPass=document.getElementById('pr-curr')?.value;
      const newPass=document.getElementById('pr-new')?.value;
      const confPass=document.getElementById('pr-conf')?.value;
      const newEmail=document.getElementById('pr-email')?.value.trim()||'';
      if(!currPass){showToast('Current password is required','error');return;}
      const currHash=await sha256(currPass);
      const me=S.users.find(x=>x.id===S.user?.id);
      if(!me||me.passwordHash!==currHash){showToast('Current password is incorrect','error');return;}
      if(newPass&&newPass!==confPass){showToast('New passwords do not match','error');return;}
      const snapshot={email:me.email,passwordHash:me.passwordHash};
      me.email=newEmail;
      if(newPass)me.passwordHash=await sha256(newPass);
      S.modal={...m,busy:true};render();
      try{
        await saveUsers('Update profile');
        S.user.email=newEmail;persistSession(S.sessionToken,S.user);
        S.usersForDropdown=S.users.map(u=>({id:u.id,name:u.name||u.username,role:u.role,username:u.username}));
        S.modal=null;showToast(newPass?'Password changed ✓':'Profile updated ✓');render();
      }catch(err){me.email=snapshot.email;me.passwordHash=snapshot.passwordHash;S.modal=null;showToast('Failed: '+err.message,'error');render();}
    } else if(m.type==='send-welcome'){
      if(!can('admin'))return;
      const appUrl=document.getElementById('sw-url')?.value.trim();
      const pass=document.getElementById('sw-pass')?.value.trim();
      if(!appUrl||!pass){showToast('App URL and password are required','error');return;}
      const targets=(m.targets||[]).filter(u=>u.email);
      if(!targets.length){showToast('No recipients have an email address set','error');return;}
      S.modal={...m,busy:true};render();
      // Hash and update passwords for all recipients
      const passHash=await sha256(pass);
      targets.forEach(t=>{const u=S.users.find(x=>x.id===t.id);if(u)u.passwordHash=passHash;});
      try{await saveUsers('Set passwords for welcome email');}catch(e){targets.forEach(t=>{const u=S.users.find(x=>x.id===t.id);if(u)u.passwordHash='';});S.modal=null;showToast('Failed to update passwords','error');render();return;}
      // Send emails
      let sent=0,failed=0;
      await Promise.all(targets.map(async t=>{
        try{
          const r=await fetch('/api/send-email',{method:'POST',headers:{'Content-Type':'application/json','x-session-token':S.sessionToken||''},body:JSON.stringify({to:t.email,name:t.name,username:t.username,password:pass,appUrl})});
          if(r.ok)sent++;else failed++;
        }catch(e){failed++;}
      }));
      S.modal=null;
      showToast(failed?`${sent} sent, ${failed} failed — check Resend dashboard`:`Welcome emails sent to ${sent} user${sent===1?'':'s'} ✓`);
      render();
    } else if(m.type==='edit-user'){
      if(!can('admin'))return;
      const u=S.users.find(x=>x.id===m.uid);if(!u)return;
      const newName=document.getElementById('eu-name')?.value.trim();
      const newEmail=document.getElementById('eu-email')?.value.trim()||'';
      const newPass=document.getElementById('eu-pass')?.value;
      if(!newName){showToast('Full name is required','error');return;}
      const snapshot={name:u.name,email:u.email,passwordHash:u.passwordHash};
      u.name=newName;u.email=newEmail;
      S.modal={...m,busy:true};render();
      if(newPass){u.passwordHash=await sha256(newPass);}
      try{
        await saveUsers(`Edit user: ${u.username}`);
        // refresh dropdown with updated name
        S.usersForDropdown=S.users.map(x=>({id:x.id,name:x.name||x.username,role:x.role,username:x.username}));
        // if editing self, update session
        if(u.id===S.user?.id){S.user.name=newName;persistSession(S.sessionToken,S.user);}
        S.modal=null;showToast(`${newName} updated ✓`);render();
      }catch(err){u.name=snapshot.name;u.email=snapshot.email;u.passwordHash=snapshot.passwordHash;S.modal=null;showToast('Failed: '+err.message,'error');render();}
    } else if(m.type==='add-user'){
      const username=document.getElementById('m1')?.value.trim(),name=document.getElementById('m2')?.value.trim(),password=document.getElementById('m3')?.value,role=document.getElementById('m4')?.value,email=document.getElementById('m5')?.value.trim()||'';
      if(!username||!name||!password){showToast('Username, name and password are required','error');return;}
      if(S.users.find(x=>x.username===username)){showToast('Username taken','error');return;}
      S.modal={...m,busy:true};render();
      const hash=await sha256(password);
      const nu={id:uid(),username,name,email,passwordHash:hash,role};S.users.push(nu);
      try{await saveUsers(`Add ${username}`);S.usersForDropdown=S.users.map(u=>({id:u.id,name:u.name||u.username,role:u.role,username:u.username}));S.modal=null;showToast(`${name} added`);render();}
      catch(err){S.users.pop();S.modal=null;showToast('Failed: '+err.message,'error');render();}
    } else if(m.type==='bulk-import-users'){
      const valid=(m.csvRows||[]).filter(r=>!r.error);
      if(!valid.length){showToast('No valid rows to import','error');return;}
      S.modal={...m,busy:true};render();
      const newUsers=await Promise.all(valid.map(async r=>({id:uid(),username:r.username,name:r.name,email:r.email||'',passwordHash:await sha256(r.password),role:r.role})));
      const prev=JSON.parse(JSON.stringify(S.users));
      S.users=[...S.users,...newUsers];
      try{await saveUsers(`Bulk import ${newUsers.length} users`);S.usersForDropdown=S.users.map(u=>({id:u.id,name:u.name||u.username,role:u.role,username:u.username}));S.modal=null;showToast(`${newUsers.length} user${newUsers.length!==1?'s':''} imported ✓`);render();}
      catch(err){S.users=prev;S.modal=null;showToast('Import failed: '+err.message,'error');render();}
    } else if(m.type==='add-impl-client'){
      const existingId=document.getElementById('m0')?.value;
      if(existingId){
        const c=S.clients.find(x=>x.id===existingId);if(!c)return;
        c.modules=[];S.modal={...m,busy:true};render();
        try{await saveClients(`Enable Implementation tracking: ${c.name}`);S.modal=null;showToast(`${c.name} added to Implementations`);render();}
        catch(err){delete c.modules;S.modal=null;showToast('Failed: '+err.message,'error');render();}
      }else{
        const name=document.getElementById('m1')?.value.trim();
        if(!name){showToast('Pick a client above or enter a new name','error');return;}
        if(S.clients.find(x=>x.name.toLowerCase()===name.toLowerCase())){showToast(`"${name}" already exists — select it above instead`,'error');return;}
        const desc=document.getElementById('m2')?.value.trim();
        const nc={id:uid(),name,description:desc||'',createdAt:new Date().toISOString(),integrations:[],modules:[]};
        S.clients.push(nc);S.modal={...m,busy:true};render();
        try{await saveClients(`Add ${name}`);S.modal=null;showToast(`${name} added`);render();}
        catch(err){S.clients.pop();S.modal=null;showToast('Failed: '+err.message,'error');render();}
      }
    } else if(m.type==='add-impl-module'){
      const name=document.getElementById('m1')?.value.trim();
      if(!name){showToast('Name required','error');return;}
      const c=S.clients.find(x=>x.id===m.cid);if(!c)return;
      const nm={id:uid(),name,phases:PHASES.map(ph=>({name:ph,status:'Not Started',startDate:'',targetDate:'',updates:[]}))};
      if(!c.modules)c.modules=[];c.modules.push(nm);S.modal={...m,busy:true};render();
      try{await saveClients(`Add module ${name}`);S.modal=null;showToast(`${name} added`);navigate('impl-client-detail',{clientId:c.id});}
      catch(err){c.modules.pop();S.modal=null;showToast('Failed: '+err.message,'error');render();}
    } else if(m.type==='add-ams-client'){
      const existingId=document.getElementById('m0')?.value;
      const rateRaw=document.getElementById('m3')?.value;
      const rate=rateRaw?parseFloat(rateRaw):undefined;
      const availRaw=document.getElementById('m4')?.value;
      const avail=availRaw?parseFloat(availRaw):undefined;
      const currency=document.getElementById('m5')?.value||'INR';
      if(existingId){
        const c=S.clients.find(x=>x.id===existingId);if(!c)return;
        if(rate)c.manDayRate=rate;c.workLog=c.workLog||[];c.currency=currency;if(avail!==undefined)c.totalAvailableHours=avail;
        S.modal={...m,busy:true};render();
        try{await saveClients(`Enable AMS: ${c.name}`);S.modal=null;showToast(`${c.name} added to AMS`);render();}
        catch(err){delete c.manDayRate;delete c.totalAvailableHours;S.modal=null;showToast('Failed: '+err.message,'error');render();}
      }else{
        const name=document.getElementById('m1')?.value.trim();
        if(!name){showToast('Pick a client above or enter a new name','error');return;}
        if(S.clients.find(x=>x.name.toLowerCase()===name.toLowerCase())){showToast(`"${name}" already exists — select it above instead`,'error');return;}
        const desc=document.getElementById('m2')?.value.trim();
        const nc={id:uid(),name,description:desc||'',createdAt:new Date().toISOString(),integrations:[],workLog:[],currency};
        if(rate)nc.manDayRate=rate;if(avail!==undefined)nc.totalAvailableHours=avail;
        S.clients.push(nc);S.modal={...m,busy:true};render();
        try{await saveClients(`Add ${name}`);S.modal=null;showToast(`${name} added`);render();}
        catch(err){S.clients.pop();S.modal=null;showToast('Failed: '+err.message,'error');render();}
      }
    } else if(m.type==='edit-ams-client'){
      const c=S.clients.find(x=>x.id===m.cid);if(!c)return;
      const rateRaw=document.getElementById('m2')?.value;
      const desc=document.getElementById('m1')?.value.trim();
      const availRaw=document.getElementById('m3')?.value;
      const currency=document.getElementById('m4')?.value||'INR';
      const snapshot={description:c.description,manDayRate:c.manDayRate,totalAvailableHours:c.totalAvailableHours,currency:c.currency};
      c.description=desc||'';c.currency=currency;
      if(rateRaw){c.manDayRate=parseFloat(rateRaw);}else{delete c.manDayRate;}
      if(availRaw){c.totalAvailableHours=parseFloat(availRaw);}else{delete c.totalAvailableHours;}
      S.modal={...m,busy:true};render();
      try{await saveClients(`Edit AMS client: ${c.name}`);S.modal=null;showToast('Saved ✓');navigate('ams-client-detail',{clientId:c.id});}
      catch(err){Object.assign(c,snapshot);if(snapshot.totalAvailableHours===undefined)delete c.totalAvailableHours;if(snapshot.manDayRate===undefined)delete c.manDayRate;S.modal=null;showToast('Failed: '+err.message,'error');render();}
    } else if(m.type==='add-ams-entry'||m.type==='edit-ams-entry'){
      if(!can('edit'))return;
      const cid=m.cid;const c=S.clients.find(x=>x.id===cid);if(!c)return;
      const dateRaised=document.getElementById('ae-date')?.value;
      const hours=parseFloat(document.getElementById('ae-hours')?.value);
      if(!dateRaised||!hours||hours<=0){showToast('Date and hours are required','error');return;}
      const fields={dateRaised,
        dueDate:document.getElementById('ae-due')?.value||'',
        raisedBy:document.getElementById('ae-raised')?.value||S.user.name,
        module:document.getElementById('ae-module')?.value?.trim()||'',
        project:document.getElementById('ae-project')?.value?.trim()||'',
        description:document.getElementById('ae-desc')?.value?.trim()||'',
        type:document.getElementById('ae-type')?.value,
        queryLevel:document.getElementById('ae-level')?.value,
        modeOfSupport:document.getElementById('ae-mode')?.value,
        entryStatus:document.getElementById('ae-status')?.value,
        ragStatus:document.getElementById('ae-rag')?.value||'',
        dependencies:document.getElementById('ae-deps')?.value?.trim()||'',
        solution:document.getElementById('ae-solution')?.value?.trim()||'',
        hours};
      if(!c.workLog)c.workLog=[];
      if(m.type==='add-ams-entry'){
        const entry={id:uid(),...fields,loggedAt:new Date().toISOString()};
        c.workLog.push(entry);S.modal={...m,busy:true};render();
        try{await saveClients(`Add entry: ${c.name}`);S.modal=null;showToast('Entry added ✓');navigate('ams-client-detail',{clientId:cid});}
        catch(err){c.workLog.pop();S.modal=null;showToast('Failed: '+err.message,'error');render();}
      }else{
        const idx=c.workLog.findIndex(x=>x.id===m.eid);if(idx<0)return;
        const original=c.workLog[idx];
        const snapshot=JSON.parse(JSON.stringify(original));
        const updated={...original,...fields,edits:[...(original.edits||[]),{description:original.description,hours:original.hours,dateRaised:entryDate(original),editedAt:new Date().toISOString(),editedBy:S.user.name}],lastEditedAt:new Date().toISOString(),lastEditedBy:S.user.name};
        c.workLog[idx]=updated;S.modal={...m,busy:true};render();
        try{await saveClients(`Edit entry: ${c.name}`);S.modal=null;showToast('Entry updated ✓');navigate('ams-client-detail',{clientId:cid});}
        catch(err){c.workLog[idx]=snapshot;S.modal=null;showToast('Failed: '+err.message,'error');render();}
      }
    }
  }
});

document.addEventListener('change',async e=>{
  const roleEl=e.target.closest('[data-act="change-role"]');
  if(roleEl&&can('admin')){
    const u=S.users.find(x=>x.id===roleEl.dataset.uid);if(!u||u.id===S.user?.id)return;
    const prev=u.role;u.role=roleEl.value;roleEl.disabled=true;
    try{await saveUsers(`Role: ${u.username}`);showToast(`${u.name} → ${u.role}`);roleEl.disabled=false;}
    catch(err){u.role=prev;showToast('Failed','error');render();}
    return;
  }
  const rangeEl=e.target.closest('[data-act="ams-range"]');
  if(rangeEl){
    S.amsFrom=document.getElementById('ams-from')?.value||'';
    S.amsTo=document.getElementById('ams-to')?.value||'';
    render();
  }
  // ── File attachment upload handler ────────────────────────────
  const fileEl=e.target;
  if(fileEl.type==='file'&&fileEl.accept&&fileEl.files?.length){
    const file=fileEl.files[0];if(!file)return;
    // Determine prefix and IDs based on input id
    const isAddForm=fileEl.id==='ip-attach-file';
    const tid=fileEl.dataset.tid||'';
    const urlId=isAddForm?'ip-attach-url':`eat-url-${tid}`;
    const mimeId=isAddForm?'ip-attach-mimetype':`eat-mimetype-${tid}`;
    const nameId=isAddForm?'ip-attach-filename':`eat-filename-${tid}`;
    const previewId=isAddForm?'ip-attach-preview':`eat-preview-${tid}`;
    const nameDisplayId=isAddForm?'ip-attach-name':`eat-name-${tid}`;
    const iconDisplayId=isAddForm?'ip-attach-icon':`eat-icon-${tid}`;
    const labelEl=document.getElementById(isAddForm?'ip-attach-label':`eat-label-${tid}`);
    // Show uploading state
    const preview=document.getElementById(previewId);
    const nameDisplay=document.getElementById(nameDisplayId);
    const iconDisplay=document.getElementById(iconDisplayId);
    if(preview){preview.classList.remove('hidden');if(nameDisplay)nameDisplay.textContent='Uploading…';}
    try{
      const result=await uploadAttachment(file);
      const urlEl=document.getElementById(urlId);const mEl=document.getElementById(mimeId);const nEl=document.getElementById(nameId);
      if(urlEl)urlEl.value=result.url;if(mEl)mEl.value=result.mimeType;if(nEl)nEl.value=result.fileName;
      if(nameDisplay)nameDisplay.textContent=result.fileName;
      if(iconDisplay)iconDisplay.textContent=fileIcon(result.url,result.mimeType);
      if(preview)preview.classList.remove('hidden');
      if(labelEl&&!labelEl.value)labelEl.value=result.fileName.replace(/\.[^.]+$/,'');
      showToast('File uploaded ✓');
    }catch(err){
      if(preview)preview.classList.add('hidden');
      fileEl.value='';
      showToast(err.message,'error');
    }
  }
});

let _st;
let _ct;
document.addEventListener('input',e=>{
  if(e.target.dataset?.act==='search'){
    clearTimeout(_st);const v=e.target.value;
    _st=setTimeout(()=>{S.search=v;render();setTimeout(()=>{const el=document.getElementById('search-inp');if(el){el.focus();try{el.setSelectionRange(v.length,v.length);}catch{}}},10);},120);
  }
  if(e.target.dataset?.act==='cmdp-input'){
    clearTimeout(_ct);const v=e.target.value;
    _ct=setTimeout(()=>{S.cmdQuery=v;render();setTimeout(()=>{const el=document.getElementById('cmdp-input');if(el){el.focus();try{el.setSelectionRange(v.length,v.length);}catch{}}},10);},100);
  }
});

document.addEventListener('keydown',e=>{
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'&&S.user){
    e.preventDefault();
    const saveBtn=document.querySelector('[data-act="save-integ"],[data-act="save-impl-phase"],[data-act="bulk-mark-complete"]');
    if(saveBtn)saveBtn.click();
    else showToast('Nothing to save on this page','info');
    return;
  }
  if(e.key==='Enter'&&S.view==='login')document.querySelector('[data-act="login"]')?.click();
  if(e.key==='Escape'&&S.modal&&!S.modal.busy){S.modal=null;render();return;}
  if(e.key==='Escape'&&S.cmdPaletteOpen){S.cmdPaletteOpen=false;render();return;}
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'&&S.user){e.preventDefault();S.cmdPaletteOpen=!S.cmdPaletteOpen;S.cmdQuery='';render();if(S.cmdPaletteOpen)setTimeout(()=>document.getElementById('cmdp-input')?.focus(),30);return;}
  if(S.cmdPaletteOpen&&e.key==='Enter'){const first=document.querySelector('[data-act="cmdp-go"][data-idx="0"]');first?.click();return;}
});

// ─── INIT ─────────────────────────────────────────────────────────
let _resizeTimer=null;
window.addEventListener('resize',()=>{clearTimeout(_resizeTimer);_resizeTimer=setTimeout(()=>{if(S.user)render();},150);});
(async function init(){
  const sess=restoreSession();
  if(sess&&sess.token&&sess.user){
    S.sessionToken=sess.token;S.user=sess.user;
    document.getElementById('app').innerHTML=renderAppSkeleton();
    try{
      const cl=await apiRead('data/clients.json');S.clients=cl.content;S.shas.clients=cl.sha;
      try{const ul=await apiRead('data/users.json');S.usersForDropdown=ul.content.map(u=>({id:u.id,name:u.name||u.username,role:u.role,username:u.username}));if(can('admin')){S.users=ul.content;S.shas.users=ul.sha;}}
      catch(e){S.usersForDropdown=[{id:S.user.id,name:S.user.name||S.user.username,role:S.user.role,username:S.user.username}];}
      navigate('dashboard');
    }catch(e){
      clearSession();S.user=null;S.sessionToken=null;render();
    }
  }else{render();}
})();
