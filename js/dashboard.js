// ─── DASHBOARD ────────────────────────────────────────────────────
// The EDITOR view ("Your critical items") is unchanged — it was already
// doing its job. The ADMIN view is rebuilt as a person-first "Team Review"
// for the weekly call: team bandwidth on top, pick/search a person, then
// their items grouped as In the way → Moving → Needs filling in, plus
// flow-level tiles and a full-screen Call Mode.
//
// DESIGN RULE ENFORCED THROUGHOUT: red belongs to WORK, never to a person.
// A person's load bar only ever reads has room / balanced / at capacity.
// Missing data is "needs 2 min", not a hygiene failure. Call Mode orders by
// most-blocked-first, so the person needing most help is served first.
//
// Capacity maths is UNCHANGED from the previous version — same capAdd(),
// same weights (S.capacityWeights), same thresholds (0.6 / 0.9 / cap) that
// previously drove "Available / Stretched / Over capacity".

let _trTimerHandle = null;

function renderDashboard() {
  ensureSnapshotCaptured();
  fetchSnapshotHistory(14);
  fetchCapacityWeights();

  const all = S.clients.flatMap(c => (c.integrations || []).map(i => ({ ...i, clientName: c.name, clientId: c.id })));
  const ar = all.filter(i => i.status === 'At Risk').length;
  const overdue = all.filter(isOverdue);
  const stale = all.filter(i => isStale(i, 7) && !isOverdue(i));
  const needsAttn = [...overdue.map(i => ({ ...i, reason: 'overdue' })), ...stale.map(i => ({ ...i, reason: 'stale' }))].sort((a, b) => (a.reason === 'overdue' && b.reason !== 'overdue') ? -1 : 1);
  const needsDays = i => i.reason === 'overdue' ? daysOverdue(i) : (lastUpdateDate(i) ? daysDiff(lastUpdateDate(i)) : 0);

  const implClients = S.clients.filter(c => c.modules !== undefined);
  const amsClients = S.clients.filter(c => c.workLog !== undefined);
  const allAmsEntries = amsClients.flatMap(c => (c.workLog || []).map(e => ({ ...e, clientName: c.name, clientId: c.id })));
  const openAmsEntries = allAmsEntries.filter(e => e.entryStatus !== 'Closed');
  const isL3orL4 = e => { const q = e.queryLevel || ''; return q.includes('L3') || q.includes('L4'); };
  const isAdmin = can('admin');

  // ── critical items (still used verbatim by the editor view) ──
  const criticalItems = [];
  needsAttn.forEach(i => criticalItems.push({ domain: 'Integration', severity: i.reason === 'overdue' ? 0 : 1, title: i.name, client: i.clientName, detail: i.reason === 'overdue' ? `${daysOverdue(i)}d overdue` : `${needsDays(i)}d stale`, owner: i.assignee || 'Unassigned', act: 'open-integ', cid: i.clientId, iid: i.id }));
  implClients.forEach(c => (c.modules || []).forEach(m => (m.phases || []).forEach(ph => {
    if (ph.status === 'At Risk') criticalItems.push({ domain: 'Phase', severity: 0, title: `${ph.name} — At Risk`, client: c.name, detail: ph.targetDate ? `Target ${fmtDate(ph.targetDate)}` : 'No target date set', owner: ph.assignee || 'Unassigned', act: 'open-impl-client', cid: c.id });
  })));
  openAmsEntries.forEach(e => {
    if (isL3orL4(e)) {
      const age = daysDiff(entryDate(e));
      criticalItems.push({ domain: `AMS · ${(e.queryLevel || '').split(' - ')[0]}`, severity: (e.queryLevel || '').includes('L4') ? 0 : 1, title: (e.description || 'Untitled').slice(0, 60), client: e.clientName, detail: `${age}d open`, owner: entryRaisedBy(e), act: 'open-ams-client', cid: e.clientId });
    }
  });
  criticalItems.sort((a, b) => a.severity - b.severity);

  const critRow = it => `<div class="kd-crit-row" data-act="${it.act}" data-cid="${esc(it.cid)}" data-id="${esc(it.cid)}" ${it.iid ? `data-iid="${esc(it.iid)}"` : ''}>
    <div class="kd-crit-title-wrap">
      ${it.severity === 0 ? `<svg class="kd-crit-flag" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 5v4M8 11h.01M7.1 2.3 1.5 12a1.5 1.5 0 0 0 1.3 2.2h10.4a1.5 1.5 0 0 0 1.3-2.2L8.9 2.3a1 1 0 0 0-1.8 0Z"/></svg>` : ''}
      <div class="min-w-0">
        <div class="kd-crit-title" title="${esc(it.title)}">${esc(it.title)}</div>
        <div class="kd-crit-domain">${esc(it.domain)}</div>
      </div>
    </div>
    <div class="kd-crit-client" title="${esc(it.client)}">${esc(it.client)}</div>
    <div class="kd-crit-status ${it.severity === 0 ? 'kd-text-red' : 'kd-text-amber'}">${esc(it.detail)}</div>
    <div class="kd-crit-owner" title="${esc(it.owner)}">${esc(it.owner)}</div>
  </div>`;

  // ═══ EDITOR VIEW — unchanged ═══
  if (!isAdmin) {
    const myName = (S.user?.name || '').trim().toLowerCase();
    const myItems = criticalItems.filter(it => {
      const owner = (it.owner || '').trim().toLowerCase();
      return owner === myName || owner === 'unassigned' || !owner;
    });
    return `<div class="k-page fade kd">
  ${DASH_CSS}
  <header>
    <h1 class="kd-page-title">Your critical items</h1>
    <p class="kd-page-sub">Assigned to you, plus anything unassigned that needs an owner</p>
  </header>
  <section class="kd-card mt-5">
    <div class="kd-card-head">
      <div class="flex items-center gap-2.5">
        <span class="kd-dot kd-dot-red" aria-hidden="true"></span>
        <h2 class="kd-card-title">Critical items</h2>
      </div>
      <span class="kd-mono kd-count">${myItems.length}</span>
    </div>
    ${myItems.length ? `<div class="kd-crit-table">
      <div class="kd-crit-head"><div>Item</div><div>Client</div><div>Status / Age</div><div>Owner</div></div>
      <div>${myItems.map(critRow).join('')}</div>
    </div>` : `<div class="kd-empty"><div class="kd-empty-icon"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 3v14M3 10h14"/></svg></div><p class="kd-empty-title">Nothing of yours needs attention</p><p class="kd-empty-hint">Nothing assigned to "${esc(S.user?.name || '')}" is overdue, stale or critical.</p></div>`}
  </section>
</div>`;
  }

  // ═══ ADMIN — TEAM REVIEW ═══
  const model = trBuildModel(implClients, all, openAmsEntries);
  if (S.dashCallMode) return trRenderCallMode(model);

  const q = (S.dashPersonSearch || '').toLowerCase().trim();
  const shown = model.people.filter(p => p.name.toLowerCase().includes(q));
  const selected = model.people.find(p => p.name === S.dashPerson)
    || (q && shown.length === 1 ? shown[0] : null)
    || trCallOrder(model)[0] || null;

  const cw = S.capacityWeights;
  const sections = {};

  // ── TEAM BANDWIDTH ──
  const bands = { room: [], bal: [], full: [] };
  shown.forEach(p => bands[p.band].push(p));
  const bandCol = (key, label) => {
    const list = bands[key];
    return `<div>
      <div class="tr-col-h">
        <span class="kd-dot" style="background:${TR_BAND_C[key]}"></span>
        <span style="color:${TR_BAND_C[key]}">${label}</span>
        <span class="tr-col-n">${list.length}</span>
      </div>
      ${list.length ? list.map(p => `<button class="tr-chip ${selected && selected.name === p.name ? 'tr-chip-on' : ''}" data-act="tr-pick" data-key="${esc(p.name)}">
        ${avatarChip(p.name, 26)}
        <span class="tr-chip-mid">
          <span class="tr-chip-n">${esc(p.name)}</span>
          <span class="tr-chip-meta">
            <span>${p.items.length} item${p.items.length !== 1 ? 's' : ''}</span>
            ${p.blocked.length ? `<span class="kd-text-red">${p.blocked.length} blocked</span>` : ''}
          </span>
          <span class="tr-bar"><i style="width:${Math.min(100, p.load / cw.cap * 100)}%;background:${TR_BAND_C[key]}"></i></span>
        </span>
        <span class="kd-mono tr-chip-load">${p.load.toFixed(1)}</span>
      </button>`).join('') : `<div class="tr-empty">Nobody here right now</div>`}
    </div>`;
  };

  sections['team-bandwidth'] = `<section class="kd-card kd-tile">
    <div class="kd-card-head kd-wrap">
      <div class="min-w-0">
        <h2 class="kd-card-title">Team bandwidth</h2>
        <p class="kd-card-subline">Grouped by room to take on work, not by output. Pick someone to see their items. Module ${cw.module} · PMO ${cw.pmo} · AMS ${cw.ams} · cap ${cw.cap}</p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <input type="text" id="dash-person-search-inp" data-act="tr-search" value="${esc(S.dashPersonSearch || '')}" placeholder="Search a person…" class="kd-search"/>
        <button data-act="modal-open" data-modal="capacity-weights" class="kd-btn kd-btn-outline kd-btn-sm">Weights</button>
      </div>
    </div>
    ${model.overCap.length ? `<div class="tr-band">
      <span class="kd-dot" style="background:var(--dk-amber)"></span>
      <p class="kd-bold-sm kd-text-amber">${model.overCap.map(p => esc(p.name)).join(', ')} ${model.overCap.length === 1 ? 'is' : 'are'} carrying more than the cap — worth rebalancing before anything new is assigned.</p>
    </div>` : ''}
    <div class="tr-cols">${bandCol('room', 'Has room')}${bandCol('bal', 'Balanced')}${bandCol('full', 'At capacity')}</div>
  </section>`;

  // ── PERSON PANEL ──
  sections['person-panel'] = selected ? (() => {
    const f = S.dashFilter;
    const list = trApplyFilter(selected.items, f);
    const blocked = list.filter(i => i.blocker);
    const missing = list.filter(i => !i.blocker && i.missing);
    const moving = list.filter(i => !i.blocker && !i.missing);
    const grp = (label, color, items, why, empty) => `<div class="tr-grp">
      <div class="tr-grp-h">
        <span class="kd-dot" style="background:${color}"></span>
        <span class="tr-grp-t" style="color:${color}">${label}</span>
        <span class="tr-grp-c">${items.length}</span>
        <span class="tr-grp-why">${why}</span>
      </div>
      ${items.length ? items.map(trItemCard).join('') : `<div class="tr-empty">${empty}</div>`}
    </div>`;
    return `<section class="kd-card kd-tile" style="padding:0">
      <div class="tr-pp-top">
        ${avatarChip(selected.name, 40)}
        <div class="min-w-0">
          <div class="tr-pp-name">${esc(selected.name)}</div>
          <div class="tr-pp-role">${esc(selected.role)}${selected.pmoFor.length ? ` · PMO for ${selected.pmoFor.length} client${selected.pmoFor.length !== 1 ? 's' : ''}` : ''}</div>
        </div>
        <div class="tr-pp-load">
          <div class="kd-mono tr-pp-load-n" style="color:${TR_BAND_C[selected.band]}">${TR_BAND_L[selected.band]} · ${selected.load.toFixed(1)}/${cw.cap}</div>
          <div class="tr-bar" style="width:150px;margin-left:auto"><i style="width:${Math.min(100, selected.load / cw.cap * 100)}%;background:${TR_BAND_C[selected.band]}"></i></div>
          <div class="tr-pp-load-l">${selected.clients.size} client${selected.clients.size !== 1 ? 's' : ''}${f !== 'all' ? ' · filtered' : ''}</div>
        </div>
      </div>
      ${grp('In the way', 'var(--dk-red)', blocked, 'talk about these first', 'Nothing is blocked right now.')}
      ${grp('Moving', 'var(--dk-primary)', moving, 'confirm the next action still holds', 'No active items.')}
      ${grp('Needs filling in', 'var(--dk-mute-2)', missing, 'a data gap, not a performance issue', 'Everything is filled in.')}
    </section>`;
  })() : `<section class="kd-card kd-tile"><div class="kd-empty"><p class="kd-empty-title">No one to show</p><p class="kd-empty-hint">No admin or editor users match that search.</p></div></section>`;

  // ── WHERE WORK IS PILING UP ──
  const stageCounts = {};
  PHASES.forEach(p => stageCounts[p] = 0);
  implClients.forEach(c => (c.modules || []).forEach(m => { if (m.singlePhase) return; (m.phases || []).forEach(ph => { if (ph.status === 'In Progress' || ph.status === 'At Risk' || ph.status === 'Delayed') stageCounts[ph.name] = (stageCounts[ph.name] || 0) + 1; }); }));
  const stagePairs = Object.entries(stageCounts);
  const stageTotal = stagePairs.reduce((a, s) => a + s[1], 0);
  const stageMax = Math.max(...stagePairs.map(s => s[1]), 1);
  const stageTop = stagePairs.slice().sort((a, b) => b[1] - a[1])[0];
  sections['work-stages'] = `<section class="kd-card kd-tile">
    <h2 class="kd-card-title">Where work is piling up</h2>
    <p class="kd-card-subline mb-3">Live phases sitting in each stage. A tall bar is a process queue, not a person.</p>
    ${stageTotal ? stagePairs.map(([name, n]) => `<div class="tr-stage">
        <span class="tr-stage-l">${esc(name)}</span>
        <span class="tr-stage-t"><i class="${name === stageTop[0] && n > 0 ? 'tr-hot' : ''}" style="width:${n / stageMax * 100}%"></i></span>
        <span class="kd-mono tr-stage-n">${n}</span>
      </div>`).join('') + `<p class="kd-footnote">Most live work sits at <b>${esc(stageTop[0])}</b> (${Math.round(stageTop[1] / stageTotal * 100)}%). Worth asking what that stage needs to clear it.</p>`
      : `<div class="tr-empty">No phases are in progress.</div>`}
  </section>`;

  // ── QUIET THE LONGEST ──
  const buckets = [['Updated this week', 0, 7], ['8–14 days', 8, 14], ['15–30 days', 15, 30], ['Over 30 days', 31, 99999]];
  sections['aging'] = `<section class="kd-card kd-tile">
    <h2 class="kd-card-title">Time since last update</h2>
    <p class="kd-card-subline mb-3">How long live items have been quiet. A long gap usually means a decision is waiting, not that someone forgot.</p>
    ${buckets.map(([label, lo, hi]) => {
    const n = model.items.filter(i => i.age !== null && i.age >= lo && i.age <= hi).length;
    const hot = lo >= 15;
    return `<div class="tr-row">
        <div><div>${label}</div><div class="tr-row-sub">${hot ? 'usually a decision waiting to be made' : 'healthy flow'}</div></div>
        <span class="tr-pill ${hot && n ? 'tr-pill-hot' : ''}">${n}</span>
      </div>`;
  }).join('')}
    ${model.noUpdate ? `<p class="kd-footnote">${model.noUpdate} item${model.noUpdate !== 1 ? 's have' : ' has'} never been updated, so no gap can be measured yet.</p>` : ''}
  </section>`;

  // ── NEEDS AN OWNER ──
  const roomy = model.people.filter(p => p.band === 'room').slice(0, 3).map(p => p.name.split(' ')[0]);
  sections['needs-owner'] = `<section class="kd-card kd-tile">
    <div class="kd-card-head"><div>
      <h2 class="kd-card-title">Needs an owner</h2>
      <p class="kd-card-subline">Live work with nobody's name on it. Assign it and it leaves this list.</p>
    </div><span class="kd-mono kd-count">${model.unowned.length}</span></div>
    ${model.unowned.length ? model.unowned.slice(0, 12).map(i => `<div class="tr-row tr-row-click" data-act="${i.act}" data-cid="${esc(i.cid)}" data-id="${esc(i.cid)}" ${i.mid ? `data-mid="${esc(i.mid)}"` : ''} ${i.iid ? `data-iid="${esc(i.iid)}"` : ''} ${i.phase ? `data-phase="${esc(i.phase)}"` : ''}>
        <div><div><b>${esc(i.client)}</b> <span class="tr-dim">· ${esc(i.label)}${i.sub ? ' · ' + esc(i.sub) : ''}</span></div>
        <div class="tr-row-sub">unassigned${i.age !== null ? ` · quiet ${i.age}d` : ''}</div></div>
        <span class="tr-assign">Assign →</span>
      </div>`).join('') + (roomy.length ? `<p class="kd-footnote"><b class="kd-text-green">${roomy.map(esc).join(', ')}</b> ${roomy.length === 1 ? 'has' : 'have'} room this week.</p>` : '')
      : `<div class="tr-empty">Everything has an owner.</div>`}
  </section>`;

  // ── LANDING SOON ──
  const todayS = todayStr();
  const in14 = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const soon = model.items.filter(i => i.due && i.due >= todayS && i.due <= in14).sort((a, b) => a.due.localeCompare(b.due));
  sections['upcoming-deadlines'] = `<section class="kd-card kd-tile">
    <div class="kd-card-head"><div>
      <h2 class="kd-card-title">Landing in the next 14 days</h2>
      <p class="kd-card-subline">So the call covers what's coming, not only what slipped.</p>
    </div><span class="kd-mono kd-count">${soon.length}</span></div>
    ${soon.length ? soon.slice(0, 14).map(i => `<div class="tr-row tr-row-click" data-act="${i.act}" data-cid="${esc(i.cid)}" data-id="${esc(i.cid)}" ${i.mid ? `data-mid="${esc(i.mid)}"` : ''} ${i.iid ? `data-iid="${esc(i.iid)}"` : ''} ${i.phase ? `data-phase="${esc(i.phase)}"` : ''}>
        <div><div><b>${esc(i.client)}</b> <span class="tr-dim">· ${esc(i.label)}</span></div>
        <div class="tr-row-sub">${esc(i.owner || 'Unassigned')}</div></div>
        <span class="kd-mono tr-due">${fmtDate(i.due)}</span>
      </div>`).join('') : `<div class="tr-empty">Nothing due in the next fortnight.</div>`}
  </section>`;

  const layout = getDashLayout().filter(t => {
    const reg = DASH_TILE_REGISTRY.find(r => r.id === t.id);
    return reg && t.visible && (!reg.adminOnly || isAdmin) && sections[t.id];
  });
  const paired = ['work-stages', 'aging', 'needs-owner', 'upcoming-deadlines'];
  const wide = layout.filter(t => !paired.includes(t.id)).map(t => sections[t.id]).join('');
  const grid = layout.filter(t => paired.includes(t.id)).map(t => sections[t.id]).join('');

  const d = new Date();
  const stamp = (d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).replace(/,/g, '') + ' · ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })).toUpperCase();

  return `<div class="k-page fade kd">
  ${DASH_CSS}
  <header class="flex flex-wrap items-start justify-between gap-3">
    <div class="min-w-0">
      <p class="kd-datestamp">${esc(stamp)}</p>
      <h1 class="kd-page-title">Team Review</h1>
      <p class="kd-page-sub">Who is carrying what, what is in their way, and what moves this week.</p>
    </div>
    <div class="flex items-center gap-2">
      <button data-act="modal-open" data-modal="dashboard-layout" class="kd-btn kd-btn-outline">Customise</button>
      <button data-act="portfolio-export" class="kd-btn kd-btn-outline">Export</button>
      <button data-act="tr-call-start" class="kd-btn kd-btn-primary">▶ Start weekly call</button>
    </div>
  </header>

  <div class="tr-actionbar">
    ${TR_FILTERS.map(f => {
    const n = trApplyFilter(model.items, f.k).length;
    return `<button data-act="tr-filter" data-key="${f.k}" class="tr-act ${S.dashFilter === f.k ? 'tr-act-on' : ''}">
      <span class="tr-act-n" style="color:${f.c}">${n}</span>
      <span class="tr-act-l">${f.l}</span>
      <span class="tr-act-h">${f.h}</span>
    </button>`;
  }).join('')}
  </div>

  ${wide}
  <div class="tr-tiles">${grid}</div>
  <p class="tr-legend">Red belongs to the work, never to a person — a load bar only ever reads <b class="kd-text-green">has room</b>, <b style="color:var(--dk-primary)">balanced</b> or <b class="kd-text-amber">at capacity</b>. Integration items still count toward load; they carry no blocker field yet, so they can't appear under "In the way".</p>
</div>`;
}

// ─── TEAM REVIEW MODEL ────────────────────────────────────────────
const TR_BAND_C = { room: 'var(--dk-green)', bal: 'var(--dk-primary)', full: 'var(--dk-amber)' };
const TR_BAND_L = { room: 'Has room', bal: 'Balanced', full: 'At capacity' };
const TR_KIND = { gov: ['Governance', 'tr-t-gov'], impl: ['Delivery', 'tr-t-impl'], int: ['Integration', 'tr-t-int'], ams: ['AMS', 'tr-t-ams'] };
const TR_FILTERS = [
  { k: 'all', l: 'Live items', h: 'everything in flight', c: 'var(--dk-ink)' },
  { k: 'blocked', l: 'Need unblocking', h: 'someone is waiting on an answer', c: 'var(--dk-red)' },
  { k: 'waiting', l: 'Waiting 7 days +', h: 'escalate or change the plan', c: 'var(--dk-amber)' },
  { k: 'due', l: 'Landing in 14 days', h: 'confirm they are on track', c: 'var(--dk-ink)' },
  { k: 'missing', l: 'Need 2 min to fill in', h: 'not a performance signal', c: 'var(--dk-mute)' },
];

function trApplyFilter(items, f) {
  const todayS = todayStr();
  const in14 = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  if (!f || f === 'all') return items;
  if (f === 'blocked') return items.filter(i => i.blocker);
  if (f === 'waiting') return items.filter(i => i.waitingDays !== null && i.waitingDays >= 7);
  if (f === 'due') return items.filter(i => i.due && i.due >= todayS && i.due <= in14);
  if (f === 'missing') return items.filter(i => i.missing);
  return items;
}

// Most-blocked-first: the person who needs the most help is served first.
// Never a performance ranking.
function trCallOrder(model) {
  return model.people.slice().sort((a, b) => (b.blocked.length - a.blocked.length) || (b.load - a.load) || a.name.localeCompare(b.name));
}

// Build the person-indexed work model. Capacity maths is unchanged from the
// previous dashboard — same capAdd, weights and thresholds.
function trBuildModel(implClients, allIntegrations, openAmsEntries) {
  const cw = S.capacityWeights;
  const capacity = {};
  const capAdd = (name, type, amount, detail) => {
    const nm = (name || '').trim(); if (!nm) return;
    if (!capacity[nm]) capacity[nm] = { module: 0, pmo: 0, integ: 0, ams: 0, total: 0, details: [] };
    capacity[nm][type] += amount; capacity[nm].total += amount;
    if (detail) capacity[nm].details.push({ type, amount, detail });
  };
  const seenModulePairs = new Set();
  implClients.forEach(c => (c.modules || []).forEach(m => (m.phases || []).forEach(ph => {
    if (ph.status === 'Completed' || ph.status === 'Not Started' || !ph.assignee) return;
    const key = `${ph.assignee.trim()}::${m.id}`;
    if (seenModulePairs.has(key)) return; seenModulePairs.add(key);
    capAdd(ph.assignee, 'module', cw.module, `${m.name} · ${c.name}`);
  })));
  implClients.forEach(c => (c.modules || []).forEach(m => {
    if (m.assignee && m.effort) capAdd(m.assignee, 'module', Number(m.effort) || 0, `${m.name} (module) · ${c.name}`);
  }));
  const pmoFor = {};
  implClients.forEach(c => {
    if (!c.masterAssignee) return;
    capAdd(c.masterAssignee, 'pmo', cw.pmo, `PMO · ${c.name}`);
    (pmoFor[c.masterAssignee.trim()] = pmoFor[c.masterAssignee.trim()] || []).push(c.name);
  });
  allIntegrations.filter(i => !['Completed', 'Cancelled'].includes(i.status)).forEach(i => { if (i.assignee) capAdd(i.assignee, 'integ', i.effortWeight ?? 0.5, `${i.name} · ${i.clientName}`); });
  openAmsEntries.forEach(e => { const rb = entryRaisedBy(e); if (rb && rb !== '—') capAdd(rb, 'ams', cw.ams, `${e.description || 'AMS ticket'} · ${e.clientName}`); });

  // ── items ──
  const items = [];
  const lastPhaseUpdate = ph => {
    const u = ph.updates || [];
    if (!u.length) return ph.startDate || null;
    return u.reduce((a, x) => { const dt = (x.addedAt || x.date || '').slice(0, 10); return dt > a ? dt : a; }, '') || ph.startDate || null;
  };
  implClients.forEach(c => (c.modules || []).forEach(m => (m.phases || []).forEach(ph => {
    if (ph.status === 'Completed') return;
    const owner = (ph.assignee || (m.singlePhase ? m.assignee : '') || '').trim();
    const lu = lastPhaseUpdate(ph);
    items.push({
      owner, client: c.name, cid: c.id, mid: m.id, phase: ph.name,
      label: m.name, sub: m.singlePhase ? null : ph.name,
      kind: m.singlePhase ? 'gov' : 'impl', status: ph.status,
      activity: ph.currentActivity || '', next: ph.nextAction || '',
      blocker: ph.blocker || '', waitingOn: ph.waitingOn || '',
      waitingDays: ph.blockerSince ? daysDiff(ph.blockerSince) : null,
      age: lu ? daysDiff(lu) : null, due: ph.targetDate || '',
      missing: typeof phaseIsIncomplete === 'function' ? phaseIsIncomplete(ph) : false,
      act: 'open-impl-phase',
    });
  })));
  allIntegrations.filter(i => !['Completed', 'Cancelled'].includes(i.status)).forEach(i => {
    const lu = lastUpdateDate(i);
    items.push({
      owner: (i.assignee || '').trim(), client: i.clientName, cid: i.clientId, iid: i.id,
      label: i.name, sub: null, kind: 'int', status: i.status,
      activity: i.timeline?.[0]?.update || '', next: '',
      blocker: '', waitingOn: '', waitingDays: null,
      age: lu ? daysDiff(lu) : null, due: i.dueDate || '',
      missing: !i.assignee || !i.dueDate, act: 'open-integ',
    });
  });
  openAmsEntries.forEach(e => {
    const rb = entryRaisedBy(e);
    const dep = (e.dependencies || '').trim();
    items.push({
      owner: rb && rb !== '—' ? rb.trim() : '', client: e.clientName, cid: e.clientId,
      label: (e.description || 'AMS item').slice(0, 70), sub: e.queryLevel || null,
      kind: 'ams', status: e.entryStatus || 'Open',
      activity: '', next: '',
      blocker: dep, waitingOn: dep ? 'see dependency' : '', waitingDays: null,
      age: entryDate(e) ? daysDiff(entryDate(e)) : null, due: e.dueDate || '',
      missing: false, act: 'open-ams-client',
    });
  });

  // ── people: every admin/editor user, so nobody silently vanishes ──
  const roster = (S.usersForDropdown || []).filter(u => u.role === 'admin' || u.role === 'editor');
  const names = new Set(roster.map(u => (u.name || '').trim()).filter(Boolean));
  // anyone holding work but not in the roster still shows, rather than
  // their items disappearing from the review entirely
  items.forEach(i => { if (i.owner) names.add(i.owner); });
  Object.keys(capacity).forEach(n => names.add(n));

  const people = [...names].map(name => {
    const mine = items.filter(i => i.owner === name);
    const load = capacity[name]?.total || 0;
    const band = load < cw.cap * 0.6 ? 'room' : load >= cw.cap * 0.9 ? 'full' : 'bal';
    const r = roster.find(u => (u.name || '').trim() === name);
    return {
      name, role: r ? (r.role === 'admin' ? 'Admin' : 'Editor') : 'Not a Kora user',
      load, band, items: mine, blocked: mine.filter(i => i.blocker),
      clients: new Set(mine.map(i => i.client)),
      details: capacity[name]?.details || [], pmoFor: pmoFor[name] || [],
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  return {
    people, items,
    unowned: items.filter(i => !i.owner),
    overCap: people.filter(p => p.load > cw.cap),
    noUpdate: items.filter(i => i.age === null).length,
  };
}

function trItemCard(i) {
  const [kindLabel, kindClass] = TR_KIND[i.kind] || TR_KIND.impl;
  const quiet = i.age !== null && i.age >= 14;
  return `<div class="tr-it ${i.blocker ? 'tr-it-blocked' : ''}" data-act="${i.act}" data-cid="${esc(i.cid)}" data-id="${esc(i.cid)}" ${i.mid ? `data-mid="${esc(i.mid)}"` : ''} ${i.iid ? `data-iid="${esc(i.iid)}"` : ''} ${i.phase ? `data-phase="${esc(i.phase)}"` : ''}>
    <div class="tr-it-h">
      <span class="tr-it-c">${esc(i.client)}</span>
      <span class="tr-it-p">${esc(i.label)}${i.sub ? ' · ' + esc(i.sub) : ''}</span>
      <span class="tr-tag ${kindClass}">${kindLabel}</span>
      <span class="kd-mono tr-it-age ${quiet ? 'kd-text-amber' : ''}">${i.age === null ? 'no updates yet' : `quiet ${i.age}d`}</span>
    </div>
    ${i.missing && !i.activity && !i.next ? `<div class="tr-f-v tr-dim-i">No current activity or next action recorded yet.</div>
      <span class="tr-fix">＋ Fill this in (takes 2 minutes)</span>`
      : `<div class="tr-flow">
        <div><div class="tr-f-l">Where it is now</div><div class="tr-f-v">${i.activity ? esc(i.activity) : '<span class="tr-dim-i">not recorded</span>'}</div></div>
        <div><div class="tr-f-l">Next action</div><div class="tr-f-v">${i.next ? esc(i.next) : '<span class="tr-dim-i">not recorded</span>'}</div></div>
      </div>`}
    ${i.blocker ? `<div class="tr-imp">
      <div class="tr-imp-l"><span class="kd-dot kd-dot-red"></span>In the way</div>
      <div class="tr-imp-t">${esc(i.blocker)}</div>
      <div class="tr-imp-m">
        ${i.waitingOn ? `<span>Waiting on <span class="tr-who">${esc(i.waitingOn)}</span></span>` : ''}
        ${i.waitingDays !== null ? `<span class="kd-mono">${i.waitingDays} day${i.waitingDays !== 1 ? 's' : ''}</span>` : ''}
      </div>
    </div>` : ''}
    ${i.due ? `<div class="tr-it-due">Target <b>${fmtDate(i.due)}</b></div>` : ''}
  </div>`;
}

// ─── CALL MODE ────────────────────────────────────────────────────
// Cached so the "Finish" branch in events.js knows where the list ends
// without rebuilding the whole model.
let _trOrderLen = 0;
function trCallOrderLength() { return _trOrderLen; }

function trRenderCallMode(model) {
  const order = trCallOrder(model);
  _trOrderLen = order.length;
  if (!order.length) return `<div class="k-page fade kd">${DASH_CSS}<div class="kd-empty"><p class="kd-empty-title">Nobody to review</p><button data-act="tr-call-end" class="kd-btn kd-btn-outline mt-3">Back</button></div></div>`;
  const idx = Math.max(0, Math.min(order.length - 1, S.dashCallIdx || 0));
  const p = order[idx];
  const blocked = p.items.filter(i => i.blocker);
  const missing = p.items.filter(i => !i.blocker && i.missing);
  const moving = p.items.filter(i => !i.blocker && !i.missing);
  const cw = S.capacityWeights;

  const oldest = blocked.slice().sort((a, b) => (b.waitingDays || 0) - (a.waitingDays || 0))[0];
  const ask = blocked.length
    ? `${blocked.length === 1 ? 'One thing is' : blocked.length + ' things are'} blocked. What would clear the oldest one${oldest && oldest.waitingDays !== null ? ` — ${oldest.waitingDays} day${oldest.waitingDays !== 1 ? 's' : ''} waiting${oldest.waitingOn ? ' on ' + esc(oldest.waitingOn) : ''}` : ''}?`
    : missing.length
      ? `Nothing is blocked. ${missing.length} item${missing.length !== 1 ? 's need' : ' needs'} its current activity filling in — shall we do that now, together?`
      : p.items.length
        ? `Nothing blocked, everything current. Anything coming that we should plan for?`
        : `Nothing assigned this week — good moment to pick something up from "Needs an owner".`;

  const block = (label, color, items) => items.length ? `<div class="tr-cm-block">
    <h3 class="tr-cm-sec"><span class="kd-dot" style="background:${color}"></span><span style="color:${color}">${label}</span></h3>
    ${items.map(trItemCard).join('')}
  </div>` : '';

  return `<div class="kd tr-cm">
  ${DASH_CSS}
  <div class="tr-cm-progress"><i style="width:${(idx + 1) / order.length * 100}%"></i></div>
  <div class="tr-cm-top">
    <div>
      <div class="kd-mono tr-cm-pos">Person ${idx + 1} of ${order.length}</div>
      <div class="tr-cm-title">Weekly team call</div>
    </div>
    <div class="flex items-center gap-2 flex-wrap">
      <span id="tr-timer" class="kd-mono tr-cm-timer">5:00</span>
      <button data-act="tr-call-prev" class="kd-btn kd-btn-outline kd-btn-sm"${idx === 0 ? ' disabled style="opacity:.4"' : ''}>← Previous</button>
      <button data-act="tr-call-next" class="kd-btn kd-btn-primary kd-btn-sm">${idx === order.length - 1 ? 'Finish ✓' : 'Next person →'}</button>
      <button data-act="tr-call-end" class="kd-btn kd-btn-outline kd-btn-sm">Exit</button>
    </div>
  </div>
  <div class="tr-cm-body"><div class="tr-cm-inner">
    <div class="tr-cm-who">
      ${avatarChip(p.name, 46)}
      <div class="min-w-0">
        <div class="tr-cm-name">${esc(p.name)}</div>
        <div class="tr-cm-role">${esc(p.role)}${p.pmoFor.length ? ` · PMO for ${p.pmoFor.length}` : ''}</div>
      </div>
      <div class="tr-cm-load">
        <div class="kd-mono tr-pp-load-n" style="color:${TR_BAND_C[p.band]}">${TR_BAND_L[p.band]}</div>
        <div class="tr-bar" style="width:160px;margin-top:4px"><i style="width:${Math.min(100, p.load / cw.cap * 100)}%;background:${TR_BAND_C[p.band]}"></i></div>
        <div class="tr-pp-load-l">${p.items.length} item${p.items.length !== 1 ? 's' : ''} · ${p.clients.size} client${p.clients.size !== 1 ? 's' : ''}</div>
      </div>
    </div>
    <div class="tr-ask"><div class="tr-ask-l">Ask this</div><div class="tr-ask-q">${ask}</div></div>
    ${block('In the way — decide here', 'var(--dk-red)', blocked)}
    ${block('Moving — confirm the next action', 'var(--dk-primary)', moving)}
    ${block('Fill in together', 'var(--dk-mute-2)', missing)}
    ${!p.items.length ? `<div class="tr-empty" style="font-size:14px;padding:30px 0">Nothing assigned right now.</div>` : ''}
  </div></div>
</div>`;
}

// Per-person pacing. Writes straight to the timer node — it must NEVER call
// render(), which would replace #app and wipe anything being typed.
function trStartTimer() {
  trStopTimer();
  let left = 300;
  _trTimerHandle = setInterval(() => {
    const el = document.getElementById('tr-timer');
    if (!el) { trStopTimer(); return; }
    left--;
    const m = Math.floor(Math.abs(left) / 60), s = String(Math.abs(left) % 60).padStart(2, '0');
    el.textContent = (left < 0 ? '+' : '') + m + ':' + s;
    el.classList.toggle('tr-cm-timer-over', left < 0);
  }, 1000);
}
function trStopTimer() { if (_trTimerHandle) { clearInterval(_trTimerHandle); _trTimerHandle = null; } }

const DASH_CSS = `<style>
.kd{ --dk-primary: var(--teal); --dk-red: var(--red); --dk-amber: var(--amber); --dk-green: var(--green);
     --dk-sky: #43AFCD; --dk-ink: var(--ink); --dk-mute: var(--mute); --dk-mute-2: var(--mute-2); --dk-line: var(--line); --dk-line-2: var(--line-2); --dk-paper: var(--paper); }
.kd-page-title{ font-size:22px; font-weight:700; color:var(--ink-2); line-height:1.15; letter-spacing:-.02em; }
.kd-page-sub{ margin-top:3px; font-size:12.5px; color:var(--dk-mute); }
.kd-datestamp{ font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:.07em; color:var(--dk-mute-2); margin-bottom:5px; }
.kd-btn{ font-size:12.5px; font-weight:500; padding:7px 13px; border-radius:var(--radius); transition:all var(--t-fast); white-space:nowrap; }
.kd-btn-outline{ border:1px solid var(--dk-line); color:var(--ink-3); background:var(--dk-paper); }
.kd-btn-outline:hover{ border-color:var(--dk-primary); color:var(--dk-primary); }
.kd-btn-primary{ background:var(--dk-primary); color:#fff; font-weight:600; box-shadow:var(--shadow-s); }
.kd-btn-primary:hover{ filter:brightness(1.08); }
.kd-btn-sm{ padding:6px 11px; font-size:12px; }
.kd-num{ font-weight:700; }
.kd-mono{ font-family:var(--mono); }
.kd-text-red{ color:var(--dk-red); } .kd-text-amber{ color:var(--dk-amber); } .kd-text-green{ color:var(--dk-green); }
.kd-bold-sm{ font-size:12px; font-weight:500; }
.kd-dot{ width:7px; height:7px; border-radius:50%; display:inline-block; flex-shrink:0; }
.kd-dot-red{ background:var(--dk-red); }

.kd-tile{ margin-top:16px; }
.kd-card{ background:var(--dk-paper); border:1px solid var(--dk-line); border-radius:var(--radius-l); padding:16px; }
.kd-card-head{ display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:12px; }
.kd-wrap{ flex-wrap:wrap; row-gap:8px; }
.kd-card-title{ font-size:13px; font-weight:600; color:var(--ink-2); letter-spacing:-.01em; }
.kd-card-subline{ margin-top:2px; font-size:11.5px; color:var(--dk-mute-2); font-weight:400; }
.kd-count{ font-size:11px; color:var(--dk-mute); }
.kd-footnote{ margin-top:10px; padding-top:9px; border-top:1px solid var(--dk-line-2); font-size:11.5px; color:var(--dk-mute); line-height:1.5; }
.kd-empty{ text-align:center; padding:30px 12px; }
.kd-empty-icon{ width:30px; height:30px; margin:0 auto 8px; color:var(--dk-mute-2); }
.kd-empty-title{ font-size:13px; font-weight:500; color:var(--dk-mute); }
.kd-empty-hint{ margin-top:4px; font-size:11.5px; color:var(--dk-mute-2); max-width:280px; margin-left:auto; margin-right:auto; }
.kd-search{ font-size:12.5px; border:1px solid var(--dk-line); border-radius:var(--radius); padding:7px 10px; max-width:230px; background:var(--dk-paper); }
.kd-search:focus{ outline:none; border-color:var(--dk-primary); box-shadow:0 0 0 3px var(--teal-lo); }

/* editor view — critical items table */
.kd-crit-table{ border:1px solid var(--dk-line-2); border-radius:var(--radius); overflow:hidden; }
.kd-crit-head{ display:grid; grid-template-columns:1fr 160px 130px 140px; background:var(--surface); border-bottom:1px solid var(--dk-line); font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:.05em; color:var(--dk-mute); padding:8px 14px; }
.kd-crit-row{ display:grid; grid-template-columns:1fr 160px 130px 140px; align-items:center; gap:10px; padding:10px 14px; border-bottom:1px solid var(--dk-line-2); cursor:pointer; transition:background var(--t-fast); }
.kd-crit-row:last-child{ border-bottom:none; }
.kd-crit-row:hover{ background:var(--teal-hi); }
.kd-crit-title-wrap{ display:flex; align-items:flex-start; gap:6px; min-width:0; }
.kd-crit-flag{ width:13px; height:13px; margin-top:2px; flex-shrink:0; color:var(--dk-red); }
.kd-crit-title{ font-size:12.5px; font-weight:500; color:var(--dk-ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.kd-crit-domain{ font-size:10.5px; color:var(--dk-mute-2); margin-top:1px; }
.kd-crit-client{ font-size:12px; color:var(--dk-mute); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.kd-crit-status{ font-family:var(--mono); font-size:11.5px; font-weight:500; }
.kd-crit-owner{ font-size:12px; color:var(--dk-mute); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
@media (max-width:820px){ .kd-crit-head{ display:none; } .kd-crit-row{ grid-template-columns:1fr; row-gap:2px; } }

/* ── team review ── */
.tr-actionbar{ display:grid; grid-template-columns:repeat(5,1fr); gap:1px; background:var(--dk-line); border:1px solid var(--dk-line); border-radius:var(--radius-l); overflow:hidden; margin-top:16px; }
.tr-act{ background:var(--dk-paper); padding:11px 14px; text-align:left; transition:background var(--t-fast); }
.tr-act:hover{ background:var(--teal-hi); }
.tr-act-on{ background:var(--teal-hi); box-shadow:inset 0 -2px 0 var(--dk-primary); }
.tr-act-n{ display:block; font-size:21px; font-weight:700; line-height:1.1; letter-spacing:-.02em; }
.tr-act-l{ display:block; font-size:11.5px; color:var(--dk-mute); margin-top:3px; line-height:1.3; }
.tr-act-h{ display:block; font-size:10.5px; color:var(--dk-mute-2); margin-top:1px; }

.tr-cols{ display:grid; grid-template-columns:repeat(3,1fr); gap:14px; align-items:start; }
.tr-col-h{ display:flex; align-items:center; gap:6px; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.05em; margin-bottom:8px; }
.tr-col-n{ font-family:var(--mono); font-weight:400; color:var(--dk-mute-2); letter-spacing:0; }
.tr-chip{ display:flex; align-items:center; gap:9px; width:100%; padding:8px 10px; border:1px solid var(--dk-line); border-radius:var(--radius); background:var(--dk-paper); margin-bottom:6px; transition:all var(--t-fast); text-align:left; }
.tr-chip:hover{ border-color:var(--dk-primary); box-shadow:var(--shadow-s); }
.tr-chip-on{ border-color:var(--dk-primary); background:var(--teal-hi); box-shadow:inset 2px 0 0 var(--dk-primary); }
.tr-chip-mid{ flex:1; min-width:0; }
.tr-chip-n{ display:block; font-size:12.5px; font-weight:500; color:var(--dk-ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.tr-chip-meta{ display:flex; gap:7px; font-size:10.5px; color:var(--dk-mute-2); margin-top:1px; }
.tr-chip-load{ font-size:11px; font-weight:600; color:var(--dk-mute); flex-shrink:0; }
.tr-bar{ display:block; height:4px; border-radius:9999px; background:var(--dk-line-2); overflow:hidden; margin-top:4px; }
.tr-bar > i{ display:block; height:100%; border-radius:9999px; }
.tr-band{ display:flex; align-items:center; gap:10px; padding:9px 13px; margin-bottom:12px; border-radius:var(--radius); background:var(--amber-hi); border:1px solid rgba(161,98,7,.2); }
.tr-empty{ font-size:12px; color:var(--dk-mute-2); padding:10px 2px; font-style:italic; }

.tr-pp-top{ display:flex; align-items:center; gap:13px; padding:14px 16px; border-bottom:1px solid var(--dk-line-2); flex-wrap:wrap; }
.tr-pp-name{ font-size:16px; font-weight:600; color:var(--ink-2); letter-spacing:-.01em; }
.tr-pp-role{ font-size:11.5px; color:var(--dk-mute); margin-top:1px; }
.tr-pp-load{ margin-left:auto; text-align:right; min-width:150px; }
.tr-pp-load-n{ font-size:13px; font-weight:600; }
.tr-pp-load-l{ font-size:10.5px; color:var(--dk-mute-2); margin-top:2px; }
.tr-grp{ padding:13px 16px; border-bottom:1px solid var(--dk-line-2); }
.tr-grp:last-child{ border-bottom:none; }
.tr-grp-h{ display:flex; align-items:center; gap:7px; margin-bottom:9px; flex-wrap:wrap; }
.tr-grp-t{ font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.05em; }
.tr-grp-c{ font-family:var(--mono); font-size:10.5px; color:var(--dk-mute-2); background:var(--dk-line-2); padding:1px 6px; border-radius:9999px; }
.tr-grp-why{ font-size:11px; color:var(--dk-mute-2); }

.tr-it{ border:1px solid var(--dk-line); border-radius:var(--radius); padding:10px 12px; margin-bottom:7px; background:var(--dk-paper); cursor:pointer; transition:all var(--t-fast); }
.tr-it:last-child{ margin-bottom:0; }
.tr-it:hover{ border-color:var(--dk-primary); box-shadow:var(--shadow-s); }
.tr-it-blocked{ border-left:2px solid var(--dk-red); background:var(--red-hi); }
.tr-it-h{ display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; margin-bottom:5px; }
.tr-it-c{ font-size:12.5px; font-weight:600; color:var(--ink-2); }
.tr-it-p{ font-size:11.5px; color:var(--dk-mute); }
.tr-it-age{ margin-left:auto; font-size:10.5px; color:var(--dk-mute-2); white-space:nowrap; }
.tr-it-due{ margin-top:6px; font-size:11px; color:var(--dk-mute); }
.tr-flow{ display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:6px; }
@media (max-width:700px){ .tr-flow{ grid-template-columns:1fr; } }
.tr-f-l{ font-size:9.5px; font-weight:600; text-transform:uppercase; letter-spacing:.06em; color:var(--dk-mute-2); margin-bottom:2px; }
.tr-f-v{ font-size:12px; color:var(--ink-3); line-height:1.45; }
.tr-dim{ color:var(--dk-mute); }
.tr-dim-i{ color:var(--dk-mute-2); font-style:italic; }
.tr-fix{ display:inline-block; font-size:11px; font-weight:500; color:var(--dk-primary); margin-top:6px; }
.tr-imp{ margin-top:8px; padding:8px 10px; background:var(--dk-paper); border:1px solid rgba(220,38,38,.22); border-radius:var(--radius); }
.tr-imp-l{ display:flex; align-items:center; gap:6px; font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:var(--dk-red); margin-bottom:3px; }
.tr-imp-t{ font-size:12.5px; color:var(--dk-ink); line-height:1.45; }
.tr-imp-m{ font-size:11px; color:var(--dk-mute); margin-top:4px; display:flex; gap:10px; flex-wrap:wrap; }
.tr-who{ background:var(--amber-hi); color:var(--dk-amber); padding:1px 6px; border-radius:var(--radius-s); font-weight:500; }
.tr-tag{ font-size:10px; font-weight:500; padding:1px 7px; border-radius:var(--radius-s); white-space:nowrap; }
.tr-t-gov{ background:var(--teal-hi); color:var(--dk-primary); }
.tr-t-impl{ background:var(--dk-line-2); color:var(--ink-3); }
.tr-t-int{ background:var(--dk-line-2); color:var(--ink-3); }
.tr-t-ams{ background:var(--amber-hi); color:var(--dk-amber); }

.tr-tiles{ display:grid; grid-template-columns:repeat(2,1fr); gap:16px; align-items:start; }
.tr-tiles > .kd-tile{ margin-top:0; }
@media (max-width:900px){ .tr-tiles{ grid-template-columns:1fr; } .tr-cols{ grid-template-columns:1fr; } .tr-actionbar{ grid-template-columns:repeat(2,1fr); } }
.tr-row{ display:grid; grid-template-columns:1fr auto; gap:10px; align-items:center; padding:7px 0; border-bottom:1px solid var(--dk-line-2); font-size:12.5px; }
.tr-row:last-of-type{ border-bottom:none; }
.tr-row-click{ cursor:pointer; }
.tr-row-click:hover{ background:var(--teal-hi); }
.tr-row-sub{ font-size:11px; color:var(--dk-mute-2); margin-top:1px; }
.tr-pill{ font-family:var(--mono); font-size:11px; font-weight:600; padding:2px 8px; border-radius:9999px; background:var(--dk-line-2); color:var(--ink-3); }
.tr-pill-hot{ background:var(--red-hi); color:var(--dk-red); }
.tr-assign{ font-size:11px; font-weight:500; color:var(--dk-primary); }
.tr-due{ font-size:11px; font-weight:600; color:var(--dk-primary); }
.tr-stage{ display:grid; grid-template-columns:130px 1fr 26px; gap:9px; align-items:center; padding:5px 0; font-size:11.5px; }
.tr-stage-l{ color:var(--dk-mute); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.tr-stage-t{ height:7px; border-radius:9999px; background:var(--dk-line-2); overflow:hidden; }
.tr-stage-t > i{ display:block; height:100%; border-radius:9999px; background:var(--dk-primary); }
.tr-stage-t > i.tr-hot{ background:var(--dk-amber); }
.tr-stage-n{ font-size:11px; color:var(--dk-mute); text-align:right; }
.tr-legend{ margin-top:16px; font-size:11px; color:var(--dk-mute-2); line-height:1.6; }

/* ── call mode ── */
.tr-cm{ position:fixed; inset:0; z-index:90; background:var(--surface); display:flex; flex-direction:column; }
.tr-cm-progress{ height:3px; background:var(--dk-line-2); flex-shrink:0; }
.tr-cm-progress > i{ display:block; height:100%; background:var(--dk-primary); transition:width var(--t); }
.tr-cm-top{ display:flex; align-items:center; justify-content:space-between; gap:14px; padding:13px 24px; border-bottom:1px solid var(--dk-line); background:var(--dk-paper); flex-wrap:wrap; }
.tr-cm-pos{ font-size:11px; color:var(--dk-mute-2); text-transform:uppercase; letter-spacing:.06em; }
.tr-cm-title{ font-size:14px; font-weight:600; margin-top:2px; color:var(--ink-2); }
.tr-cm-timer{ font-size:12px; font-weight:600; color:var(--dk-mute); padding:5px 10px; border:1px solid var(--dk-line); border-radius:var(--radius); min-width:62px; text-align:center; }
.tr-cm-timer-over{ color:var(--dk-amber); border-color:var(--dk-amber); }
.tr-cm-body{ flex:1; overflow-y:auto; padding:24px; }
.tr-cm-inner{ max-width:1000px; margin:0 auto; }
.tr-cm-who{ display:flex; align-items:center; gap:14px; margin-bottom:18px; flex-wrap:wrap; }
.tr-cm-name{ font-size:26px; font-weight:700; letter-spacing:-.025em; color:var(--ink-2); }
.tr-cm-role{ font-size:12.5px; color:var(--dk-mute); }
.tr-cm-load{ margin-left:auto; text-align:right; }
.tr-ask{ background:var(--teal-hi); border:1px solid var(--teal-lo); border-radius:var(--radius-l); padding:12px 15px; margin-bottom:20px; }
.tr-ask-l{ font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:var(--dk-primary); margin-bottom:5px; }
.tr-ask-q{ font-size:13.5px; color:var(--dk-ink); line-height:1.6; }
.tr-cm-block{ margin-bottom:22px; }
.tr-cm-sec{ display:flex; align-items:center; gap:7px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; margin:0 0 10px; }
</style>`;