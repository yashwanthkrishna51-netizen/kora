// ─── DASHBOARD ────────────────────────────────────────────────────
// UI PORT NOTICE: this file's visual structure (markup/CSS classes) is
// redesigned to match koraV2's actual dashboard components
// (components/dashboard/admin-dashboard.tsx, kpi.tsx, critical-items.tsx,
// my-dashboard.tsx). EVERY COMPUTATION BELOW IS UNCHANGED from the previous
// version — same variables, same formulas, same trend calculation (including
// its known inversion bug — deliberately not fixed here, that's a separate,
// isolated change). Only the returned HTML changed. Every data-act, every
// tile key in `sections{}`, every S.* state field read/written is identical,
// so the existing tile customization system (DASH_TILE_REGISTRY /
// getDashLayout()) keeps working exactly as before.
function renderDashboard() {
  ensureSnapshotCaptured();
  fetchSnapshotHistory(14);
  fetchCapacityWeights();

  const all = S.clients.flatMap(c => (c.integrations || []).map(i => ({ ...i, clientName: c.name, clientId: c.id })));
  const ti = all.length;
  const ar = all.filter(i => i.status === 'At Risk').length;
  const ip = all.filter(i => i.status === 'In Progress').length;
  const co = all.filter(i => i.status === 'Completed').length;
  const overdue = all.filter(isOverdue);
  const stale = all.filter(i => isStale(i, 7) && !isOverdue(i));
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  const thisWeekUpdates = all.reduce((n, i) => n + (i.timeline || []).filter(t => new Date(t.date) >= weekAgo).length, 0);
  const needsAttn = [...overdue.map(i => ({ ...i, reason: 'overdue' })), ...stale.map(i => ({ ...i, reason: 'stale' }))].sort((a, b) => (a.reason === 'overdue' && b.reason !== 'overdue') ? -1 : 1);
  const needsDays = i => i.reason === 'overdue' ? daysOverdue(i) : (lastUpdateDate(i) ? daysDiff(lastUpdateDate(i)) : 0);

  const implClients = S.clients.filter(c => c.modules !== undefined);
  const allModules = implClients.flatMap(c => (c.modules || []).map(m => ({ ...m, clientName: c.name, clientId: c.id })));
  const allPhases = allModules.flatMap(m => (m.phases || []).map(ph => ({ ...ph })));
  const implTotalPhases = allPhases.length;
  const implAtRiskClients = implClients.filter(c => implAutoRag(c) === 'Red');

  const amsClients = S.clients.filter(c => c.workLog !== undefined);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const monthEnd = todayStr();
  let amsHoursThisMonth = 0, amsRevenueINR = 0, amsRevenueUSD = 0;
  const amsLowBalance = [];
  amsClients.forEach(c => {
    const tm = amsTotals(c, monthStart, monthEnd);
    amsHoursThisMonth += tm.totalHours;
    if (tm.totalAmount) {
      if ((c.currency || 'INR') === 'USD') amsRevenueUSD += tm.totalAmount;
      else amsRevenueINR += tm.totalAmount;
    }
    if (tm.hasBucket && tm.balanceAvailable <= Math.max(2, tm.totalAvailableHours * 0.15)) { amsLowBalance.push({ name: c.name, id: c.id, balance: tm.balanceAvailable, total: tm.totalAvailableHours }); }
  });
  const allAmsEntries = amsClients.flatMap(c => (c.workLog || []).map(e => ({ ...e, clientName: c.name, clientId: c.id })));
  const openAmsEntries = allAmsEntries.filter(e => e.entryStatus !== 'Closed');
  const isL3orL4 = e => { const q = e.queryLevel || ''; return q.includes('L3') || q.includes('L4'); };

  const isAdmin = can('admin');

  const rankRag = v => v == null ? 1 : ({ Red: 0, Amber: 1, Green: 2 }[v] ?? 1);
  const healthRows = S.clients.map(c => {
    const iR = integRagLabel(c), implR = c.modules !== undefined ? implAutoRag(c) : null, amsR = c.workLog !== undefined ? amsClientRag(c) : null;
    const overall = overallRagLabel(iR, implR, amsR);
    const hist = S.snapshotHistory.filter(s => s.client_id === c.id).sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
    let trend = hist.length ? 'same' : 'new';
    if (hist.length >= 2) {
      const d = rankRag(hist[0].overall_rag) - rankRag(hist[hist.length - 1].overall_rag);
      trend = d > 0 ? 'better' : d < 0 ? 'worse' : 'same';
    }
    return { id: c.id, name: c.name, integR: iR, implR, amsR, overall, trend };
  }).filter(r => r.overall).sort((a, b) => rankRag(a.overall) - rankRag(b.overall));

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

  const datestampLine = () => {
    const d = new Date();
    const date = d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).replace(/,/g, '');
    const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `<p class="kd-datestamp">${esc((date + ' · ' + time).toUpperCase())}</p>`;
  };
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

  if (!can('admin')) {
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

  const todayS = todayStr();
  const in14 = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const upcoming = [];
  all.forEach(i => (i.milestones || []).forEach(ms => { if (ms.status === 'Pending' && ms.dueDate >= todayS && ms.dueDate <= in14) upcoming.push({ date: ms.dueDate, title: ms.name, client: i.clientName, tag: 'Milestone' }); }));
  implClients.forEach(c => (c.modules || []).forEach(m => (m.phases || []).forEach(ph => { if (ph.status !== 'Completed' && ph.targetDate && ph.targetDate >= todayS && ph.targetDate <= in14) upcoming.push({ date: ph.targetDate, title: `${ph.name} — ${m.name}`, client: c.name, tag: 'Phase' }); })));
  openAmsEntries.forEach(e => { if (e.dueDate && e.dueDate >= todayS && e.dueDate <= in14) upcoming.push({ date: e.dueDate, title: (e.description || 'AMS item').slice(0, 50), client: e.clientName, tag: 'AMS' }); });
  upcoming.sort((a, b) => a.date.localeCompare(b.date));
  const TAG_CLASS = { Milestone: 'kd-tag-teal', Phase: 'kd-tag-primary', AMS: 'kd-tag-amber' };

  const workMixTotal = allAmsEntries.reduce((a, e) => a + Number(e.hours || 0), 0);
  const workMixByType = {};
  allAmsEntries.forEach(e => { const t = entryType(e); workMixByType[t] = (workMixByType[t] || 0) + Number(e.hours || 0); });
  const workMixSorted = Object.entries(workMixByType).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const reactiveHours = allAmsEntries.filter(e => ['Bug Fix', 'Support Ticket'].includes(entryType(e))).reduce((a, e) => a + Number(e.hours || 0), 0);
  const reactivePct = workMixTotal ? Math.round(reactiveHours / workMixTotal * 100) : 0;

  const severityDist = {};
  AMS_QUERY_LEVELS.forEach(l => severityDist[l] = 0);
  allAmsEntries.forEach(e => { const l = e.queryLevel || AMS_QUERY_LEVELS[0]; severityDist[l] = (severityDist[l] || 0) + 1; });
  const severityTotal = allAmsEntries.length || 1;
  const oldestCritical = openAmsEntries.filter(isL3orL4).map(e => daysDiff(entryDate(e))).sort((a, b) => b - a)[0];
  const SEV_CLASS = { 'L1 - Low': 'kd-sev-l1', 'L2 - Medium': 'kd-sev-l2', 'L3 - High': 'kd-sev-l3', 'L4 - Critical': 'kd-sev-l4' };

  const funnelCounts = {};
  PHASES.forEach(p => funnelCounts[p] = 0);
  implClients.forEach(c => (c.modules || []).forEach(m => (m.phases || []).forEach(ph => { if (ph.status === 'In Progress' || ph.status === 'At Risk') funnelCounts[ph.name] = (funnelCounts[ph.name] || 0) + 1; })));
  const funnelTotal = Object.values(funnelCounts).reduce((a, b) => a + b, 0) || 1;
  const funnelSorted = Object.entries(funnelCounts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const funnelMax = funnelSorted[0];

  const hyg = all.length ? {
    assignee: all.filter(i => i.assignee && i.assignee.trim()).length / all.length,
    due: all.filter(i => i.dueDate).length / all.length,
    fresh: all.filter(i => !isStale(i, 30)).length / all.length,
  } : { assignee: 1, due: 1, fresh: 1 };
  const hygieneScore = Math.round((hyg.assignee + hyg.due + hyg.fresh) / 3 * 100);

  const blockers = openAmsEntries.filter(e => e.dependencies && e.dependencies.trim()).map(e => ({ client: e.clientName, text: e.dependencies.trim() }));

  let atRiskDelta = null;
  if (S.snapshotHistory.length) {
    const dates = [...new Set(S.snapshotHistory.map(s => s.snapshot_date))].sort();
    const earliestSum = S.snapshotHistory.filter(s => s.snapshot_date === dates[0]).reduce((a, s) => a + (s.integ_at_risk || 0), 0);
    atRiskDelta = ar - earliestSum;
  }
  const healthSplit = { Red: 0, Amber: 0, Green: 0 };
  healthRows.forEach(r => { healthSplit[r.overall] = (healthSplit[r.overall] || 0) + 1; });
  const l3l4OpenCount = openAmsEntries.filter(isL3orL4).length;
  const portfolioScore = healthRows.length ? Math.round((healthSplit.Green * 100 + healthSplit.Amber * 50) / healthRows.length) : null;

  const sections = {};

  const critDomains = [...new Set(criticalItems.map(it => it.domain.split(' · ')[0]))];
  let critFiltered = criticalItems;
  if (S.dashCritSearch.trim()) {
    const q = S.dashCritSearch.toLowerCase();
    critFiltered = critFiltered.filter(it => it.title.toLowerCase().includes(q) || it.client.toLowerCase().includes(q) || it.owner.toLowerCase().includes(q));
  }
  if (S.dashCritFilter !== 'all') critFiltered = critFiltered.filter(it => it.domain.startsWith(S.dashCritFilter));

  sections['critical-items'] = `<section class="kd-card kd-tile">
    <div class="kd-card-head kd-wrap">
      <div class="flex items-center gap-2.5">
        <span class="kd-dot kd-dot-red" aria-hidden="true"></span>
        <h2 class="kd-card-title">Critical items — start here</h2>
      </div>
      <span class="kd-mono kd-count">${critFiltered.length}${critFiltered.length !== criticalItems.length ? ` / ${criticalItems.length}` : ''}</span>
    </div>
    <div class="kd-toolbar">
      <input type="text" id="dash-crit-search-inp" placeholder="Search item, client, owner…" value="${esc(S.dashCritSearch)}" data-act="dash-crit-search" class="kd-search"/>
      <div class="kd-chipbar" role="group" aria-label="Filter critical items by domain">
        <button data-act="dash-crit-filter" data-key="all" class="kd-chip ${S.dashCritFilter === 'all' ? 'kd-chip-active' : ''}">All ${criticalItems.length}</button>
        ${critDomains.map(d => `<button data-act="dash-crit-filter" data-key="${esc(d)}" class="kd-chip ${S.dashCritFilter === d ? 'kd-chip-active' : ''}">${esc(d)}</button>`).join('')}
      </div>
    </div>
    <div class="kd-crit-table">
      <div class="kd-crit-head"><div>Item</div><div>Client</div><div>Status / Age</div><div>Owner</div></div>
      <div>${critFiltered.length ? critFiltered.map(critRow).join('') : `<div class="kd-empty-inline">${S.dashCritSearch || S.dashCritFilter !== 'all' ? 'No matches' : 'Nothing is overdue, stale or critical'}</div>`}</div>
    </div>
  </section>`;

  sections['health-scorecard'] = `<section class="kd-card kd-tile">
    <div class="kd-card-head">
      <h2 class="kd-card-title">Portfolio health scorecard</h2>
      ${portfolioScore !== null ? `<div class="text-right"><p class="kd-num kd-score" style="color:${portfolioScore >= 75 ? 'var(--dk-green)' : portfolioScore >= 50 ? 'var(--dk-amber)' : 'var(--dk-red)'}">${portfolioScore}</p><p class="kd-score-sub">portfolio score</p></div>` : ''}
    </div>
    <div class="kd-thead"><div class="kd-th-client">Client</div><div class="kd-th-c">Int</div><div class="kd-th-c">Impl</div><div class="kd-th-c">AMS</div><div class="kd-th-r">Trend</div></div>
    <div class="kd-scorebody">
      ${healthRows.length ? healthRows.map(r => `<div class="kd-scorerow" data-act="open-client" data-id="${esc(r.id)}">
        <div class="kd-sr-name">${esc(r.name)}</div>
        <div class="kd-sr-c">${r.integR ? `<span class="kd-dot" style="background:${RAG_HEX[r.integR]}"></span>` : `<span class="kd-dash">—</span>`}</div>
        <div class="kd-sr-c">${r.implR ? `<span class="kd-dot" style="background:${RAG_HEX[r.implR]}"></span>` : `<span class="kd-dash">—</span>`}</div>
        <div class="kd-sr-c">${r.amsR ? `<span class="kd-dot" style="background:${RAG_HEX[r.amsR]}"></span>` : `<span class="kd-dash">—</span>`}</div>
        <div class="kd-sr-trend ${r.trend === 'worse' ? 'kd-text-red' : r.trend === 'better' ? 'kd-text-green' : ''}">${r.trend === 'worse' ? '↓ worse' : r.trend === 'better' ? '↑ better' : r.trend === 'new' ? 'new' : '— same'}</div>
      </div>`).join('') : `<div class="kd-empty-inline">No client health data yet</div>`}
    </div>
    <p class="kd-footnote">100 per Green client + 50 per Amber, averaged. Trend sharpens as daily snapshots accumulate.</p>
  </section>`;

  sections['upcoming-deadlines'] = `<section class="kd-card kd-tile">
    <div class="kd-card-head"><h2 class="kd-card-title">Upcoming deadlines — next 14 days</h2><span class="kd-mono kd-count">${upcoming.length}</span></div>
    ${upcoming.length ? `<ul class="kd-list">${upcoming.map(u => `<li class="kd-deadline-row">
        <span class="kd-mono kd-deadline-date">${fmtDate(u.date)}</span>
        <span class="kd-deadline-title" title="${esc(u.title)}">${esc(u.title)}</span>
        <span class="kd-deadline-client">${esc(u.client)}</span>
        <span class="kd-tag ${TAG_CLASS[u.tag]}">${u.tag}</span>
      </li>`).join('')}</ul>` : `<div class="kd-empty"><p class="kd-empty-title">Nothing due in the next fortnight</p></div>`}
  </section>`;

  sections['ams-workmix'] = `<section class="kd-card kd-tile">
    <h2 class="kd-card-title mb-3">Work mix</h2>
    ${workMixSorted.length ? (() => {
      const donutColors = ['var(--dk-primary)', 'var(--dk-green)', 'var(--dk-amber)', 'var(--dk-red)'];
      const r = 52, cx = 60, cy = 60, circ = 2 * Math.PI * r;
      let cumulative = 0;
      const arcs = workMixSorted.map(([type, hrs], idx) => {
        const pct = workMixTotal ? hrs / workMixTotal : 0;
        const dash = pct * circ;
        const offset = circ - cumulative;
        cumulative += dash;
        return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${donutColors[idx % 4]}" stroke-width="14" stroke-dasharray="${dash.toFixed(1)} ${(circ - dash).toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})" stroke-linecap="round"/>`;
      }).join('');
      return `<div class="flex items-center gap-5">
        <svg width="120" height="120" viewBox="0 0 120 120" class="shrink-0">
          <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--dk-line)" stroke-width="14"/>
          ${arcs}
          <text x="${cx}" y="${cy - 3}" text-anchor="middle" class="kd-donut-num" fill="var(--dk-ink)">${workMixTotal.toFixed(0)}h</text>
          <text x="${cx}" y="${cy + 14}" text-anchor="middle" class="kd-donut-sub" fill="var(--dk-mute)">total logged</text>
        </svg>
        <div class="flex-1 space-y-1.5">
          ${workMixSorted.map(([type, hrs], idx) => { const pct = workMixTotal ? Math.round(hrs / workMixTotal * 100) : 0; return `<div class="kd-legend-row"><span class="kd-dot" style="background:${donutColors[idx % 4]}"></span><span class="kd-legend-label">${esc(type)}</span><span class="kd-legend-pct">${pct}%</span></div>`; }).join('')}
        </div>
      </div>
      <p class="kd-footnote">${reactivePct}% reactive (Bug Fix + Support) vs ${100 - reactivePct}% proactive</p>`;
    })() : `<div class="kd-empty-inline">No AMS hours logged yet</div>`}
  </section>`;

  sections['severity-aging'] = `<section class="kd-card kd-tile">
    <h2 class="kd-card-title mb-3">Severity &amp; aging</h2>
    ${severityTotal > 1 ? `<div class="kd-sevbar">
      ${AMS_QUERY_LEVELS.map(l => severityDist[l] ? `<div class="${SEV_CLASS[l]}" style="width:${Math.round(severityDist[l] / severityTotal * 100)}%" title="${l}: ${severityDist[l]}"></div>` : '').join('')}
    </div>
    <div class="kd-sevlegend">
      ${AMS_QUERY_LEVELS.map(l => `<span class="${SEV_CLASS[l]}-text">${l.split(' - ')[0]}: ${Math.round(severityDist[l] / severityTotal * 100)}%</span>`).join('')}
    </div>
    ${oldestCritical !== undefined ? `<p class="kd-text-red kd-bold-sm">Oldest open L3/L4 ticket: ${oldestCritical}d</p>` : `<p class="kd-text-green kd-bold-sm">No open L3/L4 tickets</p>`}` : `<div class="kd-empty-inline">No AMS entries yet</div>`}
  </section>`;

  const delayedPhaseCount = allPhases.filter(ph => ph.status === 'Delayed').length;
  sections['phase-funnel'] = `<section class="kd-card kd-tile">
    <h2 class="kd-card-title mb-3">Phase-stage funnel</h2>
    ${funnelSorted.length ? `<div class="space-y-1.5">
      ${funnelSorted.map(([name, n]) => `<div class="kd-funnel-row"><span class="kd-funnel-label ${name === funnelMax[0] ? 'kd-funnel-max' : ''}">${esc(name)}</span><div class="kd-funnel-track"><div class="kd-funnel-fill ${name === funnelMax[0] ? 'kd-funnel-fill-max' : ''}" style="width:${Math.round(n / funnelTotal * 100)}%"></div></div><span class="kd-funnel-n">${n}</span></div>`).join('')}
    </div>
    <p class="kd-footnote kd-text-red">Bottleneck: ${Math.round(funnelMax[1] / funnelTotal * 100)}% of active phases stuck at ${esc(funnelMax[0])}${delayedPhaseCount ? ` · ${delayedPhaseCount} phase${delayedPhaseCount !== 1 ? 's' : ''} marked Delayed` : ''}</p>` : `<div class="kd-empty-inline">No active phases in progress</div>`}
  </section>`;

  sections['financial-rollup'] = `<section class="kd-card kd-tile">
    <h2 class="kd-card-title mb-3">Financial rollup</h2>
    ${isAdmin ? `<div class="grid grid-cols-2 gap-2 mb-3">
      <div class="kd-fin-box"><p class="kd-fin-num">${amsRevenueINR ? `₹${amsRevenueINR.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'}</p><p class="kd-fin-label">Billable (INR)</p></div>
      <div class="kd-fin-box"><p class="kd-fin-num">${amsRevenueUSD ? `$${amsRevenueUSD.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}</p><p class="kd-fin-label">Billable (USD)</p></div>
    </div>` : `<div class="kd-fin-box mb-3"><p class="kd-fin-num">${amsHoursThisMonth.toFixed(1)}h</p><p class="kd-fin-label">Hours this month</p></div>`}
    ${amsLowBalance.length ? `<p class="kd-text-red kd-bold-sm">${amsLowBalance.length} client pool${amsLowBalance.length !== 1 ? 's' : ''} running low</p>` : amsClients.length ? `<p class="kd-text-green kd-bold-sm">All hour pools healthy</p>` : ''}
  </section>`;

  sections['data-hygiene'] = `<section class="kd-card kd-tile">
    <h2 class="kd-card-title mb-3">Hygiene</h2>
    <p class="kd-num kd-hygiene-num" style="color:${hygieneScore >= 80 ? 'var(--dk-green)' : hygieneScore >= 60 ? 'var(--dk-amber)' : 'var(--dk-red)'}">${hygieneScore}%</p>
    <dl class="kd-hygiene-rows">
      <div class="kd-hygiene-row"><dt>Have an assignee</dt><dd class="kd-mono">${Math.round(hyg.assignee * 100)}%</dd></div>
      <div class="kd-hygiene-row"><dt>Have a due date</dt><dd class="kd-mono">${Math.round(hyg.due * 100)}%</dd></div>
      <div class="kd-hygiene-row"><dt>Updated recently</dt><dd class="kd-mono">${Math.round(hyg.fresh * 100)}%</dd></div>
    </dl>
  </section>`;

  sections['blockers'] = `<section class="kd-card kd-tile">
    <div class="kd-card-head"><h2 class="kd-card-title">Blockers</h2><span class="kd-mono kd-count">${blockers.length}</span></div>
    ${blockers.length ? `<ul class="kd-list">${blockers.slice(0, 5).map(b => `<li class="kd-blocker-row"><p class="kd-blocker-text">${esc(b.text)}</p><p class="kd-blocker-client">${esc(b.client)}</p></li>`).join('')}</ul>` : `<div class="kd-empty"><p class="kd-empty-title">Nothing is blocked</p></div>`}
  </section>`;

  if (isAdmin) {
    const cw = S.capacityWeights;
    const capacity = {};
    const capAdd = (name, type, amount, detail) => {
      const nm = (name || '').trim(); if (!nm) return;
      if (!capacity[nm]) capacity[nm] = { name: nm, module: 0, pmo: 0, integ: 0, ams: 0, total: 0, details: [] };
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
    // Module-level effort (e.g. the default Governance module: effort=1,
    // assigned to the client's Master Assignee) — counted separately from
    // the phase-driven loop above, since it's a standing responsibility, not
    // tied to any one phase's status. Uses the module's own effort value
    // directly as the capacity amount (same convention as an integration's
    // effortWeight), so "effort = 1" means "1 unit of this person's capacity".
    implClients.forEach(c => (c.modules || []).forEach(m => {
      if (m.assignee && m.effort) capAdd(m.assignee, 'module', Number(m.effort) || 0, `${m.name} (module) · ${c.name}`);
    }));
    implClients.forEach(c => { if (c.masterAssignee) capAdd(c.masterAssignee, 'pmo', cw.pmo, `PMO · ${c.name}`); });
    all.filter(i => !['Completed', 'Cancelled'].includes(i.status)).forEach(i => { if (i.assignee) capAdd(i.assignee, 'integ', i.effortWeight ?? 0.5, `${i.name} · ${i.clientName}`); });
    openAmsEntries.forEach(e => { const rb = entryRaisedBy(e); if (rb && rb !== '—') capAdd(rb, 'ams', cw.ams, `${e.description || 'AMS ticket'} · ${e.clientName}`); });
    let capacityRows = Object.values(capacity).sort((a, b) => b.total - a.total);
    const available = capacityRows.filter(r => r.total < cw.cap * 0.6);
    const stretched = capacityRows.filter(r => r.total >= cw.cap * 0.9);
    const overCap = capacityRows.filter(r => r.total > cw.cap);

    sections['team-bandwidth'] = `<section class="kd-card kd-tile">
      <div class="kd-card-head kd-wrap">
        <div class="min-w-0">
          <h2 class="kd-card-title">Team bandwidth</h2>
          <p class="kd-card-subline">Module = ${cw.module} · PMO = ${cw.pmo} · AMS ticket = ${cw.ams} · Integration = per-item · Cap = ${cw.cap}</p>
        </div>
        <button data-act="modal-open" data-modal="capacity-weights" class="kd-btn kd-btn-outline kd-btn-sm shrink-0">Configure weights</button>
      </div>
      ${overCap.length ? `<div class="kd-riskband">
        <span class="kd-dot kd-dot-red" aria-hidden="true"></span>
        <p class="kd-text-red kd-bold-sm">Delivery risk: ${overCap.length} ${overCap.length === 1 ? 'person is' : 'people are'} over capacity right now — ${overCap.map(r => esc(r.name)).join(', ')}</p>
      </div>` : ''}
      ${capacityRows.length ? `<div class="grid grid-cols-2 gap-3 mb-4">
        <div class="kd-capbox kd-capbox-green">
          <p class="kd-capbox-title kd-text-green">Available capacity (${available.length})</p>
          <p class="kd-capbox-body">${available.length ? available.map(r => `${esc(r.name)} (${r.total.toFixed(2)})`).join(', ') : 'Nobody has meaningful spare capacity right now'}</p>
        </div>
        <div class="kd-capbox kd-capbox-red">
          <p class="kd-capbox-title kd-text-red">Stretched (${stretched.length})</p>
          <p class="kd-capbox-body">${stretched.length ? stretched.map(r => `${esc(r.name)} (${r.total.toFixed(2)})`).join(', ') : 'Nobody is at or near capacity'}</p>
        </div>
      </div>` : ''}
      ${capacityRows.length === 0 ? `<div class="kd-empty"><p class="kd-empty-title">Nothing is assigned</p></div>` : `<div class="kd-scrollbox"><ul>
        ${capacityRows.map(r => {
      const pct = Math.min(100, r.total / cw.cap * 100);
      const over = r.total > cw.cap;
      const expanded = S.dashCapacityExpanded.has(r.name);
      return `<li>
          <div class="kd-bwrow" data-act="dash-capacity-toggle" data-key="${esc(r.name)}">
            <span class="kd-bw-name ${over ? 'kd-text-red' : ''}">${esc(r.name)}</span>
            <span class="kd-bw-track"><span class="kd-bw-fill" style="width:${pct}%;background:${loadFillColor(r.total, cw)}"></span></span>
            <span class="kd-mono kd-bw-total ${over ? 'kd-text-red' : ''}">${r.total.toFixed(2)} / ${cw.cap}</span>
          </div>
          ${expanded ? `<div class="kd-bw-detail">${r.details.map(d => `<span class="kd-bw-detail-item"><span class="kd-mono kd-bw-detail-amt">${d.amount}</span> ${esc(d.detail)}</span>`).join('')}</div>` : ''}
        </li>`;
    }).join('')}
      </ul></div>`}
    </section>`;
  }

  const layout = getDashLayout().filter(t => {
    const reg = DASH_TILE_REGISTRY.find(r => r.id === t.id);
    return reg && t.visible && (!reg.adminOnly || isAdmin);
  });
  const orderedSections = layout.map(t => sections[t.id] || '').join('');

  const red = healthSplit.Red, amber = healthSplit.Amber;

  return `<div class="k-page fade kd">
  ${DASH_CSS}
  <header class="flex flex-wrap items-start justify-between gap-3">
    <div class="min-w-0">
      ${datestampLine()}
      <h1 class="kd-page-title">Portfolio</h1>
      <p class="kd-page-sub">${S.clients.length} client${S.clients.length === 1 ? '' : 's'} across three delivery streams — sorted worst-first</p>
    </div>
    <div class="flex items-center gap-2">
      <button data-act="modal-open" data-modal="dashboard-layout" class="kd-btn kd-btn-outline">Customize</button>
      ${isAdmin ? `<button data-act="portfolio-export" class="kd-btn kd-btn-primary">Portfolio Export</button>` : ''}
    </div>
  </header>

  <div class="kd-kpi-sticky">
    <div class="kd-kpi-strip">
      <div class="kd-kpi" style="border-left-color:var(--dk-primary)"><span class="kd-num kd-kpi-val">${S.clients.length}</span><span class="kd-kpi-label">Clients</span></div>
      <div class="kd-kpi" style="border-left-color:var(--dk-red)">
        <span class="kd-num kd-kpi-val" style="color:${ar ? 'var(--dk-red)' : 'var(--dk-ink)'}">${ar}${atRiskDelta !== null && atRiskDelta !== 0 ? `<span class="kd-kpi-delta ${atRiskDelta > 0 ? 'kd-text-red' : 'kd-text-green'}">${atRiskDelta > 0 ? '↑' : '↓'}${Math.abs(atRiskDelta)}</span>` : ''}</span>
        <span class="kd-kpi-label">At risk${atRiskDelta !== null ? ' · vs ' + new Date([...new Set(S.snapshotHistory.map(s => s.snapshot_date))].sort()[0]).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : ''}</span>
      </div>
      <div class="kd-kpi" style="border-left-color:var(--dk-sky)"><span class="kd-num kd-kpi-val">${thisWeekUpdates}</span><span class="kd-kpi-label">Updates, 7 days</span><span class="kd-kpi-sub">hygiene ${hygieneScore}%</span></div>
      <div class="kd-kpi" style="border-left-color:var(--dk-amber)"><span class="kd-num kd-kpi-val kd-kpi-val-sm">${healthSplit.Red}<span class="kd-text-red"> R</span> · ${healthSplit.Amber}<span class="kd-text-amber"> A</span> · ${healthSplit.Green}<span class="kd-text-green"> G</span></span><span class="kd-kpi-label">Clients off track</span><span class="kd-kpi-sub">${red} red · ${amber} amber</span></div>
      <div class="kd-kpi" style="border-left-color:var(--dk-red)"><span class="kd-num kd-kpi-val" style="color:${l3l4OpenCount ? 'var(--dk-red)' : 'var(--dk-ink)'}">${l3l4OpenCount}</span><span class="kd-kpi-label">L3/L4 tickets open</span></div>
      <div class="kd-kpi" style="border-left-color:var(--dk-green)"><span class="kd-num kd-kpi-val" style="color:${hygieneScore >= 80 ? 'var(--dk-green)' : hygieneScore >= 60 ? 'var(--dk-amber)' : 'var(--dk-red)'}">${hygieneScore}%</span><span class="kd-kpi-label">Data hygiene score</span></div>
    </div>
  </div>

  ${orderedSections}
</div>`;
}

function loadFillColor(total, w) {
  if (total > w.cap) return 'var(--dk-red)';
  if (total >= w.cap * 0.9) return 'var(--dk-amber)';
  if (total < w.cap * 0.6) return 'var(--dk-green)';
  return 'var(--dk-primary)';
}

const DASH_CSS = `<style>
.kd{ --dk-primary: var(--teal); --dk-red: var(--red); --dk-amber: var(--amber); --dk-green: var(--green);
     --dk-sky: #43AFCD; --dk-ink: var(--ink); --dk-mute: var(--mute); --dk-mute-2: var(--mute-2); --dk-line: var(--line); --dk-line-2: var(--line-2); --dk-paper: var(--paper); }
.kd-page-title{ font-size:26px; font-weight:800; color:var(--dk-ink); line-height:1.15; }
.kd-page-sub{ margin-top:4px; font-size:13px; color:var(--dk-mute); }
.kd-datestamp{ font-family:var(--mono); font-size:10.5px; text-transform:uppercase; letter-spacing:.06em; color:var(--dk-mute-2); margin-bottom:6px; }
.kd-btn{ font-size:13px; font-weight:600; padding:8px 16px; border-radius:12px; transition:background .15s; }
.kd-btn-outline{ border:1px solid var(--dk-line); color:var(--dk-mute); background:var(--dk-paper); }
.kd-btn-outline:hover{ border-color:var(--dk-primary); color:var(--dk-primary); }
.kd-btn-primary{ background:var(--dk-primary); color:#fff; font-weight:700; }
.kd-btn-primary:hover{ filter:brightness(.93); }
.kd-btn-sm{ padding:6px 12px; font-size:12px; }
.kd-num{ font-family:var(--font-head, inherit); font-weight:800; }
.kd-mono{ font-family:var(--mono); }
.kd-text-red{ color:var(--dk-red); } .kd-text-amber{ color:var(--dk-amber); } .kd-text-green{ color:var(--dk-green); }
.kd-bold-sm{ font-size:12px; font-weight:600; }
.kd-dot{ width:8px; height:8px; border-radius:50%; display:inline-block; flex-shrink:0; }
.kd-dot-red{ background:var(--dk-red); }
.kd-dash{ color:var(--dk-mute-2); }

.kd-kpi-sticky{ position:sticky; top:0; z-index:20; background:var(--surface); margin:0 -4px; padding:12px 4px 14px; }
.kd-kpi-strip{ display:grid; grid-template-columns:repeat(6,1fr); gap:10px; }
@media (max-width:1180px){ .kd-kpi-strip{ grid-template-columns:repeat(3,1fr); } }
@media (max-width:640px){ .kd-kpi-strip{ grid-template-columns:repeat(2,1fr); } }
.kd-kpi{ background:var(--dk-paper); border:1px solid var(--dk-line); border-left-width:3px; border-radius:12px; padding:14px 16px; }
.kd-kpi-val{ display:block; font-size:26px; line-height:1; color:var(--dk-ink); }
.kd-kpi-val-sm{ font-size:17px; }
.kd-kpi-delta{ font-size:12px; font-weight:600; margin-left:6px; }
.kd-kpi-label{ display:block; margin-top:7px; font-size:11px; color:var(--dk-mute); line-height:1.35; }
.kd-kpi-sub{ display:block; margin-top:2px; font-size:11px; color:var(--dk-mute-2); }

.kd-tile{ margin-top:16px; }
.kd-card{ background:var(--dk-paper); border:1px solid var(--dk-line); border-radius:14px; padding:18px; }
.kd-card-head{ display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:12px; }
.kd-wrap{ flex-wrap:wrap; row-gap:8px; }
.kd-card-title{ font-size:14px; font-weight:700; color:var(--dk-ink); }
.kd-card-subline{ margin-top:3px; font-size:11px; color:var(--dk-mute); }
.kd-count{ font-size:11px; color:var(--dk-mute); }
.kd-footnote{ margin-top:10px; padding-top:10px; border-top:1px solid var(--dk-line-2); font-size:11px; color:var(--dk-mute); }
.kd-empty{ text-align:center; padding:32px 12px; }
.kd-empty-icon{ width:32px; height:32px; margin:0 auto 8px; color:var(--dk-mute-2); }
.kd-empty-title{ font-size:13px; font-weight:600; color:var(--dk-mute); }
.kd-empty-hint{ margin-top:4px; font-size:11.5px; color:var(--dk-mute-2); max-width:280px; margin-left:auto; margin-right:auto; }
.kd-empty-inline{ text-align:center; padding:24px 8px; font-size:13px; color:var(--dk-mute); }

.kd-toolbar{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:12px; }
.kd-search{ font-size:12px; border:1px solid var(--dk-line); border-radius:10px; padding:6px 10px; max-width:220px; background:var(--dk-paper); }
.kd-search:focus{ outline:none; box-shadow:0 0 0 2px var(--teal-lo); }
.kd-chipbar{ display:flex; gap:6px; flex-wrap:wrap; }
.kd-chip{ font-size:11px; font-weight:600; padding:4px 11px; border-radius:999px; border:1px solid var(--dk-line); color:var(--dk-mute); background:var(--dk-paper); transition:all .12s; }
.kd-chip:hover{ border-color:var(--dk-primary); color:var(--dk-primary); }
.kd-chip-active{ background:var(--dk-primary); border-color:var(--dk-primary); color:#fff; }

.kd-crit-table{ border:1px solid var(--dk-line-2); border-radius:10px; overflow:hidden; }
.kd-crit-head{ display:grid; grid-template-columns:1fr 160px 130px 140px; background:var(--surface); border-bottom:1px solid var(--dk-line); font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color:var(--dk-mute); padding:8px 14px; }
.kd-crit-row{ display:grid; grid-template-columns:1fr 160px 130px 140px; align-items:center; gap:10px; padding:10px 14px; border-bottom:1px solid var(--dk-line-2); cursor:pointer; transition:background .12s; }
.kd-crit-row:last-child{ border-bottom:none; }
.kd-crit-row:hover{ background:var(--teal-hi); }
.kd-crit-title-wrap{ display:flex; align-items:flex-start; gap:6px; min-width:0; }
.kd-crit-flag{ width:13px; height:13px; margin-top:2px; flex-shrink:0; color:var(--dk-red); }
.kd-crit-title{ font-size:12.5px; font-weight:600; color:var(--dk-ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.kd-crit-domain{ font-size:10.5px; color:var(--dk-mute-2); margin-top:1px; }
.kd-crit-client{ font-size:12px; color:var(--dk-mute); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.kd-crit-status{ font-family:var(--mono); font-size:11.5px; font-weight:600; }
.kd-crit-owner{ font-size:12px; color:var(--dk-mute); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
@media (max-width:820px){ .kd-crit-head{ display:none; } .kd-crit-row{ grid-template-columns:1fr; row-gap:2px; } }

.kd-thead{ display:grid; grid-template-columns:1fr 34px 34px 34px 76px; border-bottom:1px solid var(--dk-line); padding:0 4px 6px; }
.kd-thead > div{ font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:.04em; color:var(--dk-mute); }
.kd-th-c{ text-align:center; } .kd-th-r{ text-align:right; }
.kd-scorebody{ max-height:320px; overflow-y:auto; }
.kd-scrollbox{ max-height:320px; overflow-y:auto; }
.kd-scorerow{ display:grid; grid-template-columns:1fr 34px 34px 34px 76px; align-items:center; padding:8px 4px; border-bottom:1px solid var(--dk-line-2); font-size:12.5px; cursor:pointer; }
.kd-scorerow:hover{ background:var(--teal-hi); }
.kd-scorerow:last-child{ border-bottom:none; }
.kd-sr-name{ font-weight:500; color:var(--dk-ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.kd-sr-c{ text-align:center; }
.kd-sr-trend{ text-align:right; font-size:11px; font-weight:600; color:var(--dk-mute); }
.kd-score{ font-size:20px; line-height:1; }
.kd-score-sub{ margin-top:2px; font-size:9.5px; color:var(--dk-mute-2); }

.kd-list{ display:flex; flex-direction:column; }
.kd-deadline-row{ display:grid; grid-template-columns:60px 1fr 110px 78px; align-items:center; gap:10px; padding:8px 2px; border-bottom:1px solid var(--dk-line-2); font-size:12px; }
.kd-deadline-row:last-child{ border-bottom:none; }
.kd-deadline-date{ font-size:11px; font-weight:600; color:var(--dk-primary); }
.kd-deadline-title{ color:var(--dk-ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.kd-deadline-client{ color:var(--dk-mute); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.kd-tag{ font-size:10px; font-weight:600; padding:2px 8px; border-radius:999px; text-align:center; }
.kd-tag-teal{ background:var(--teal-hi); color:var(--dk-primary); }
.kd-tag-primary{ background:var(--teal-hi); color:var(--dk-primary); }
.kd-tag-amber{ background:rgba(245,158,11,.12); color:var(--dk-amber); }

.kd-riskband{ display:flex; align-items:center; gap:10px; padding:10px 14px; margin-bottom:12px; border-radius:10px; background:rgba(239,68,68,.06); border:1px solid rgba(239,68,68,.18); }
.kd-capbox{ border-radius:12px; padding:12px; }
.kd-capbox-green{ background:rgba(34,153,84,.06); border:1px solid rgba(34,153,84,.15); }
.kd-capbox-red{ background:rgba(239,68,68,.06); border:1px solid rgba(239,68,68,.15); }
.kd-capbox-title{ font-size:12px; font-weight:600; margin-bottom:5px; }
.kd-capbox-body{ font-size:11.5px; line-height:1.5; color:var(--dk-mute); }
.kd-bwrow{ display:grid; grid-template-columns:130px 1fr 92px; align-items:center; gap:12px; padding:9px 2px; border-bottom:1px solid var(--dk-line-2); cursor:pointer; }
.kd-bwrow:hover{ background:var(--teal-hi); }
.kd-bw-name{ font-size:12.5px; font-weight:500; color:var(--dk-ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.kd-bw-track{ height:8px; border-radius:999px; background:var(--dk-line-2); overflow:hidden; }
.kd-bw-fill{ display:block; height:100%; border-radius:999px; }
.kd-bw-total{ font-size:11.5px; font-weight:600; text-align:right; color:var(--dk-mute); }
.kd-bw-detail{ padding:8px 4px 8px 20px; display:flex; flex-wrap:wrap; gap:8px 16px; background:var(--surface); border-bottom:1px solid var(--dk-line-2); }
.kd-bw-detail-item{ font-size:11px; color:var(--dk-mute); }
.kd-bw-detail-amt{ font-size:9px; background:var(--dk-line-2); color:var(--dk-mute); padding:1px 5px; border-radius:6px; margin-right:3px; }

.kd-legend-row{ display:flex; align-items:center; gap:8px; font-size:12px; }
.kd-legend-label{ flex:1; color:var(--dk-ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.kd-legend-pct{ font-weight:600; color:var(--dk-mute); }
.kd-donut-num{ font-size:19px; font-weight:800; }
.kd-donut-sub{ font-size:9px; }

.kd-sevbar{ display:flex; height:10px; border-radius:999px; overflow:hidden; background:var(--dk-line-2); margin-bottom:8px; }
.kd-sevlegend{ display:flex; flex-wrap:wrap; gap:8px; font-size:11px; margin-bottom:10px; }
.kd-sev-l1{ background:#94A3B8; } .kd-sev-l1-text{ color:#64748B; }
.kd-sev-l2{ background:var(--dk-primary); } .kd-sev-l2-text{ color:var(--dk-primary); }
.kd-sev-l3{ background:var(--dk-amber); } .kd-sev-l3-text{ color:var(--dk-amber); }
.kd-sev-l4{ background:var(--dk-red); } .kd-sev-l4-text{ color:var(--dk-red); }

.kd-funnel-row{ display:flex; align-items:center; gap:8px; font-size:11px; }
.kd-funnel-label{ width:150px; flex-shrink:0; color:var(--dk-mute); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.kd-funnel-max{ color:var(--dk-ink); font-weight:600; }
.kd-funnel-track{ flex:1; height:10px; border-radius:6px; background:var(--dk-line-2); overflow:hidden; }
.kd-funnel-fill{ height:100%; border-radius:6px; background:var(--dk-primary); }
.kd-funnel-fill-max{ background:var(--dk-red); }
.kd-funnel-n{ width:20px; text-align:right; color:var(--dk-mute); }

.kd-fin-box{ border-radius:12px; padding:12px; background:rgba(34,153,84,.06); }
.kd-fin-num{ font-size:18px; font-weight:800; color:var(--dk-green); }
.kd-fin-label{ font-size:11px; color:var(--dk-mute); margin-top:2px; }

.kd-hygiene-num{ font-size:28px; line-height:1; margin-bottom:12px; }
.kd-hygiene-rows{ display:flex; flex-direction:column; gap:6px; font-size:12px; }
.kd-hygiene-row{ display:flex; align-items:center; justify-content:space-between; }
.kd-hygiene-row dt{ color:var(--dk-mute); }

.kd-blocker-row{ padding:8px 0; border-bottom:1px solid var(--dk-line-2); }
.kd-blocker-row:last-child{ border-bottom:none; }
.kd-blocker-text{ font-size:12px; color:var(--dk-ink); }
.kd-blocker-client{ font-size:11px; color:var(--dk-mute); margin-top:1px; }
</style>`;