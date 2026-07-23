// ─── AMS ──────────────────────────────────────────────────────────
function amsEntryAmount(hours,rate){if(!rate)return null;return(hours/HOURS_PER_DAY)*rate;}
function amsStatusBadge(s){const m={'Open':'bg-blue-50 text-blue-700 border-blue-200','In Progress':'bg-amber-50 text-amber-700 border-amber-200','Closed':'bg-green-50 text-green-700 border-green-200'};return`<span class="text-xs font-medium border ${m[s]||'bg-gray-50 text-gray-600 border-gray-200'} px-2 py-0.5 rounded-full">${esc(s||'Open')}</span>`;}
function entryDate(e){return e.dateRaised||e.date||''}
function entryType(e){return e.type||e.category||'—'}
function entryRaisedBy(e){return e.raisedBy||e.loggedBy||'—'}
function currencySymbol(client){return CURRENCIES[client?.currency||'INR']?.symbol||'₹';}
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