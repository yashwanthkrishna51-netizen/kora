// ─── HELPERS ──────────────────────────────────────────────────────
function sbadge(s) { return `<span class="${SBG[s] || SBG['Not Started']}">${esc(s)}</span>`; }
function roleBadge(role) {
  const map = { admin: ['#7c3aed', 'Admin'], editor: ['#0e7490', 'Editor'], viewer: ['#64748b', 'Viewer'] };
  const [color, label] = map[role] || map.viewer;
  return `<span class="k-status" style="border-color:${color}22;"><span style="width:6px;height:6px;border-radius:50%;background:${color};display:inline-block;"></span>${label}</span>`;
}
function adminRowMenu(items) {
  // items: [{label, act, extra (raw data-attr string), danger:bool}]; renders a "..." overflow menu,
  // with a divider before the first danger item so destructive actions read as visually separate.
  let sawDanger = false;
  const rows = items.map(it => {
    const divider = (it.danger && !sawDanger) ? '<div class="border-t border-gray-100 my-1"></div>' : '';
    if (it.danger) sawDanger = true;
    return `${divider}<button data-act="${it.act}" ${it.extra || ''} class="w-full text-left px-3.5 py-2 text-sm ${it.danger ? 'text-rose-600 hover:bg-rose-50' : 'text-gray-700 hover:bg-gray-50'} transition">${esc(it.label)}</button>`;
  }).join('');
  return `<div class="relative group inline-block">
    <button class="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition" title="More actions">⋯</button>
    <div class="absolute right-0 top-full mt-1 bg-white border border-gray-100 rounded-xl shadow-xl w-52 py-1 hidden group-hover:block z-20">${rows}</div>
  </div>`;
}
function sBar(integs) { if (!integs.length) return ''; const c = {}; integs.forEach(i => c[i.status] = (c[i.status] || 0) + 1); return Object.entries(c).map(([s, n]) => `<div class="h-1.5 rounded" style="width:${Math.round(n / integs.length * 100)}%;background:${SDOT[s] || '#9ca3af'};"></div>`).join(''); }
function sCounts(integs) { const c = {}; integs.forEach(i => c[i.status] = (c[i.status] || 0) + 1); return Object.entries(c).map(([s, n]) => `<span class="flex items-center gap-1 text-xs text-gray-500"><span class="w-2 h-2 inline-block rounded-full" style="background:${SDOT[s] || '#9ca3af'};"></span>${n} ${esc(s)}</span>`).join(''); }
// Clients are shared across all sections now. This lets a modal offer "pick an
// existing client not yet in this section" alongside "create a new one".
function clientPickerHtml(excludeFn) {
  const avail = S.clients.filter(c => !excludeFn(c)).sort((a, b) => a.name.localeCompare(b.name));
  return `<div><label class="block text-xs font-medium text-gray-500 mb-1">Existing Client</label>
    <select id="m0" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]">
      <option value="">— Create a new client below —</option>
      ${avail.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
    </select>
  </div>`;
}

// ─── BRAND WORDMARK ───────────────────────────────────────────────
function brandMark(big) {
  const h = big ? 36 : 24;
  return `<div class="flex flex-col items-start gap-0.5">
    <img src="${KOGNOZ_LOGO}" alt="Kognoz" style="height:${h}px;width:auto;object-fit:contain;" />
    <span class="text-[13px] font-bold tracking-[0.2em] uppercase" style="color:#0e7490;letter-spacing:0.18em;">KORA</span>
  </div>`;
}
let _cmdpResults = [];
function renderShortcutsHelp() {
  const rows = [
    ['Navigation', [['g then d', 'Go to Dashboard'], ['g then i', 'Go to Integrations'], ['g then m', 'Go to Implementation'], ['g then a', 'Go to AMS & Support']]],
    ['General', [['⌘/Ctrl + K', 'Open search'], ['⌘/Ctrl + S', 'Save current record'], ['?', 'Show this shortcuts list'], ['Esc', 'Close any open dialog']]],
  ];
  return `<div class="k-modal-overlay fixed inset-0 z-[100] flex items-center justify-center" data-act="close-shortcuts-help">
    <div class="k-modal" style="max-width:420px;" onclick="event.stopPropagation()">
      <h3 class="text-base font-bold mb-4" style="color:var(--ink)">Keyboard Shortcuts</h3>
      ${rows.map(([group, items]) => `<div class="mb-4">
        <div class="text-xs font-semibold uppercase tracking-wide mb-2" style="color:var(--mute)">${group}</div>
        <div class="space-y-1.5">
          ${items.map(([key, label]) => `<div class="flex items-center justify-between text-sm">
            <span style="color:var(--ink-3)">${esc(label)}</span>
            <kbd style="font-size:11px;padding:2px 8px;border:1px solid var(--line);border-radius:4px;background:var(--surface);color:var(--mute);">${esc(key)}</kbd>
          </div>`).join('')}
        </div>
      </div>`).join('')}
      <button data-act="close-shortcuts-help" class="k-btn k-btn-secondary w-full mt-2">Close</button>
    </div>
  </div>`;
}
function renderCmdPalette() {
  const q = S.cmdQuery.toLowerCase().trim();
  const icon = { client: '🔗', integ: '⚡', implClient: '🏗️', amsClient: '🧾' };
  let list;
  if (q) {
    const results = [];
    S.clients.forEach(c => {
      if (c.name.toLowerCase().includes(q)) results.push({ type: 'client', label: c.name, sub: 'Integration Client', view: 'client-detail', params: { clientId: c.id } });
      (c.integrations || []).forEach(i => { if (i.name.toLowerCase().includes(q)) results.push({ type: 'integ', label: i.name, sub: `Integration · ${c.name}`, view: 'integ-detail', params: { clientId: c.id, integId: i.id } }); });
      if (c.modules !== undefined && c.name.toLowerCase().includes(q)) results.push({ type: 'implClient', label: c.name, sub: 'Implementation Client', view: 'impl-client-detail', params: { clientId: c.id } });
      if (c.workLog !== undefined && c.name.toLowerCase().includes(q)) results.push({ type: 'amsClient', label: c.name, sub: 'AMS Client', view: 'ams-client-detail', params: { clientId: c.id } });
    });
    list = results.slice(0, 20);
  } else {
    list = S.recentlyViewed.filter(r => {
      const c = S.clients.find(x => x.id === r.params.clientId); if (!c) return false;
      if (r.view === 'integ-detail') return !!c.integrations.find(x => x.id === r.params.integId);

      return true;
    });
  }
  _cmdpResults = list;
  return `<div class="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-24 p-4 fade" id="cmdp-overlay">
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg modal-pop overflow-hidden">
      <div class="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
        <svg class="w-5 h-5 text-gray-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"/></svg>
        <input id="cmdp-input" data-act="cmdp-input" type="text" value="${esc(S.cmdQuery)}" placeholder="Search clients, integrations, projects…" autocomplete="off" class="flex-1 text-sm outline-none"/>
        <kbd class="text-[10px] text-gray-300 border border-gray-200 rounded px-1.5 py-0.5">Esc</kbd>
      </div>
      <div class="max-h-80 overflow-y-auto p-2">
        ${!q && !list.length ? `<p class="text-sm text-gray-400 text-center py-8">${emptyIcon('search')}Start typing to search everything.</p>` : ''}
        ${!q && list.length ? `<div class="px-2 pt-1 pb-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Recently Viewed</div>` : ''}
        ${q && !list.length ? `<p class="text-sm text-gray-400 text-center py-8">${emptyIcon('search')}No matches for "${esc(S.cmdQuery)}"</p>` : ''}
        ${list.map((r, idx) => `<button data-act="cmdp-go" data-idx="${idx}" style="animation-delay:${idx * 15}ms" class="row-in w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${idx === Math.min(S.cmdSelectedIdx, list.length - 1) ? 'bg-[#0e7490]/8' : 'hover:bg-[#0e7490]/8'}">
          <span class="text-base shrink-0">${icon[r.type] || '📄'}</span>
          <div class="min-w-0 flex-1"><div class="text-sm font-medium text-gray-800 truncate">${esc(r.label)}</div><div class="text-xs text-gray-400 truncate">${esc(r.sub || '')}</div></div>
        </button>`).join('')}
      </div>
    </div>
  </div>`;
}
function renderAppSkeleton() {
  const isMobile = window.innerWidth < 768;
  const collapsed = !isMobile && S.sidebarCollapsed;
  const sbw = isMobile ? '0' : (collapsed ? '56px' : '232px');
  const w = isMobile ? '240px' : sbw;
  return `<aside class="k-sidebar fixed inset-y-0 left-0 z-40 flex flex-col" style="width:${w};transform:${isMobile ? 'translateX(-100%)' : 'translateX(0)'};">
    <div class="k-side-header shrink-0 flex flex-col items-center justify-center ${collapsed ? 'px-1 py-3' : 'px-4 py-5'}" style="background:#ffffff;">
      <img src="${KOGNOZ_LOGO}" alt="Kognoz" style="height:${collapsed ? '26px' : '40px'};width:auto;object-fit:contain;display:block;" />
    </div>
    <div class="flex-1 px-2.5 py-4 space-y-2">${[1, 2, 3, 4].map(() => `<div class="skel rounded-xl h-9"></div>`).join('')}</div>
  </aside>
  <main class="min-h-screen" style="margin-left:${sbw}">
    <div class="max-w-7xl mx-auto px-6 py-7">
      <div class="skel rounded-lg h-7 w-48 mb-2"></div>
      <div class="skel rounded-lg h-4 w-72 mb-6"></div>
      <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">${[1, 2, 3, 4, 5].map(() => `<div class="skel rounded-2xl h-20"></div>`).join('')}</div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div class="skel rounded-2xl h-64"></div>
        <div class="skel rounded-2xl h-64"></div>
      </div>
    </div>
  </main>`;
}

// ─── RENDER ───────────────────────────────────────────────────────
function renderBreadcrumb() {
  if (S.view === 'dashboard' || S.view === 'login') return '';
  const crumbs = [{ label: 'Dashboard', act: 'nav-dashboard' }];
  const c = S.params.clientId ? S.clients.find(x => x.id === S.params.clientId) : null;
  if (['clients', 'client-detail', 'integ-detail'].includes(S.view)) {
    crumbs.push({ label: 'Integrations', act: 'nav-clients' });
    if (c) crumbs.push({ label: c.name, act: 'open-client', id: c.id });
    if (S.view === 'integ-detail' && c) {
      const i = (c.integrations || []).find(x => x.id === S.params.integId);
      if (i) crumbs.push({ label: i.name });
    }
  } else if (['impl-clients', 'impl-client-detail', 'impl-phase-detail'].includes(S.view)) {
    crumbs.push({ label: 'Implementation', act: 'nav-impl' });
    if (c) crumbs.push({ label: c.name, act: 'open-impl-client', id: c.id });
    if (S.view === 'impl-phase-detail' && c) {
      const m = (c.modules || []).find(x => x.id === S.params.moduleId);
      if (m) crumbs.push({ label: m.name, act: 'open-impl-client', id: c.id });
      crumbs.push({ label: S.params.phase });
    }
  } else if (['ams-clients', 'ams-client-detail'].includes(S.view)) {
    crumbs.push({ label: 'AMS & Support', act: 'nav-ams' });
    if (c) crumbs.push({ label: c.name });
  } else if (S.view === 'admin') {
    crumbs.push({ label: 'Admin' });
  }
  return `<div class="k-crumbs">${crumbs.map((cr, idx) => {
    const isLast = idx === crumbs.length - 1;
    const sep = idx > 0 ? '<span style="margin:0 6px;color:var(--mute-2);">/</span>' : '';
    if (isLast || !cr.act) return `${sep}<span style="color:var(--ink-3);font-weight:500;">${esc(cr.label)}</span>`;
    return `${sep}<a data-act="${cr.act}"${cr.id ? ` data-id="${esc(cr.id)}"` : ''} style="cursor:pointer;">${esc(cr.label)}</a>`;
  }).join('')}</div>`;
}
function render() {
  const app = document.getElementById('app');
  if (!app) return;
  if (!S.user || S.view === 'login') { app.innerHTML = renderLogin(); return; }
  let content = '';
  if (S.view === 'dashboard') content = renderDashboard();
  else if (S.view === 'clients') content = renderClientDetail(S.params.clientId);
  else if (S.view === 'client-detail') content = renderClientDetail(S.params.clientId);
  else if (S.view === 'integ-detail') content = renderIntegDetail(S.params.clientId, S.params.integId);
  else if (S.view === 'impl-clients') content = renderImplClientDetail(S.params.clientId);
  else if (S.view === 'impl-client-detail') content = renderImplClientDetail(S.params.clientId);
  else if (S.view === 'impl-phase-detail') content = renderImplPhaseDetail(S.params.clientId, S.params.moduleId, S.params.phase);
  else if (S.view === 'ams-clients') content = renderAmsClientDetail(S.params.clientId);
  else if (S.view === 'ams-client-detail') content = renderAmsClientDetail(S.params.clientId);
  else if (S.view === 'admin') content = can('admin') ? renderAdmin() : `<div class="p-8 text-rose-500">Access denied</div>`;
  const isMobile = window.innerWidth < 768;
  const sbw = isMobile ? '0' : (S.sidebarCollapsed ? '56px' : '232px');
  // "View As" preview banner — rendered unconditionally here (not inside any
  // can()-gated content) so an admin previewing a lower role always has a
  // visible way back out, even from a page that role can't otherwise see.
  const viewingAs = S.user?.role === 'admin' && S.viewAsRole;
  const viewAsBanner = viewingAs ? `<div style="position:fixed;top:0;left:0;right:0;z-index:210;background:#7c3aed;color:#fff;font-size:12px;font-weight:600;text-align:center;padding:7px 12px;letter-spacing:0.02em;display:flex;align-items:center;justify-content:center;box-sizing:border-box;">👁 Previewing as ${esc(S.viewAsRole)} — your real admin access is unchanged <button data-act="exit-view-as" style="margin-left:10px;background:rgba(255,255,255,.2);border:none;color:#fff;font-weight:700;padding:2px 10px;border-radius:6px;cursor:pointer;">Exit Preview</button></div>` : '';
  const topOffset = viewingAs && S.offlineMode ? '30px' : '0';
  app.innerHTML = `${viewAsBanner}${S.offlineMode ? `<div style="position:fixed;top:${topOffset};left:0;right:0;z-index:200;background:var(--red);color:#fff;font-size:12px;font-weight:500;text-align:center;padding:6px;letter-spacing:0.02em;">You appear to be offline — saves will fail until your connection is restored</div>` : ''}${renderSidebar()}<main class="min-h-screen" style="margin-left:${sbw};transition:margin-left 200ms ease;${S.offlineMode || viewingAs ? `padding-top:${(S.offlineMode ? 28 : 0) + (viewingAs ? 30 : 0)}px;` : ''}">${isMobile ? `<div style="position:fixed;top:12px;left:12px;z-index:50;"><button data-act="toggle-sidebar" class="k-btn k-btn-secondary" style="width:36px;height:36px;padding:0;box-shadow:var(--shadow);"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="2" y1="4" x2="14" y2="4"/><line x1="2" y1="8" x2="14" y2="8"/><line x1="2" y1="12" x2="14" y2="12"/></svg></button></div>` : ''}${renderBreadcrumb()}${content}</main>${S.modal ? renderModal() : ''}${S.cmdPaletteOpen ? renderCmdPalette() : ''}${S.shortcutsHelpOpen ? renderShortcutsHelp() : ''}${isMobile && S.mobileSidebarOpen ? `<div data-act="toggle-sidebar" style="position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:30;"></div>` : ''}`;

}

function renderSidebar() {
  const isMobile = window.innerWidth < 768;
  const collapsed = !isMobile && S.sidebarCollapsed;
  const w = isMobile ? '240px' : (collapsed ? '56px' : '232px');
  const hidden = isMobile && !S.mobileSidebarOpen;
  const isActive = v => {
    if (v === 'clients') return ['clients', 'client-detail', 'integ-detail'].includes(S.view);
    if (v === 'impl') return ['impl-clients', 'impl-client-detail', 'impl-phase-detail'].includes(S.view);
    if (v === 'ams') return ['ams-clients', 'ams-client-detail'].includes(S.view);
    return S.view === v;
  };
  const ico = {
    dash: `<svg class="k-side-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>`,
    integ: `<svg class="k-side-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 2L3 9h4l-1 5 5-7H7l1-5z" stroke-linejoin="round"/></svg>`,
    impl: `<svg class="k-side-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="3" height="10" rx="0.5"/><rect x="6.5" y="3" width="3" height="10" rx="0.5"/><rect x="11" y="3" width="3" height="10" rx="0.5"/></svg>`,
    ams: `<svg class="k-side-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M8 4v4l2.5 2.5"/></svg>`,
    admin: `<svg class="k-side-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="2.5"/><path d="M8 1v2M8 13v2M13.5 8h1M1.5 8h1M12.24 3.76l-1.06 1.06M4.82 11.18l-1.06 1.06M12.24 12.24l-1.06-1.06M4.82 4.82L3.76 3.76"/></svg>`,
    search: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4.5"/><path d="M13 13l-2.5-2.5"/></svg>`,
    logout: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 2H3v12h3M10 5l3 3-3 3M13 8H6"/></svg>`,
    chevron: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 4l4 4-4 4"/></svg>`,
    sun: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="3"/><path d="M8 1v1M8 14v1M15 8h-1M2 8H1M12.95 3.05l-.7.7M3.75 12.25l-.7.7M12.95 12.95l-.7-.7M3.75 3.75l-.7-.7"/></svg>`,
    moon: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a6 6 0 1 0 7 7z"/></svg>`,
  };
  const navItem = (view, label, icon) => `<button data-act="nav-${view}" class="k-side-item ${isActive(view) ? 'active' : ''}" ${collapsed ? `title="${label}"` : ''}>
    ${icon}${collapsed ? '' : `<span class="truncate label-fade">${label}</span>`}
  </button>`;
  const grp = t => collapsed ? '' : `<div class="k-side-group">${t}</div>`;

  return `<aside class="k-sidebar fixed inset-y-0 left-0 z-40 flex flex-col" style="width:${w};transform:${hidden ? 'translateX(-100%)' : 'translateX(0)'};transition:transform 200ms ease,width 200ms ease">
  <div class="k-side-header shrink-0 flex flex-col items-center justify-center ${collapsed ? 'px-1 py-3' : 'px-4 py-5'}" style="background:#ffffff;">
    ${collapsed
      ? `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
          <img src="${KOGNOZ_LOGO}" alt="Kognoz" style="height:26px;width:auto;object-fit:contain;display:block;" />
          <span style="font-size:9px;font-weight:700;letter-spacing:0.14em;color:var(--teal);text-transform:uppercase;line-height:1;">Kora</span>
        </div>`
      : `<img src="${KOGNOZ_LOGO}" alt="Kognoz" style="height:52px;width:auto;max-width:180px;object-fit:contain;display:block;margin-bottom:6px;" />
        <span style="font-size:22px;font-weight:700;letter-spacing:0.18em;color:var(--teal);text-transform:uppercase;line-height:1;">Kora</span>`}
  </div>
  <div class="px-3 pt-3 pb-1">
    <button data-act="cmdp-open" class="w-full flex items-center gap-2 k-side-search rounded-md px-2.5 ${collapsed ? 'justify-center' : ''}">
      ${ico.search}
      ${collapsed ? '' : `<span class="flex-1 text-left label-fade" style="font-size:12px;">Search…</span><kbd style="font-size:10px;padding:1px 5px;border:1px solid rgba(255,255,255,.1);border-radius:3px;color:#71717a;font-family:var(--font);">${kbdHint('K')}</kbd>`}
    </button>
  </div>
  <nav class="flex-1 overflow-y-auto sidebar-scroll pt-2 pb-3">
    ${!collapsed ? '<div class="k-side-group" style="margin-top:8px;">Main</div>' : ''}
    ${navItem('dashboard', 'Dashboard', ico.dash)}
    ${grp('Trackers')}
    ${navItem('clients', 'Integrations', ico.integ)}
    ${navItem('impl', 'Implementations', ico.impl)}
    ${navItem('ams', 'AMS & Support', ico.ams)}
    ${can('admin') ? grp('System') : ''}
    ${can('admin') ? navItem('admin', 'Admin', ico.admin) : ''}
  </nav>
  <div class="k-side-profile shrink-0">
    ${!collapsed ? `<button data-act="open-profile" class="k-side-profile-btn" title="View Profile">
      <div style="width:30px;height:30px;border-radius:50%;background:var(--teal);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;">${esc((S.user?.name || '?')[0].toUpperCase())}</div>
      <div class="min-w-0 flex-1">
        <div class="k-side-username truncate">${esc(S.user?.name)}</div>
        <div class="k-side-tag">${esc(S.user?.role)}</div>
      </div>
    </button>`: ``}
    <div class="${collapsed ? 'flex flex-col items-center gap-1.5' : 'flex items-center gap-1.5'}">
      <button data-act="toggle-dark" title="Toggle theme" class="k-side-action-btn ${collapsed ? 'w-full' : 'flex-1'}">
        ${S.darkMode ? ico.moon : ico.sun}
      </button>
      <button data-act="logout" title="Sign out" class="k-side-action-btn ${collapsed ? 'w-full' : 'flex-1'}">
        ${ico.logout}
      </button>
      <button data-act="toggle-sidebar" title="${collapsed ? 'Expand' : 'Collapse'}" class="k-side-action-btn" style="width:32px;">
        <span style="display:inline-block;transform:rotate(${collapsed ? '0' : '180'}deg);transition:transform 200ms ease;">${ico.chevron}</span>
      </button>
    </div>
  </div>
</aside>`;
}

function renderLogin() {
  const board = [
    ['Completed', 'SAP S/4HANA rollout', 100],
    ['In Progress', 'Salesforce integration', 62],
    ['At Risk', 'Payroll sync', 28],
    ['Pending Client', 'SSO configuration', 10],
  ];
  return `<style>
    @keyframes login-mesh-drift {
      0%   { background-position: 0% 0%, 100% 100%, 50% 50%; filter: hue-rotate(0deg); }
      50%  { background-position: 100% 50%, 0% 50%, 60% 40%; filter: hue-rotate(25deg); }
      100% { background-position: 0% 0%, 100% 100%, 50% 50%; filter: hue-rotate(0deg); }
    }
    .login-mesh {
      position: absolute; inset: -20%; z-index: 0; pointer-events: none;
      background-image:
        radial-gradient(circle at 15% 85%, rgba(37,99,235,.35), transparent 55%),
        radial-gradient(circle at 85% 15%, rgba(14,116,144,.32), transparent 55%),
        radial-gradient(circle at 50% 50%, rgba(99,102,241,.22), transparent 60%);
      background-size: 180% 180%, 180% 180%, 160% 160%;
      animation: login-mesh-drift 18s ease-in-out infinite;
      will-change: background-position, filter;
    }
    @keyframes login-in {
      from { opacity: 0; transform: translateY(14px) scale(.98); }
      to   { opacity: 1; transform: none; }
    }
    .login-stagger { opacity: 0; animation: login-in .7s cubic-bezier(.2,.7,.2,1) forwards; }
    .login-stagger-1 { animation-delay: .05s; }
    .login-stagger-2 { animation-delay: .25s; }
    .login-stagger-3 { animation-delay: .45s; }
    @keyframes login-pulse-glow {
      0%, 100% { box-shadow: 0 0 24px 0 rgba(37,99,235,.08); border-color: rgba(255,255,255,.1); }
      50%      { box-shadow: 0 0 32px 4px rgba(37,99,235,.22); border-color: rgba(96,165,250,.35); }
    }
    .login-card {
      opacity: 0;
      animation:
        login-in .7s cubic-bezier(.2,.7,.2,1) .45s forwards,
        login-pulse-glow 3.2s ease-in-out .45s infinite;
    }
    .login-bar-fill {
      width: 0; border-radius: 2px;
      animation: login-bar-fill 1.1s cubic-bezier(.16,.8,.3,1) forwards;
      animation-delay: var(--d, 0s);
    }
    @keyframes login-bar-fill { from { width: 0; } to { width: var(--w); } }
  </style>
  <div class="min-h-screen flex" style="background:var(--paper);">
  <div class="login-left-panel flex-col justify-between" style="width:58%;background:var(--ink-2);padding:56px 64px;position:relative;overflow:hidden;">
    <div class="login-mesh"></div>
    <div class="login-stagger login-stagger-1" style="position:relative;z-index:1;">
      <div style="display:inline-block;background:#fff;padding:8px 16px;border-radius:10px;">
        <img src="${KOGNOZ_LOGO}" alt="Kognoz" style="height:26px;width:auto;object-fit:contain;display:block;" />
      </div>
    </div>
    <div style="position:relative;z-index:1;max-width:480px;">
      <h1 class="login-stagger login-stagger-2" style="font-size:34px;font-weight:700;letter-spacing:-0.02em;line-height:1.15;color:#fff;margin-bottom:16px;">Every client.<br/>Every phase.<br/>One view.</h1>
      <p class="login-stagger login-stagger-2" style="font-size:14px;color:#94a3b8;line-height:1.6;margin-bottom:36px;">Kora tracks integrations, implementations, and AMS delivery across your whole portfolio — so nothing slips between spreadsheets.</p>
      <div class="login-card" style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:20px 22px;backdrop-filter:blur(8px);">
        <div style="font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;margin-bottom:14px;">Live portfolio status</div>
        <div style="display:flex;flex-direction:column;gap:13px;">
          ${board.map(([status, label, pct], i) => `<div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
              <span style="width:7px;height:7px;border-radius:50%;background:#${SHEX[status]};flex-shrink:0;"></span>
              <span style="font-size:12.5px;color:#e2e8f0;flex:1;">${label}</span>
              <span style="font-size:11px;color:#64748b;font-family:var(--mono);">${pct}%</span>
            </div>
            <div style="height:4px;background:rgba(255,255,255,.08);border-radius:2px;overflow:hidden;">
              <div class="login-bar-fill" style="--w:${pct}%;--d:${(1 + i * 0.15).toFixed(2)}s;height:100%;background:#${SHEX[status]};"></div>
            </div>
          </div>`).join('')}
        </div>
      </div>
    </div>
    <div style="position:relative;z-index:1;font-size:11px;color:#475569;">© ${new Date().getFullYear()} Kognoz · Internal delivery platform</div>
  </div>

  <div class="flex-1 flex items-center justify-center" style="padding:24px;">
    <div class="login-stagger login-stagger-3" style="width:100%;max-width:360px;">
      <div class="lg:hidden text-center" style="margin-bottom:28px;">
        <img src="${KOGNOZ_LOGO}" alt="Kognoz" style="height:40px;width:auto;object-fit:contain;margin:0 auto;display:block;" />
      </div>
      <div style="margin-bottom:32px;">
        <div style="font-size:22px;font-weight:700;letter-spacing:-0.01em;color:var(--ink);">Sign in to Kora</div>
        <p style="font-size:13px;color:var(--mute);margin-top:6px;">Enter your credentials to continue</p>
      </div>
      <div style="display:flex;flex-direction:column;gap:18px;">
        <div>
          <label style="display:block;margin-bottom:6px;font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:var(--mute);">Username</label>
          <input id="lu" type="text" autocomplete="username" placeholder="preview_admin" class="k-input" style="width:100%;height:40px;padding:0 12px;font-size:14px;box-sizing:border-box;"/>
        </div>
        <div>
          <label style="display:block;margin-bottom:6px;font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:var(--mute);">Password</label>
          <div style="position:relative;width:100%;">
            <input id="lp" type="password" autocomplete="current-password" placeholder="••••••••" class="k-input" style="width:100%;height:40px;padding:0 38px 0 12px;font-size:14px;box-sizing:border-box;"/>
            ${pwdToggleBtn('lp')}
          </div>
        </div>
        <div id="lerr" class="${S.authMessage ? '' : 'hidden'}" style="font-size:12px;color:var(--red);background:var(--red-hi);padding:8px 12px;border-radius:var(--radius);text-align:center;">${S.authMessage ? esc(S.authMessage) : ''}</div>
        <button data-act="login" class="k-btn k-btn-primary k-btn-lg" style="width:100%;margin-top:4px;">Sign In</button>
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin:20px 0;">
        <div style="flex:1;height:1px;background:var(--line);"></div>
        <span style="font-size:11px;color:var(--mute-2);">OR</span>
        <div style="flex:1;height:1px;background:var(--line);"></div>
      </div>
      <a href="/api/auth-microsoft" class="k-btn k-btn-lg" style="width:100%;display:flex;align-items:center;justify-content:center;gap:10px;background:#fff;border:1px solid var(--line);color:var(--ink);text-decoration:none;">
        <svg width="18" height="18" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
          <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
        </svg>
        Sign in with Microsoft 365
      </a>
      <div style="text-align:center;margin-top:24px;font-size:11px;color:var(--mute-2);">
        Kognoz internal platform · Access is provisioned by your admin
      </div>
    </div>
  </div>
</div>`;
}
const RAG_BADGE = { Red: 'k-rag k-rag-red', Amber: 'k-rag k-rag-amber', Green: 'k-rag k-rag-green' };
const RAG_DOT = { Red: 'k-rag-red', Amber: 'k-rag-amber', Green: 'k-rag-green' };
function ragBadge(rag, size = 'sm') { if (!rag) return '<span class="text-xs" style="color:var(--mute-2)">—</span>'; return `<span class="${RAG_BADGE[rag] || ''}">${rag}</span>`; }

// ─── CLIENT DETAIL (sortable table) ──────────────────────────────
function sortIntegs(list) {
  const { key, dir } = S.sort; const m = dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    let av, bv;
    if (key === 'due') { av = a.dueDate || '9999'; bv = b.dueDate || '9999'; }
    else if (key === 'lastUpdate') { av = lastUpdateDate(a) || '0000'; bv = lastUpdateDate(b) || '0000'; }
    else if (key === 'status') { av = a.status; bv = b.status; }
    else if (key === 'assignee') { av = a.assignee || ''; bv = b.assignee || ''; }
    else { av = a.name; bv = b.name; }
    return av < bv ? -1 * m : av > bv ? 1 * m : 0;
  });
}
function sortGeneric(list, state, getters) {
  const { key, dir } = state; const m = dir === 'asc' ? 1 : -1;
  const get = getters[key] || getters._default;
  return [...list].sort((a, b) => { const av = get(a), bv = get(b); return av < bv ? -1 * m : av > bv ? 1 * m : 0; });
}
function sortArrow(key) { if (S.sort.key !== key) return '<span class="text-gray-300">↕</span>'; return S.sort.dir === 'asc' ? '<span class="text-[#0e7490]">↑</span>' : '<span class="text-[#0e7490]">↓</span>'; }
function sortArrowFor(state, key) { if (state.key !== key) return '<span class="text-gray-300">↕</span>'; return state.dir === 'asc' ? '<span class="text-[#0e7490]">↑</span>' : '<span class="text-[#0e7490]">↓</span>'; }