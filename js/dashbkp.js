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
    <div class="k-card" style="padding:0;overflow:hidden;">
      <div class="k-card-head" style="padding:16px 16px 0;margin-bottom:10px;">
        <h3 class="k-h3">⚠️ Needs Attention</h3>
        <span class="k-eyebrow">${needsAttn.length}</span>
      </div>
      <div style="max-height:340px;overflow-y:auto;font-size:12px;">
        <div style="display:grid;grid-template-columns:28% 16% 16% 24% 16%;position:sticky;top:0;background:var(--paper);z-index:2;border-bottom:1px solid var(--line);">
          ${[['name','Integration'],['client','Client'],['assignee','Assignee'],['status','Status'],['days','Days']].map(([k,l])=>`<div data-act="sort-dash-attn" data-key="${k}" style="padding:6px 12px;font-size:10px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:var(--mute);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${l} ${sortArrowFor(S.dashAttnSort,k)}</div>`).join('')}
        </div>
        ${needsSorted.length?needsSorted.map(i=>`<div class="k-list-row" style="display:grid;grid-template-columns:28% 16% 16% 24% 16%;align-items:center;margin:0;border-radius:0;border-bottom:1px solid var(--line-2);" data-act="open-integ" data-cid="${i.clientId}" data-iid="${i.id}">
          <div style="padding:7px 12px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--ink);font-weight:500;" title="${esc(i.name)}">${esc(i.name)}</div>
          <div style="padding:7px 12px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--ink-3);" title="${esc(i.clientName)}">${esc(i.clientName)}</div>
          <div style="padding:7px 12px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--mute);" title="${esc(i.assignee||'Unassigned')}">${esc(i.assignee||'Unassigned')}</div>
          <div style="padding:7px 12px;overflow:hidden;" onclick="event.stopPropagation()">${can('editor')?`<select data-act="inline-status" data-cid="${i.clientId}" data-iid="${i.id}" style="font-size:11px;width:100%;" class="border border-gray-200 rounded-lg px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-[#0e7490]">${STATUSES.map(s=>`<option value="${esc(s)}"${s===i.status?' selected':''}>${esc(s)}</option>`).join('')}</select>`:sbadge(i.status)}</div>
          <div style="padding:7px 12px;white-space:nowrap;overflow:hidden;">${i.reason==='overdue'?`<span style="color:var(--red);font-weight:500;">${daysOverdue(i)}d overdue</span>`:`<span style="color:var(--amber);">${needsDays(i)}d stale</span>`}</div>
        </div>`).join(''):`<div class="k-empty">All caught up — nothing overdue or stale 🎉</div>`}
      </div>
    </div>

    <div class="k-card" style="padding:0;overflow:hidden;">
      <div class="k-card-head" style="padding:16px 16px 0;margin-bottom:10px;">
        <h3 class="k-h3">Status by Client</h3>
      </div>
      <div style="max-height:340px;overflow-y:auto;font-size:12px;">
        <div style="display:grid;grid-template-columns:40% 15% 15% 15% 15%;position:sticky;top:0;background:var(--paper);z-index:2;border-bottom:1px solid var(--line);">
          ${[['name','Client'],['total','Total'],['inProgress','In Progress'],['atRisk','At Risk'],['completed','Completed']].map(([k,l])=>`<div data-act="sort-dash-client" data-key="${k}" style="padding:6px 12px;font-size:10px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:var(--mute);cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${l} ${sortArrowFor(S.dashClientSort,k)}</div>`).join('')}
        </div>
        ${clientRowsSorted.map(r=>`<div class="k-list-row" style="display:grid;grid-template-columns:40% 15% 15% 15% 15%;align-items:center;margin:0;border-radius:0;border-bottom:1px solid var(--line-2);" data-act="open-client" data-id="${r.id}">
          <div style="padding:7px 12px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--ink);font-weight:500;" title="${esc(r.name)}">${esc(r.name)}</div>
          <div style="padding:7px 12px;color:var(--ink-3);">${r.total}</div>
          <div style="padding:7px 12px;color:var(--teal);font-weight:500;">${r.inProgress}</div>
          <div style="padding:7px 12px;${r.atRisk?'color:var(--red);font-weight:500;':'color:var(--mute-2);'}">${r.atRisk}</div>
          <div style="padding:7px 12px;${r.completed?'color:var(--green);font-weight:500;':'color:var(--mute-2);'}">${r.completed}</div>
        </div>`).join('')}
      </div>
      <div class="flex flex-wrap gap-3" style="padding:12px 16px;border-top:1px solid var(--line-2);">
        ${STATUSES.map(s=>`<span class="flex items-center gap-1.5" style="font-size:11px;color:var(--mute);"><span class="w-2.5 h-2.5 rounded-full" style="background:${SDOT[s]};"></span>${s}</span>`).join('')}
      </div>
    </div>
  </div>

  <div class="k-card mb-6" style="padding:0;overflow:hidden;">
    <div class="k-card-head" style="padding:16px 16px 0;margin-bottom:10px;">
      <h3 class="k-h3">Workload by Assignee</h3>
      <span class="k-eyebrow">${workloadRows.length} people${workloadRows.some(w=>w.unassigned)?' · unassigned flagged':''}</span>
    </div>
    <div class="flex flex-wrap items-center gap-2" style="padding:0 16px 12px;">
      <input type="text" id="dash-assignee-search-inp" placeholder="Search person or item…" value="${esc(S.dashAssigneeSearch)}" data-act="dash-assignee-search" style="font-size:12px;max-width:220px;" class="border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/>
      <div class="flex gap-1">
        ${[['all','All'],['integ','Integrations'],['phase','Phases'],['ams','AMS']].map(([k,l])=>`<button data-act="dash-assignee-filter" data-key="${k}" style="font-size:11px;padding:5px 10px;border-radius:9999px;font-weight:500;${S.dashAssigneeFilter===k?'background:var(--ink);color:#fff;':'background:var(--paper);color:var(--ink-3);border:1px solid var(--line);'}">${l}</button>`).join('')}
      </div>
    </div>
    <div style="max-height:380px;overflow-y:auto;font-size:12px;">
      <div style="display:grid;grid-template-columns:26% 16% 16% 16% 13% 13%;position:sticky;top:0;background:var(--paper);z-index:2;border-bottom:1px solid var(--line);">
        ${[['name','Person'],['integ','Integrations'],['phase','Phases'],['ams','AMS Entries'],['total','Total'],['','']].map(([k,l])=>k?`<div data-act="sort-dash-assignee" data-key="${k}" style="padding:6px 12px;font-size:10px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:var(--mute);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${l} ${sortArrowFor(S.dashAssigneeSort,k)}</div>`:`<div></div>`).join('')}
      </div>
      ${workloadRows.length?workloadRows.map(w=>{
        const expanded=S.dashAssigneeExpanded.has(w.name);
        const items=[...w.integ.map(it=>({...it,cat:'Integration'})),...w.phase.map(it=>({...it,cat:'Phase'})),...w.ams.map(it=>({...it,cat:'AMS'}))];
        return`<div>
          <div class="k-list-row" style="display:grid;grid-template-columns:26% 16% 16% 16% 13% 13%;align-items:center;margin:0;border-radius:0;border-bottom:1px solid var(--line-2);${w.unassigned?'background:var(--red-hi);':''}" data-act="dash-assignee-toggle" data-key="${esc(w.name)}">
            <div style="padding:7px 12px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:500;${w.unassigned?'color:var(--red);':'color:var(--ink);'}">${w.unassigned?'⚠ ':''}${esc(w.name)}</div>
            <div style="padding:7px 12px;color:var(--ink-3);">${w.integ.length||''}</div>
            <div style="padding:7px 12px;color:var(--ink-3);">${w.phase.length||''}</div>
            <div style="padding:7px 12px;color:var(--ink-3);">${w.ams.length||''}</div>
            <div style="padding:7px 12px;font-weight:600;color:var(--ink);">${w.total}</div>
            <div style="padding:7px 12px;color:var(--mute);">${expanded?'▾':'▸'}</div>
          </div>
          ${expanded?`<div style="padding:4px 12px 10px 24px;background:var(--surface);border-bottom:1px solid var(--line-2);">
            ${items.map(it=>`<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:11.5px;">
              <span class="k-badge" style="font-size:9px;">${it.cat}</span>
              ${it.cat==='Phase'&&it.moduleName?`<span style="color:var(--ink-3);font-weight:500;">${esc(it.moduleName)}</span><span style="color:var(--mute-2);">·</span>`:''}
              <span style="color:var(--ink-3);" class="truncate">${esc(it.name||it.description||'Untitled')}</span>
              <span style="color:var(--mute-2);">· ${esc(it.clientName||'')}</span>
              ${it.status?`<span style="color:var(--mute);">· ${esc(it.status)}</span>`:''}
            </div>`).join('')}
          </div>`:''}
        </div>`;
      }).join(''):`<div class="k-empty">${S.dashAssigneeSearch?'No matches':'No open items assigned yet'}</div>`}
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