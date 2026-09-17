// ─── AMS ──────────────────────────────────────────────────────────
function amsEntryAmount(hours, rate) { if (!rate) return null; return (hours / HOURS_PER_DAY) * rate; }
function amsStatusBadge(s) { const m = { 'Open': 'bg-blue-50 text-blue-700 border-blue-200', 'In Progress': 'bg-amber-50 text-amber-700 border-amber-200', 'Closed': 'bg-green-50 text-green-700 border-green-200' }; return `<span class="text-xs font-medium border ${m[s] || 'bg-gray-50 text-gray-600 border-gray-200'} px-2 py-0.5 rounded-full">${esc(s || 'Open')}</span>`; }
function entryDate(e) { return e.dateRaised || e.date || '' }
function entryType(e) { return e.type || e.category || '—' }
function entryRaisedBy(e) { return e.raisedBy || e.loggedBy || '—' }
function currencySymbol(client) { return CURRENCIES[client?.currency || 'INR']?.symbol || '₹'; }
function parseAmsEntriesCsv(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (!lines.length) return [];
  const hasHeader = lines[0].toLowerCase().includes('date_raised') || lines[0].toLowerCase().includes('date raised');
  const dataLines = hasHeader ? lines.slice(1) : lines;
  return dataLines.map((line, i) => {
    const p = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    const [date_raised, due_date, raised_by, module, project, description, type, query_level, entry_status, mode_of_support, hours] = p;
    let error = null;
    if (!date_raised) error = 'date_raised required';
    else if (!hours || isNaN(parseFloat(hours))) error = 'hours required (number)';
    else if (!description) error = 'description required';
    return { dateRaised: date_raised, dueDate: due_date || '', raisedBy: raised_by || '', module: module || '', project: project || '', description: description || '', type: type || AMS_TYPES[0], queryLevel: query_level || AMS_QUERY_LEVELS[0], entryStatus: entry_status || 'Open', modeOfSupport: mode_of_support || AMS_MODES[0], hours: parseFloat(hours) || 0, error, row: i + (hasHeader ? 2 : 1) };
  });
}
// The single, canonical AMS health formula — used by the AMS pages AND the
// Dashboard Health Scorecard/snapshot capture. Previously these lived as two
// separate, disagreeing functions (this one, and core.js's amsRagLabel) that
// could show a client as Green here and Red on the Dashboard for identical
// underlying data. Merged: this now checks everything either version checked.
function amsClientRag(client) {
  const entries = client.workLog || [];
  if (!entries.length) return null;
  const open = entries.filter(e => (e.entryStatus || 'Open') !== 'Closed');
  if (open.some(e => e.ragStatus === 'Red')) return 'Red';
  if (open.some(e => (e.queryLevel || '').includes('L4'))) return 'Red';
  if (open.some(e => e.dueDate && e.dueDate < todayStr())) return 'Red';
  const t = amsTotals(client, '', '');
  if (t.hasBucket && t.balanceAvailable !== null && t.balanceAvailable <= Math.max(2, t.totalAvailableHours * 0.15)) return 'Red';
  if (open.some(e => e.ragStatus === 'Amber')) return 'Amber';
  if (open.some(e => (e.queryLevel || '').includes('L3'))) return 'Amber';
  const threeDays = new Date(); threeDays.setDate(threeDays.getDate() + 3); const soonStr = threeDays.toISOString().slice(0, 10);
  if (open.some(e => e.dueDate && e.dueDate <= soonStr && e.dueDate >= todayStr())) return 'Amber';
  return 'Green';
}
function amsTotals(client, fromDate, toDate) {
  const allLog = client.workLog || [];
  const log = allLog.filter(e => (!fromDate || entryDate(e) >= fromDate) && (!toDate || entryDate(e) <= toDate));
  const totalHours = log.reduce((a, e) => a + Number(e.hours || 0), 0);
  const allTimeHours = allLog.reduce((a, e) => a + Number(e.hours || 0), 0);
  const bucket = client.totalAvailableHours;
  const hasBucket = bucket !== undefined && bucket !== null && bucket > 0;
  const hasRate = !!(client.manDayRate > 0);
  let billableHours = totalHours, coveredHours = 0, balanceAvailable = null;
  if (hasBucket) {
    const hoursBeforePeriod = fromDate ? allLog.filter(e => entryDate(e) < fromDate).reduce((a, e) => a + Number(e.hours || 0), 0) : 0;
    const remainingAtPeriodStart = Math.max(0, bucket - hoursBeforePeriod);
    coveredHours = Math.min(totalHours, remainingAtPeriodStart);
    billableHours = Math.max(0, totalHours - remainingAtPeriodStart);
    balanceAvailable = Math.max(0, bucket - allTimeHours);
  }
  const totalAmount = hasRate ? (amsEntryAmount(billableHours, client.manDayRate) || 0) : null;
  const byType = {};
  log.forEach(e => { const tp = entryType(e); byType[tp] = (byType[tp] || 0) + Number(e.hours || 0); });
  return { log, totalHours, totalAmount, byType, hasRate, hasBucket, totalAvailableHours: bucket, billableHours, coveredHours, consumedAllTime: allTimeHours, balanceAvailable };
}
// ─── CLIENT LIST — replaced by the 3-column renderAmsClientDetail below,
// which now also handles the bare "no client selected yet" case ───
function renderAmsClientDetail(clientId) {
  const amsClients = S.clients.filter(x => x.workLog !== undefined);
  const c = S.clients.find(x => x.id === clientId) || amsClients[0];
  if (!c) return `<div class="fade" style="padding:20px 28px 36px;"><div class="bg-white rounded-2xl border border-gray-100 text-center py-16 text-gray-400 text-sm">${emptyIcon('hours')}No AMS clients yet. ${can('admin') ? `<button data-act="modal-open" data-modal="add-ams-client" class="text-[#0e7490] font-medium ml-1">Add one</button>` : ''}</div></div>`;
  const t = amsTotals(c, S.amsFrom, S.amsTo);
  const sorted = [...t.log].sort((a, b) => entryDate(b).localeCompare(entryDate(a)));

  const clientRail = `<div class="overflow-y-auto pr-1" style="max-height:calc(100vh - 132px);">
    <div class="flex items-center justify-between mb-3 px-1">
      <span class="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">${amsClients.length} Client${amsClients.length !== 1 ? 's' : ''}</span>
      ${can('admin') ? `<button data-act="modal-open" data-modal="add-ams-client" title="Add Client" class="text-[#0e7490] text-lg leading-none font-bold">+</button>` : ''}
    </div>
    <div class="flex flex-col gap-3">
      ${amsClients.map(cl => {
    const clT = amsTotals(cl, '', '');
    const log = cl.workLog || [];
    const open = log.filter(e => (e.entryStatus || 'Open') !== 'Closed');
    const atRisk = open.filter(e => e.ragStatus === 'Red' || e.ragStatus === 'Amber' || (e.queryLevel || '').includes('L3') || (e.queryLevel || '').includes('L4')).length;
    const rag = amsClientRag(cl);
    const ringColor = rag ? RAG_HEX[rag] : 'var(--mute-2)';
    const pct = clT.hasBucket && clT.totalAvailableHours ? Math.min(100, clT.consumedAllTime / clT.totalAvailableHours * 100) : (log.length ? (log.length - open.length) / log.length * 100 : 0);
    const active = cl.id === c.id;
    return `<div data-act="open-ams-client" data-id="${esc(cl.id)}" class="card-hover cursor-pointer bg-white rounded-2xl border p-4 ${active ? 'border-[#0e7490] ring-1 ring-[#0e7490]/30' : 'border-gray-100'}">
        <div class="flex items-center gap-3">
          ${ringSvg(pct, ringColor, 40)}
          <div class="flex-1 min-w-0">
            <div class="font-semibold text-sm truncate" style="color:${active ? '#0e7490' : '#111827'}">${esc(cl.name)}</div>
            <div class="text-xs text-gray-400 mt-0.5 truncate">${log.length} entr${log.length !== 1 ? 'ies' : 'y'} logged</div>
          </div>
        </div>
        ${open.length || atRisk ? `<div class="flex gap-3 mt-3 pt-2.5 border-t border-gray-50">
          ${open.length ? `<div class="text-xs"><span class="font-semibold" style="color:var(--teal)">${open.length}</span> <span class="text-gray-400">open</span></div>` : ''}
          ${atRisk ? `<div class="text-xs"><span class="font-semibold text-rose-600">${atRisk}</span> <span class="text-gray-400">at risk</span></div>` : ''}
        </div>`: ''}
      </div>`;
  }).join('')}
    </div>
  </div>`;

  const detailPanel = `<div>
  <div class="flex flex-wrap items-start justify-between gap-4 mb-5">
    <div>
      <div class="flex items-center gap-3 mb-0.5"><h1 class="text-xl font-bold text-gray-900">${esc(c.name)}</h1>${(() => { const r = amsClientRag(c); return r ? ragBadge(r) : '' })()}</div>
      ${c.description ? `<p class="text-sm text-gray-400 mt-0.5">${esc(c.description)}</p>` : ''}
    </div>
    ${can('admin') ? `<div class="flex gap-2 flex-wrap">
      <button data-act="edit-ams-client" data-id="${esc(c.id)}" class="text-gray-400 hover:text-[#0e7490] text-xs px-2 border border-gray-200 rounded-lg py-1.5">Edit Client</button>
      <button data-act="delete-ams-client" data-id="${esc(c.id)}" class="text-rose-400 hover:text-rose-600 text-xs px-2">Delete Client</button>
    </div>`: ''}
  </div>
  ${can('editor') ? `<div class="mb-5"><button data-act="modal-open" data-modal="add-ams-entry" data-cid="${esc(c.id)}" class="btn-grad text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition">+ Add Entry</button></div>` : ''}
  ${can('admin') && t.hasRate ? `<div class="bg-white rounded-2xl border border-gray-100 p-5 mb-6">
    <h3 class="font-semibold text-gray-900 text-sm mb-3">Billing</h3>
    ${t.hasBucket ? `<div class="grid grid-cols-3 gap-4 mb-4">
      <div class="bg-gray-50 rounded-xl p-4"><div class="text-2xl font-bold text-gray-700">${t.totalAvailableHours.toFixed(1)}</div><div class="text-xs text-gray-500">Total Available</div></div>
      <div class="bg-gray-50 rounded-xl p-4"><div class="text-2xl font-bold text-gray-700">${t.consumedAllTime.toFixed(1)}</div><div class="text-xs text-gray-500">Consumed (all-time)</div></div>
      <div class="${t.balanceAvailable > 0 ? 'bg-green-50' : 'bg-rose-50'} rounded-xl p-4"><div class="text-2xl font-bold ${t.balanceAvailable > 0 ? 'text-green-600' : 'text-rose-600'}">${t.balanceAvailable.toFixed(1)}</div><div class="text-xs text-gray-500">Balance Available</div></div>
    </div>`: ''}
    <div class="flex flex-wrap items-center gap-3 mb-4 p-3 bg-gray-50/70 border border-gray-100 rounded-xl">
      <div class="flex items-center gap-2">
        <div><label class="block text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">From</label><input id="ams-from" data-act="ams-range" type="date" value="${esc(S.amsFrom)}" class="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
        <div><label class="block text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">To</label><input id="ams-to" data-act="ams-range" type="date" value="${esc(S.amsTo)}" class="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      </div>
      <div class="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-0.5">
        <button data-act="ams-month-prev" class="px-2 py-1 text-xs text-gray-600 hover:text-[#0e7490] hover:bg-gray-50 rounded transition" title="Previous Month">◀</button>
        <span class="px-2 text-xs font-semibold text-gray-700 min-w-[70px] text-center">${S.amsFrom ? new Date(S.amsFrom + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : 'All Dates'}</span>
        <button data-act="ams-month-next" class="px-2 py-1 text-xs text-gray-600 hover:text-[#0e7490] hover:bg-gray-50 rounded transition" title="Next Month">▶</button>
      </div>
      <div class="flex gap-1.5 items-center flex-wrap">
        ${[['This Month', 'this-month'], ['Last Month', 'last-month'], ['This Quarter', 'this-quarter'], ['All Time', 'all-time']].map(([l, k]) => `<button data-act="ams-quick" data-range="${k}" class="text-xs px-2.5 py-1.5 rounded-lg border transition ${S.amsQuick === k ? 'bg-[#0e7490] text-white border-[#0e7490]' : 'border-gray-200 text-gray-500 hover:border-[#0e7490] hover:text-[#0e7490] bg-white'}">${l}</button>`).join('')}
      </div>
      <div class="ml-auto">
        ${exportMenuButton(`ams-${c.id}`, [
          { label: '📋 Activity Report (PDF)', act: 'exp-ams-activity', data: { cid: c.id } },
          { label: '🧾 Invoice / Billing (PDF)', act: 'exp-ams-invoice', data: { cid: c.id } },
          { label: '📊 Excel', act: 'exp-excel', data: { etype: 'ams', cid: c.id } },
          { label: '⬆ Import (CSV)', act: 'open-import-ams', data: { cid: c.id } },
        ])}
      </div>
    </div>
    <div class="grid grid-cols-3 gap-4 mb-4">
      <div class="bg-gray-50 rounded-xl p-4"><div class="text-2xl font-bold text-gray-700">${t.totalHours.toFixed(1)}</div><div class="text-xs text-gray-500">Hours This Period${t.hasBucket ? ` (${t.coveredHours.toFixed(1)} covered)` : ''}</div></div>
      <div class="bg-gray-50 rounded-xl p-4"><div class="text-2xl font-bold text-gray-700">${currencySymbol(c)}${(c.manDayRate || 0).toLocaleString(c.currency === 'USD' ? 'en-US' : 'en-IN')}</div><div class="text-xs text-gray-500">Day Rate</div></div>
      <div class="bg-[#0e7490]/10 rounded-xl p-4"><div class="text-2xl font-bold text-[#0e7490]">${currencySymbol(c)}${(t.totalAmount || 0).toLocaleString(c.currency === 'USD' ? 'en-US' : 'en-IN', { maximumFractionDigits: 0 })}</div><div class="text-xs text-gray-500">Billable Amount</div></div>
    </div>
    <div class="flex flex-wrap gap-2">
      ${Object.entries(t.byType).map(([tp, hrs]) => `<span class="text-xs bg-gray-50 border border-gray-200 rounded-full px-3 py-1 text-gray-600">${esc(tp)}: ${hrs.toFixed(1)}h</span>`).join('') || '<span class="text-xs text-gray-400">No entries in this range</span>'}
    </div>
  </div>`: can('admin') && !t.hasRate ? `<div class="bg-white rounded-2xl border border-gray-100 p-5 mb-6">
    <div class="flex flex-wrap items-center gap-3 mb-4 p-3 bg-gray-50/70 border border-gray-100 rounded-xl">
      <div class="flex items-center gap-2">
        <div><label class="block text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">From</label><input id="ams-from" data-act="ams-range" type="date" value="${esc(S.amsFrom)}" class="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
        <div><label class="block text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">To</label><input id="ams-to" data-act="ams-range" type="date" value="${esc(S.amsTo)}" class="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      </div>
      <div class="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-0.5">
        <button data-act="ams-month-prev" class="px-2 py-1 text-xs text-gray-600 hover:text-[#0e7490] hover:bg-gray-50 rounded transition" title="Previous Month">◀</button>
        <span class="px-2 text-xs font-semibold text-gray-700 min-w-[70px] text-center">${S.amsFrom ? new Date(S.amsFrom + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : 'All Dates'}</span>
        <button data-act="ams-month-next" class="px-2 py-1 text-xs text-gray-600 hover:text-[#0e7490] hover:bg-gray-50 rounded transition" title="Next Month">▶</button>
      </div>
      <div class="flex gap-1.5 items-center flex-wrap">
        ${[['This Month', 'this-month'], ['Last Month', 'last-month'], ['This Quarter', 'this-quarter'], ['All Time', 'all-time']].map(([l, k]) => `<button data-act="ams-quick" data-range="${k}" class="text-xs px-2.5 py-1.5 rounded-lg border transition ${S.amsQuick === k ? 'bg-[#0e7490] text-white border-[#0e7490]' : 'border-gray-200 text-gray-500 hover:border-[#0e7490] hover:text-[#0e7490] bg-white'}">${l}</button>`).join('')}
      </div>
      <div class="ml-auto">
        ${exportMenuButton(`ams-${c.id}`, [
          { label: '📋 Activity Report (PDF)', act: 'exp-ams-activity', data: { cid: c.id } },
          { label: '📊 Excel', act: 'exp-excel', data: { etype: 'ams', cid: c.id } },
          { label: '⬆ Import (CSV)', act: 'open-import-ams', data: { cid: c.id } },
        ])}
      </div>
    </div>
    <div class="bg-gray-50 rounded-xl p-4 inline-block"><div class="text-2xl font-bold text-gray-700">${t.totalHours.toFixed(1)}</div><div class="text-xs text-gray-500">Total Hours (Retainer)</div></div>
  </div>`: ''}
  ${(() => {
      if (!sorted.length) return `<div class="bg-white rounded-2xl border border-gray-100 text-center py-16 text-gray-400 text-sm">${emptyIcon('hours')}No entries yet. Add one to get started.</div>`;
      const selId = S.selectedAmsEntryId && sorted.some(e => e.id === S.selectedAmsEntryId) ? S.selectedAmsEntryId : sorted[0].id;
      const sel = sorted.find(e => e.id === selId);
      if (!sel) return `<div class="bg-white rounded-2xl border border-gray-100 text-center py-16 text-gray-400 text-sm">${emptyIcon('hours')}No entry selected</div>`;
      const isOverdue = e => e.dueDate && e.dueDate < todayStr() && (e.entryStatus || 'Open') !== 'Closed';
      const isExpanded = S.expandedAmsHistory.has(sel.id);
      const hasHistory = sel.edits && sel.edits.length > 0;
      return `<div class="bg-white rounded-2xl border border-gray-100 overflow-hidden grid grid-cols-12" style="min-height:460px;">
    <div class="col-span-5 lg:col-span-4 border-r border-gray-100 overflow-y-auto" style="max-height:680px;">
      <div class="px-3 py-2 bg-gray-50 border-b border-gray-100 text-[11px] font-semibold text-gray-400 uppercase tracking-wide sticky top-0 flex items-center justify-between">
        <span>${sorted.length} entr${sorted.length !== 1 ? 'ies' : 'y'}</span>
      </div>
      ${sorted.map(e => {
        const active = e.id === selId;
        return `<div data-act="select-ams-entry" data-eid="${e.id}" class="px-3 py-2.5 border-b border-gray-50 cursor-pointer transition flex items-start gap-2 ${active ? 'bg-[#0e7490]/5 border-l-2 border-l-[#0e7490]' : 'border-l-2 border-l-transparent hover:bg-gray-50'}">
          <div class="flex-1 min-w-0">
            <div class="flex justify-between items-baseline gap-2">
              <span class="text-xs font-medium text-gray-900 truncate">${esc(e.module || e.project || 'Untitled')}</span>
              <span class="text-xs shrink-0 ${isOverdue(e) ? 'text-rose-600 font-semibold' : 'text-gray-400'}">${fmtDate(entryDate(e))}</span>
            </div>
            <div class="text-xs text-gray-500 truncate mt-0.5">${esc(e.description || '—')}</div>
            <div class="flex gap-1.5 mt-1.5 flex-wrap">${amsStatusBadge(e.entryStatus || 'Open')}${e.ragStatus ? `<span class="scale-90 origin-left">${ragBadge(e.ragStatus)}</span>` : ''}</div>
          </div>
        </div>`;
      }).join('')}
    </div>
    <div class="col-span-7 lg:col-span-8 p-6 overflow-y-auto flex flex-col justify-between" style="max-height:680px;">
      <div class="space-y-4">
        <!-- Top Toolbar -->
        <div class="flex items-center justify-between pb-3 border-b border-gray-100 flex-wrap gap-2">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="bg-gray-50 border border-gray-200 rounded-full px-2.5 py-1 text-xs text-gray-600 font-medium">${esc(entryType(sel))}</span>
            ${amsStatusBadge(sel.entryStatus || 'Open')}
            ${sel.ragStatus ? ragBadge(sel.ragStatus) : ''}
            ${sel.queryLevel ? `<span class="text-xs px-2 py-0.5 rounded-full border ${sel.queryLevel.includes('L4') ? 'bg-rose-50 border-rose-200 text-rose-700' : sel.queryLevel.includes('L3') ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-gray-50 border-gray-200 text-gray-600'} font-medium">${esc(sel.queryLevel)}</span>` : ''}
          </div>
          ${can('editor') ? `<div class="flex gap-2 shrink-0">
            <button data-act="edit-ams-entry" data-cid="${esc(c.id)}" data-eid="${sel.id}" class="text-xs font-semibold text-white bg-[#0e7490] hover:bg-[#0c627a] rounded-lg px-3.5 py-1.5 transition shadow-sm">Edit Entry</button>
            ${can('admin') ? `<button data-act="delete-ams-entry" data-cid="${esc(c.id)}" data-eid="${sel.id}" class="text-xs font-medium text-rose-500 border border-rose-200 hover:bg-rose-50 rounded-lg px-3 py-1.5 transition bg-white">Delete</button>` : ''}
          </div>`: ''}
        </div>

        <!-- Header Title & Description -->
        <div>
          <h2 class="text-lg font-bold text-gray-900 tracking-tight">${esc(sel.module || sel.project || 'Untitled Entry')}</h2>
          <div class="mt-2 p-3.5 bg-gray-50/90 border border-gray-100 rounded-xl text-xs text-gray-700 leading-relaxed">
            ${esc(sel.description || 'No description provided for this entry.')}
          </div>
        </div>

        <!-- History Toggle if edited -->
        ${hasHistory ? `<div>
          <button data-act="toggle-ams-history" data-eid="${sel.id}" class="text-xs text-amber-600 hover:text-amber-700 font-medium flex items-center gap-1">
            <span>✎</span> Edited — ${isExpanded ? 'Hide' : 'View'} History
          </button>
          ${isExpanded ? `<div class="mt-2 pl-3 border-l-2 border-amber-200 space-y-1.5 bg-amber-50/30 p-2.5 rounded-r-xl">
            ${[...sel.edits].reverse().map(h => `<div class="text-xs text-gray-500 font-mono"><span class="font-semibold text-gray-700">${fmtDate(h.editedAt)}:</span> ${esc(h.description || '—')}</div>`).join('')}
          </div>` : ''}
        </div>`: ''}

        <!-- 3-Column Attributes Grid -->
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pt-1">
          <div class="bg-gray-50/80 rounded-xl p-3 border border-gray-100">
            <span class="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Date Raised</span>
            <div class="text-xs font-semibold text-gray-800 flex items-center gap-1">
              <span>📅</span> ${fmtDate(entryDate(sel))}
            </div>
          </div>
          <div class="bg-gray-50/80 rounded-xl p-3 border border-gray-100">
            <span class="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Due Date</span>
            <div class="text-xs font-semibold ${isOverdue(sel) ? 'text-rose-600' : 'text-gray-800'} flex items-center gap-1">
              <span>⏰</span> ${sel.dueDate ? fmtDate(sel.dueDate) : '—'}
            </div>
          </div>
          <div class="bg-gray-50/80 rounded-xl p-3 border border-gray-100">
            <span class="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Raised By</span>
            <div class="text-xs text-gray-800 font-medium truncate flex items-center gap-1">
              <span>👤</span> ${esc(entryRaisedBy(sel))}
            </div>
          </div>
          <div class="bg-gray-50/80 rounded-xl p-3 border border-gray-100">
            <span class="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Project</span>
            <div class="text-xs text-gray-800 font-medium truncate">${esc(sel.project || '—')}</div>
          </div>
          <div class="bg-gray-50/80 rounded-xl p-3 border border-gray-100">
            <span class="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Mode of Support</span>
            <div class="text-xs text-gray-800 font-medium">${esc(sel.modeOfSupport || '—')}</div>
          </div>
          <div class="bg-gray-50/80 rounded-xl p-3 border border-gray-100">
            <span class="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Hours Logged</span>
            <div class="text-xs font-bold text-[#0e7490] flex items-center gap-1">
              <span>⏱</span> ${Number(sel.hours || 0).toFixed(1)} hrs
            </div>
          </div>
          <div class="col-span-2 bg-gray-50/80 rounded-xl p-3 border border-gray-100">
            <span class="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Dependencies</span>
            <div class="text-xs text-gray-800 font-medium">${esc(sel.dependencies || 'None')}</div>
          </div>
        </div>

        <!-- Solution & Notes Callout Card -->
        <div class="p-3.5 bg-teal-50/40 border border-teal-100/80 rounded-xl">
          <div class="text-[11px] font-bold text-[#0e7490] uppercase tracking-wide flex items-center gap-1.5 mb-1">
            <span>💡</span> Solution Discussed &amp; Resolution Notes
          </div>
          <div class="text-xs text-gray-800 leading-relaxed">
            ${sel.solution ? esc(sel.solution) : '<span class="text-gray-400 italic">No solution notes recorded yet.</span>'}
          </div>
        </div>
      </div>

      <div class="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-400">
        <span>Logged in billing period — hours are automatically tallied in the summary matrix above.</span>
      </div>
    </div>
  </div>`;
    })()}
</div>`;

  return `<div class="fade" style="padding:20px 24px 36px;width:100%;box-sizing:border-box;">
  <div class="k-master-detail-grid">
    ${clientRail}
    <div style="min-width:0;">${detailPanel}</div>
  </div>
</div>`;
}