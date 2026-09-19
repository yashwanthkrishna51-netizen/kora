// ─── ADMIN ────────────────────────────────────────────────────────
function renderAdmin(){
  return`<div class="k-page fade">
  <h1 class="text-xl font-bold text-gray-900 mb-5">Admin</h1>
  <div class="flex border-b border-gray-200 mb-6 gap-1 overflow-x-auto">
    ${[['integrations','Integrations'],['implementations','Implementations'],['ams','AMS & Support'],['pipeline','Pipeline'],['users','Users'],['audit','Audit Log']].map(([t,l])=>`<button data-act="admin-tab" data-tab="${t}" class="whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 transition ${S.adminTab===t?'border-[#0e7490] text-[#0e7490]':'border-transparent text-gray-500 hover:text-gray-800'}">${l}</button>`).join('')}
  </div>
  ${S.adminTab==='integrations'?renderAdminClients():S.adminTab==='implementations'?renderAdminImpl():S.adminTab==='ams'?renderAdminAms():S.adminTab==='pipeline'?renderAdminPipeline():S.adminTab==='audit'?renderAdminAudit():renderAdminUsers()}
</div>`;
}

function adminSearchBar(placeholder){
  return`<input type="text" id="admin-search-inp" data-act="admin-search" value="${esc(S.adminSearch)}" placeholder="${esc(placeholder)}" class="border border-gray-200 rounded-xl px-3.5 py-2 text-sm w-full max-w-xs focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/>`;
}

function renderAdminImpl(){
  fetchImplementationRagRules();
  fetchCapacityWeights();
  fetchModuleWeights();
  const implClients=S.clients.filter(c=>c.modules!==undefined);
  const q=S.adminSearch.toLowerCase();
  const filtered=q?implClients.filter(c=>c.name.toLowerCase().includes(q)):implClients;
  const totalModules=implClients.reduce((a,c)=>a+(c.modules||[]).length,0);
  const totalAtRisk=implClients.reduce((a,c)=>a+implProgress(c).atRisk,0);
  const noGovernance=implClients.filter(c=>!(c.modules||[]).some(m=>m.name==='Governance')).length;
  const hasGovernance=implClients.filter(c=>(c.modules||[]).some(m=>m.name==='Governance')).length;
  const rules=S.implementationRagRules||{forceRed:true,redDays:14,amberDays:7};
  return`<div>
  <div class="k-card mb-5" style="padding:18px 0;">
    <div class="k-metric-row" style="grid-template-columns:repeat(3,1fr);">
      <div class="k-metric"><div class="k-num-l">${implClients.length}</div><div class="k-eyebrow" style="margin-top:6px;">Clients</div></div>
      <div class="k-metric k-metric-teal"><div class="k-num-l">${totalModules}</div><div class="k-eyebrow" style="margin-top:6px;">Modules</div></div>
      <div class="k-metric${totalAtRisk?' k-metric-red':''}"><div class="k-num-l" style="${totalAtRisk?'color:var(--red);':''}">${totalAtRisk}</div><div class="k-eyebrow" style="margin-top:6px;">Phases At Risk</div></div>
    </div>
  </div>

  <div class="bg-white rounded-2xl border border-gray-100 p-4 mb-5">
    <h2 class="text-base font-bold text-gray-900 mb-1">RAG Configuration</h2>
    <p class="text-xs text-gray-500 mb-4">Controls how Red/Amber/Green is calculated for every Implementation client — shown to users via the "How is RAG calculated?" panel on each client's page.</p>
    <label class="flex items-start gap-2 mb-3 cursor-pointer">
      <input id="rag-flag-incomplete" type="checkbox" ${rules.flagIncomplete?'checked':''} class="w-4 h-4 mt-0.5 accent-[#0e7490]"/>
      <span class="text-sm text-gray-700">Flag records with missing required fields as <b class="text-rose-600">Red</b> <span class="text-gray-400">— clears automatically per-record once someone opens it, fills in Assignee/Dates/Activity/Next Action, and saves. Recommended: on.</span></span>
    </label>
    <label class="flex items-start gap-2 mb-4 cursor-pointer">
      <input id="rag-force-red" type="checkbox" ${rules.forceRed?'checked':''} class="w-4 h-4 mt-0.5 accent-[#0e7490]"/>
      <span class="text-sm text-gray-700">Emergency override: force <i>every</i> record to <b class="text-rose-600">Red</b>, ignoring everything else <span class="text-gray-400">— a blunt global switch, not the day-to-day setting. Turn this off once you don't need it — leave "Flag missing fields" above on instead.</span></span>
    </label>
    <div class="grid grid-cols-2 gap-3 mb-4 max-w-md">
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Red after (days overdue / stale)</label><input id="rag-red-days" type="number" min="1" max="365" value="${rules.redDays}" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Amber after (days stale, no update)</label><input id="rag-amber-days" type="number" min="1" max="365" value="${rules.amberDays}" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
    </div>
    <button data-act="save-impl-rag-rules" class="text-sm font-semibold px-4 py-2 rounded-xl bg-[#0e7490] text-white hover:bg-[#0d3d4f]">Save RAG Rules</button>
  </div>

  ${(()=>{
    const cw=S.capacityWeights;
    // Every unique module name in use, with how many clients carry one and
    // how many of those are still running on the catalog default.
    const catalog={};
    implClients.forEach(c=>(c.modules||[]).forEach(m=>{
      const k=(m.name||'').trim(); if(!k) return;
      if(!catalog[k]) catalog[k]={name:k,count:0,unset:0};
      catalog[k].count++;
      if(moduleWeightUnset(m)) catalog[k].unset++;
    }));
    const rows=Object.values(catalog).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
    const totalUnset=rows.reduce((a,r)=>a+r.unset,0);
    const saved=S.moduleWeights||{};
    return `
  <div class="bg-white rounded-2xl border border-gray-100 p-4 mb-5">
    <h2 class="text-base font-bold text-gray-900 mb-1">Capacity Weights</h2>
    <p class="text-xs text-gray-500 mb-4">Feeds Team Bandwidth on the dashboard. Module effort is no longer a flat number here — it comes from the catalog below, or from a weight set on the module itself.</p>
    <div class="grid grid-cols-3 gap-3 mb-4 max-w-xl">
      <div><label class="block text-xs font-medium text-gray-500 mb-1">PMO per client</label><input id="cw-pmo" type="number" step="0.25" min="0.25" max="50" value="${cw.pmo}" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">AMS per open ticket</label><input id="cw-ams" type="number" step="0.25" min="0.25" max="50" value="${cw.ams}" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Capacity cap per person</label><input id="cw-cap" type="number" step="0.5" min="0.5" max="50" value="${cw.cap}" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
    </div>
    <button data-act="save-capacity-weights-admin" class="text-sm font-semibold px-4 py-2 rounded-xl bg-[#0e7490] text-white hover:bg-[#0d3d4f]">Save Capacity Weights</button>
  </div>

  <div class="bg-white rounded-2xl border border-gray-100 p-4 mb-5">
    <h2 class="text-base font-bold text-gray-900 mb-1">Module Weight Catalog</h2>
    <p class="text-xs text-gray-500 mb-1">Every unique module name across your ${implClients.length} Implementation client${implClients.length!==1?'s':''}. The weight here is the <b>default</b> applied when a module of that name is created.</p>
    <p class="text-xs text-gray-400 mb-4">A weight set on an individual module always wins, so editing this table never silently re-weights work already running. Use "Apply to unset modules" for the one-time backfill.</p>
    ${rows.length?`
    <div class="border border-gray-100 rounded-xl overflow-hidden mb-3">
      <table class="w-full text-sm">
        <thead class="bg-gray-50 border-b border-gray-100"><tr>
          <th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Module</th>
          <th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Used by</th>
          <th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">On default</th>
          <th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-32">Standard weight</th>
        </tr></thead>
        <tbody class="divide-y divide-gray-50">
          ${rows.map((r,i)=>`<tr>
            <td class="px-3 py-2 font-medium text-gray-900">${esc(r.name)}</td>
            <td class="px-3 py-2 text-gray-500">${r.count} client${r.count!==1?'s':''}</td>
            <td class="px-3 py-2">${r.unset?`<span class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-0.5">${r.unset}</span>`:`<span class="text-xs text-gray-300">—</span>`}</td>
            <td class="px-3 py-2"><input data-mwname="${esc(r.name)}" id="mw-${i}" type="number" step="0.25" min="0.25" max="50" value="${esc(String(saved[r.name] ?? 1))}" class="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="flex flex-wrap gap-2">
      <button data-act="save-module-weights" class="text-sm font-semibold px-4 py-2 rounded-xl bg-[#0e7490] text-white hover:bg-[#0d3d4f]">Save Catalog</button>
      <button data-act="apply-module-weights" class="text-sm font-semibold px-4 py-2 rounded-xl ${totalUnset?'bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100':'bg-gray-50 border border-gray-200 text-gray-400'} transition">Apply to unset modules${totalUnset?` (${totalUnset})`:' (none)'}</button>
    </div>`:`<p class="text-sm text-gray-400">No modules yet.</p>`}
  </div>`;
  })()}

  <div class="bg-white rounded-2xl border border-gray-100 p-4 mb-5">
    <h2 class="text-base font-bold text-gray-900 mb-1">Governance Module</h2>
    <p class="text-xs text-gray-500 mb-3">Every Implementation client should carry a default "Governance" module (effort 1, assigned to the client's Master Assignee). New clients get this automatically — use this to backfill existing ones.</p>
    <button data-act="bulk-add-governance" class="text-sm font-semibold px-4 py-2 rounded-xl ${noGovernance?'bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100':'bg-gray-50 border border-gray-200 text-gray-400'} transition">+ Add Governance Module to All Clients${noGovernance?` (${noGovernance} missing)`:' (none missing)'}</button>
    <button data-act="bulk-remove-governance" class="text-sm font-semibold px-4 py-2 rounded-xl mt-2 ${hasGovernance?'bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100':'bg-gray-50 border border-gray-200 text-gray-400'} transition">🗑 Remove Governance Module from All Clients${hasGovernance?` (${hasGovernance} client${hasGovernance!==1?'s':''})`:' (none)'}</button>
  </div>

  <div class="flex items-center justify-between gap-3 mb-4">
    ${adminSearchBar('Search clients…')}
    <div class="flex gap-2">
      <button data-act="exp-admin-excel" data-domain="impl" class="bg-gray-50 border border-gray-200 text-gray-600 text-sm font-semibold px-4 py-2 rounded-xl hover:bg-gray-100 transition whitespace-nowrap">⬇ Export Excel</button>
      <button data-act="modal-open" data-modal="add-impl-client" class="btn-grad text-white text-sm font-semibold px-4 py-2 rounded-xl transition whitespace-nowrap">+ Add Client</button>
    </div>
  </div>
  <div class="bg-white rounded-2xl border border-gray-100 overflow-hidden">
    <table class="w-full text-sm">
      <thead class="border-b border-gray-100 bg-gray-50 sticky-head"><tr>
        ${['Client','Modules','At Risk Phases',''].map(h=>`<th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">${h}</th>`).join('')}
      </tr></thead>
      <tbody class="divide-y divide-gray-50">
        ${filtered.length?filtered.map(c=>{
          const pr=implProgress(c);
          return`<tr class="hover:bg-gray-50/50 transition">
          <td class="px-4 py-3"><div class="font-medium text-gray-900" title="${esc(c.name)}">${esc(c.name)}</div>${c.description?`<div class="text-xs text-gray-400 truncate max-w-[180px]" title="${esc(c.description)}">${esc(c.description)}</div>`:''}</td>
          <td class="px-4 py-3 font-semibold text-gray-700">${(c.modules||[]).length}</td>
          <td class="px-4 py-3">${pr.atRisk>0?`<span class="k-badge" style="color:var(--red);border-color:var(--red);background:var(--red-hi);">${pr.atRisk} at risk</span>`:`<span class="text-gray-300 text-xs">—</span>`}</td>
          <td class="px-4 py-3">
            <div class="flex items-center justify-end gap-1">
              <button data-act="modal-open" data-modal="rename-client" data-cid="${esc(c.id)}" class="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition" title="Rename client">✎</button>
              <button data-act="modal-open" data-modal="add-impl-module" data-cid="${esc(c.id)}" class="w-7 h-7 flex items-center justify-center rounded-lg text-[#0e7490] hover:bg-[#0e7490]/10 transition" title="Add module">+</button>
              ${adminRowMenu([
                {label:'✎ Rename Modules',act:'modal-open',extra:`data-modal="rename-modules" data-cid="${esc(c.id)}"`},
                {label:'Remove from Implementations',act:'delete-impl-client',extra:`data-id="${esc(c.id)}"`,danger:true}
              ])}
            </div>
          </td>
        </tr>`;}).join(''):`<tr><td colspan="4" class="text-center py-8 text-gray-400 text-sm">${q?'No clients match your search':'No implementation clients yet'}</td></tr>`}
      </tbody>
    </table>
  </div>
</div>`;
}

function renderAdminAms(){
  const amsClients=S.clients.filter(c=>c.workLog!==undefined);
  const q=S.adminSearch.toLowerCase();
  const filtered=q?amsClients.filter(c=>c.name.toLowerCase().includes(q)):amsClients;
  const totalHours=amsClients.reduce((a,c)=>a+amsTotals(c,'','').totalHours,0);
  const retainerCount=amsClients.filter(c=>!c.manDayRate).length;
  return`<div>
  <div class="k-card mb-5" style="padding:18px 0;">
    <div class="k-metric-row" style="grid-template-columns:repeat(3,1fr);">
      <div class="k-metric"><div class="k-num-l">${amsClients.length}</div><div class="k-eyebrow" style="margin-top:6px;">Clients</div></div>
      <div class="k-metric k-metric-teal"><div class="k-num-l">${totalHours.toFixed(1)}</div><div class="k-eyebrow" style="margin-top:6px;">Total Hours Logged</div></div>
      <div class="k-metric"><div class="k-num-l">${retainerCount}</div><div class="k-eyebrow" style="margin-top:6px;">On Retainer</div></div>
    </div>
  </div>
  <div class="flex items-center justify-between gap-3 mb-4">
    ${adminSearchBar('Search clients…')}
    <div class="flex gap-2">
      <button data-act="exp-admin-excel" data-domain="ams" class="bg-gray-50 border border-gray-200 text-gray-600 text-sm font-semibold px-4 py-2 rounded-xl hover:bg-gray-100 transition whitespace-nowrap">⬇ Export Excel</button>
      <button data-act="modal-open" data-modal="add-ams-client" class="btn-grad text-white text-sm font-semibold px-4 py-2 rounded-xl transition whitespace-nowrap">+ Add Client</button>
    </div>
  </div>
  <div class="bg-white rounded-2xl border border-gray-100 overflow-hidden">
    <table class="w-full text-sm">
      <thead class="border-b border-gray-100 bg-gray-50 sticky-head"><tr>
        ${['Client','Day Rate','Total Hours Logged',''].map(h=>`<th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">${h}</th>`).join('')}
      </tr></thead>
      <tbody class="divide-y divide-gray-50">
        ${filtered.length?filtered.map(c=>{
          const t=amsTotals(c,'','');
          return`<tr class="hover:bg-gray-50/50 transition">
          <td class="px-4 py-3"><div class="font-medium text-gray-900" title="${esc(c.name)}">${esc(c.name)}</div>${c.description?`<div class="text-xs text-gray-400 truncate max-w-[180px]" title="${esc(c.description)}">${esc(c.description)}</div>`:''}</td>
          <td class="px-4 py-3">${c.manDayRate?`<span class="font-semibold text-gray-700">₹${c.manDayRate.toLocaleString('en-IN')}</span>`:`<span class="k-badge">Retainer</span>`}</td>
          <td class="px-4 py-3 text-gray-600">${t.totalHours.toFixed(1)}</td>
          <td class="px-4 py-3">
            <div class="flex items-center justify-end gap-1">
              <button data-act="modal-open" data-modal="rename-client" data-cid="${esc(c.id)}" class="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition" title="Rename client">✎</button>
              ${adminRowMenu([
                {label:'Remove from AMS',act:'delete-ams-client',extra:`data-id="${esc(c.id)}"`,danger:true}
              ])}
            </div>
          </td>
        </tr>`;}).join(''):`<tr><td colspan="4" class="text-center py-8 text-gray-400 text-sm">${q?'No clients match your search':'No AMS clients yet'}</td></tr>`}
      </tbody>
    </table>
  </div>
</div>`;
}

function renderAdminClients(){
  const scoped=S.clients.filter(c=>(c.integrations||[]).length>0||(c.modules===undefined&&c.workLog===undefined));
  const q=S.adminSearch.toLowerCase();
  const filtered=q?scoped.filter(c=>c.name.toLowerCase().includes(q)):scoped;
  const totalInteg=scoped.reduce((a,c)=>a+(c.integrations||[]).length,0);
  const totalAtRisk=scoped.reduce((a,c)=>a+(c.integrations||[]).filter(i=>i.status==='At Risk').length,0);
  const totalCompleted=scoped.reduce((a,c)=>a+(c.integrations||[]).filter(i=>i.status==='Completed').length,0);
  return`<div>
  <div class="k-card mb-5" style="padding:18px 0;">
    <div class="k-metric-row" style="grid-template-columns:repeat(4,1fr);">
      <div class="k-metric"><div class="k-num-l">${scoped.length}</div><div class="k-eyebrow" style="margin-top:6px;">Clients</div></div>
      <div class="k-metric k-metric-teal"><div class="k-num-l">${totalInteg}</div><div class="k-eyebrow" style="margin-top:6px;">Integrations</div></div>
      <div class="k-metric${totalAtRisk?' k-metric-red':''}"><div class="k-num-l" style="${totalAtRisk?'color:var(--red);':''}">${totalAtRisk}</div><div class="k-eyebrow" style="margin-top:6px;">At Risk</div></div>
      <div class="k-metric k-metric-green"><div class="k-num-l" style="${totalCompleted?'color:var(--green);':''}">${totalCompleted}</div><div class="k-eyebrow" style="margin-top:6px;">Completed</div></div>
    </div>
  </div>
  <div class="flex items-center justify-between gap-3 mb-4">
    ${adminSearchBar('Search clients…')}
    <div class="flex gap-2">
      <button data-act="exp-admin-excel" data-domain="integrations" class="bg-gray-50 border border-gray-200 text-gray-600 text-sm font-semibold px-4 py-2 rounded-xl hover:bg-gray-100 transition whitespace-nowrap">⬇ Export Excel</button>
      <button data-act="modal-open" data-modal="add-client" class="btn-grad text-white text-sm font-semibold px-4 py-2 rounded-xl transition whitespace-nowrap">+ Add Client</button>
    </div>
  </div>
  <div class="bg-white rounded-2xl border border-gray-100 overflow-hidden">
    <table class="w-full text-sm">
      <thead class="border-b border-gray-100 bg-gray-50 sticky-head"><tr>
        ${['Client','Integrations','At Risk','Completed',''].map(h=>`<th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">${h}</th>`).join('')}
      </tr></thead>
      <tbody class="divide-y divide-gray-50">
        ${filtered.length?filtered.map(c=>{
          const ar=(c.integrations||[]).filter(i=>i.status==='At Risk').length;
          const co=(c.integrations||[]).filter(i=>i.status==='Completed').length;
          return`<tr class="hover:bg-gray-50/50 transition">
          <td class="px-4 py-3"><div class="font-medium text-gray-900" title="${esc(c.name)}">${esc(c.name)}</div>${c.description?`<div class="text-xs text-gray-400 truncate max-w-[180px]" title="${esc(c.description)}">${esc(c.description)}</div>`:''}</td>
          <td class="px-4 py-3 font-semibold text-gray-700">${(c.integrations||[]).length}</td>
          <td class="px-4 py-3">${ar>0?`<span class="k-badge" style="color:var(--red);border-color:var(--red);background:var(--red-hi);">${ar}</span>`:`<span class="text-gray-300 text-xs">—</span>`}</td>
          <td class="px-4 py-3">${co>0?`<span class="k-badge" style="color:var(--green);border-color:var(--green);background:var(--green-hi);">${co}</span>`:`<span class="text-gray-300 text-xs">—</span>`}</td>
          <td class="px-4 py-3">
            <div class="flex items-center justify-end gap-1">
              <button data-act="modal-open" data-modal="rename-client" data-cid="${esc(c.id)}" class="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition" title="Rename client">✎</button>
              <button data-act="modal-open" data-modal="add-integ" data-cid="${esc(c.id)}" class="w-7 h-7 flex items-center justify-center rounded-lg text-[#0e7490] hover:bg-[#0e7490]/10 transition" title="Add integration">+</button>
              ${adminRowMenu([
                {label:'✎ Rename Integrations',act:'modal-open',extra:`data-modal="rename-integrations" data-cid="${esc(c.id)}"`},
                {label:'Remove from Integrations',act:'delete-client',extra:`data-id="${esc(c.id)}"`,danger:true}
              ])}
            </div>
          </td>
        </tr>`;}).join(''):`<tr><td colspan="5" class="text-center py-8 text-gray-400 text-sm">${q?'No clients match your search':'No clients yet'}</td></tr>`}
      </tbody>
    </table>
  </div>
</div>`;
}

function screenLabel(s){
  if(!s)return'—';
  return s.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
}
function auditActionClass(action){
  const a=(action||'').toLowerCase();
  if(a.includes('failed')||a.includes('delete')||a.includes('force logout'))return'text-rose-700';
  if(a.includes('login success')||a.includes('add')||a.includes('import'))return'text-emerald-700';
  return'text-gray-800';
}
function renderAdminPipeline(){
  fetchPipelineStats();
  fetchPipelineStageWeights();
  const stats = S.pipelineStats;
  const weights = S.pipelineStageWeights || {};
  return `<div class="space-y-5">
    <div>
      <h2 class="text-base font-bold text-gray-900 mb-1">Pipeline Funnel</h2>
      <p class="text-xs text-gray-500 mb-4">Stage counts and conversion, computed live from every tracked opportunity.</p>
      ${!stats ? `<div class="text-sm text-gray-400 py-8 text-center">Loading…</div>` : `
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div class="bg-white rounded-2xl border border-gray-100 p-4"><div class="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1">Win Rate</div><div class="text-xl font-extrabold text-gray-900">${stats.winRate === null ? '—' : stats.winRate + '%'}</div></div>
        <div class="bg-white rounded-2xl border border-gray-100 p-4"><div class="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1">Weighted Value (Open)</div><div class="text-xl font-extrabold text-gray-900">₹${Number(stats.weightedValue || 0).toLocaleString('en-IN')}</div></div>
        <div class="bg-white rounded-2xl border border-gray-100 p-4"><div class="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1">Avg. Days to Close</div><div class="text-xl font-extrabold text-gray-900">${stats.avgDaysToClose === null ? '—' : stats.avgDaysToClose + 'd'}</div></div>
        <div class="bg-white rounded-2xl border border-gray-100 p-4"><div class="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1">Open Opportunities</div><div class="text-xl font-extrabold text-gray-900">${stats.totalOpen}</div></div>
      </div>
      <div class="bg-white rounded-2xl border border-gray-100 p-4 mb-5">
        <div class="text-xs font-semibold text-gray-600 mb-3">Stage Breakdown</div>
        <div class="space-y-2">
          ${stats.funnel.map(f => `<div class="flex items-center gap-3"><span class="text-xs text-gray-500 w-28 shrink-0">${esc(f.stage)}</span><div class="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden"><div class="h-2 rounded-full" style="width:${stats.funnel[0].count ? Math.round(f.count / Math.max(1, Math.max(...stats.funnel.map(x=>x.count))) * 100) : 0}%;background:#${PIPELINE_STAGE_HEX[f.stage] || '94a3b8'};"></div></div><span class="text-xs font-semibold text-gray-700 w-6 text-right">${f.count}</span></div>`).join('')}
        </div>
      </div>`}
    </div>

    <div>
      <h2 class="text-base font-bold text-gray-900 mb-1">Stage Win Probabilities</h2>
      <p class="text-xs text-gray-500 mb-4">Default probability % applied when an opportunity moves to each stage — feeds the weighted pipeline value. Editable per-deal too.</p>
      <div class="bg-white rounded-2xl border border-gray-100 p-4">
        <div class="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
          ${PIPELINE_STAGES.map(s => `<div><label class="block text-xs font-medium text-gray-500 mb-1">${esc(s)}</label><div class="relative"><input id="psw-${esc(s)}" type="number" min="0" max="100" value="${weights[s] ?? 0}" class="w-full border border-gray-200 rounded-xl px-3 py-2 pr-7 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/><span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span></div></div>`).join('')}
        </div>
        <button data-act="save-pipeline-weights" class="text-sm font-semibold px-4 py-2 rounded-xl bg-[#0e7490] text-white hover:bg-[#0d3d4f]">Save Stage Weights</button>
      </div>
    </div>
  </div>`;
}

function renderAdminAudit(){
  const users=S.usersForDropdown||[];
  const rows=S.auditRows||[];
  const totalPages=Math.max(1,Math.ceil((S.auditTotal||0)/S.auditPageSize));
  return`<div>
  <div class="flex gap-2 mb-3 flex-wrap">
    ${[['24h', 'Last 24 Hours'], ['deletes', 'All Deletes'], ['logins', 'All Logins']].map(([k, l]) => `<button data-act="audit-preset" data-key="${k}" class="text-xs font-medium px-3 py-1.5 rounded-full border border-gray-200 text-gray-600 hover:border-[#0e7490] hover:text-[#0e7490] transition">${l}</button>`).join('')}
  </div>
  <div class="flex items-end gap-3 mb-4 flex-wrap">
    <div>
      <label class="block text-xs font-semibold text-gray-500 mb-1">From</label>
      <input type="date" data-act="audit-from" value="${esc(S.auditFrom)}" class="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/>
    </div>
    <div>
      <label class="block text-xs font-semibold text-gray-500 mb-1">To</label>
      <input type="date" data-act="audit-to" value="${esc(S.auditTo)}" class="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/>
    </div>
    <div>
      <label class="block text-xs font-semibold text-gray-500 mb-1">User</label>
      <select data-act="audit-user" class="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]">
        <option value="">All users</option>
        ${users.map(u=>`<option value="${esc(u.username)}"${S.auditUser===u.username?' selected':''}>${esc(u.name||u.username)}</option>`).join('')}
      </select>
    </div>
    <div class="flex-1 min-w-[180px]">
      <label class="block text-xs font-semibold text-gray-500 mb-1">Search action</label>
      <input type="text" id="audit-search-inp" data-act="audit-search" value="${esc(S.auditSearch)}" placeholder="e.g. delete, login, client name…" class="border border-gray-200 rounded-xl px-3.5 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/>
    </div>
    <button data-act="audit-apply" class="btn-grad text-white text-sm font-semibold px-4 py-2 rounded-xl transition whitespace-nowrap">Apply Filters</button>
    <button data-act="audit-clear" class="bg-gray-50 border border-gray-200 text-gray-600 text-sm font-semibold px-4 py-2 rounded-xl hover:bg-gray-100 transition whitespace-nowrap">Clear</button>
    <button data-act="audit-export" class="bg-green-50 border border-green-200 text-green-700 text-sm font-semibold px-4 py-2 rounded-xl hover:bg-green-100 transition whitespace-nowrap">⬇ Export Excel</button>
  </div>
  <div class="text-xs text-gray-500 mb-2">${S.auditTotal||0} event${S.auditTotal===1?'':'s'} match${S.auditTotal===1?'es':''} current filters</div>
  <div class="bg-white rounded-2xl border border-gray-100 overflow-hidden">
    <table class="w-full text-sm">
      <thead class="border-b border-gray-100 bg-gray-50 sticky-head"><tr>
        ${['Timestamp','User','Role','Action','Screen','IP'].map(h=>`<th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">${h}</th>`).join('')}
      </tr></thead>
      <tbody class="divide-y divide-gray-50">
        ${S.auditLoading?`<tr><td colspan="6" class="text-center py-8 text-gray-400 text-sm">Loading…</td></tr>`
          :rows.length?rows.map(r=>`<tr class="hover:bg-gray-50/50 transition">
          <td class="px-4 py-3 font-mono text-xs text-gray-700 whitespace-nowrap">${fmtDateTime(r.ts)}</td>
          <td class="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">${esc(r.username||'—')}</td>
          <td class="px-4 py-3">${r.role?roleBadge(r.role):'—'}</td>
          <td class="px-4 py-3 ${auditActionClass(r.action)}">${esc(r.action||'—')}</td>
          <td class="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">${esc(screenLabel(r.screen))}</td>
          <td class="px-4 py-3 font-mono text-xs text-gray-400 whitespace-nowrap">${esc(r.ip||'—')}</td>
        </tr>`).join(''):`<tr><td colspan="6" class="text-center py-8 text-gray-400 text-sm">No events match current filters</td></tr>`}
      </tbody>
    </table>
  </div>
  <div class="flex items-center justify-between mt-4">
    <button data-act="audit-prev" ${S.auditPage<=0?'disabled':''} class="text-sm font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition disabled:opacity-40 disabled:cursor-not-allowed">← Prev</button>
    <span class="text-xs text-gray-500">Page ${S.auditPage+1} of ${totalPages}</span>
    <button data-act="audit-next" ${S.auditPage+1>=totalPages?'disabled':''} class="text-sm font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition disabled:opacity-40 disabled:cursor-not-allowed">Next →</button>
  </div>
</div>`;
}
function renderAdminUsers(){
  const q=S.adminSearch.toLowerCase();
  const filtered=q?S.users.filter(u=>u.name.toLowerCase().includes(q)||u.username.toLowerCase().includes(q)||(u.email||'').toLowerCase().includes(q)):S.users;
  const byRole={admin:0,editor:0,viewer:0};
  S.users.forEach(u=>{byRole[u.role]=(byRole[u.role]||0)+1;});
  return`<div>
  <div class="k-card mb-5" style="padding:18px 0;">
    <div class="k-metric-row" style="grid-template-columns:repeat(4,1fr);">
      <div class="k-metric"><div class="k-num-l">${S.users.length}</div><div class="k-eyebrow" style="margin-top:6px;">Total Users</div></div>
      <div class="k-metric"><div class="k-num-l" style="color:#7c3aed;">${byRole.admin||0}</div><div class="k-eyebrow" style="margin-top:6px;">Admins</div></div>
      <div class="k-metric"><div class="k-num-l" style="color:#0e7490;">${byRole.editor||0}</div><div class="k-eyebrow" style="margin-top:6px;">Editors</div></div>
      <div class="k-metric"><div class="k-num-l" style="color:#64748b;">${byRole.viewer||0}</div><div class="k-eyebrow" style="margin-top:6px;">Viewers</div></div>
    </div>
  </div>
  <div class="k-card mb-5" style="padding:16px 18px;">
    <h3 class="text-sm font-bold text-gray-900 mb-1">System Maintenance</h3>
    <p class="text-xs text-gray-400 mb-3">One-time or repair tasks. Safe to re-run anytime — none of these touch your live records, only their backing/derived data.</p>
    <div class="flex flex-wrap gap-2">
      <button data-act="modal-open" data-modal="admin-task-runner" data-task-label="Resync V2 Tables" data-task-endpoint="/api/ops?op=backfill" data-task-description="Re-syncs every client into the new normalized v2 tables — catches up anything created before dual-write existed, or anything a save silently failed to sync." class="text-xs font-medium px-3 py-2 rounded-xl border border-gray-200 text-gray-600 hover:border-[#0e7490] hover:text-[#0e7490] transition">🔄 Resync V2 Tables</button>
      <button data-act="recompute-snapshot-now" class="text-xs font-medium px-3 py-2 rounded-xl border border-gray-200 text-gray-600 hover:border-[#0e7490] hover:text-[#0e7490] transition">📸 Recompute Snapshot Now</button>
    </div>
  </div>
  <div class="k-card mb-5" style="padding:16px 18px;">
    <h3 class="text-sm font-bold text-gray-900 mb-1">Preview Mode</h3>
    <p class="text-xs text-gray-400 mb-3">See the app as an editor or viewer would. Your real access is unchanged — this only changes what you see, and you can exit anytime from the banner at the top.</p>
    <div class="flex items-center gap-2">
      <select id="view-as-select" class="text-xs border border-gray-200 rounded-lg px-2.5 py-2">
        <option value="editor">Editor</option>
        <option value="viewer">Viewer</option>
      </select>
      <button data-act="activate-view-as" class="text-xs font-medium px-3 py-2 rounded-xl border border-gray-200 text-gray-600 hover:border-[#0e7490] hover:text-[#0e7490] transition">👁 Preview</button>
    </div>
  </div>
  <div class="flex items-center justify-between gap-3 mb-4 flex-wrap">
    ${adminSearchBar('Search name, username, or email…')}
    <div class="flex gap-2">
      <button data-act="toggle-bulk-users" class="whitespace-nowrap text-sm font-medium px-4 py-2 rounded-xl transition border ${S.bulkUserMode ? 'bg-rose-50 border-rose-200 text-rose-600' : 'border-gray-200 text-gray-600 hover:border-gray-300'}">${S.bulkUserMode ? '✕ Cancel' : '☑ Bulk Role'}</button>
      <button data-act="force-logout-all" class="bg-rose-50 border border-rose-200 text-rose-700 text-sm font-semibold px-4 py-2 rounded-xl hover:bg-rose-100 transition whitespace-nowrap">🔒 Force Logout All</button>
      <button data-act="open-digest-recipients" class="bg-green-50 border border-green-200 text-green-700 text-sm font-semibold px-4 py-2 rounded-xl hover:bg-green-100 transition whitespace-nowrap">✉ Digest Recipients</button>
      <button data-act="modal-open" data-modal="admin-task-runner" data-task-label="Send Daily Digest Now" data-task-endpoint="/api/cron/daily-digest" data-task-description="Sends today's reminder digest immediately — the same logic as the scheduled 9am run, evaluated against current data. Safe to run anytime; it doesn't skip or double up anything." class="bg-teal-50 border border-teal-200 text-teal-700 text-sm font-semibold px-4 py-2 rounded-xl hover:bg-teal-100 transition whitespace-nowrap">📧 Send Digest Now</button>
      <button data-act="modal-open" data-modal="bulk-import-users" class="bg-amber-50 border border-amber-200 text-amber-700 text-sm font-semibold px-4 py-2 rounded-xl hover:bg-amber-100 transition whitespace-nowrap">⬆ Import (CSV)</button>
      <button data-act="modal-open" data-modal="add-user" class="btn-grad text-white text-sm font-semibold px-4 py-2 rounded-xl transition whitespace-nowrap">+ Add User</button>
    </div>
  </div>
  <div class="bg-white rounded-2xl border border-gray-100 overflow-hidden">
    <table class="w-full text-sm">
      <thead class="border-b border-gray-100 bg-gray-50 sticky-head"><tr>
        ${['Username','Full Name','Email','Last Active','Role',''].map(h=>`<th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">${h}</th>`).join('')}
      </tr></thead>
      <tbody class="divide-y divide-gray-50">
        ${filtered.length?filtered.map(u=>`<tr class="hover:bg-gray-50/50 transition">
          <td class="px-4 py-3 font-mono text-xs text-gray-700">${S.bulkUserMode&&u.id!==S.user?.id?`<input type="checkbox" ${S.bulkUserSelected.has(u.id)?'checked':''} class="rounded mr-2 align-middle" data-act="toggle-bulk-user-row" data-uid="${esc(u.id)}"/>`:''}${esc(u.username)}${u.lockedUntil&&new Date(u.lockedUntil)>new Date()?`<span class="ml-2 inline-flex items-center gap-1 text-[10px] font-semibold text-rose-600 bg-rose-50 border border-rose-200 rounded-full px-2 py-0.5 normal-case">🔒 Locked</span>`:''}</td>
          <td class="px-4 py-3 font-medium text-gray-900">${esc(u.name)}</td>
          <td class="px-4 py-3 text-xs text-gray-500">${esc(u.email||'—')}</td>
          <td class="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">${S.lastActiveMap[u.username]?fmtDateTime(S.lastActiveMap[u.username]):'<span class="text-gray-300">Never</span>'}</td>
          <td class="px-4 py-3">${can('admin')&&u.id!==S.user?.id
            ?`<select data-act="change-role" data-uid="${esc(u.id)}" class="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[#0e7490]">${ROLES.map(r=>`<option${r===u.role?' selected':''}>${r}</option>`).join('')}</select>`
            :roleBadge(u.role)}
          </td>
          <td class="px-4 py-3">${u.id!==S.user?.id
            ?`<div class="flex items-center justify-end gap-1">
                <button data-act="edit-user" data-uid="${esc(u.id)}" class="w-7 h-7 flex items-center justify-center rounded-lg text-[#0e7490] hover:bg-[#0e7490]/10 transition" title="Edit user">✎</button>
                ${adminRowMenu([
                  {label:'Force Logout',act:'force-logout-user',extra:`data-uid="${esc(u.id)}"`},
                  ...(u.lockedUntil&&new Date(u.lockedUntil)>new Date()?[{label:'Clear Lockout',act:'clear-lockout',extra:`data-uid="${esc(u.id)}"`}]:[]),
                  {label:'Delete User',act:'delete-user',extra:`data-uid="${esc(u.id)}"`,danger:true}
                ])}
              </div>`
            :`<span class="text-xs text-gray-300">current user</span>`}</td>
        </tr>`).join(''):`<tr><td colspan="6" class="text-center py-8 text-gray-400 text-sm">${q?'No users match your search':'No users yet'}</td></tr>`}
      </tbody>
    </table>
  </div>
  ${S.bulkUserMode ? `<div class="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-200 shadow-xl px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
    <div class="flex items-center gap-3">
      <div class="w-9 h-9 rounded-full bg-[#0e7490]/10 flex items-center justify-center text-sm font-bold text-[#0e7490]">${S.bulkUserSelected.size}</div>
      <div class="font-semibold text-gray-900 text-sm">${S.bulkUserSelected.size===0?'No users selected':`${S.bulkUserSelected.size} user${S.bulkUserSelected.size!==1?'s':''} selected`}</div>
    </div>
    <div class="flex items-center gap-2">
      <select id="bulk-role-select" class="text-sm border border-gray-200 rounded-xl px-3 py-2">${ROLES.map(r=>`<option value="${r}">${r}</option>`).join('')}</select>
      <button data-act="toggle-bulk-users" class="text-sm text-gray-500 border border-gray-200 px-4 py-2 rounded-xl hover:bg-gray-50 transition">Cancel</button>
      <button data-act="bulk-role-apply" ${S.bulkUserSelected.size===0?'disabled class="bg-gray-100 text-gray-400 text-sm font-semibold px-5 py-2 rounded-xl cursor-not-allowed"':'class="btn-grad text-white text-sm font-semibold px-5 py-2 rounded-xl transition"'}>Apply Role</button>
    </div>
  </div>
  <div class="h-20"></div>`:''}
</div>`;
}