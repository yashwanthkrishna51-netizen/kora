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

function adminSearchBar(placeholder){
  return`<input type="text" id="admin-search-inp" data-act="admin-search" value="${esc(S.adminSearch)}" placeholder="${esc(placeholder)}" class="border border-gray-200 rounded-xl px-3.5 py-2 text-sm w-full max-w-xs focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/>`;
}

function renderAdminImpl(){
  const implClients=S.clients.filter(c=>c.modules!==undefined);
  const q=S.adminSearch.toLowerCase();
  const filtered=q?implClients.filter(c=>c.name.toLowerCase().includes(q)):implClients;
  const totalModules=implClients.reduce((a,c)=>a+(c.modules||[]).length,0);
  const totalAtRisk=implClients.reduce((a,c)=>a+implProgress(c).atRisk,0);
  return`<div>
  <div class="k-card mb-5" style="padding:18px 0;">
    <div class="k-metric-row" style="grid-template-columns:repeat(3,1fr);">
      <div class="k-metric"><div class="k-num-l">${implClients.length}</div><div class="k-eyebrow" style="margin-top:6px;">Clients</div></div>
      <div class="k-metric k-metric-teal"><div class="k-num-l">${totalModules}</div><div class="k-eyebrow" style="margin-top:6px;">Modules</div></div>
      <div class="k-metric${totalAtRisk?' k-metric-red':''}"><div class="k-num-l" style="${totalAtRisk?'color:var(--red);':''}">${totalAtRisk}</div><div class="k-eyebrow" style="margin-top:6px;">Phases At Risk</div></div>
    </div>
  </div>
  <div class="flex items-center justify-between gap-3 mb-4">
    ${adminSearchBar('Search clients…')}
    <button data-act="modal-open" data-modal="add-impl-client" class="btn-grad text-white text-sm font-semibold px-4 py-2 rounded-xl transition whitespace-nowrap">+ Add Client</button>
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
              <button data-act="modal-open" data-modal="rename-client" data-cid="${c.id}" class="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition" title="Rename client">✎</button>
              <button data-act="modal-open" data-modal="add-impl-module" data-cid="${c.id}" class="w-7 h-7 flex items-center justify-center rounded-lg text-[#0e7490] hover:bg-[#0e7490]/10 transition" title="Add module">+</button>
              ${adminRowMenu([
                {label:'✎ Rename Modules',act:'modal-open',extra:`data-modal="rename-modules" data-cid="${c.id}"`},
                {label:'Remove from Implementations',act:'delete-impl-client',extra:`data-id="${c.id}"`,danger:true}
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
    <button data-act="modal-open" data-modal="add-ams-client" class="btn-grad text-white text-sm font-semibold px-4 py-2 rounded-xl transition whitespace-nowrap">+ Add Client</button>
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
              <button data-act="modal-open" data-modal="rename-client" data-cid="${c.id}" class="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition" title="Rename client">✎</button>
              ${adminRowMenu([
                {label:'Remove from AMS',act:'delete-ams-client',extra:`data-id="${c.id}"`,danger:true}
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
  const scoped=S.clients.filter(c=>c.integrations.length>0||(c.modules===undefined&&c.workLog===undefined));
  const q=S.adminSearch.toLowerCase();
  const filtered=q?scoped.filter(c=>c.name.toLowerCase().includes(q)):scoped;
  const totalInteg=scoped.reduce((a,c)=>a+c.integrations.length,0);
  const totalAtRisk=scoped.reduce((a,c)=>a+c.integrations.filter(i=>i.status==='At Risk').length,0);
  const totalCompleted=scoped.reduce((a,c)=>a+c.integrations.filter(i=>i.status==='Completed').length,0);
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
    <button data-act="modal-open" data-modal="add-client" class="btn-grad text-white text-sm font-semibold px-4 py-2 rounded-xl transition whitespace-nowrap">+ Add Client</button>
  </div>
  <div class="bg-white rounded-2xl border border-gray-100 overflow-hidden">
    <table class="w-full text-sm">
      <thead class="border-b border-gray-100 bg-gray-50 sticky-head"><tr>
        ${['Client','Integrations','At Risk','Completed',''].map(h=>`<th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">${h}</th>`).join('')}
      </tr></thead>
      <tbody class="divide-y divide-gray-50">
        ${filtered.length?filtered.map(c=>{
          const ar=c.integrations.filter(i=>i.status==='At Risk').length;
          const co=c.integrations.filter(i=>i.status==='Completed').length;
          return`<tr class="hover:bg-gray-50/50 transition">
          <td class="px-4 py-3"><div class="font-medium text-gray-900" title="${esc(c.name)}">${esc(c.name)}</div>${c.description?`<div class="text-xs text-gray-400 truncate max-w-[180px]" title="${esc(c.description)}">${esc(c.description)}</div>`:''}</td>
          <td class="px-4 py-3 font-semibold text-gray-700">${c.integrations.length}</td>
          <td class="px-4 py-3">${ar>0?`<span class="k-badge" style="color:var(--red);border-color:var(--red);background:var(--red-hi);">${ar}</span>`:`<span class="text-gray-300 text-xs">—</span>`}</td>
          <td class="px-4 py-3">${co>0?`<span class="k-badge" style="color:var(--green);border-color:var(--green);background:var(--green-hi);">${co}</span>`:`<span class="text-gray-300 text-xs">—</span>`}</td>
          <td class="px-4 py-3">
            <div class="flex items-center justify-end gap-1">
              <button data-act="modal-open" data-modal="rename-client" data-cid="${c.id}" class="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition" title="Rename client">✎</button>
              <button data-act="modal-open" data-modal="add-integ" data-cid="${c.id}" class="w-7 h-7 flex items-center justify-center rounded-lg text-[#0e7490] hover:bg-[#0e7490]/10 transition" title="Add integration">+</button>
              ${adminRowMenu([
                {label:'✎ Rename Integrations',act:'modal-open',extra:`data-modal="rename-integrations" data-cid="${c.id}"`},
                {label:'Remove from Integrations',act:'delete-client',extra:`data-id="${c.id}"`,danger:true}
              ])}
            </div>
          </td>
        </tr>`;}).join(''):`<tr><td colspan="5" class="text-center py-8 text-gray-400 text-sm">${q?'No clients match your search':'No clients yet'}</td></tr>`}
      </tbody>
    </table>
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
  <div class="flex items-center justify-between gap-3 mb-4 flex-wrap">
    ${adminSearchBar('Search name, username, or email…')}
    <div class="flex gap-2">
      <button data-act="force-logout-all" class="bg-rose-50 border border-rose-200 text-rose-700 text-sm font-semibold px-4 py-2 rounded-xl hover:bg-rose-100 transition whitespace-nowrap">🔒 Force Logout All</button>
      <button data-act="send-welcome-all" class="bg-green-50 border border-green-200 text-green-700 text-sm font-semibold px-4 py-2 rounded-xl hover:bg-green-100 transition whitespace-nowrap">✉ Send Welcome to All</button>
      <button data-act="modal-open" data-modal="bulk-import-users" class="bg-amber-50 border border-amber-200 text-amber-700 text-sm font-semibold px-4 py-2 rounded-xl hover:bg-amber-100 transition whitespace-nowrap">⬆ Import (CSV)</button>
      <button data-act="modal-open" data-modal="add-user" class="btn-grad text-white text-sm font-semibold px-4 py-2 rounded-xl transition whitespace-nowrap">+ Add User</button>
    </div>
  </div>
  <div class="bg-white rounded-2xl border border-gray-100 overflow-hidden">
    <table class="w-full text-sm">
      <thead class="border-b border-gray-100 bg-gray-50 sticky-head"><tr>
        ${['Username','Full Name','Email','Role',''].map(h=>`<th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">${h}</th>`).join('')}
      </tr></thead>
      <tbody class="divide-y divide-gray-50">
        ${filtered.length?filtered.map(u=>`<tr class="hover:bg-gray-50/50 transition">
          <td class="px-4 py-3 font-mono text-xs text-gray-700">${esc(u.username)}</td>
          <td class="px-4 py-3 font-medium text-gray-900">${esc(u.name)}</td>
          <td class="px-4 py-3 text-xs text-gray-500">${esc(u.email||'—')}</td>
          <td class="px-4 py-3">${can('admin')&&u.id!==S.user?.id
            ?`<select data-act="change-role" data-uid="${u.id}" class="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[#0e7490]">${ROLES.map(r=>`<option${r===u.role?' selected':''}>${r}</option>`).join('')}</select>`
            :roleBadge(u.role)}
          </td>
          <td class="px-4 py-3">${u.id!==S.user?.id
            ?`<div class="flex items-center justify-end gap-1">
                <button data-act="edit-user" data-uid="${u.id}" class="w-7 h-7 flex items-center justify-center rounded-lg text-[#0e7490] hover:bg-[#0e7490]/10 transition" title="Edit user">✎</button>
                <button data-act="send-welcome-one" data-uid="${u.id}" class="w-7 h-7 flex items-center justify-center rounded-lg text-green-600 hover:bg-green-50 transition" title="Send welcome email">✉</button>
                ${adminRowMenu([
                  {label:'Force Logout',act:'force-logout-user',extra:`data-uid="${u.id}"`},
                  {label:'Delete User',act:'delete-user',extra:`data-uid="${u.id}"`,danger:true}
                ])}
              </div>`
            :`<span class="text-xs text-gray-300">current user</span>`}</td>
        </tr>`).join(''):`<tr><td colspan="5" class="text-center py-8 text-gray-400 text-sm">${q?'No users match your search':'No users yet'}</td></tr>`}
      </tbody>
    </table>
  </div>
</div>`;
}