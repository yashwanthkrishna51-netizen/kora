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
  const needsDays=i=>i.reason==='overdue'?daysOverdue(i):(lastUpdateDate(i)?daysDiff(lastUpdateDate(i)):0);
  const needsSorted=sortGeneric(needsAttn,S.dashAttnSort,{name:i=>i.name,client:i=>i.clientName,assignee:i=>i.assignee||'',status:i=>i.status,days:needsDays,reason:i=>i.reason,_default:i=>i.name});
  const clientRows=S.clients.map(c=>({id:c.id,name:c.name,total:c.integrations.length,inProgress:c.integrations.filter(i=>i.status==='In Progress').length,atRisk:c.integrations.filter(i=>i.status==='At Risk').length,completed:c.integrations.filter(i=>i.status==='Completed').length,integrations:c.integrations}));
  const clientRowsSorted=sortGeneric(clientRows,S.dashClientSort,{name:r=>r.name,total:r=>r.total,inProgress:r=>r.inProgress,atRisk:r=>r.atRisk,completed:r=>r.completed,_default:r=>r.name});

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

  // Workload by assignee — cross-domain bandwidth view (open items only)
  const workload={};
  const wAdd=(bucket,name,item)=>{
    const nm=(name||'').trim();
    const key=nm||'__unassigned__';
    if(!workload[key])workload[key]={name:nm||'Unassigned',unassigned:!nm,integ:[],phase:[],ams:[],total:0};
    workload[key][bucket].push(item);workload[key].total++;
  };
  all.filter(i=>!['Completed','Cancelled'].includes(i.status)).forEach(i=>wAdd('integ',i.assignee,i));
  implClients.forEach(c=>(c.modules||[]).forEach(m=>(m.phases||[]).forEach(ph=>{if(ph.status!=='Completed'&&ph.status!=='Not Started')wAdd('phase',ph.assignee,{...ph,clientName:c.name,moduleName:m.name});})));
  amsClients.forEach(c=>(c.workLog||[]).forEach(e=>{if(e.entryStatus!=='Closed'){const rb=entryRaisedBy(e);wAdd('ams',rb==='—'?'':rb,{...e,clientName:c.name});}}));
  let workloadRows=Object.values(workload);
  if(S.dashAssigneeSearch.trim()){
    const q=S.dashAssigneeSearch.toLowerCase();
    workloadRows=workloadRows.filter(w=>w.name.toLowerCase().includes(q)||[...w.integ,...w.phase,...w.ams].some(it=>(it.name||'').toLowerCase().includes(q)));
  }
  if(S.dashAssigneeFilter!=='all')workloadRows=workloadRows.filter(w=>w[S.dashAssigneeFilter].length>0);
  workloadRows=sortGeneric(workloadRows,S.dashAssigneeSort,{name:w=>w.name,total:w=>w.total,integ:w=>w.integ.length,phase:w=>w.phase.length,ams:w=>w.ams.length,_default:w=>w.total});
  // Unassigned always pinned to top regardless of sort — it's the actionable item
  workloadRows.sort((a,b)=>(a.unassigned&&!b.unassigned)?-1:(!a.unassigned&&b.unassigned)?1:0);

  return`<div class="k-page fade kdash2">
  <style>
    .kdash2{--dp:#2563EB;--da:#059669;--dd:#DC2626;--damber:#D97706;--dbg:#F8FAFC;--dcard:#FFFFFF;--dborder:#E4ECFC;--dmute:#64748B;--dink:#0F172A;}
    .kdash2 .bento{border-radius:24px;background:var(--dcard);border:1px solid var(--dborder);box-shadow:0 4px 6px rgba(0,0,0,.05);transition:transform 180ms ease,box-shadow 180ms ease;}
    .kdash2 .bento:hover{transform:scale(1.006);box-shadow:0 8px 20px rgba(37,99,235,.08);}
    .kdash2 .row2{display:flex;align-items:center;padding:7px 4px;border-bottom:1px solid var(--dborder);font-size:12.5px;cursor:pointer;}
    .kdash2 .row2:last-child{border-bottom:none;}
    .kdash2 .row2:hover{background:rgba(37,99,235,.03);}
    .kdash2 .chip2{font-size:11px;font-weight:600;padding:2px 9px;border-radius:999px;display:inline-flex;align-items:center;white-space:nowrap;}
    .kdash2 .hd2{color:var(--dmute);font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;cursor:pointer;}
    .kdash2 .scrollbox{max-height:320px;overflow-y:auto;}
  </style>

  <div class="flex items-center justify-between mb-5">
    <div>
      <h1 class="text-2xl font-extrabold" style="color:var(--dink)">Dashboard</h1>
      <p class="text-sm mt-0.5" style="color:var(--dmute)">Overview across all clients and integrations</p>
    </div>
    ${can('admin')?`<button data-act="portfolio-export" class="text-sm font-semibold text-white px-4 py-2.5 rounded-xl" style="background:var(--dp)">Portfolio Export</button>`:''}
  </div>

  <!-- KPI strip -->
  <div class="grid grid-cols-5 gap-4 mb-4">
    <div class="bento p-4"><div class="text-3xl font-extrabold" style="color:var(--dink)">${S.clients.length}</div><div class="text-xs font-medium mt-1" style="color:var(--dmute)">Clients</div></div>
    <div class="bento p-4"><div class="text-3xl font-extrabold" style="color:var(--dink)">${ti}</div><div class="text-xs font-medium mt-1" style="color:var(--dmute)">Integrations</div></div>
    <div class="bento p-4"><div class="text-3xl font-extrabold" style="color:var(--dp)">${ip}</div><div class="text-xs font-medium mt-1" style="color:var(--dmute)">In Progress</div></div>
    <div class="bento p-4"><div class="text-3xl font-extrabold" style="color:${ar?'var(--dd)':'var(--dink)'}">${ar}</div><div class="text-xs font-medium mt-1" style="color:var(--dmute)">At Risk${atRiskPct?` · ${atRiskPct}%`:''}</div></div>
    <div class="bento p-4"><div class="text-3xl font-extrabold" style="color:var(--dink)">${thisWeekUpdates}</div><div class="text-xs font-medium mt-1" style="color:var(--dmute)">Updates · 7d</div></div>
  </div>

  <div class="text-xs font-semibold uppercase tracking-wide mb-2 mt-1" style="color:var(--dmute)">Across your trackers</div>
  <div class="grid grid-cols-2 gap-4 mb-4">
    <div class="bento p-5">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-bold text-sm" style="color:var(--dink)">Implementations</h3>
        <button data-act="nav-impl" class="text-xs font-semibold" style="color:var(--dp)">View all →</button>
      </div>
      <div class="grid grid-cols-2 gap-3 mb-3">
        <div class="rounded-xl p-3" style="background:rgba(37,99,235,.06)"><div class="text-xl font-extrabold" style="color:var(--dp)">${implActiveClients.length}</div><div class="text-xs" style="color:var(--dmute)">Active Clients</div></div>
        <div class="rounded-xl p-3" style="background:${implAtRiskClients.length?'rgba(220,38,38,.06)':'rgba(100,116,139,.06)'}"><div class="text-xl font-extrabold" style="color:${implAtRiskClients.length?'var(--dd)':'var(--dmute)'}">${implAtRiskClients.length}</div><div class="text-xs" style="color:var(--dmute)">Need Attention</div></div>
      </div>
      ${implTotalPhases?`<div class="flex gap-0.5 h-1.5 rounded-full overflow-hidden mb-3" style="background:var(--dborder)">
        ${STATUSES.map(s=>{const n=allPhases.filter(ph=>ph.status===s).length;const c={'Completed':'var(--da)','In Progress':'var(--dp)','At Risk':'var(--dd)','Delayed':'var(--dd)','Not Started':'var(--dmute)'}[s]||'var(--dmute)';return n?`<div style="width:${Math.round(n/implTotalPhases*100)}%;background:${c};" title="${s}: ${n}"></div>`:'';}).join('')}
      </div>
      <div class="text-xs mb-2" style="color:var(--dmute)">${implTotalPhases} phases tracked across ${implClients.length} client${implClients.length!==1?'s':''}</div>`:`<div class="text-xs py-2" style="color:var(--dmute)">No implementation data yet.</div>`}
      ${implAtRiskClients.length?`<div class="flex flex-wrap gap-1.5 pt-2" style="border-top:1px solid var(--dborder)">${implAtRiskClients.slice(0,3).map(c=>`<button data-act="open-impl-client" data-id="${c.id}" class="chip2 truncate max-w-[140px]" style="background:rgba(220,38,38,.08);color:var(--dd)">${esc(c.name)}</button>`).join('')}</div>`:''}
    </div>

    <div class="bento p-5">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-bold text-sm" style="color:var(--dink)">AMS &amp; Support</h3>
        <button data-act="nav-ams" class="text-xs font-semibold" style="color:var(--dp)">View all →</button>
      </div>
      <div class="grid grid-cols-2 gap-3 mb-3">
        <div class="rounded-xl p-3" style="background:rgba(37,99,235,.06)"><div class="text-xl font-extrabold" style="color:var(--dp)">${amsHoursThisMonth.toFixed(1)}h</div><div class="text-xs" style="color:var(--dmute)">Hours This Month</div></div>
        ${can('admin')?`<div class="rounded-xl p-3" style="background:${amsRevenueINR||amsRevenueUSD?'rgba(5,150,105,.06)':'rgba(100,116,139,.06)'}">
          ${amsRevenueINR>0?`<div class="text-xl font-extrabold" style="color:var(--da)">₹${amsRevenueINR.toLocaleString('en-IN',{maximumFractionDigits:0})}</div>`:''}
          ${amsRevenueUSD>0?`<div class="text-xl font-extrabold" style="color:var(--da)">$${amsRevenueUSD.toLocaleString('en-US',{maximumFractionDigits:0})}</div>`:''}
          ${!amsRevenueINR&&!amsRevenueUSD?`<div class="text-xl font-extrabold" style="color:var(--dmute)">—</div>`:''}
          <div class="text-xs" style="color:var(--dmute)">Billable This Month</div>
        </div>`:`<div class="rounded-xl p-3" style="background:rgba(100,116,139,.06)"><div class="text-xl font-extrabold" style="color:var(--dink)">${amsClients.length}</div><div class="text-xs" style="color:var(--dmute)">Active Clients</div></div>`}
      </div>
      ${amsLowBalance.length?`<div class="space-y-1">${amsLowBalance.slice(0,3).map(c=>`<button data-act="open-ams-client" data-id="${c.id}" class="w-full flex items-center justify-between text-xs font-medium" style="color:var(--dd)"><span class="truncate">⚠ ${esc(c.name)} pool running low</span><span class="font-semibold shrink-0 ml-2">${c.balance.toFixed(1)}/${c.total.toFixed(1)}h</span></button>`).join('')}</div>`:amsClients.length?`<p class="text-xs" style="color:var(--dmute)">All hour pools healthy ✓</p>`:`<div class="text-xs" style="color:var(--dmute)">${emptyIcon('hours')}No AMS clients yet.</div>`}
    </div>
  </div>

  <!-- Needs Attention + Status by Client -->
  <div class="grid grid-cols-2 gap-4 mb-4">
    <div class="bento p-5">
      <div class="flex items-center justify-between mb-2">
        <h3 class="font-bold text-sm" style="color:var(--dink)">⚠️ Needs Attention</h3>
        <span class="chip2" style="background:rgba(220,38,38,.08);color:var(--dd)">${needsAttn.length}</span>
      </div>
      <div class="scrollbox">
        <div class="flex" style="border-bottom:1px solid var(--dborder)">
          ${[['name','Integration','flex-1'],['client','Client','w-28'],['assignee','Assignee','w-24'],['status','Status','w-24'],['days','Days','w-20']].map(([k,l,w])=>`<div data-act="sort-dash-attn" data-key="${k}" class="hd2 ${w} px-2 py-1.5 truncate">${l} ${sortArrowFor(S.dashAttnSort,k)}</div>`).join('')}
        </div>
        ${needsSorted.length?needsSorted.map(i=>`<div class="row2" data-act="open-integ" data-cid="${i.clientId}" data-iid="${i.id}">
          <div class="flex-1 px-2 font-medium truncate" style="color:var(--dink)" title="${esc(i.name)}">${esc(i.name)}</div>
          <div class="w-28 px-2 truncate" style="color:var(--dmute)" title="${esc(i.clientName)}">${esc(i.clientName)}</div>
          <div class="w-24 px-2 truncate" style="color:var(--dmute)" title="${esc(i.assignee||'Unassigned')}">${esc(i.assignee||'Unassigned')}</div>
          <div class="w-24 px-2 truncate" onclick="event.stopPropagation()">${can('editor')?`<select data-act="inline-status" data-cid="${i.clientId}" data-iid="${i.id}" class="text-xs rounded-lg px-1.5 py-1 focus:outline-none w-full" style="border:1px solid var(--dborder)">${STATUSES.map(s=>`<option value="${esc(s)}"${s===i.status?' selected':''}>${esc(s)}</option>`).join('')}</select>`:sbadge(i.status)}</div>
          <div class="w-20 px-2 font-semibold truncate" style="color:${i.reason==='overdue'?'var(--dd)':'var(--damber)'}">${i.reason==='overdue'?`${daysOverdue(i)}d overdue`:`${needsDays(i)}d stale`}</div>
        </div>`).join(''):`<div class="text-sm text-center py-8" style="color:var(--dmute)">All caught up — nothing overdue or stale 🎉</div>`}
      </div>
    </div>

    <div class="bento p-5">
      <h3 class="font-bold text-sm mb-2" style="color:var(--dink)">Status by Client</h3>
      <div class="scrollbox">
        <div class="flex" style="border-bottom:1px solid var(--dborder)">
          ${[['name','Client','flex-1'],['total','Total','w-16 text-right'],['inProgress','Progress','w-20 text-right'],['atRisk','At Risk','w-16 text-right'],['completed','Done','w-16 text-right']].map(([k,l,w])=>`<div data-act="sort-dash-client" data-key="${k}" class="hd2 ${w} px-2 py-1.5 truncate">${l} ${sortArrowFor(S.dashClientSort,k)}</div>`).join('')}
        </div>
        ${clientRowsSorted.map(r=>`<div class="row2" data-act="open-client" data-id="${r.id}">
          <div class="flex-1 px-2 font-medium truncate" style="color:var(--dink)" title="${esc(r.name)}">${esc(r.name)}</div>
          <div class="w-16 px-2 text-right" style="color:var(--dmute)">${r.total}</div>
          <div class="w-20 px-2 text-right font-semibold" style="color:var(--dp)">${r.inProgress}</div>
          <div class="w-16 px-2 text-right font-semibold" style="color:${r.atRisk?'var(--dd)':'var(--dmute)'}">${r.atRisk}</div>
          <div class="w-16 px-2 text-right font-semibold" style="color:${r.completed?'var(--da)':'var(--dmute)'}">${r.completed}</div>
        </div>`).join('')}
      </div>
      <div class="flex flex-wrap gap-3 pt-3 mt-1" style="border-top:1px solid var(--dborder)">
        ${STATUSES.map(s=>`<span class="flex items-center gap-1.5 text-xs" style="color:var(--dmute)"><span class="w-2.5 h-2.5 rounded-full" style="background:${SDOT[s]}"></span>${s}</span>`).join('')}
      </div>
    </div>
  </div>

  <!-- Workload by Assignee -->
  <div class="bento p-5 mb-4">
    <div class="flex items-center justify-between mb-2">
      <h3 class="font-bold text-sm" style="color:var(--dink)">Workload by Assignee</h3>
      <span class="text-xs" style="color:var(--dmute)">${workloadRows.length} people${workloadRows.some(w=>w.unassigned)?' · unassigned flagged':''}</span>
    </div>
    <div class="flex flex-wrap items-center gap-2 mb-2">
      <input type="text" id="dash-assignee-search-inp" placeholder="Search person or item…" value="${esc(S.dashAssigneeSearch)}" data-act="dash-assignee-search" class="text-xs rounded-lg px-2.5 py-1.5 focus:outline-none max-w-[220px]" style="border:1px solid var(--dborder)"/>
      <div class="flex gap-1.5">
        ${[['all','All'],['integ','Integrations'],['phase','Phases'],['ams','AMS']].map(([k,l])=>`<button data-act="dash-assignee-filter" data-key="${k}" class="chip2" style="${S.dashAssigneeFilter===k?'background:var(--dink);color:#fff;':'background:var(--dbg);color:var(--dmute);border:1px solid var(--dborder);'}">${l}</button>`).join('')}
      </div>
    </div>
    <div class="scrollbox">
      <div class="flex" style="border-bottom:1px solid var(--dborder)">
        ${[['name','Person','flex-1'],['integ','Integrations','w-24 text-right'],['phase','Phases','w-20 text-right'],['ams','AMS','w-20 text-right'],['total','Total','w-16 text-right']].map(([k,l,w])=>`<div data-act="sort-dash-assignee" data-key="${k}" class="hd2 ${w} px-2 py-1.5 truncate">${l} ${sortArrowFor(S.dashAssigneeSort,k)}</div>`).join('')}
        <div class="w-8"></div>
      </div>
      ${workloadRows.length?workloadRows.map(w=>{
        const expanded=S.dashAssigneeExpanded.has(w.name);
        const items=[...w.integ.map(it=>({...it,cat:'Integration'})),...w.phase.map(it=>({...it,cat:'Phase'})),...w.ams.map(it=>({...it,cat:'AMS'}))];
        return`<div>
          <div class="row2" data-act="dash-assignee-toggle" data-key="${esc(w.name)}" style="${w.unassigned?'background:rgba(220,38,38,.04);':''}">
            <div class="flex-1 px-2 font-medium truncate" style="color:${w.unassigned?'var(--dd)':'var(--dink)'}">${w.unassigned?'⚠ ':''}${esc(w.name)}</div>
            <div class="w-24 px-2 text-right" style="color:var(--dmute)">${w.integ.length||''}</div>
            <div class="w-20 px-2 text-right" style="color:var(--dmute)">${w.phase.length||''}</div>
            <div class="w-20 px-2 text-right" style="color:var(--dmute)">${w.ams.length||''}</div>
            <div class="w-16 px-2 text-right font-bold" style="color:var(--dink)">${w.total}</div>
            <div class="w-8 px-2" style="color:var(--dmute)">${expanded?'▾':'▸'}</div>
          </div>
          ${expanded?`<div class="pl-6 pr-2 py-2" style="background:var(--dbg);border-bottom:1px solid var(--dborder)">
            ${items.map(it=>`<div class="flex items-center gap-2 py-1 text-xs">
              <span class="chip2" style="background:var(--dborder);color:var(--dmute);font-size:9px;">${it.cat}</span>
              ${it.cat==='Phase'&&it.moduleName?`<span class="font-medium" style="color:var(--dmute)">${esc(it.moduleName)}</span><span style="color:var(--dborder)">·</span>`:''}
              <span class="truncate" style="color:var(--dmute)">${esc(it.name||it.description||'Untitled')}</span>
              <span style="color:var(--dborder)">· ${esc(it.clientName||'')}</span>
              ${it.status?`<span style="color:var(--dmute)">· ${esc(it.status)}</span>`:''}
            </div>`).join('')}
          </div>`:''}
        </div>`;
      }).join(''):`<div class="text-sm text-center py-8" style="color:var(--dmute)">${S.dashAssigneeSearch?'No matches':'No open items assigned yet'}</div>`}
    </div>
  </div>

  <!-- Status Distribution + Team Activity -->
  <div class="grid grid-cols-2 gap-4">
    <div class="bento p-5">
      <h3 class="font-bold text-sm mb-3" style="color:var(--dink)">Overall Status Distribution</h3>
      <div class="flex gap-1 h-3.5 rounded-full overflow-hidden mb-3" style="background:var(--dborder)">
        ${STATUSES.map(s=>{const n=all.filter(i=>i.status===s).length;return n?`<div style="width:${Math.round(n/(ti||1)*100)}%;background:${SDOT[s]};" title="${s}: ${n}"></div>`:'';}).join('')}
      </div>
      <div class="flex flex-wrap gap-3">
        ${STATUSES.map(s=>{const n=all.filter(i=>i.status===s).length;return`<span class="flex items-center gap-1.5 text-xs" style="color:var(--dmute)"><span class="w-2.5 h-2.5 rounded-full" style="background:${SDOT[s]}"></span>${s}: <b style="color:var(--dink)">${n}</b></span>`;}).join('')}
      </div>
    </div>
    ${topUsers.length?`<div class="bento p-5">
      <h3 class="font-bold text-sm mb-3" style="color:var(--dink)">Team Activity This Week</h3>
      <div class="flex flex-col gap-2.5">
        ${topUsers.map(([name,count],i)=>`<div class="flex items-center gap-3">
          <div class="flex items-center justify-center shrink-0 rounded-full text-[11px] font-bold" style="width:22px;height:22px;background:rgba(37,99,235,.1);color:var(--dp)">${i+1}</div>
          <div class="flex-1 min-w-0 text-sm font-medium truncate" style="color:var(--dink)">${esc(name)}</div>
          <div class="text-sm font-bold" style="color:var(--dp)">${count}</div>
          <div class="text-xs" style="color:var(--dmute)">update${count!==1?'s':''}</div>
          <div class="w-20 h-1.5 rounded-full overflow-hidden" style="background:var(--dborder)"><div class="h-full rounded-full" style="width:${Math.round(count/topUsers[0][1]*100)}%;background:var(--dp)"></div></div>
        </div>`).join('')}
      </div>
    </div>`:'<div></div>'}
  </div>
</div>`;
}