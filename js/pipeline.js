// js/pipeline.js — Sales Pipeline: track upcoming work (existing-client
// expansion AND brand-new prospects) before it becomes real delivery work.
// Same chrome/density as Integrations/Implementation/AMS, one structural
// difference flagged deliberately: the list is deals, not clients, since a
// prospect entry has no client record until it's moved/won.

function pipelineStageBadge(stage) {
  const hex = PIPELINE_STAGE_HEX[stage] || '94a3b8';
  return `<span class="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full" style="background:#${hex}1a;color:#${hex};"><span class="w-1.5 h-1.5 rounded-full" style="background:#${hex};"></span>${esc(stage)}</span>`;
}

function pipelineOriginBadge(entry) {
  return entry.clientId
    ? `<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100">Existing Client</span>`
    : `<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-50 text-purple-600 border border-purple-100">New Prospect</span>`;
}

function pipelineEntryClientName(entry) {
  if (entry.clientId) { const c = S.clients.find(x => x.id === entry.clientId); return c ? c.name : '(client)'; }
  return entry.prospectName || '—';
}

function pipelineDaysInStage(entry) {
  const anchor = entry.lastActivityAt || entry.createdAt;
  if (!anchor) return null;
  return daysDiff(anchor.slice(0, 10));
}

function renderPipeline() {
  fetchPipelineEntries();
  const entries = S.pipelineEntries || [];
  const openEntries = entries.filter(e => e.stage !== 'Won' && e.stage !== 'Lost');
  const totalWeighted = openEntries.reduce((sum, e) => sum + pipelineWeightedValue(e), 0);
  const totalHours = openEntries.reduce((sum, e) => sum + (Number(e.estimatedHours) || 0), 0);
  const staleCount = openEntries.filter(e => pipelineIsStale(e)).length;

  const filtered = entries.filter(e => S.pipelineFilter === 'all' ? true : e.stage === S.pipelineFilter);
  const sorted = [...filtered].sort((a, b) => {
    if (S.pipelineSort === 'value') return (Number(b.quotedValue) || 0) - (Number(a.quotedValue) || 0);
    if (S.pipelineSort === 'stage') return PIPELINE_STAGES.indexOf(a.stage) - PIPELINE_STAGES.indexOf(b.stage);
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });

  const sel = S.selectedPipelineId ? entries.find(e => e.id === S.selectedPipelineId) : null;

  return `<div class="k-page fade">
  <div class="flex items-center justify-between mb-4 flex-wrap gap-3">
    <div>
      <h1 class="text-xl font-bold text-gray-900">Sales Pipeline</h1>
      <p class="text-xs text-gray-500 mt-0.5">${entries.length} opportunit${entries.length === 1 ? 'y' : 'ies'} tracked · ${openEntries.length} open</p>
    </div>
    ${can('editor') ? `<button data-act="modal-open" data-modal="add-pipeline-entry" class="text-sm font-semibold px-4 py-2 rounded-xl bg-[#0e7490] text-white hover:bg-[#0d3d4f] transition">+ New Opportunity</button>` : ''}
  </div>

  <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
    <div class="bg-white rounded-2xl border border-gray-100 p-4">
      <div class="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1">Weighted Pipeline Value</div>
      <div class="text-xl font-extrabold text-gray-900">₹${Math.round(totalWeighted).toLocaleString('en-IN')}</div>
    </div>
    <div class="bg-white rounded-2xl border border-gray-100 p-4">
      <div class="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1">Estimated Hours Coming</div>
      <div class="text-xl font-extrabold text-gray-900">${totalHours.toLocaleString('en-IN')}h</div>
    </div>
    <div class="bg-white rounded-2xl border border-gray-100 p-4">
      <div class="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1">Open Opportunities</div>
      <div class="text-xl font-extrabold text-gray-900">${openEntries.length}</div>
    </div>
    <div class="bg-white rounded-2xl border border-gray-100 p-4">
      <div class="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1">Stale (7d+ no activity)</div>
      <div class="text-xl font-extrabold ${staleCount ? 'text-amber-600' : 'text-gray-900'}">${staleCount}</div>
    </div>
  </div>

  <div class="flex gap-2 items-center mb-4 flex-wrap">
    <div class="flex gap-2 overflow-x-auto pb-1 flex-1 min-w-0">
      ${['all', ...PIPELINE_STAGES].map(st => `<button data-act="pipeline-filter" data-filter="${st}" class="whitespace-nowrap text-xs font-medium px-3 py-1.5 rounded-full transition ${S.pipelineFilter === st ? 'bg-[#0e7490] text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-[#0e7490]/40'}">${st === 'all' ? `All (${entries.length})` : esc(st) + ` (${entries.filter(e => e.stage === st).length})`}</button>`).join('')}
    </div>
    <select data-act="pipeline-sort" class="text-xs border border-gray-200 rounded-full px-3 py-1.5 text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#0e7490]">
      <option value="created" ${S.pipelineSort === 'created' ? 'selected' : ''}>Newest first</option>
      <option value="value" ${S.pipelineSort === 'value' ? 'selected' : ''}>Highest value</option>
      <option value="stage" ${S.pipelineSort === 'stage' ? 'selected' : ''}>By stage</option>
    </select>
  </div>

  <div class="grid ${sel ? 'grid-cols-1 lg:grid-cols-[1fr_360px]' : 'grid-cols-1'} gap-4 items-start">
    <div class="space-y-2">
      ${!sorted.length ? `<div class="bg-white rounded-2xl border border-gray-100 text-center py-16 text-gray-400 text-sm">No opportunities match this filter${can('editor') ? ` — <button data-act="modal-open" data-modal="add-pipeline-entry" class="text-[#0e7490] font-medium">add one</button>` : ''}</div>` :
      sorted.map(e => {
        const stale = pipelineIsStale(e);
        const days = pipelineDaysInStage(e);
        return `<div data-act="select-pipeline-entry" data-id="${esc(e.id)}" class="bg-white rounded-2xl border p-4 cursor-pointer transition hover:border-[#0e7490]/40 ${S.selectedPipelineId === e.id ? 'border-[#0e7490] ring-1 ring-[#0e7490]/30' : 'border-gray-100'}">
          <div class="flex items-start justify-between gap-2 mb-1.5">
            <div class="font-semibold text-sm text-gray-900 truncate">${esc(e.name)}</div>
            ${pipelineStageBadge(e.stage)}
          </div>
          <div class="flex items-center gap-2 mb-2 flex-wrap">
            ${pipelineOriginBadge(e)}
            <span class="text-xs text-gray-500">${esc(pipelineEntryClientName(e))}</span>
            ${stale ? `<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Stale${days !== null ? ` · ${days}d` : ''}</span>` : ''}
          </div>
          <div class="flex items-center gap-4 text-xs text-gray-500">
            ${e.owner ? `<span>${esc(e.owner)}</span>` : `<span class="text-gray-300">Unassigned</span>`}
            ${e.estimatedHours ? `<span>${Number(e.estimatedHours).toLocaleString('en-IN')}h</span>` : ''}
            ${e.quotedValue ? `<span class="font-medium text-gray-700">₹${Number(e.quotedValue).toLocaleString('en-IN')}</span>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>

    ${sel ? renderPipelineDetailPanel(sel) : ''}
  </div>
</div>`;
}

function renderPipelineDetailPanel(e) {
  const decided = e.stage === 'Won' || e.stage === 'Lost';
  const weighted = pipelineWeightedValue(e);
  const days = pipelineDaysInStage(e);
  return `<div class="bg-white rounded-2xl border border-gray-100 p-5 sticky top-4">
    <div class="flex items-start justify-between mb-3">
      <div class="font-bold text-base text-gray-900 pr-2">${esc(e.name)}</div>
      <button data-act="deselect-pipeline-entry" class="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
    </div>
    <div class="flex items-center gap-2 mb-4 flex-wrap">
      ${pipelineStageBadge(e.stage)}
      ${pipelineOriginBadge(e)}
    </div>

    <div class="space-y-2.5 text-sm mb-4">
      <div class="flex justify-between"><span class="text-gray-400">Client / Prospect</span><span class="font-medium text-gray-800">${esc(pipelineEntryClientName(e))}</span></div>
      <div class="flex justify-between"><span class="text-gray-400">Owner</span><span class="font-medium text-gray-800">${esc(e.owner || '—')}</span></div>
      <div class="flex justify-between"><span class="text-gray-400">Win probability</span><span class="font-medium text-gray-800">${e.probability ?? 0}%</span></div>
      <div class="flex justify-between"><span class="text-gray-400">Est. hours</span><span class="font-medium text-gray-800">${e.estimatedHours ? Number(e.estimatedHours).toLocaleString('en-IN') + 'h' : '—'}</span></div>
      <div class="flex justify-between"><span class="text-gray-400">Quoted value</span><span class="font-medium text-gray-800">${e.quotedValue ? '₹' + Number(e.quotedValue).toLocaleString('en-IN') : '—'}</span></div>
      <div class="flex justify-between"><span class="text-gray-400">Weighted value</span><span class="font-medium text-gray-800">₹${Math.round(weighted).toLocaleString('en-IN')}</span></div>
      <div class="flex justify-between"><span class="text-gray-400">Lead source</span><span class="font-medium text-gray-800">${esc(e.leadSource || '—')}</span></div>
      <div class="flex justify-between"><span class="text-gray-400">Target domain</span><span class="font-medium text-gray-800">${esc(e.targetDomain || '—')}</span></div>
      <div class="flex justify-between"><span class="text-gray-400">Expected close</span><span class="font-medium text-gray-800">${fmtDate(e.expectedCloseDate)}</span></div>
      <div class="flex justify-between"><span class="text-gray-400">Days in stage</span><span class="font-medium text-gray-800">${days !== null ? days + 'd' : '—'}</span></div>
    </div>

    ${e.nextAction ? `<div class="mb-3"><div class="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1">Next Action</div><div class="text-sm text-gray-800">${esc(e.nextAction)}</div></div>` : ''}
    ${e.notes ? `<div class="mb-4"><div class="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1">Notes</div><div class="text-sm text-gray-600 whitespace-pre-wrap">${esc(e.notes)}</div></div>` : ''}

    ${e.stage === 'Won' ? `<div class="bg-green-50 border border-green-200 rounded-xl p-3 text-xs text-green-700 mb-3">Won ${fmtDate(e.wonAt ? e.wonAt.slice(0, 10) : '')} — converted to ${esc(e.targetDomain || 'delivery')}${e.clientId ? ` for <button data-act="open-client" data-id="${esc(e.clientId)}" class="font-semibold underline">${esc(pipelineEntryClientName(e))}</button>` : ''}.</div>` : ''}
    ${e.stage === 'Lost' && e.winLossReason ? `<div class="bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs text-rose-700 mb-3">Lost — ${esc(e.winLossReason)}</div>` : ''}

    ${can('editor') ? `<div class="flex flex-col gap-2">
      ${!decided ? `<button data-act="modal-open" data-modal="edit-pipeline-entry" data-id="${esc(e.id)}" class="w-full text-sm font-semibold px-3 py-2 rounded-xl border border-gray-200 text-gray-700 hover:border-[#0e7490]/40">Edit</button>` : ''}
      ${!decided ? `<button data-act="modal-open" data-modal="move-pipeline-entry" data-id="${esc(e.id)}" class="w-full text-sm font-semibold px-3 py-2 rounded-xl bg-[#0e7490] text-white hover:bg-[#0d3d4f]">Move to Integration / Implementation</button>` : ''}
      ${!decided ? `<button data-act="modal-open" data-modal="mark-pipeline-lost" data-id="${esc(e.id)}" class="w-full text-sm font-semibold px-3 py-2 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50">Mark Lost</button>` : ''}
    </div>` : ''}
  </div>`;
}
