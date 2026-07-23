// ─── CLIENT LIST ──────────────────────────────────────────────────
function renderClientList(){
  const q=S.search.toLowerCase();
  const inIntegDomain=c=>c.integrations.length>0||(c.modules===undefined&&c.workLog===undefined);
  const fl=S.clients.filter(inIntegDomain).filter(c=>c.name.toLowerCase().includes(q));
  const scoped=S.clients.filter(inIntegDomain);
  const ti=scoped.reduce((a,c)=>a+c.integrations.length,0);
  const ar=scoped.reduce((a,c)=>a+c.integrations.filter(i=>i.status==='At Risk').length,0);
  const ip=scoped.reduce((a,c)=>a+c.integrations.filter(i=>i.status==='In Progress').length,0);
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
      const total=c.integrations.length;
      const completed=c.integrations.filter(i=>i.status==='Completed').length;
      const pct=total?completed/total*100:0;
      return`<div data-act="open-client" data-id="${c.id}" style="animation-delay:${Math.min(idx*35,400)}ms" class="row-in card-hover bg-white rounded-2xl border border-gray-100 p-5 hover:border-[#0e7490]/30 transition cursor-pointer">
        <div class="flex items-center gap-3.5">
          ${ringSvg(pct,healthVar(c))}
          <div class="flex-1 min-w-0">
            <div class="font-semibold text-gray-900 truncate" title="${esc(c.name)}">${esc(c.name)}</div>
            <div class="text-xs text-gray-400 mt-0.5 truncate">${c.description?esc(c.description):`${total} integration${total!==1?'s':''}`}</div>
          </div>
        </div>
        <div class="flex gap-5 mt-3.5 pt-3 border-t border-gray-100">
          ${miniStat(total,'integrations')}
          ${miniStat(ar2,'at risk',ar2>0?'var(--red)':undefined)}
          ${miniStat(od2,'overdue',od2>0?'var(--amber)':undefined)}
        </div>
      </div>`;
    }).join(''):`<div class="col-span-3 text-center py-16 text-gray-400">${emptyIcon('search')}No clients match "${esc(S.search)}"</div>`}
  </div>
</div>`;
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

function renderClientDetail(clientId){
  const c=S.clients.find(x=>x.id===clientId);
  if(!c)return`<div class="p-8 text-gray-400">Client not found</div>`;
  const fl=S.filter==='all'?c.integrations:c.integrations.filter(i=>i.status===S.filter);
  const sorted=sortIntegs(fl);
  const cols=[['name','Integration'],['status','Status'],['assignee','Assignee'],['due','Due Date'],['lastUpdate','Last Update']];
  return`<div class="k-page fade">
  <div class="flex flex-wrap items-start justify-between gap-4 mb-5">
    <div><h1 class="text-xl font-bold text-gray-900">${esc(c.name)}</h1>${c.description?`<p class="text-sm text-gray-400 mt-0.5">${esc(c.description)}</p>`:''}</div>
    <div class="flex items-center gap-2">
    ${can('admin')?`<button data-act="toggle-bulk-integ" data-cid="${c.id}" class="whitespace-nowrap text-sm font-medium px-4 py-2 rounded-xl transition ${S.bulkIntegMode&&S.bulkIntegCid===c.id?'bg-rose-50 border border-rose-200 text-rose-600':'border border-gray-200 text-gray-600 hover:border-gray-300'}">${S.bulkIntegMode&&S.bulkIntegCid===c.id?'✕ Cancel':'☑ Select'}</button>`:''}
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
  </div>
  <div class="flex gap-2 overflow-x-auto pb-1 mb-5 items-center">
    ${['all',...STATUSES].map(st=>`<button data-act="filter" data-filter="${st}" class="whitespace-nowrap text-xs font-medium px-3 py-1.5 rounded-full transition ${S.filter===st?'bg-[#0e7490] text-white':'bg-white border border-gray-200 text-gray-600 hover:border-[#0e7490]/40'}">${st==='all'?`All (${c.integrations.length})`:esc(st)+` (${c.integrations.filter(i=>i.status===st).length})`}</button>`).join('')}
    <button data-act="modal-open" data-modal="add-integ" data-cid="${c.id}" class="whitespace-nowrap text-xs font-medium px-3 py-1.5 rounded-full bg-green-50 border border-green-200 text-green-700 hover:bg-green-100 ml-auto">+ Add Integration</button>
  </div>
  ${S.bulkIntegMode&&S.bulkIntegCid===c.id?`<div class="flex items-center gap-3 mb-3 px-4 py-2.5 bg-rose-50 border border-rose-200 rounded-xl">
    <span class="text-sm text-rose-700 font-medium">Select integrations to delete</span>
  </div>`:''}
  <div class="bg-white rounded-2xl border border-gray-100 overflow-hidden${S.bulkIntegMode&&S.bulkIntegCid===c.id?' ring-2 ring-rose-300':''}">
    <table class="w-full text-sm">
      <thead class="border-b border-gray-100 bg-gray-50 sticky-head">
        <tr>${S.bulkIntegMode&&S.bulkIntegCid===c.id?`<th class="px-4 py-3 w-10"><input type="checkbox" data-act="toggle-bulk-integ-all" data-cid="${c.id}" ${sorted.length&&sorted.every(i=>S.bulkIntegSelected.has(i.id))?'checked':''} class="rounded"/></th>`:''}${cols.map(([k,l])=>`<th data-act="sort" data-key="${k}" data-sort class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer transition select-none">${l} ${sortArrow(k)}</th>`).join('')}</tr>
      </thead>
      <tbody class="divide-y divide-gray-50">
        ${sorted.length?sorted.map(i=>{
          const lu=lastUpdateDate(i);
          const bulkOn=S.bulkIntegMode&&S.bulkIntegCid===c.id;
          return`<tr class="hover:bg-gray-50/60 transition${bulkOn?'':' cursor-pointer'}" ${bulkOn?'':`data-act="open-integ" data-cid="${c.id}" data-iid="${i.id}"`}>
          ${bulkOn?`<td class="px-4 py-3"><input type="checkbox" data-act="toggle-bulk-integ-row" data-cid="${c.id}" data-iid="${i.id}" ${S.bulkIntegSelected.has(i.id)?'checked':''} class="rounded"/></td>`:''}
          <td class="px-4 py-3"${bulkOn?` data-act="open-integ" data-cid="${c.id}" data-iid="${i.id}"`:''}><div class="font-medium text-gray-900" title="${esc(i.name)}">${esc(i.name)}</div>${i.description?`<div class="text-xs text-gray-400 truncate max-w-xs" title="${esc(i.description)}">${esc(i.description)}</div>`:''}</td>
          <td class="px-4 py-3" onclick="event.stopPropagation()">${can('editor')?`<select data-act="inline-status" data-cid="${c.id}" data-iid="${i.id}" class="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#0e7490]">${STATUSES.map(s=>`<option value="${esc(s)}"${s===i.status?' selected':''}>${esc(s)}</option>`).join('')}</select>`:sbadge(i.status)}</td>
          <td class="px-4 py-3 text-gray-600" onclick="event.stopPropagation()">${can('editor')?`<select data-act="inline-assignee" data-cid="${c.id}" data-iid="${i.id}" class="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#0e7490] max-w-[140px]">${assigneeOptionsOnly(i.assignee)}</select>`:esc(i.assignee||'—')}</td>
          <td class="px-4 py-3"${bulkOn?'':` data-act="open-integ" data-cid="${c.id}" data-iid="${i.id}"`}><div class="flex flex-col gap-1"><span class="text-gray-600">${fmtDate(i.dueDate)}</span>${overdueBadge(i)}</div></td>
          <td class="px-4 py-3 text-gray-500"${bulkOn?'':` data-act="open-integ" data-cid="${c.id}" data-iid="${i.id}"`}>${lu?fmtDate(lu):'<span class="text-amber-600 text-xs font-medium">No updates</span>'}</td>
        </tr>`;}).join(''):`<tr><td colspan="6" class="text-center py-12 text-gray-400 text-sm">No integrations match this filter</td></tr>`}
      </tbody>
    </table>
  </div>
  ${S.bulkIntegMode&&S.bulkIntegCid===c.id?`<div class="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-200 shadow-xl px-6 py-4 flex items-center justify-between gap-4">
    <div class="flex items-center gap-3">
      <div class="w-9 h-9 rounded-full bg-rose-100 flex items-center justify-center text-sm font-bold text-rose-700">${S.bulkIntegSelected.size}</div>
      <div>
        <div class="font-semibold text-gray-900 text-sm">${S.bulkIntegSelected.size===0?'No integrations selected':S.bulkIntegSelected.size===1?'1 integration selected':`${S.bulkIntegSelected.size} integrations selected`}</div>
        <div class="text-xs text-gray-400">This cannot be undone</div>
      </div>
    </div>
    <div class="flex items-center gap-3">
      <button data-act="toggle-bulk-integ" data-cid="${c.id}" class="text-sm text-gray-500 border border-gray-200 px-4 py-2 rounded-xl hover:bg-gray-50 transition">Cancel</button>
      <button data-act="bulk-delete-integ" data-cid="${c.id}" ${S.bulkIntegSelected.size===0?'disabled class="bg-gray-100 text-gray-400 text-sm font-semibold px-5 py-2 rounded-xl cursor-not-allowed"':'class="bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold px-5 py-2 rounded-xl transition"'}>
        🗑 Delete ${S.bulkIntegSelected.size||''} Selected
      </button>
    </div>
  </div>
  <div class="h-20"></div>`:''}
</div>`;
}

// ─── INTEG DETAIL ─────────────────────────────────────────────────
function renderIntegDetail(clientId,integId){
  const c=S.clients.find(x=>x.id===clientId);
  const i=c?.integrations.find(x=>x.id===integId);
  if(!c||!i)return`<div class="p-8 text-gray-400">Not found</div>`;
  return`<div class="max-w-6xl mx-auto px-6 py-7 fade">
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
        ${can('edit')?`<button data-act="save-integ" data-cid="${c.id}" data-iid="${i.id}" class="w-full btn-grad text-white font-semibold rounded-xl py-2.5 text-sm transition">Save Details</button>`:''}
        ${can('edit')&&i.status!=='Completed'?`<button data-act="mark-complete" data-cid="${c.id}" data-iid="${i.id}" class="w-full text-green-700 bg-green-50 hover:bg-green-100 font-medium rounded-xl py-2 text-xs transition">✓ Mark as Complete</button>`:''}
        ${can('admin')?`<button data-act="delete-integ" data-cid="${c.id}" data-iid="${i.id}" class="w-full text-rose-400 hover:text-rose-600 text-xs py-1 transition">Delete Integration</button>`:''}
      </div>
    </div>
    <div class="bg-white rounded-2xl border border-gray-100 p-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-semibold text-gray-900 text-sm flex items-center gap-1.5">
          <svg class="w-4 h-4 text-[#0e7490]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
          Activity <span class="text-gray-400 font-normal">(${i.timeline?.length||0})</span>
        </h3>
      </div>
      ${can('edit')?`<div class="flex gap-2.5 mb-4">
        ${avatarChip(S.user?.name)}
        <div class="flex-1 min-w-0">
          <div class="bg-gray-50 rounded-2xl rounded-tl-md px-3.5 py-2.5">
            <textarea id="tl-input" rows="2" placeholder="Post an update…" class="w-full bg-transparent text-sm resize-none outline-none"></textarea>
          </div>
          <div class="flex items-center gap-3 mt-1.5 pl-1">
            <span class="text-[11px] text-gray-400">Posts immediately — no need to Save Details</span>
            <div class="flex-1"></div>
            <button data-act="add-timeline" data-cid="${c.id}" data-iid="${i.id}" title="Post update" class="w-8 h-8 rounded-full bg-[#0e7490] hover:bg-[#0d3d4f] flex items-center justify-center transition shrink-0">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 19V5M5 12l7-7 7 7"/></svg>
            </button>
          </div>
        </div>
      </div>`:''}
      <div class="space-y-4 max-h-[440px] overflow-y-auto pr-1">
        ${!(i.timeline?.length)?`<div class="text-sm text-gray-400 text-center py-8">${emptyIcon('clock')}No updates yet</div>`:
        i.timeline.map((t,idx,arr)=>{
          const isEditing=S.editingTimelineId===t.id;
          const hasHistory=t.edits&&t.edits.length>0;
          const isExpanded=S.expandedHistory.has(t.id);
          if(isEditing){
            return`<div class="flex gap-2.5">
              ${avatarChip(t.addedBy)}
              <div class="flex-1 min-w-0">
                <div class="text-xs font-semibold text-[#0e7490] mb-1">${esc(t.date)} · ${esc(t.addedBy||'')}</div>
                <textarea id="edit-tl-${t.id}" rows="3" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490] resize-none">${esc(t.update)}</textarea>
                <div class="flex gap-2 mt-2">
                  <button data-act="cancel-edit-timeline" class="flex-1 text-xs font-medium text-gray-500 border border-gray-200 rounded-lg py-1.5 hover:bg-gray-50 transition">Cancel</button>
                  <button data-act="save-edit-timeline" data-cid="${c.id}" data-iid="${i.id}" data-tid="${t.id}" class="flex-1 text-xs font-semibold text-white bg-[#0e7490] rounded-lg py-1.5 hover:bg-[#0d3d4f] transition">Save Edit</button>
                </div>
              </div>
            </div>`;
          }
          return`<div class="flex gap-2.5">
          ${avatarChip(t.addedBy)}
          <div class="flex-1 min-w-0">
            <div class="flex items-baseline gap-2 flex-wrap">
              <span class="text-sm font-medium text-gray-900">${esc(t.addedBy||'Unknown')}</span>
              <span class="text-xs text-gray-400">${esc(t.date)}${t.addedAt?` · ${fmtDate(t.addedAt)}`:''}</span>
              ${hasHistory?`<button data-act="toggle-history" data-tid="${t.id}" class="text-xs text-amber-600 hover:text-amber-700 font-medium">edited${t.edits.length>1?` (${t.edits.length}×)`:''} — ${isExpanded?'hide':'view'}</button>`:''}
            </div>
            <div class="bg-gray-50 rounded-2xl rounded-tl-md px-3.5 py-2.5 mt-1 text-sm text-gray-700 leading-relaxed">${esc(t.update)}</div>
            <div class="flex items-center gap-3 mt-1.5 pl-1">
              ${can('edit')?`<button data-act="edit-timeline" data-tid="${t.id}" class="text-[11px] text-gray-400 hover:text-[#0e7490]">Edit</button>`:''}
              ${can('admin')?`<button data-act="delete-timeline-entry" data-cid="${c.id}" data-iid="${i.id}" data-tid="${t.id}" class="text-[11px] text-gray-400 hover:text-rose-500">Delete</button>`:''}
              <button data-act="copy-update" data-text="${esc(t.update)}" class="text-[11px] text-gray-400 hover:text-[#0e7490]">Copy</button>
            </div>
            ${isExpanded&&hasHistory?`<div class="mt-2 pl-3 border-l-2 border-amber-200 space-y-2">
              ${[...t.edits].reverse().map(e=>`<div class="text-xs"><div class="text-gray-400 mb-0.5">${fmtDate(e.editedAt)} · ${esc(e.editedBy||'')} changed it from:</div><div class="text-gray-500">${esc(e.text)}</div></div>`).join('')}
            </div>`:''}
          </div>
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