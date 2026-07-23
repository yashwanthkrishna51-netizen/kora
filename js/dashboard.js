// ─── DASHBOARD ────────────────────────────────────────────────────
function renderDashboard(){
  ensureSnapshotCaptured();
  fetchSnapshotHistory(14);

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

  const implClients=S.clients.filter(c=>c.modules!==undefined);
  const allModules=implClients.flatMap(c=>(c.modules||[]).map(m=>({...m,clientName:c.name,clientId:c.id})));
  const allPhases=allModules.flatMap(m=>(m.phases||[]).map(ph=>({...ph})));
  const implTotalPhases=allPhases.length;
  const implAtRiskClients=implClients.filter(c=>implAutoRag(c)==='Red');

  const amsClients=S.clients.filter(c=>c.workLog!==undefined);
  const now=new Date();
  const monthStart=new Date(now.getFullYear(),now.getMonth(),1).toISOString().slice(0,10);
  const monthEnd=todayStr();
  let amsHoursThisMonth=0,amsRevenueINR=0,amsRevenueUSD=0;
  const amsLowBalance=[];
  amsClients.forEach(c=>{
    const tm=amsTotals(c,monthStart,monthEnd);
    amsHoursThisMonth+=tm.totalHours;
    if(tm.totalAmount){
      if((c.currency||'INR')==='USD')amsRevenueUSD+=tm.totalAmount;
      else amsRevenueINR+=tm.totalAmount;
    }
    if(tm.hasBucket&&tm.balanceAvailable<=Math.max(2,tm.totalAvailableHours*0.15)){amsLowBalance.push({name:c.name,id:c.id,balance:tm.balanceAvailable,total:tm.totalAvailableHours});}
  });
  const allAmsEntries=amsClients.flatMap(c=>(c.workLog||[]).map(e=>({...e,clientName:c.name,clientId:c.id})));
  const openAmsEntries=allAmsEntries.filter(e=>e.entryStatus!=='Closed');
  const isL3orL4=e=>{const q=e.queryLevel||'';return q.includes('L3')||q.includes('L4');};

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
  workloadRows.sort((a,b)=>(a.unassigned&&!b.unassigned)?-1:(!a.unassigned&&b.unassigned)?1:0);

  const rankRag=v=>v==null?1:({Red:0,Amber:1,Green:2}[v]??1);
  const healthRows=S.clients.map(c=>{
    const iR=integRagLabel(c),implR=c.modules!==undefined?implAutoRag(c):null,amsR=c.workLog!==undefined?amsRagLabel(c):null;
    const overall=overallRagLabel(iR,implR,amsR);
    const hist=S.snapshotHistory.filter(s=>s.client_id===c.id).sort((a,b)=>a.snapshot_date.localeCompare(b.snapshot_date));
    let trend=hist.length?'same':'new';
    if(hist.length>=2){
      const d=rankRag(hist[0].overall_rag)-rankRag(hist[hist.length-1].overall_rag);
      trend=d>0?'better':d<0?'worse':'same';
    }
    return{id:c.id,name:c.name,integR:iR,implR,amsR,overall,trend};
  }).filter(r=>r.overall).sort((a,b)=>rankRag(a.overall)-rankRag(b.overall));

  const criticalItems=[];
  needsAttn.forEach(i=>criticalItems.push({domain:'Integration',severity:i.reason==='overdue'?0:1,title:i.name,client:i.clientName,detail:i.reason==='overdue'?`${daysOverdue(i)}d overdue`:`${needsDays(i)}d stale`,owner:i.assignee||'Unassigned',act:'open-integ',cid:i.clientId,iid:i.id}));
  implClients.forEach(c=>(c.modules||[]).forEach(m=>(m.phases||[]).forEach(ph=>{
    if(ph.status==='At Risk')criticalItems.push({domain:'Phase',severity:0,title:`${ph.name} — At Risk`,client:c.name,detail:ph.targetDate?`Target ${fmtDate(ph.targetDate)}`:'No target date set',owner:ph.assignee||'Unassigned',act:'open-impl-client',cid:c.id});
  })));
  openAmsEntries.forEach(e=>{
    if(isL3orL4(e)){
      const age=daysDiff(entryDate(e));
      criticalItems.push({domain:`AMS · ${(e.queryLevel||'').split(' - ')[0]}`,severity:(e.queryLevel||'').includes('L4')?0:1,title:(e.description||'Untitled').slice(0,60),client:e.clientName,detail:`${age}d open`,owner:entryRaisedBy(e),act:'open-ams-client',cid:e.clientId});
    }
  });
  criticalItems.sort((a,b)=>a.severity-b.severity);

  const todayS=todayStr();
  const in14=new Date(Date.now()+14*86400000).toISOString().slice(0,10);
  const upcoming=[];
  all.forEach(i=>(i.milestones||[]).forEach(ms=>{if(ms.status==='Pending'&&ms.dueDate>=todayS&&ms.dueDate<=in14)upcoming.push({date:ms.dueDate,title:ms.name,client:i.clientName,tag:'Milestone'});}));
  implClients.forEach(c=>(c.modules||[]).forEach(m=>(m.phases||[]).forEach(ph=>{if(ph.status!=='Completed'&&ph.targetDate&&ph.targetDate>=todayS&&ph.targetDate<=in14)upcoming.push({date:ph.targetDate,title:`${ph.name} — ${m.name}`,client:c.name,tag:'Phase'});})));
  openAmsEntries.forEach(e=>{if(e.dueDate&&e.dueDate>=todayS&&e.dueDate<=in14)upcoming.push({date:e.dueDate,title:(e.description||'AMS item').slice(0,50),client:e.clientName,tag:'AMS'});});
  upcoming.sort((a,b)=>a.date.localeCompare(b.date));
  const TAG_COLOR={Milestone:'da',Phase:'dp',AMS:'damber'};

  const workMixTotal=allAmsEntries.reduce((a,e)=>a+Number(e.hours||0),0);
  const workMixByType={};
  allAmsEntries.forEach(e=>{const t=entryType(e);workMixByType[t]=(workMixByType[t]||0)+Number(e.hours||0);});
  const workMixSorted=Object.entries(workMixByType).sort((a,b)=>b[1]-a[1]).slice(0,4);
  const reactiveHours=allAmsEntries.filter(e=>['Bug Fix','Support Ticket'].includes(entryType(e))).reduce((a,e)=>a+Number(e.hours||0),0);
  const reactivePct=workMixTotal?Math.round(reactiveHours/workMixTotal*100):0;

  const severityDist={};
  AMS_QUERY_LEVELS.forEach(l=>severityDist[l]=0);
  allAmsEntries.forEach(e=>{const l=e.queryLevel||AMS_QUERY_LEVELS[0];severityDist[l]=(severityDist[l]||0)+1;});
  const severityTotal=allAmsEntries.length||1;
  const oldestCritical=openAmsEntries.filter(isL3orL4).map(e=>daysDiff(entryDate(e))).sort((a,b)=>b-a)[0];
  const SEV_COLOR={'L1 - Low':'#94A3B8','L2 - Medium':'var(--dp)','L3 - High':'var(--damber)','L4 - Critical':'var(--dd)'};

  const funnelCounts={};
  PHASES.forEach(p=>funnelCounts[p]=0);
  implClients.forEach(c=>(c.modules||[]).forEach(m=>(m.phases||[]).forEach(ph=>{if(ph.status==='In Progress'||ph.status==='At Risk')funnelCounts[ph.name]=(funnelCounts[ph.name]||0)+1;})));
  const funnelTotal=Object.values(funnelCounts).reduce((a,b)=>a+b,0)||1;
  const funnelSorted=Object.entries(funnelCounts).filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1]);
  const funnelMax=funnelSorted[0];

  const hyg=all.length?{
    assignee:all.filter(i=>i.assignee&&i.assignee.trim()).length/all.length,
    due:all.filter(i=>i.dueDate).length/all.length,
    fresh:all.filter(i=>!isStale(i,30)).length/all.length,
  }:{assignee:1,due:1,fresh:1};
  const hygieneScore=Math.round((hyg.assignee+hyg.due+hyg.fresh)/3*100);

  const blockers=openAmsEntries.filter(e=>e.dependencies&&e.dependencies.trim()).map(e=>({client:e.clientName,text:e.dependencies.trim()}));

  let atRiskDelta=null;
  if(S.snapshotHistory.length){
    const dates=[...new Set(S.snapshotHistory.map(s=>s.snapshot_date))].sort();
    const earliestSum=S.snapshotHistory.filter(s=>s.snapshot_date===dates[0]).reduce((a,s)=>a+(s.integ_at_risk||0),0);
    atRiskDelta=ar-earliestSum;
  }
  const healthSplit={Red:0,Amber:0,Green:0};
  healthRows.forEach(r=>{healthSplit[r.overall]=(healthSplit[r.overall]||0)+1;});
  const l3l4OpenCount=openAmsEntries.filter(isL3orL4).length;

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
    .kdash2 .dot2{width:8px;height:8px;border-radius:999px;display:inline-block;}
  </style>

  <div class="flex items-center justify-between mb-5">
    <div>
      <h1 class="text-2xl font-extrabold" style="color:var(--dink)">Dashboard</h1>
      <p class="text-sm mt-0.5" style="color:var(--dmute)">Portfolio overview — sorted worst-first</p>
    </div>
    ${can('admin')?`<button data-act="portfolio-export" class="text-sm font-semibold text-white px-4 py-2.5 rounded-xl" style="background:var(--dp)">Portfolio Export</button>`:''}
  </div>

  <div class="grid grid-cols-6 gap-3 mb-4">
    <div class="bento p-4"><div class="text-3xl font-extrabold" style="color:var(--dink)">${S.clients.length}</div><div class="text-xs font-medium mt-1" style="color:var(--dmute)">Clients</div></div>
    <div class="bento p-4">
      <div class="flex items-end gap-1.5"><div class="text-3xl font-extrabold" style="color:${ar?'var(--dd)':'var(--dink)'}">${ar}</div>${atRiskDelta!==null&&atRiskDelta!==0?`<span class="text-xs font-semibold mb-1" style="color:${atRiskDelta>0?'var(--dd)':'var(--da)'}">${atRiskDelta>0?'↑':'↓'}${Math.abs(atRiskDelta)}</span>`:''}</div>
      <div class="text-xs font-medium mt-1" style="color:var(--dmute)">At Risk${atRiskDelta!==null?' · vs '+new Date([...new Set(S.snapshotHistory.map(s=>s.snapshot_date))].sort()[0]).toLocaleDateString('en-IN',{day:'2-digit',month:'short'}):''}</div>
    </div>
    <div class="bento p-4"><div class="text-3xl font-extrabold" style="color:var(--dink)">${thisWeekUpdates}</div><div class="text-xs font-medium mt-1" style="color:var(--dmute)">Updates · 7d</div></div>
    <div class="bento p-4">
      <div class="text-lg font-extrabold" style="color:var(--dink)">${healthSplit.Red} <span style="color:var(--dd)">R</span> · ${healthSplit.Amber} <span style="color:var(--damber)">A</span> · ${healthSplit.Green} <span style="color:var(--da)">G</span></div>
      <div class="text-xs font-medium mt-1" style="color:var(--dmute)">Client Health Split</div>
    </div>
    <div class="bento p-4"><div class="text-3xl font-extrabold" style="color:${l3l4OpenCount?'var(--dd)':'var(--dink)'}">${l3l4OpenCount}</div><div class="text-xs font-medium mt-1" style="color:var(--dmute)">L3/L4 tickets open</div></div>
    <div class="bento p-4"><div class="text-3xl font-extrabold" style="color:${hygieneScore>=80?'var(--da)':hygieneScore>=60?'var(--damber)':'var(--dd)'}">${hygieneScore}%</div><div class="text-xs font-medium mt-1" style="color:var(--dmute)">Data Hygiene Score</div></div>
  </div>

  <div class="bento p-5 mb-4">
    <div class="flex items-center justify-between mb-2">
      <h3 class="font-bold text-sm flex items-center gap-2" style="color:var(--dink)"><span class="dot2" style="background:var(--dd)"></span>⚠️ Critical Items — start here</h3>
      <span class="chip2" style="background:rgba(220,38,38,.08);color:var(--dd)">${criticalItems.length}</span>
    </div>
    <div class="scrollbox">
      <div class="flex" style="border-bottom:1px solid var(--dborder)">
        <div class="hd2 w-24 px-2 py-1.5">Domain</div><div class="hd2 flex-1 px-2 py-1.5">Item</div><div class="hd2 w-28 px-2 py-1.5">Client</div><div class="hd2 w-40 px-2 py-1.5">Age / Detail</div><div class="hd2 w-24 px-2 py-1.5">Owner</div>
      </div>
      ${criticalItems.length?criticalItems.map(it=>`<div class="row2" data-act="${it.act}" data-cid="${it.cid}" data-id="${it.cid}" ${it.iid?`data-iid="${it.iid}"`:''}>
        <div class="w-24 px-2"><span class="chip2" style="background:${it.severity===0?'rgba(220,38,38,.08)':'rgba(217,119,6,.1)'};color:${it.severity===0?'var(--dd)':'var(--damber)'}">${esc(it.domain)}</span></div>
        <div class="flex-1 px-2 font-medium truncate" style="color:var(--dink)" title="${esc(it.title)}">${esc(it.title)}</div>
        <div class="w-28 px-2 truncate" style="color:var(--dmute)">${esc(it.client)}</div>
        <div class="w-40 px-2 font-semibold truncate" style="color:${it.severity===0?'var(--dd)':'var(--damber)'}">${esc(it.detail)}</div>
        <div class="w-24 px-2 truncate" style="color:var(--dmute)">${esc(it.owner)}</div>
      </div>`).join(''):`<div class="text-sm text-center py-8" style="color:var(--dmute)">Nothing critical right now 🎉</div>`}
    </div>
  </div>

  <div class="grid grid-cols-2 gap-4 mb-4">
    <div class="bento p-5">
      <h3 class="font-bold text-sm mb-2" style="color:var(--dink)">Portfolio Health Scorecard</h3>
      <div class="scrollbox">
        <div class="flex" style="border-bottom:1px solid var(--dborder)">
          <div class="hd2 flex-1 px-2 py-1.5">Client</div><div class="hd2 w-10 px-2 py-1.5 text-center">Int</div><div class="hd2 w-10 px-2 py-1.5 text-center">Impl</div><div class="hd2 w-10 px-2 py-1.5 text-center">AMS</div><div class="hd2 w-16 px-2 py-1.5 text-right">Trend</div>
        </div>
        ${healthRows.length?healthRows.map(r=>`<div class="row2" data-act="open-client" data-id="${r.id}">
          <div class="flex-1 px-2 font-medium truncate" style="color:var(--dink)">${esc(r.name)}</div>
          <div class="w-10 px-2 text-center">${r.integR?`<span class="dot2" style="background:${RAG_HEX[r.integR]}"></span>`:''}</div>
          <div class="w-10 px-2 text-center">${r.implR?`<span class="dot2" style="background:${RAG_HEX[r.implR]}"></span>`:''}</div>
          <div class="w-10 px-2 text-center">${r.amsR?`<span class="dot2" style="background:${RAG_HEX[r.amsR]}"></span>`:''}</div>
          <div class="w-16 px-2 text-right font-semibold" style="color:${r.trend==='worse'?'var(--dd)':r.trend==='better'?'var(--da)':'var(--dmute)'}">${r.trend==='worse'?'↓ worse':r.trend==='better'?'↑ better':r.trend==='new'?'— new':'→ same'}</div>
        </div>`).join(''):`<div class="text-sm text-center py-8" style="color:var(--dmute)">No client health data yet</div>`}
      </div>
      <div class="text-[11px] mt-2 pt-2" style="color:var(--dmute);border-top:1px solid var(--dborder)">Trend sharpens as daily snapshots accumulate</div>
    </div>

    <div class="bento p-5">
      <h3 class="font-bold text-sm mb-2" style="color:var(--dink)">Upcoming Deadlines — next 14 days</h3>
      <div class="scrollbox">
        ${upcoming.length?upcoming.map(u=>`<div class="row2" style="cursor:default">
          <div class="w-16 px-2 font-semibold" style="color:var(--dp)">${fmtDate(u.date)}</div>
          <div class="flex-1 px-2 truncate" style="color:var(--dink)" title="${esc(u.title)}">${esc(u.title)}</div>
          <div class="w-24 px-2 truncate" style="color:var(--dmute)">${esc(u.client)}</div>
          <div class="w-20 px-2"><span class="chip2" style="background:rgba(37,99,235,.08);color:var(--${TAG_COLOR[u.tag]})">${u.tag}</span></div>
        </div>`).join(''):`<div class="text-sm text-center py-8" style="color:var(--dmute)">Nothing due in the next 14 days</div>`}
      </div>
    </div>
  </div>

  <div class="grid grid-cols-3 gap-4 mb-4">
    <div class="bento p-5">
      <h3 class="font-bold text-sm mb-3" style="color:var(--dink)">AMS Work-Mix</h3>
      ${workMixSorted.length?`<div class="space-y-2">
        ${workMixSorted.map(([type,hrs])=>{const pct=workMixTotal?Math.round(hrs/workMixTotal*100):0;const c=['Bug Fix','Support Ticket'].includes(type)?'var(--dd)':'var(--dp)';return`<div><div class="flex justify-between text-xs mb-1"><span style="color:var(--dink)">${esc(type)}</span><span class="font-semibold" style="color:${c}">${pct}%</span></div><div class="h-1.5 rounded-full overflow-hidden" style="background:var(--dborder)"><div class="h-full" style="width:${pct}%;background:${c}"></div></div></div>`;}).join('')}
      </div>
      <div class="text-[11px] mt-3 pt-2" style="color:var(--dmute);border-top:1px solid var(--dborder)">${reactivePct}% reactive (Bug Fix + Support) vs ${100-reactivePct}% proactive</div>`:`<div class="text-sm text-center py-6" style="color:var(--dmute)">No AMS hours logged yet</div>`}
    </div>

    <div class="bento p-5">
      <h3 class="font-bold text-sm mb-3" style="color:var(--dink)">Severity &amp; Aging</h3>
      ${severityTotal>1?`<div class="flex gap-1 h-3 rounded-full overflow-hidden mb-2" style="background:var(--dborder)">
        ${AMS_QUERY_LEVELS.map(l=>severityDist[l]?`<div style="width:${Math.round(severityDist[l]/severityTotal*100)}%;background:${SEV_COLOR[l]}" title="${l}: ${severityDist[l]}"></div>`:'').join('')}
      </div>
      <div class="flex flex-wrap gap-2 text-[11px] mb-3">
        ${AMS_QUERY_LEVELS.map(l=>`<span style="color:${SEV_COLOR[l]}">${l.split(' - ')[0]}: ${Math.round(severityDist[l]/severityTotal*100)}%</span>`).join('')}
      </div>
      ${oldestCritical!==undefined?`<div class="text-xs font-semibold" style="color:var(--dd)">Oldest open L3/L4 ticket: ${oldestCritical}d</div>`:`<div class="text-xs" style="color:var(--da)">No open L3/L4 tickets ✓</div>`}`:`<div class="text-sm text-center py-6" style="color:var(--dmute)">No AMS entries yet</div>`}
    </div>

    <div class="bento p-5">
      <h3 class="font-bold text-sm mb-3" style="color:var(--dink)">Phase-Stage Funnel</h3>
      ${funnelSorted.length?`<div class="space-y-1.5">
        ${funnelSorted.map(([name,n])=>`<div class="flex items-center gap-2 text-[11px]"><span class="w-24 truncate" style="color:${name===funnelMax[0]?'var(--dink)':'var(--dmute)'};font-weight:${name===funnelMax[0]?600:400}">${esc(name)}</span><div class="flex-1 h-2.5 rounded" style="background:var(--dborder)"><div class="h-full rounded" style="width:${Math.round(n/funnelTotal*100)}%;background:${name===funnelMax[0]?'var(--dd)':'var(--dp)'}"></div></div><span class="w-4 text-right" style="color:var(--dmute)">${n}</span></div>`).join('')}
      </div>
      <div class="text-[11px] mt-2 pt-2" style="color:var(--dd);border-top:1px solid var(--dborder)">Bottleneck: ${Math.round(funnelMax[1]/funnelTotal*100)}% of active phases stuck at ${esc(funnelMax[0])}</div>`:`<div class="text-sm text-center py-6" style="color:var(--dmute)">No active phases in progress</div>`}
    </div>
  </div>

  <div class="grid grid-cols-3 gap-4 mb-4">
    <div class="bento p-5">
      <h3 class="font-bold text-sm mb-3" style="color:var(--dink)">Financial Rollup</h3>
      ${can('admin')?`<div class="grid grid-cols-2 gap-2 mb-3">
        <div class="rounded-xl p-3" style="background:rgba(5,150,105,.06)"><div class="text-lg font-extrabold" style="color:var(--da)">${amsRevenueINR?`₹${amsRevenueINR.toLocaleString('en-IN',{maximumFractionDigits:0})}`:'—'}</div><div class="text-[11px]" style="color:var(--dmute)">Billable (INR)</div></div>
        <div class="rounded-xl p-3" style="background:rgba(5,150,105,.06)"><div class="text-lg font-extrabold" style="color:var(--da)">${amsRevenueUSD?`$${amsRevenueUSD.toLocaleString('en-US',{maximumFractionDigits:0})}`:'—'}</div><div class="text-[11px]" style="color:var(--dmute)">Billable (USD)</div></div>
      </div>`:`<div class="rounded-xl p-3 mb-3" style="background:rgba(37,99,235,.06)"><div class="text-lg font-extrabold" style="color:var(--dp)">${amsHoursThisMonth.toFixed(1)}h</div><div class="text-[11px]" style="color:var(--dmute)">Hours this month</div></div>`}
      ${amsLowBalance.length?`<div class="text-xs font-semibold" style="color:var(--dd)">⚠ ${amsLowBalance.length} client pool${amsLowBalance.length!==1?'s':''} running low</div>`:amsClients.length?`<div class="text-xs" style="color:var(--da)">All hour pools healthy ✓</div>`:''}
    </div>
    <div class="bento p-5">
      <h3 class="font-bold text-sm mb-3" style="color:var(--dink)">Data Hygiene Score</h3>
      <div class="flex items-center gap-3 mb-2">
        <div class="text-3xl font-extrabold" style="color:${hygieneScore>=80?'var(--da)':hygieneScore>=60?'var(--damber)':'var(--dd)'}">${hygieneScore}%</div>
        <div class="text-xs" style="color:var(--dmute)">of items fully tracked</div>
      </div>
      <div class="text-[11px] space-y-1" style="color:var(--dmute)">
        <div>${Math.round((1-hyg.assignee)*100)}% missing assignee</div>
        <div>${Math.round((1-hyg.due)*100)}% missing due date</div>
        <div>${Math.round((1-hyg.fresh)*100)}% no update in 30+ days</div>
      </div>
    </div>
    <div class="bento p-5">
      <h3 class="font-bold text-sm mb-3" style="color:var(--dink)">Blockers / Dependencies</h3>
      ${blockers.length?blockers.slice(0,5).map(b=>`<div class="row2" style="cursor:default"><div class="flex-1 truncate text-xs" style="color:var(--dink)">${esc(b.client)} — ${esc(b.text)}</div></div>`).join(''):`<div class="text-sm text-center py-6" style="color:var(--dmute)">No blockers flagged ✓</div>`}
    </div>
  </div>

  <div class="bento p-5">
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
        const critCount=[...w.integ,...w.phase].filter(it=>it.status==='At Risk').length+w.ams.filter(it=>isL3orL4(it)).length;
        return`<div>
          <div class="row2" data-act="dash-assignee-toggle" data-key="${esc(w.name)}" style="${w.unassigned?'background:rgba(220,38,38,.04);':''}">
            <div class="flex-1 px-2 font-medium truncate" style="color:${w.unassigned?'var(--dd)':'var(--dink)'}">${w.unassigned?'⚠ ':''}${esc(w.name)}${critCount>1?` <span class="chip2" style="background:rgba(220,38,38,.08);color:var(--dd);font-size:9px;">${critCount} critical</span>`:''}</div>
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
</div>`;
}