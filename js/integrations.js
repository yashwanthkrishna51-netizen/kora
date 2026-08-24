// ─── CLIENT LIST — replaced by the 3-column renderClientDetail below,
// which now also handles the bare "no client selected yet" case ───
function parseIntegrationsCsv(text, existingIntegs = []) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (!lines.length) return [];
  const hasHeader = lines[0].toLowerCase().includes('name') || lines[0].toLowerCase().includes('integration');
  const dataLines = hasHeader ? lines.slice(1) : lines;
  return dataLines.map((line, i) => {
    const p = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    const [name, status, assignee, due_date, description, next_action] = p;
    let error = null;
    if (!name) error = 'name required';
    else if (existingIntegs.find(x => x.name.toLowerCase() === name.toLowerCase())) error = `"${name}" already exists`;
    return { name: name || '', status: STATUSES.includes(status) ? status : 'Not Started', assignee: assignee || '', dueDate: due_date || '', description: description || '', nextAction: next_action || '', error, row: i + (hasHeader ? 2 : 1) };
  });
}

// Client rail sort — 'name' (alphabetical), 'health' (worst RAG first), or
// 'overdue' (most overdue integrations first). Kept local to this file since
// it's rail-display logic, not shared elsewhere.
function sortRailClients(list, sortKey) {
  const arr = [...list];
  if (sortKey === 'health') {
    const rank = { Red: 0, Amber: 1, Green: 2 };
    arr.sort((a, b) => (rank[integRagLabel(a)] ?? 3) - (rank[integRagLabel(b)] ?? 3) || a.name.localeCompare(b.name));
  } else if (sortKey === 'overdue') {
    const odCount = cl => cl.integrations.filter(isOverdue).length;
    arr.sort((a, b) => odCount(b) - odCount(a) || a.name.localeCompare(b.name));
  } else {
    arr.sort((a, b) => a.name.localeCompare(b.name));
  }
  return arr;
}
function renderClientDetail(clientId) {
  const inIntegDomain = x => x.integrations.length > 0 || (x.modules === undefined && x.workLog === undefined);
  const allClients = S.clients.filter(inIntegDomain);
  const c = S.clients.find(x => x.id === clientId) || allClients[0];
  if (!c) return `<div class="k-page fade"><div class="bg-white rounded-2xl border border-gray-100 text-center py-16 text-gray-400 text-sm">${emptyIcon('inbox')}No clients yet. <button data-act="modal-open" data-modal="add-client" class="text-[#0e7490] font-medium ml-1">Add one</button></div></div>`;
  const railQ = S.integRailFilter.trim().toLowerCase();
  const railClients = sortRailClients(railQ ? allClients.filter(cl => cl.name.toLowerCase().includes(railQ)) : allClients, S.integRailSort);
  const fl = (S.filter === 'all' ? c.integrations : c.integrations.filter(i => i.status === S.filter))
    .filter(i => !S.integMineOnly || (i.assignee || '').trim().toLowerCase() === (S.user?.name || '').trim().toLowerCase());
  const sorted = sortIntegs(fl);
  const cols = [['name', 'Integration'], ['status', 'Status'], ['assignee', 'Assignee'], ['due', 'Due Date'], ['lastUpdate', 'Last Update']];

  // ── COLUMN 1: client bento rail — real bento cards (ring + health color,
  // same visual language as everywhere else in the app), not a flat list.
  // Stacked vertically since the column is narrow, but each entry is a
  // genuine card: rounded, bordered, hover-lift — not a dense list row.
  const clientRail = `<div class="overflow-y-auto pr-1" style="max-height:calc(100vh - 132px);">
    <div class="flex items-center justify-between mb-2 px-1">
      <span class="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">${railClients.length}${railClients.length !== allClients.length ? ` of ${allClients.length}` : ''} Client${allClients.length !== 1 ? 's' : ''}</span>
      <button data-act="modal-open" data-modal="add-client" title="Add Client" class="text-[#0e7490] text-lg leading-none font-bold">+</button>
    </div>
    <div class="flex items-center gap-1.5 mb-3 px-1">
      <input type="text" id="integ-rail-filter-inp" data-act="integ-rail-filter" value="${esc(S.integRailFilter)}" placeholder="Filter clients…" class="flex-1 min-w-0 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/>
      <select data-act="integ-rail-sort" class="text-xs border border-gray-200 rounded-lg px-1.5 py-1.5 text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#0e7490]" title="Sort clients">
        <option value="name"${S.integRailSort === 'name' ? ' selected' : ''}>Name</option>
        <option value="health"${S.integRailSort === 'health' ? ' selected' : ''}>Health</option>
        <option value="overdue"${S.integRailSort === 'overdue' ? ' selected' : ''}>Overdue</option>
      </select>
    </div>
    <div class="flex flex-col gap-3">
      ${!railClients.length ? `<div class="text-center py-8 text-xs text-gray-400">No clients match "${esc(S.integRailFilter)}"</div>` : railClients.map(cl => {
    const ar = cl.integrations.filter(i => i.status === 'At Risk').length;
    const od = cl.integrations.filter(isOverdue).length;
    const total = cl.integrations.length;
    const completed = cl.integrations.filter(i => i.status === 'Completed').length;
    const pct = total ? completed / total * 100 : 0;
    const active = cl.id === c.id;
    return `<div data-act="open-client" data-id="${esc(cl.id)}" class="card-hover cursor-pointer bg-white rounded-2xl border p-4 ${active ? 'border-[#0e7490] ring-1 ring-[#0e7490]/30' : 'border-gray-100'}">
        <div class="flex items-center gap-3">
          ${ringSvg(pct, healthVar(cl), 40)}
          <div class="flex-1 min-w-0">
            <div class="font-semibold text-sm truncate" style="color:${active ? '#0e7490' : '#111827'}">${esc(cl.name)}</div>
            <div class="text-xs text-gray-400 mt-0.5 truncate">${total} integration${total !== 1 ? 's' : ''}</div>
          </div>
        </div>
        ${ar || od ? `<div class="flex gap-3 mt-3 pt-2.5 border-t border-gray-50">
          ${ar ? `<div class="text-xs"><span class="font-semibold text-rose-600">${ar}</span> <span class="text-gray-400">at risk</span></div>` : ''}
          ${od ? `<div class="text-xs"><span class="font-semibold text-amber-600">${od}</span> <span class="text-gray-400">overdue</span></div>` : ''}
        </div>` : ''}
      </div>`;
  }).join('')}
    </div>
  </div>`;

  // ── COLUMNS 2+3: unchanged from the existing, already-shipped master-detail —
  // reused verbatim, just no longer carrying its own top-level page header
  // (that's now Column 1's job) since this is nested inside the 3-column grid.
  const listAndDetail = `<div>
  <div class="flex flex-wrap items-start justify-between gap-4 mb-4">
    <div><h1 class="text-xl font-bold text-gray-900">${esc(c.name)}</h1>${c.description ? `<p class="text-sm text-gray-400 mt-0.5">${esc(c.description)}</p>` : ''}</div>
    <div class="flex items-center gap-2">
    ${can('admin') ? `<button data-act="toggle-bulk-integ" data-cid="${esc(c.id)}" class="whitespace-nowrap text-sm font-medium px-4 py-2 rounded-xl transition ${S.bulkIntegMode && S.bulkIntegCid === c.id ? 'bg-rose-50 border border-rose-200 text-rose-600' : 'border border-gray-200 text-gray-600 hover:border-gray-300'}">${S.bulkIntegMode && S.bulkIntegCid === c.id ? '✕ Cancel' : '☑ Select'}</button>` : ''}
    ${exportMenuButton(`integ-${c.id}`, [
    { label: '📊 PowerPoint', act: 'exp-pptx', data: { cid: c.id } },
    { label: '📄 PDF', act: 'exp-pdf', data: { cid: c.id } },
    { label: '✉ Email PDF to Client', act: 'open-client-email', data: { cid: c.id } },
    { label: '📋 Excel (Integrations)', act: 'exp-excel', data: { etype: 'integrations', cid: c.id } },
    { label: '🎯 Excel (Milestones)', act: 'exp-excel', data: { etype: 'milestones', cid: c.id } },
    { label: '⬆ Import Integrations (CSV)', act: 'open-import-integ', data: { cid: c.id } },
  ])}
    </div>
  </div>
  <div class="flex gap-2 items-center mb-4">
    <div class="flex gap-2 overflow-x-auto pb-1 flex-1 min-w-0">
      ${['all', ...STATUSES].map(st => `<button data-act="filter" data-filter="${st}" class="whitespace-nowrap text-xs font-medium px-3 py-1.5 rounded-full transition ${S.filter === st ? 'bg-[#0e7490] text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-[#0e7490]/40'}">${st === 'all' ? `All (${c.integrations.length})` : esc(st) + ` (${c.integrations.filter(i => i.status === st).length})`}</button>`).join('')}
    </div>
    <div class="flex gap-2 items-center shrink-0">
      <button data-act="toggle-integ-mine" class="whitespace-nowrap text-xs font-medium px-3 py-1.5 rounded-full transition ${S.integMineOnly ? 'bg-[#0e7490] text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-[#0e7490]/40'}">👤 Mine</button>
      <button data-act="modal-open" data-modal="add-integ" data-cid="${esc(c.id)}" class="whitespace-nowrap text-xs font-medium px-3 py-1.5 rounded-full bg-green-50 border border-green-200 text-green-700 hover:bg-green-100">+ Add Integration</button>
    </div>
  </div>
  ${S.bulkIntegMode && S.bulkIntegCid === c.id ? `<div class="flex items-center gap-3 mb-3 px-4 py-2.5 bg-rose-50 border border-rose-200 rounded-xl">
    <span class="text-sm text-rose-700 font-medium">Select integrations to delete</span>
  </div>`: ''}
  ${(() => {
      const bulkOn = S.bulkIntegMode && S.bulkIntegCid === c.id;
      if (!sorted.length) return `<div class="bg-white rounded-2xl border border-gray-100 text-center py-16 text-gray-400 text-sm">${emptyIcon('search')}No integrations match this filter</div>`;
      const selId = S.selectedIntegId && sorted.some(i => i.id === S.selectedIntegId) ? S.selectedIntegId : sorted[0].id;
      const sel = sorted.find(i => i.id === selId);
      if (!sel) return `<div class="bg-white rounded-2xl border border-gray-100 text-center py-16 text-gray-400 text-sm">${emptyIcon('search')}No integration selected</div>`;
      const lu = lastUpdateDate(sel);
      const selTimeline = sel.timeline || [];
      const selMilestones = sel.milestones || [];
      return `<div class="bg-white rounded-2xl border border-gray-100 overflow-hidden grid grid-cols-12${bulkOn ? ' ring-2 ring-rose-300' : ''}" style="min-height:460px;">
    <div class="col-span-5 lg:col-span-4 border-r border-gray-100 overflow-y-auto" style="max-height:680px;">
      <div class="px-3 py-2 bg-gray-50 border-b border-gray-100 text-[11px] font-semibold text-gray-400 uppercase tracking-wide sticky top-0 flex items-center justify-between">
        <span>${sorted.length} integration${sorted.length !== 1 ? 's' : ''}</span>
        ${bulkOn ? `<input type="checkbox" data-act="toggle-bulk-integ-all" data-cid="${esc(c.id)}" ${sorted.every(i => S.bulkIntegSelected.has(i.id)) ? 'checked' : ''} class="rounded"/>` : `<select data-act="integ-sort-select" class="text-[10px] border-none bg-transparent text-gray-400 focus:outline-none">${cols.map(([k, l]) => `<option value="${esc(k)}"${S.sort.key === k ? ' selected' : ''}>${l}</option>`).join('')}</select>`}
      </div>
      ${sorted.map(i => {
        const active = i.id === selId;
        return `<div ${bulkOn ? `data-act="toggle-bulk-integ-row" data-cid="${esc(c.id)}" data-iid="${esc(i.id)}"` : `data-act="select-integ" data-iid="${esc(i.id)}"`} class="px-3 py-2.5 border-b border-gray-50 cursor-pointer transition flex items-start gap-2 ${active && !bulkOn ? 'bg-[#0e7490]/5 border-l-2 border-l-[#0e7490]' : 'border-l-2 border-l-transparent hover:bg-gray-50'}">
          ${bulkOn ? `<input type="checkbox" ${S.bulkIntegSelected.has(i.id) ? 'checked' : ''} class="rounded mt-0.5" onclick="event.stopPropagation()" data-act="toggle-bulk-integ-row" data-cid="${esc(c.id)}" data-iid="${esc(i.id)}"/>` : ''}
          <div class="flex-1 min-w-0">
            <div class="flex justify-between items-baseline gap-2">
              <span class="text-xs font-medium text-gray-900 truncate">${esc(i.name)}</span>
              <span class="text-xs shrink-0 ${isOverdue(i) ? 'text-rose-600 font-semibold' : 'text-gray-400'}">${fmtDate(i.dueDate)}</span>
            </div>
            <div class="text-xs text-gray-500 truncate mt-0.5">${i.description ? esc(i.description) : '—'}</div>
            <div class="flex gap-1.5 mt-1.5 flex-wrap">${sbadge(i.status)}${overdueBadge(i)}${staleBadge(i)}</div>
          </div>
        </div>`;
      }).join('')}
    </div>
    <div class="col-span-7 lg:col-span-8 p-6 overflow-y-auto flex flex-col justify-between" style="max-height:680px;">
      <div class="space-y-4">
        <!-- Top Toolbar -->
        <div class="flex items-center justify-between pb-3 border-b border-gray-100 flex-wrap gap-2">
          <div class="flex items-center gap-2 flex-wrap">${sbadge(sel.status)}${overdueBadge(sel)}${staleBadge(sel)}</div>
          <div class="flex items-center gap-2">
            <button data-act="copy-link" data-url="${esc((window?.location?.origin || '') + viewToPath('integ-detail', { clientId: c.id, integId: sel.id }))}" title="Copy shareable link" class="text-xs font-medium text-gray-500 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:border-[#0e7490] hover:text-[#0e7490] transition bg-white">🔗 Copy Link</button>
            <button data-act="open-integ" data-cid="${esc(c.id)}" data-iid="${esc(sel.id)}" class="text-xs font-semibold text-white bg-[#0e7490] hover:bg-[#0c627a] rounded-lg px-3.5 py-1.5 transition shadow-sm">Open Full Record →</button>
          </div>
        </div>

        <!-- Header Info -->
        <div>
          <h2 class="text-lg font-bold text-gray-900 tracking-tight">${esc(sel.name)}</h2>
          <p class="text-xs text-gray-500 mt-0.5">${sel.description ? esc(sel.description) : 'No description provided.'}</p>
        </div>

        <!-- Next Action Callout (if present) -->
        ${sel.nextAction ? `<div class="p-3 bg-amber-50/70 border border-amber-200/80 rounded-xl">
          <div class="text-[11px] font-bold text-amber-800 uppercase tracking-wide flex items-center gap-1.5 mb-1">
            <span>⚡</span> Next Action
          </div>
          <div class="text-xs text-amber-900 leading-relaxed">${esc(sel.nextAction)}</div>
        </div>` : ''}

        <!-- 3-Column Attributes Grid -->
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2">
          <div class="bg-gray-50/80 rounded-xl p-3 border border-gray-100">
            <span class="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Status</span>
            <div>${can('editor') ? `<select data-act="inline-status" data-cid="${esc(c.id)}" data-iid="${esc(sel.id)}" class="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-[#0e7490] w-full">${STATUSES.map(s => `<option value="${esc(s)}"${s === sel.status ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>` : sbadge(sel.status)}</div>
          </div>
          <div class="bg-gray-50/80 rounded-xl p-3 border border-gray-100">
            <span class="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Assignee</span>
            <div>${can('editor') ? `<select data-act="inline-assignee" data-cid="${esc(c.id)}" data-iid="${esc(sel.id)}" class="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-[#0e7490] w-full">${assigneeOptionsOnly(sel.assignee)}</select>` : `<div class="flex items-center gap-1.5"><span class="w-5 h-5 rounded-full bg-[#0e7490]/10 text-[#0e7490] text-[10px] font-bold flex items-center justify-center">${esc((sel.assignee || '?')[0])}</span><span class="text-xs text-gray-800 font-medium truncate">${esc(sel.assignee || 'Unassigned')}</span></div>`}</div>
          </div>
          <div class="bg-gray-50/80 rounded-xl p-3 border border-gray-100">
            <span class="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Due Date</span>
            <div class="text-xs font-semibold ${isOverdue(sel) ? 'text-rose-600' : 'text-gray-800'} flex items-center gap-1">
              <span>📅</span> ${fmtDate(sel.dueDate)}
            </div>
          </div>
          <div class="bg-gray-50/80 rounded-xl p-3 border border-gray-100">
            <span class="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Effort Load</span>
            <div>${can('editor') ? `<select data-act="inline-effort" data-cid="${esc(c.id)}" data-iid="${esc(sel.id)}" class="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-[#0e7490] w-full"><option value="1"${sel.effortWeight === 1 ? ' selected' : ''}>Heavy — 1.0</option><option value="0.5"${(sel.effortWeight === 0.5 || sel.effortWeight === undefined) ? ' selected' : ''}>Medium — 0.5</option><option value="0.25"${sel.effortWeight === 0.25 ? ' selected' : ''}>Light — 0.25</option></select>` : `<span class="text-xs text-gray-800 font-semibold">${sel.effortWeight === 1 ? 'Heavy (1.0)' : sel.effortWeight === 0.25 ? 'Light (0.25)' : 'Medium (0.5)'}</span>`}</div>
          </div>
          <div class="bg-gray-50/80 rounded-xl p-3 border border-gray-100">
            <span class="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Last Update</span>
            <div class="text-xs text-gray-800 font-medium">${lu ? fmtDate(lu) : '<span class="text-amber-600 text-xs">No updates yet</span>'}</div>
          </div>
          <div class="bg-gray-50/80 rounded-xl p-3 border border-gray-100">
            <span class="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Milestones</span>
            <div class="text-xs text-gray-800 font-medium">${selMilestones.length ? `${selMilestones.filter(m => m.completed).length}/${selMilestones.length} Completed` : 'No milestones'}</div>
          </div>
        </div>

        <!-- Activity Feed Preview -->
        ${selTimeline.length ? `<div class="mt-3 pt-3 border-t border-gray-100">
          <span class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Recent Activity Feed</span>
          <div class="space-y-2">
            ${[...selTimeline].reverse().slice(0, 2).map(t => `<div class="text-xs bg-gray-50/60 border border-gray-100 rounded-lg p-2.5 flex items-start gap-2">
              <span class="text-gray-400 font-mono text-[10px] shrink-0 mt-0.5">${fmtDate(t.date)}</span>
              <span class="text-gray-700 flex-1 leading-snug">${esc(t.text)}</span>
            </div>`).join('')}
          </div>
        </div>` : ''}
      </div>

      <div class="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-400">
        <span>Detailed timeline history and milestone configurations reside in the full record.</span>
        <button data-act="open-integ" data-cid="${esc(c.id)}" data-iid="${esc(sel.id)}" class="text-[#0e7490] hover:underline font-semibold">View Record →</button>
      </div>
    </div>
  </div>`;
    })()}
  ${S.bulkIntegMode && S.bulkIntegCid === c.id ? `<div class="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-200 shadow-xl px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
    <div class="flex items-center gap-3">
      <div class="w-9 h-9 rounded-full bg-rose-100 flex items-center justify-center text-sm font-bold text-rose-700">${S.bulkIntegSelected.size}</div>
      <div>
        <div class="font-semibold text-gray-900 text-sm">${S.bulkIntegSelected.size === 0 ? 'No integrations selected' : S.bulkIntegSelected.size === 1 ? '1 integration selected' : `${S.bulkIntegSelected.size} integrations selected`}</div>
        <div class="text-xs text-gray-400">Reassign, change status, or delete</div>
      </div>
    </div>
    <div class="flex items-center gap-2 flex-wrap">
      <select id="bulk-reassign-select" class="text-xs border border-gray-200 rounded-lg px-2 py-2">${assigneeOptionsOnly('')}</select>
      <button data-act="bulk-reassign-integ" data-cid="${esc(c.id)}" ${S.bulkIntegSelected.size === 0 ? 'disabled class="bg-gray-100 text-gray-400 text-xs font-semibold px-3 py-2 rounded-lg cursor-not-allowed"' : 'class="bg-gray-50 border border-gray-200 hover:border-[#0e7490] hover:text-[#0e7490] text-gray-700 text-xs font-semibold px-3 py-2 rounded-lg transition"'}>Reassign</button>
      <select id="bulk-status-select" class="text-xs border border-gray-200 rounded-lg px-2 py-2">${STATUSES.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select>
      <button data-act="bulk-status-integ" data-cid="${esc(c.id)}" ${S.bulkIntegSelected.size === 0 ? 'disabled class="bg-gray-100 text-gray-400 text-xs font-semibold px-3 py-2 rounded-lg cursor-not-allowed"' : 'class="bg-gray-50 border border-gray-200 hover:border-[#0e7490] hover:text-[#0e7490] text-gray-700 text-xs font-semibold px-3 py-2 rounded-lg transition"'}>Set Status</button>
      <button data-act="toggle-bulk-integ" data-cid="${esc(c.id)}" class="text-sm text-gray-500 border border-gray-200 px-4 py-2 rounded-xl hover:bg-gray-50 transition">Cancel</button>
      <button data-act="bulk-delete-integ" data-cid="${esc(c.id)}" ${S.bulkIntegSelected.size === 0 ? 'disabled class="bg-gray-100 text-gray-400 text-sm font-semibold px-5 py-2 rounded-xl cursor-not-allowed"' : 'class="bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold px-5 py-2 rounded-xl transition"'}>
        🗑 Delete
      </button>
    </div>
  </div>
  <div class="h-20"></div>`: ''}
</div>`;

  // ── 3-COLUMN ASSEMBLY: full-width, not the app's usual centered .k-page
  // (max-width:1280px would waste most of the screen on a page meant to use
  // all available width). min-width:0 on the grid's second track is the
  // actual fix for the horizontal scroll — CSS grid items default to
  // min-width:auto, which refuses to shrink below its content's natural
  // width; without this override, the inner 5-col list+detail grid could
  // force the whole page wider than the viewport instead of wrapping/shrinking.
  return `<div class="fade" style="padding:20px 24px 36px;width:100%;box-sizing:border-box;">
  <div class="k-master-detail-grid">
    ${clientRail}
    <div style="min-width:0;">${listAndDetail}</div>
  </div>
</div>`;
}

// ─── INTEG DETAIL ─────────────────────────────────────────────────
// Renders the Pomodoro Focus Timer widget for the Integration Detail page.
// Editor+ only (viewers can't post updates or edit details, so a "start
// focused work" tool has nothing for them to do at the end of it).
// Idle/running/complete markup all live here; the live per-second countdown
// itself is a targeted DOM update (pomodoroTickDom in core.js), not a
// re-render of this function.
function renderPomodoroWidget(c, i) {
  if (!can('editor')) return '';
  const p = S.pomodoro;
  const isThisTimer = p && p.cid === c.id && p.iid === i.id;

  if (isThisTimer && p.phase === 'complete') {
    return `<div class="pomodoro-card mb-5"><div class="pomodoro-complete">
      <div class="p-cheer">🎉 Nice work — session done!</div>
      <div class="p-sub">Want to log what happened on <b>${esc(i.name)}</b>?</div>
      <div class="pomodoro-choice-row">
        <button data-act="pomodoro-choice-post" class="pomodoro-choice-btn pomodoro-choice-primary"><div class="cbt">📝 Post an Update</div><div class="cbs">Quick note in the Activity feed →</div></button>
        <button data-act="pomodoro-choice-details" class="pomodoro-choice-btn pomodoro-choice-secondary"><div class="cbt">✏️ Fill in Details</div><div class="cbs">Update status, dates, next action ←</div></button>
      </div>
      <button data-act="pomodoro-skip-later" class="pomodoro-skip-later">Maybe later</button>
    </div></div>`;
  }

  if (isThisTimer && p.phase === 'running') {
    return `<div class="pomodoro-card mb-5"><div class="pomodoro-inner">
      <div>
        <div id="pomodoro-digits" class="pomodoro-digits">${pomodoroMmss(p.remaining)}</div>
        <div class="pomodoro-bar"><div id="pomodoro-bar-fill" style="width:${((1 - p.remaining / p.total) * 100).toFixed(1)}%"></div></div>
      </div>
      <div style="flex:1;min-width:200px;">
        <div class="pomodoro-label">${p.cyclePhase === 'break' ? 'On a break from' : 'Focused on'}</div>
        <div class="pomodoro-task">${esc(i.name)}</div>
        <button data-act="pomodoro-reset" class="pomodoro-btn-ghost">Reset</button>
        ${p.mode === 'pomodoro' ? `<div class="pomodoro-cycle-dots">${[0, 1, 2, 3].map(idx => `<span class="${idx < p.cycle ? 'done' : ''}"></span>`).join('')}</div>` : ''}
      </div>
    </div></div>`;
  }

  // idle — covers "never started" and "a different integration's timer is running elsewhere"
  return `<div class="pomodoro-card mb-5"><div class="pomodoro-inner">
    <div style="font-size:38px;line-height:1;">⏱️</div>
    <div style="flex:1;min-width:200px;">
      <div class="pomodoro-label">Focus Timer</div>
      <div class="pomodoro-task">${esc(i.name)}</div>
      <div class="pomodoro-mode-toggle">
        <button data-act="pomodoro-mode" data-mode="simple" class="${S.pomodoroModePref !== 'pomodoro' ? 'active' : ''}">Simple</button>
        <button data-act="pomodoro-mode" data-mode="pomodoro" class="${S.pomodoroModePref === 'pomodoro' ? 'active' : ''}">Pomodoro 25/5</button>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        ${S.pomodoroModePref === 'pomodoro'
      ? `<span style="font-size:11.5px;color:#94a3b8;">4 cycles, 5-min break after each</span>`
      : `<select id="pomodoro-dur" class="pomodoro-select">${POMODORO_SIMPLE_OPTIONS.map(m => `<option value="${m}"${m === 25 ? ' selected' : ''}>${m} min</option>`).join('')}</select>`}
        <button data-act="pomodoro-start" data-cid="${esc(c.id)}" data-iid="${esc(i.id)}" class="pomodoro-btn-start">▶ Start Focus Session</button>
      </div>
    </div>
  </div></div>`;
}

function renderIntegDetail(clientId, integId) {
  const c = S.clients.find(x => x.id === clientId);
  const i = c?.integrations.find(x => x.id === integId);
  if (!c || !i) return `<div class="p-8 text-gray-400">Not found</div>`;
  return `<div class="max-w-6xl mx-auto px-6 py-7 fade">
  <div class="flex items-center gap-3 mb-2 flex-wrap">
    <h1 class="text-xl font-bold text-gray-900">${esc(i.name)}</h1>${sbadge(i.status)}${overdueBadge(i)}
    <button data-act="copy-link" data-url="${esc((window?.location?.origin || '') + viewToPath('integ-detail', { clientId: c.id, integId: i.id }))}" title="Copy shareable link" class="text-xs font-medium text-gray-400 border border-gray-200 rounded-lg px-2.5 py-1 hover:border-[#0e7490] hover:text-[#0e7490] transition ml-auto">🔗 Copy Link</button>
  </div>
  ${renderPomodoroWidget(c, i)}
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-5">
    <div class="bg-white rounded-2xl border border-gray-100 p-6">
      <h3 class="font-semibold text-gray-900 mb-4 text-sm">Details</h3>
      <div class="space-y-4">
        <div><label class="block text-xs font-medium text-gray-400 mb-1.5">Status</label>
          ${can('editor') ? `<select id="f-status" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]">${STATUSES.map(s => `<option${s === i.status ? ' selected' : ''}>${s}</option>`).join('')}</select>` : sbadge(i.status)}
        </div>
        <div><label class="block text-xs font-medium text-gray-400 mb-1.5">Assignee</label>
          ${can('editor') ? assigneeSelect('f-assignee', i.assignee || '') :
      `<p class="text-sm text-gray-700">${esc(i.assignee || '—')}</p>`}
        </div>
        <div><label class="block text-xs font-medium text-gray-400 mb-1.5">Due Date</label>
          ${can('editor') ? `<input id="f-due" type="date" value="${esc(i.dueDate || '')}" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/>` :
      `<p class="text-sm text-gray-700">${fmtDate(i.dueDate)}</p>`}
        </div>
        <div><label class="block text-xs font-medium text-gray-400 mb-1.5">Description</label>
          ${can('editor') ? `<textarea id="f-desc" rows="4" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490] resize-none">${esc(i.description || '')}</textarea>` :
      `<p class="text-sm text-gray-700 leading-relaxed">${esc(i.description || '—')}</p>`}
        </div>
        <div><label class="block text-xs font-medium text-gray-400 mb-1.5">Next Action</label>
          ${can('editor') ? `<textarea id="f-next" rows="2" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490] resize-none">${esc(i.nextAction || '')}</textarea>` :
      `<p class="text-sm text-gray-700">${esc(i.nextAction || '—')}</p>`}
        </div>
        ${can('editor') ? `<button data-act="save-integ" data-cid="${esc(c.id)}" data-iid="${esc(i.id)}" class="w-full btn-grad text-white font-semibold rounded-xl py-2.5 text-sm transition flex items-center justify-center gap-2">Save Details <kbd class="text-[10px] font-normal opacity-60 border border-white/30 rounded px-1.5 py-0.5">${kbdHint('S')}</kbd></button>` : ''}
        ${can('editor') && i.status !== 'Completed' ? `<button data-act="mark-complete" data-cid="${esc(c.id)}" data-iid="${esc(i.id)}" class="w-full text-green-700 bg-green-50 hover:bg-green-100 font-medium rounded-xl py-2 text-xs transition">✓ Mark as Complete</button>` : ''}
        ${can('admin') ? `<button data-act="delete-integ" data-cid="${esc(c.id)}" data-iid="${esc(i.id)}" class="w-full text-rose-400 hover:text-rose-600 text-xs py-1 transition">Delete Integration</button>` : ''}
      </div>
    </div>
    <div class="bg-white rounded-2xl border border-gray-100 p-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-semibold text-gray-900 text-sm flex items-center gap-1.5">
          <svg class="w-4 h-4 text-[#0e7490]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
          Activity <span class="text-gray-400 font-normal">(${i.timeline?.length || 0})</span>
        </h3>
      </div>
      ${can('editor') ? `<div class="flex gap-2.5 mb-4">
        ${avatarChip(S.user?.name)}
        <div class="flex-1 min-w-0">
          <div class="bg-gray-50 rounded-2xl rounded-tl-md px-3.5 py-2.5">
            <textarea id="tl-input" rows="2" placeholder="Post an update…" class="w-full bg-transparent text-sm resize-none outline-none"></textarea>
          </div>
          <div class="flex gap-2 mt-2">
            <input id="tl-attach-label" type="text" placeholder="File label e.g. Signoff Mail (optional)" class="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/>
            <label title="PDF, Excel, image or email (.eml/.msg), max 3MB" class="cursor-pointer flex items-center gap-1.5 text-xs font-medium text-[#0e7490] bg-[#0e7490]/8 border border-[#0e7490]/30 px-3 py-2 rounded-xl hover:bg-[#0e7490]/15 transition whitespace-nowrap shrink-0">
              📎 Attach File
              <input id="tl-attach-file" type="file" class="hidden" accept=".pdf,.xlsx,.xls,.jpg,.jpeg,.png,.gif,.webp,.eml,.msg"/>
            </label>
          </div>
          <div id="tl-attach-preview" class="hidden mt-2 text-xs text-[#0e7490] bg-[#0e7490]/8 px-2.5 py-1.5 rounded-xl flex items-center gap-2">
            <span id="tl-attach-icon">📎</span><span id="tl-attach-name" class="flex-1 truncate"></span>
            <button data-act="clear-attach" data-prefix="tl" class="text-gray-400 hover:text-rose-500 shrink-0">✕</button>
          </div>
          <input id="tl-attach-url" type="hidden" value=""/>
          <input id="tl-attach-mimetype" type="hidden" value=""/>
          <input id="tl-attach-filename" type="hidden" value=""/>
          <div class="flex items-center gap-3 mt-1.5 pl-1">
            <span class="text-[11px] text-gray-400">Posts immediately — no need to Save Details</span>
            <div class="flex-1"></div>
            <button data-act="add-timeline" data-cid="${esc(c.id)}" data-iid="${esc(i.id)}" title="Post update" class="w-8 h-8 rounded-full bg-[#0e7490] hover:bg-[#0d3d4f] flex items-center justify-center transition shrink-0">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 19V5M5 12l7-7 7 7"/></svg>
            </button>
          </div>
        </div>
      </div>`: ''}
      <div class="space-y-4 max-h-[440px] overflow-y-auto pr-1">
        ${!(i.timeline?.length) ? `<div class="text-sm text-gray-400 text-center py-8">${emptyIcon('clock')}No updates yet</div>` :
      i.timeline.map((t, idx, arr) => {
        const isEditing = S.editingTimelineId === t.id;
        const hasHistory = t.edits && t.edits.length > 0;
        const isExpanded = S.expandedHistory.has(t.id);
        if (isEditing) {
          return `<div class="flex gap-2.5">
              ${avatarChip(t.addedBy)}
              <div class="flex-1 min-w-0">
                <div class="text-xs font-semibold text-[#0e7490] mb-1">${esc(t.date)} · ${esc(t.addedBy || '')}</div>
                <textarea id="edit-tl-${t.id}" rows="3" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490] resize-none mb-2">${esc(t.update)}</textarea>
                <div class="flex gap-2 mb-1">
                  <input id="etl-label-${t.id}" type="text" placeholder="File label (optional)" value="${esc(t.attachment?.label || t.attachment?.fileName || '')}" class="flex-1 border border-gray-200 rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/>
                  <label class="cursor-pointer flex items-center gap-1 text-xs font-medium text-[#0e7490] bg-[#0e7490]/8 border border-[#0e7490]/30 px-2.5 py-1.5 rounded-xl hover:bg-[#0e7490]/15 transition whitespace-nowrap shrink-0">
                    📎 ${t.attachment?.url ? 'Replace' : 'Attach'}
                    <input id="etl-file-${t.id}" type="file" class="hidden" accept=".pdf,.xlsx,.xls,.jpg,.jpeg,.png,.gif,.webp,.eml,.msg" data-tid="${esc(t.id)}"/>
                  </label>
                </div>
                ${t.attachment?.url ? `<div id="etl-preview-${t.id}" class="mb-1 text-xs text-[#0e7490] bg-[#0e7490]/8 px-2 py-1 rounded-xl flex items-center gap-2">
                  <span>${fileIcon(t.attachment.url, t.attachment.mimeType || '')}</span>
                  <span class="flex-1 truncate" id="etl-name-${t.id}">${esc(t.attachment.fileName || t.attachment.label || 'Attachment')}</span>
                  <button data-act="clear-attach" data-prefix="etl" data-tid="${esc(t.id)}" class="text-gray-400 hover:text-rose-500 shrink-0">✕</button>
                </div>`: `<div id="etl-preview-${t.id}" class="hidden mb-1 text-xs text-[#0e7490] bg-[#0e7490]/8 px-2 py-1 rounded-xl flex items-center gap-2">
                  <span id="etl-icon-${t.id}">📎</span>
                  <span class="flex-1 truncate" id="etl-name-${t.id}"></span>
                  <button data-act="clear-attach" data-prefix="etl" data-tid="${esc(t.id)}" class="text-gray-400 hover:text-rose-500 shrink-0">✕</button>
                </div>`}
                <input id="etl-url-${t.id}" type="hidden" value="${esc(t.attachment?.url || '')}"/>
                <input id="etl-mimetype-${t.id}" type="hidden" value="${esc(t.attachment?.mimeType || '')}"/>
                <input id="etl-filename-${t.id}" type="hidden" value="${esc(t.attachment?.fileName || '')}"/>
                <div class="flex gap-2 mt-2">
                  <button data-act="cancel-edit-timeline" class="flex-1 text-xs font-medium text-gray-500 border border-gray-200 rounded-lg py-1.5 hover:bg-gray-50 transition">Cancel</button>
                  <button data-act="save-edit-timeline" data-cid="${esc(c.id)}" data-iid="${esc(i.id)}" data-tid="${esc(t.id)}" class="flex-1 text-xs font-semibold text-white bg-[#0e7490] rounded-lg py-1.5 hover:bg-[#0d3d4f] transition">Save Edit</button>
                </div>
              </div>
            </div>`;
        }
        return `<div class="flex gap-2.5">
          ${avatarChip(t.addedBy)}
          <div class="flex-1 min-w-0">
            <div class="flex items-baseline gap-2 flex-wrap">
              <span class="text-sm font-medium text-gray-900">${esc(t.addedBy || 'Unknown')}</span>
              <span class="text-xs text-gray-400">${esc(t.date)}${t.addedAt ? ` · ${fmtDate(t.addedAt)}` : ''}</span>
              ${hasHistory ? `<button data-act="toggle-history" data-tid="${esc(t.id)}" class="text-xs text-amber-600 hover:text-amber-700 font-medium">edited${t.edits.length > 1 ? ` (${t.edits.length}×)` : ''} — ${isExpanded ? 'hide' : 'view'}</button>` : ''}
            </div>
            <div class="bg-gray-50 rounded-2xl rounded-tl-md px-3.5 py-2.5 mt-1 text-sm text-gray-700 leading-relaxed">${esc(t.update)}</div>
            ${t.attachment?.url ? attachmentChip(t.attachment) : ''}
            <div class="flex items-center gap-3 mt-1.5 pl-1">
              ${can('editor') ? `<button data-act="edit-timeline" data-tid="${esc(t.id)}" class="text-[11px] text-gray-400 hover:text-[#0e7490]">Edit</button>` : ''}
              ${can('admin') ? `<button data-act="delete-timeline-entry" data-cid="${esc(c.id)}" data-iid="${esc(i.id)}" data-tid="${esc(t.id)}" class="text-[11px] text-gray-400 hover:text-rose-500">Delete</button>` : ''}
              <button data-act="copy-update" data-text="${esc(t.update)}" class="text-[11px] text-gray-400 hover:text-[#0e7490]">Copy</button>
              <button data-act="toggle-reaction" data-cid="${esc(c.id)}" data-iid="${esc(i.id)}" data-tid="${esc(t.id)}" title="Acknowledge" class="text-[11px] ${(t.reactions || []).includes(S.user?.name) ? 'text-[#0e7490] font-semibold' : 'text-gray-400 hover:text-[#0e7490]'}">👍${(t.reactions || []).length ? ` ${t.reactions.length}` : ''}</button>
            </div>
            ${isExpanded && hasHistory ? `<div class="mt-2 pl-3 border-l-2 border-amber-200 space-y-2">
              ${[...t.edits].reverse().map(e => `<div class="text-xs"><div class="text-gray-400 mb-0.5">${fmtDate(e.editedAt)} · ${esc(e.editedBy || '')} changed it from:</div><div class="text-gray-500">${esc(e.text)}</div></div>`).join('')}
            </div>`: ''}
          </div>
        </div>`;
      }).join('')}
      </div>
    </div>
  </div>
  <div class="mt-6 bg-white rounded-2xl border border-gray-100 p-6">
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-semibold text-gray-900 text-sm">Milestones</h3>
      ${can('editor') ? `<button data-act="add-milestone-btn" data-cid="${esc(c.id)}" data-iid="${esc(i.id)}" class="text-xs text-[#0e7490] font-semibold border border-[#0e7490]/30 bg-[#0e7490]/5 px-3 py-1.5 rounded-xl hover:bg-[#0e7490]/10 transition">+ Add Milestone</button>` : ''}
    </div>
    ${(i.milestones || []).length ? `<div class="space-y-2">
      ${(i.milestones || []).map(ms => {
        const msColor = ms.status === 'Achieved' ? 'green' : ms.status === 'Missed' ? 'rose' : milestoneUrgencyColor(ms);
        return `<div class="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:border-gray-200 transition">
          <div class="w-2 h-2 rounded-full bg-${msColor}-500 shrink-0"></div>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium text-gray-900">${esc(ms.name)}</div>
            <div class="text-xs text-gray-400 mt-0.5">${ms.owner ? `Owner: ${esc(ms.owner)} · ` : ''}${ms.dueDate ? `Due: ${fmtDate(ms.dueDate)}` : 'No due date'}${ms.notes ? ` · ${esc(ms.notes)}` : ''}</div>
          </div>
          <span class="text-xs font-semibold bg-${msColor}-50 text-${msColor}-700 border border-${msColor}-200 px-2 py-0.5 rounded-full shrink-0">${ms.status}</span>
          ${can('editor') ? `<div class="flex gap-2 shrink-0">
            <button data-act="edit-milestone-btn" data-cid="${esc(c.id)}" data-iid="${esc(i.id)}" data-mid="${esc(ms.id)}" class="text-xs text-gray-300 hover:text-[#0e7490]">Edit</button>
            ${can('admin') ? `<button data-act="delete-milestone" data-cid="${esc(c.id)}" data-iid="${esc(i.id)}" data-mid="${esc(ms.id)}" class="text-xs text-gray-300 hover:text-rose-500">Delete</button>` : ''}
          </div>`: ''}
        </div>`;
      }).join('')}
    </div>`: `<div class="text-center py-8 text-gray-400 text-sm">No milestones yet. Add key checkpoints for this integration.</div>`}
  </div>
</div>`;
}