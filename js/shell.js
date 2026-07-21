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
        <div class="k-side-username truncate">${esc(S.user?.name)}</div>
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
const RAG_BADGE={Red:'k-rag k-rag-red',Amber:'k-rag k-rag-amber',Green:'k-rag k-rag-green'};
const RAG_DOT={Red:'k-rag-red',Amber:'k-rag-amber',Green:'k-rag-green'};
function ragBadge(rag,size='sm'){if(!rag)return'<span class="text-xs" style="color:var(--mute-2)">—</span>';return`<span class="${RAG_BADGE[rag]||''}">${rag}</span>`;}

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
function sortGeneric(list,state,getters){
  const{key,dir}=state;const m=dir==='asc'?1:-1;
  const get=getters[key]||getters._default;
  return[...list].sort((a,b)=>{const av=get(a),bv=get(b);return av<bv?-1*m:av>bv?1*m:0;});
}
function sortArrow(key){if(S.sort.key!==key)return'<span class="text-gray-300">↕</span>';return S.sort.dir==='asc'?'<span class="text-[#0e7490]">↑</span>':'<span class="text-[#0e7490]">↓</span>';}
function sortArrowFor(state,key){if(state.key!==key)return'<span class="text-gray-300">↕</span>';return state.dir==='asc'?'<span class="text-[#0e7490]">↑</span>':'<span class="text-[#0e7490]">↓</span>';}