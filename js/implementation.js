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
      const ringColor=rag==='Red'?'var(--red)':rag==='Amber'?'var(--amber)':'var(--green)';
      const atRiskPhases=mods.reduce((a,m)=>a+(m.phases||[]).filter(ph=>ph.status==='At Risk').length,0);
      return`<div data-act="open-impl-client" data-id="${c.id}" style="animation-delay:${Math.min(idx*35,400)}ms" class="row-in card-hover bg-white rounded-2xl border border-gray-100 p-5 hover:border-[#0e7490]/30 transition cursor-pointer">
        <div class="flex items-center gap-3.5">
          ${ringSvg(pr.pct,ringColor)}
          <div class="flex-1 min-w-0">
            <div class="font-semibold text-gray-900 truncate" title="${esc(c.name)}">${esc(c.name)}</div>
            <div class="text-xs text-gray-400 mt-0.5 truncate">${c.description?esc(c.description):`${mods.length} module${mods.length!==1?'s':''}`}</div>
          </div>
        </div>
        <div class="flex gap-5 mt-3.5 pt-3 border-t border-gray-100">
          ${miniStat(mods.length,'modules')}
          ${miniStat(`${pr.completed}/${pr.total}`,'phases')}
          ${miniStat(atRiskPhases,'at risk',atRiskPhases>0?'var(--red)':undefined)}
        </div>
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
        ${can('edit')?`<button data-act="save-impl-phase" data-cid="${c.id}" data-mid="${mod.id}" data-phase="${esc(phaseName)}" class="w-full btn-grad text-white font-semibold rounded-xl py-2.5 text-sm transition">Save Details</button>`:''}
      </div>
    </div>
    <div class="bg-white rounded-2xl border border-gray-100 p-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-semibold text-gray-900 text-sm flex items-center gap-1.5">
          <svg class="w-4 h-4 text-[#0e7490]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
          Activity <span class="text-gray-400 font-normal">(${ph.updates.length})</span>
        </h3>
      </div>
      ${can('edit')?`<div class="flex gap-2.5 mb-4">
        ${avatarChip(S.user?.name)}
        <div class="flex-1 min-w-0">
          <div class="bg-gray-50 rounded-2xl rounded-tl-md px-3.5 py-2.5">
            <textarea id="ip-update-input" rows="2" placeholder="Post an update…" class="w-full bg-transparent text-sm resize-none outline-none"></textarea>
          </div>
          <div class="flex gap-2 mt-2">
            <input id="ip-attach-label" type="text" placeholder="File label e.g. Signoff Mail (optional)" class="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/>
            <label class="cursor-pointer flex items-center gap-1.5 text-xs font-medium text-[#0e7490] bg-[#0e7490]/8 border border-[#0e7490]/30 px-3 py-2 rounded-xl hover:bg-[#0e7490]/15 transition whitespace-nowrap shrink-0">
              📎 Attach File
              <input id="ip-attach-file" type="file" class="hidden" accept=".pdf,.xlsx,.xls,.jpg,.jpeg,.png,.gif,.webp"/>
            </label>
          </div>
          <div id="ip-attach-preview" class="hidden mt-2 text-xs text-[#0e7490] bg-[#0e7490]/8 px-2.5 py-1.5 rounded-xl flex items-center gap-2">
            <span id="ip-attach-icon">📎</span><span id="ip-attach-name" class="flex-1 truncate"></span>
            <button data-act="clear-attach" data-prefix="ip" class="text-gray-400 hover:text-rose-500 shrink-0">✕</button>
          </div>
          <input id="ip-attach-url" type="hidden" value=""/>
          <input id="ip-attach-mimetype" type="hidden" value=""/>
          <input id="ip-attach-filename" type="hidden" value=""/>
          <div class="flex items-center gap-3 mt-2 pl-1">
            <span class="text-[11px] text-gray-400">PDF, Excel or image, max 3MB · posts immediately</span>
            <div class="flex-1"></div>
            <button data-act="add-impl-update" data-cid="${c.id}" data-mid="${mod.id}" data-phase="${esc(phaseName)}" title="Post update" class="w-8 h-8 rounded-full bg-[#0e7490] hover:bg-[#0d3d4f] flex items-center justify-center transition shrink-0">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 19V5M5 12l7-7 7 7"/></svg>
            </button>
          </div>
        </div>
      </div>`:''}
      <div class="space-y-4 max-h-[440px] overflow-y-auto pr-1">
        ${!ph.updates.length?`<div class="text-sm text-gray-400 text-center py-8">${emptyIcon('clock')}No updates yet</div>`:
        ph.updates.map((t,idx,arr)=>{
          const isEditing=S.editingTimelineId===t.id;
          const hasHistory=t.edits&&t.edits.length>0;
          const isExpanded=S.expandedHistory.has(t.id);
          if(isEditing){
            return`<div class="flex gap-2.5">
              ${avatarChip(t.addedBy)}
              <div class="flex-1 min-w-0">
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
            ${t.attachment?.url?attachmentChip(t.attachment):''}
            <div class="flex items-center gap-3 mt-1.5 pl-1">
              ${can('edit')?`<button data-act="edit-timeline" data-tid="${t.id}" class="text-[11px] text-gray-400 hover:text-[#0e7490]">Edit</button>`:''}
              ${can('admin')?`<button data-act="delete-impl-update" data-cid="${c.id}" data-mid="${mod.id}" data-phase="${esc(phaseName)}" data-tid="${t.id}" class="text-[11px] text-gray-400 hover:text-rose-500">Delete</button>`:''}
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
</div>`;
}
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