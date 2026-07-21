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
          <td class="px-4 py-3"><div class="flex gap-2 flex-wrap">
            <button data-act="modal-open" data-modal="rename-client" data-cid="${c.id}" class="text-xs text-gray-500 hover:text-gray-800 font-medium">✎ Rename</button>
            <button data-act="modal-open" data-modal="rename-modules" data-cid="${c.id}" class="text-xs text-gray-500 hover:text-gray-800 font-medium">✎ Rename Modules</button>
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
          <td class="px-4 py-3"><div class="flex gap-2 flex-wrap">
            <button data-act="modal-open" data-modal="rename-client" data-cid="${c.id}" class="text-xs text-gray-500 hover:text-gray-800 font-medium">✎ Rename</button>
            <button data-act="delete-ams-client" data-id="${c.id}" class="text-xs text-rose-400 hover:text-rose-600 font-medium">Remove from AMS</button>
          </div></td>
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
        ${S.clients.filter(c=>c.integrations.length>0||(c.modules===undefined&&c.workLog===undefined)).map(c=>`<tr class="hover:bg-gray-50/50 transition">
          <td class="px-4 py-3"><div class="font-medium text-gray-900" title="${esc(c.name)}">${esc(c.name)}</div>${c.description?`<div class="text-xs text-gray-400 truncate max-w-[180px]" title="${esc(c.description)}">${esc(c.description)}</div>`:''}</td>
          <td class="px-4 py-3 font-semibold text-gray-700">${c.integrations.length}</td>
          <td class="px-4 py-3">${c.integrations.filter(i=>i.status==='At Risk').length>0?`<span class="text-rose-600 font-semibold">${c.integrations.filter(i=>i.status==='At Risk').length}</span>`:`<span class="text-gray-400">0</span>`}</td>
          <td class="px-4 py-3">${c.integrations.filter(i=>i.status==='Completed').length>0?`<span class="text-green-600 font-semibold">${c.integrations.filter(i=>i.status==='Completed').length}</span>`:`<span class="text-gray-400">0</span>`}</td>
          <td class="px-4 py-3"><div class="flex gap-2 flex-wrap">
            <button data-act="modal-open" data-modal="rename-client" data-cid="${c.id}" class="text-xs text-gray-500 hover:text-gray-800 font-medium">✎ Rename</button>
            <button data-act="modal-open" data-modal="rename-integrations" data-cid="${c.id}" class="text-xs text-gray-500 hover:text-gray-800 font-medium">✎ Rename Integrations</button>
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