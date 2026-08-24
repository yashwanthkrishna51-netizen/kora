// ─── EVENTS ───────────────────────────────────────────────────────

// Shared post-login bootstrap — identical whether the session came from a
// password login (POST /api/login) or Microsoft SSO (POST
// POST /api/auth-microsoft, see init() below): both return the same
// { token, user, usersSha } shape, so both end up here. errEl is optional
// (the SSO path runs before the login form even exists in the DOM, so
// failures there fall back to S.authMessage, shown once renderLogin runs).
async function finishLogin(ld, errEl) {
  S.sessionToken = ld.token; S.user = ld.user; S.shas.users = ld.usersSha;
  document.getElementById('app').innerHTML = renderAppSkeleton();
  try {
    const cl = await apiRead('data/clients.json'); S.clients = cl.content; S.shas.clients = cl.sha;
  } catch (err) {
    S.user = null; S.sessionToken = null; S.view = 'login'; render();
    const msg = 'Loaded user but failed to load clients.';
    const e2 = document.getElementById('lerr');
    if (e2) { e2.textContent = msg; e2.classList.remove('hidden'); } else { S.authMessage = msg; render(); }
    return false;
  }
  try {
    const ul = await apiRead('data/users.json');
    S.usersForDropdown = ul.content.map(u => ({ id: u.id, name: u.name || u.username, role: u.role, username: u.username }));
    if (can('admin')) { S.users = ul.content; S.shas.users = ul.sha; }
  } catch (err) {
    S.usersForDropdown = [{ id: S.user.id, name: S.user.name || S.user.username, role: S.user.role, username: S.user.username }];
  }
  persistSession(S.sessionToken, S.user);
  const resumed = S.pendingPath ? pathToView(S.pendingPath) : null;
  S.pendingPath = null;
  const targetView = (resumed && validateView(resumed.view, resumed.params || {})) ? resumed.view : 'dashboard';
  const targetParams = (resumed && validateView(resumed.view, resumed.params || {})) ? (resumed.params || {}) : {};
  navigate(targetView, targetParams, { skipTransition: true });
  clearInterval(_bgRefreshTimer);
  _bgRefreshTimer = setInterval(backgroundRefreshClients, 60000);
  return true;
}

// Maps a ?ssoError=<code> query param (set by api/auth-microsoft.js's callback step)
// to what's actually shown on the login page. Codes are deliberately
// generic/safe — the real detail is server-side only in Vercel's logs,
// same L-1 "don't leak internal error detail" pattern as password login.
// Every known code gets its own message; anything unrecognized still shows
// the raw code in parentheses so a failure is diagnosable from the screen
// alone, without needing to go digging through Vercel logs first.
function ssoErrorMessage(code) {
  if (code === 'not_authorized') return "This Microsoft account isn't registered in Kora. Contact your admin to be added, or sign in with a username/password.";
  if (code === 'state_invalid') return 'Sign-in session expired or invalid. Please try again.';
  if (code === 'no_email' || code === 'graph_failed') return "Couldn't read your Microsoft account's email. Contact your admin.";
  if (code === 'not_configured') return 'Microsoft sign-in is not set up yet (missing server config). Use your username and password.';
  if (code === 'exchange_failed') return 'Microsoft rejected the sign-in request — check the Azure client ID / client secret / tenant ID set in Vercel. Use your username and password for now.';
  if (code === 'lookup_failed') return "Couldn't check your account against Kora's user list (database error). Use your username and password for now.";
  if (code === 'no_code') return 'Microsoft sign-in was interrupted before completing. Please try again.';
  if (code === 'unexpected_error') return 'Something went wrong during Microsoft sign-in. Use your username and password for now.';
  if (typeof code === 'string' && code.startsWith('msft_')) return `Microsoft sign-in was cancelled or denied (${code.slice(5)}).`;
  return `Microsoft sign-in failed${code ? ` (${code})` : ''}. Please try again, or use your username and password.`;
}

document.addEventListener('click', async e => {
  if (e.target.id === 'modal-overlay' && e.target === e.currentTarget) { if (S.modal?.busy) return; S.modal = null; render(); return; }
  if (e.target.id === 'cmdp-overlay') { S.cmdPaletteOpen = false; render(); return; }
  if (S.openExportMenu && !e.target.closest(`[data-export-menu="${S.openExportMenu}"]`)) { S.openExportMenu = null; render(); }
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act;
  if (act.startsWith('exp-') || act === 'open-import-integ' || act === 'open-import-ams' || act === 'open-import-impl') S.openExportMenu = null;

  if (act === 'toggle-export-menu') { S.openExportMenu = S.openExportMenu === el.dataset.menuId ? null : el.dataset.menuId; render(); return; }

  if (act === 'login') {
    const u = document.getElementById('lu')?.value.trim(), p = document.getElementById('lp')?.value;
    const errEl = document.getElementById('lerr');
    if (!u || !p) { if (errEl) { errEl.textContent = 'Enter username and password'; errEl.classList.remove('hidden'); } return; }
    setBtnBusy(el, 'Signing in…');
    if (errEl) errEl.classList.add('hidden');
    S.authMessage = null;
    let ld;
    try {
      const lr = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
      ld = await lr.json();
      if (!lr.ok) { clearBtnBusy(el); const e2 = document.getElementById('lerr'); if (e2) { e2.textContent = ld.error || 'Login failed'; e2.classList.remove('hidden'); } return; }
    } catch (err) { clearBtnBusy(el); const e2 = document.getElementById('lerr'); if (e2) { e2.textContent = 'Connection failed. Check repo/env setup.'; e2.classList.remove('hidden'); } return; }
    await finishLogin(ld, document.getElementById('lerr'));
    return;
  }
  if (act === 'logout') { clearInterval(_bgRefreshTimer); _bgRefreshTimer = null; clearSession(); S.user = null; S.clients = []; S.users = []; S.usersForDropdown = []; S.shas = { clients: null, users: null }; S.sessionToken = null; S.viewAsRole = null; S.lastActiveMap = {}; S.lastActiveFetched = false; S.bulkUserMode = false; S.bulkUserSelected = new Set(); navigate('login', {}, { skipTransition: true }); return; }
  if (act === 'nav-dashboard') { S.mobileSidebarOpen = false; navigate('dashboard'); return; }
  if (act === 'nav-clients') { S.mobileSidebarOpen = false; navigate('clients'); return; }
  if (act === 'nav-impl') { S.mobileSidebarOpen = false; navigate('impl-clients'); return; }
  if (act === 'nav-ams') { S.mobileSidebarOpen = false; navigate('ams-clients'); return; }
  if (act === 'nav-admin') { if (can('admin')) { S.mobileSidebarOpen = false; navigate('admin'); } return; }
  if (act === 'toggle-sidebar') {
    if (window.innerWidth < 768) {
      S.mobileSidebarOpen = !S.mobileSidebarOpen;
    } else {
      S.sidebarCollapsed = !S.sidebarCollapsed;
      try { localStorage.setItem('itk_sb_collapsed', S.sidebarCollapsed ? '1' : '0'); } catch (e) { }
    }
    render();
    return;
  }
  if (act === 'toggle-dark') { S.darkMode = !S.darkMode; document.documentElement.classList.toggle('dark', S.darkMode); try { localStorage.setItem('itk_dark', S.darkMode ? '1' : '0'); } catch (e) { } render(); return; }
  if (act === 'toggle-pwd') {
    const input = document.getElementById(el.dataset.target);
    if (!input) return;
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    const openIcon = el.querySelector('[data-eye-open]'), closedIcon = el.querySelector('[data-eye-closed]');
    if (openIcon) openIcon.style.display = showing ? '' : 'none';
    if (closedIcon) closedIcon.style.display = showing ? 'none' : '';
    el.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    return;
  }
  if (act === 'close-shortcuts-help') { S.shortcutsHelpOpen = false; render(); return; }
  if (act === 'cmdp-open') { S.cmdPaletteOpen = true; S.cmdQuery = ''; S.cmdSelectedIdx = 0; render(); setTimeout(() => document.getElementById('cmdp-input')?.focus(), 30); return; }
  if (act === 'cmdp-go') {
    const r = _cmdpResults[Number(el.dataset.idx)]; if (!r) return;
    S.cmdPaletteOpen = false; navigate(r.view, r.params); return;
  }
  if (act === 'open-client') { navigate('client-detail', { clientId: el.dataset.id }); return; }
  if (act === 'open-integ') { navigate('integ-detail', { clientId: el.dataset.cid, integId: el.dataset.iid }); return; }
  if (act === 'open-impl-client') { navigate('impl-client-detail', { clientId: el.dataset.id }); return; }
  if (act === 'open-ams-client') { navigate('ams-client-detail', { clientId: el.dataset.id }); return; }
  if (act === 'filter') { S.filter = el.dataset.filter; render(); return; }
  if (act === 'sort') { const k = el.dataset.key; if (S.sort.key === k) { S.sort.dir = S.sort.dir === 'asc' ? 'desc' : 'asc'; } else { S.sort = { key: k, dir: 'asc' }; } render(); return; }
  if (act === 'sort-dash-attn') { const k = el.dataset.key; if (S.dashAttnSort.key === k) { S.dashAttnSort.dir = S.dashAttnSort.dir === 'asc' ? 'desc' : 'asc'; } else { S.dashAttnSort = { key: k, dir: 'asc' }; } render(); return; }
  if (act === 'dash-assignee-filter') { S.dashAssigneeFilter = el.dataset.key; render(); return; }
  if (act === 'dash-crit-filter') { S.dashCritFilter = el.dataset.key; render(); return; }
  if (act === 'sort-dash-assignee') { const k = el.dataset.key; if (S.dashAssigneeSort.key === k) { S.dashAssigneeSort.dir = S.dashAssigneeSort.dir === 'asc' ? 'desc' : 'asc'; } else { S.dashAssigneeSort = { key: k, dir: 'desc' }; } render(); return; }
  if (act === 'dash-assignee-toggle') { const key = el.dataset.key; if (S.dashAssigneeExpanded.has(key)) S.dashAssigneeExpanded.delete(key); else S.dashAssigneeExpanded.add(key); render(); return; }
  if (act === 'dash-capacity-toggle') { const key = el.dataset.key; if (S.dashCapacityExpanded.has(key)) S.dashCapacityExpanded.delete(key); else S.dashCapacityExpanded.add(key); render(); return; }
  if (act === 'sort-dash-client') { const k = el.dataset.key; if (S.dashClientSort.key === k) { S.dashClientSort.dir = S.dashClientSort.dir === 'asc' ? 'desc' : 'asc'; } else { S.dashClientSort = { key: k, dir: 'asc' }; } render(); return; }
  if (act === 'admin-tab') { S.adminTab = el.dataset.tab; S.adminSearch = ''; render(); if (el.dataset.tab === 'audit' && !S.auditLoaded) loadAuditLog(); if (el.dataset.tab === 'users' && !S.lastActiveFetched) loadLastActive(); return; }
  if (act === 'audit-apply') { S.auditPage = 0; loadAuditLog(); return; }
  if (act === 'audit-clear') { S.auditFrom = ''; S.auditTo = ''; S.auditUser = ''; S.auditSearch = ''; S.auditPage = 0; loadAuditLog(); return; }
  if (act === 'audit-preset') {
    const key = el.dataset.key;
    S.auditFrom = ''; S.auditTo = ''; S.auditUser = ''; S.auditSearch = '';
    if (key === '24h') S.auditFrom = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    else if (key === 'deletes') S.auditSearch = 'delete';
    else if (key === 'logins') S.auditSearch = 'login';
    S.auditPage = 0; loadAuditLog(); return;
  }
  if (act === 'audit-prev') { if (S.auditPage > 0) { S.auditPage--; loadAuditLog(); } return; }
  if (act === 'audit-next') { S.auditPage++; loadAuditLog(); return; }
  if (act === 'audit-export') { setBtnBusy(el, 'Exporting…'); try { const d = await fetchAuditLog({ export: true }); exportAuditExcel(d.rows); } catch (e) { showToast(e.message || 'Export failed', 'error'); } finally { clearBtnBusy(el); } return; }
  if (act === 'exp-pptx') { setBtnBusy(el, 'Generating…'); try { await exportPptx(el.dataset.cid); } finally { clearBtnBusy(el); } return; }
  if (act === 'exp-pdf') { setBtnBusy(el, 'Generating…'); try { await exportPdf(el.dataset.cid); } finally { clearBtnBusy(el); } return; }
  if (act === 'open-client-email') {
    if (!can('editor')) return;
    const c = S.clients.find(x => x.id === el.dataset.cid); if (!c) return;
    S.openExportMenu = null;
    // Open the modal immediately with a sensible default subject/body, then
    // generate the PDF in the background and mark it ready — so the person can
    // start composing while the (potentially slow) PDF renders.
    S.modal = {
      type: 'client-email', cid: c.id, clientName: c.name,
      to: '', cc: '',
      subject: `Integration Status Report — ${c.name}`,
      bodyText: `Hi,\n\nPlease find attached the latest integration status report for ${c.name}.\n\nDo let us know if you have any questions.\n\nBest regards,\nKognoz Consulting`,
      attachmentReady: false, attachmentBase64: null, attachmentName: null,
    };
    render();
    setTimeout(() => {
      const result = exportPdf(c.id, { returnDoc: true });
      if (result && S.modal && S.modal.type === 'client-email' && S.modal.cid === c.id) {
        S.modal.attachmentBase64 = result.base64;
        S.modal.attachmentName = result.filename;
        S.modal.attachmentReady = true;
        render();
      } else if (!result) {
        showToast('Could not generate the PDF attachment', 'error');
      }
    }, 50);
    setTimeout(() => document.getElementById('ce-to')?.focus(), 80);
    return;
  }
  if (act === 'exp-impl-pdf') { setBtnBusy(el, 'Generating…'); try { exportImplPdf(el.dataset.cid); } finally { clearBtnBusy(el); } return; }
  if (act === 'exp-ams-invoice') { if (!can('admin')) return; setBtnBusy(el, 'Generating…'); try { exportAmsInvoicePdf(el.dataset.cid); } finally { clearBtnBusy(el); } return; }
  if (act === 'copy-update') { try { await navigator.clipboard.writeText(el.dataset.text); showToast('Copied ✓'); } catch (e) { showToast('Copy failed', 'error'); } return; }
  if (act === 'edit-timeline') { if (!can('editor')) return; S.editingTimelineId = el.dataset.tid; render(); setTimeout(() => { const ta = document.getElementById(`edit-tl-${el.dataset.tid}`); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }, 50); return; }
  if (act === 'cancel-edit-timeline') { S.editingTimelineId = null; render(); return; }
  if (act === 'toggle-history') { const tid = el.dataset.tid; if (S.expandedHistory.has(tid)) S.expandedHistory.delete(tid); else S.expandedHistory.add(tid); render(); return; }
  if (act === 'modal-open') {
    if (el.dataset.modal === 'dashboard-layout') {
      const isAdmin = can('admin');
      const saved = getDashLayout();
      const tileOrder = saved.filter(t => {
        const reg = DASH_TILE_REGISTRY.find(r => r.id === t.id);
        return reg && (!reg.adminOnly || isAdmin);
      }).map(t => ({ ...t, label: DASH_TILE_REGISTRY.find(r => r.id === t.id).label }));
      S.modal = { type: 'dashboard-layout', tileOrder };
      render(); return;
    }
    S.modal = { ...el.dataset, type: el.dataset.modal, log: [], busy: false, done: false, offset: 0, totalProcessed: 0, totalFailed: 0 };
    render(); setTimeout(() => document.getElementById('m1')?.focus(), 50); return;
  }
  if (act === 'open-impl-phase') {
    navigate('impl-phase-detail', { clientId: el.dataset.cid, moduleId: el.dataset.mid, phase: el.dataset.phase }); return;
  }
  if (act === 'modal-close') { if (S.modal?.busy) return; S.modal = null; render(); return; }

  if (act === 'mark-complete') {
    if (!can('editor')) return;
    const cid = el.dataset.cid, iid = el.dataset.iid;
    const c = S.clients.find(x => x.id === cid); const i = c?.integrations.find(x => x.id === iid); if (!i) return;
    const prevStatus = i.status; i.status = 'Completed';
    const entry = { id: uid(), date: todayStr(), update: 'Marked as Completed.', addedBy: S.user.name, addedAt: new Date().toISOString() };
    i.timeline.unshift(entry);
    setBtnBusy(el, 'Saving…');
    try { await saveClients(`Complete: ${i.name}`, [cid]); showToast('Marked complete ✓'); navigate('integ-detail', { clientId: cid, integId: iid }); }
    catch (err) { i.status = prevStatus; i.timeline.shift(); showToast('Failed: ' + err.message, 'error'); render(); }
    return;
  }
  if (act === 'save-integ') {
    if (!can('editor')) return;
    const cid = el.dataset.cid, iid = el.dataset.iid;
    const c = S.clients.find(x => x.id === cid); const i = c?.integrations.find(x => x.id === iid); if (!i) return;
    const prev = { ...i };
    i.status = document.getElementById('f-status')?.value || i.status;
    i.assignee = document.getElementById('f-assignee')?.value?.trim() || i.assignee;
    i.dueDate = document.getElementById('f-due')?.value || '';
    i.description = document.getElementById('f-desc')?.value?.trim() || '';
    i.nextAction = document.getElementById('f-next')?.value?.trim() || '';
    setBtnBusy(el, 'Saving…');
    try { await saveClients(`Update ${i.name}`, [cid]); showToast('Saved ✓'); navigate('integ-detail', { clientId: cid, integId: iid }); }
    catch (err) { Object.assign(i, prev); showToast('Save failed: ' + err.message, 'error'); clearBtnBusy(el); }
    return;
  }
  if (act === 'add-timeline') {
    if (!can('editor')) return;
    const cid = el.dataset.cid, iid = el.dataset.iid;
    const text = document.getElementById('tl-input')?.value.trim();
    if (!text) { showToast('Enter an update', 'error'); return; }
    const c = S.clients.find(x => x.id === cid); const i = c?.integrations.find(x => x.id === iid); if (!i) return;
    const attachUrl = document.getElementById('tl-attach-url')?.value.trim() || '';
    const attachLabel = document.getElementById('tl-attach-label')?.value.trim() || '';
    const attachMime = document.getElementById('tl-attach-mimetype')?.value || '';
    const attachName = document.getElementById('tl-attach-filename')?.value || '';
    const attachment = attachUrl ? { label: attachLabel || attachName || 'Attachment', url: attachUrl, fileName: attachName || attachLabel || 'Attachment', mimeType: attachMime } : undefined;
    const entry = { id: uid(), date: todayStr(), update: text, addedBy: S.user.name, addedAt: new Date().toISOString(), ...(attachment ? { attachment } : {}) };
    i.timeline.unshift(entry); setBtnBusy(el, 'Saving…');
    try { await saveClients(`Timeline: ${i.name}`, [cid]); showToast('Update added ✓'); navigate('integ-detail', { clientId: cid, integId: iid }); }
    catch (err) { i.timeline.shift(); showToast('Failed: ' + err.message, 'error'); clearBtnBusy(el); }
    return;
  }
  if (act === 'save-edit-timeline') {
    if (!can('editor')) return;
    const cid = el.dataset.cid, iid = el.dataset.iid, tid = el.dataset.tid;
    const c = S.clients.find(x => x.id === cid); const i = c?.integrations.find(x => x.id === iid); if (!i) return;
    const idx = i.timeline.findIndex(x => x.id === tid); if (idx < 0) return;
    const newText = document.getElementById(`edit-tl-${tid}`)?.value.trim();
    if (!newText) { showToast('Update cannot be empty', 'error'); return; }
    const attachUrl = document.getElementById(`etl-url-${tid}`)?.value.trim() || '';
    const attachLabel = document.getElementById(`etl-label-${tid}`)?.value.trim() || '';
    const attachMime = document.getElementById(`etl-mimetype-${tid}`)?.value || '';
    const attachName = document.getElementById(`etl-filename-${tid}`)?.value || '';
    const attachment = attachUrl ? { label: attachLabel || attachName || 'Attachment', url: attachUrl, fileName: attachName || attachLabel || 'Attachment', mimeType: attachMime } : undefined;
    const original = i.timeline[idx];
    const textChanged = newText !== original.update;
    if (!textChanged && attachment?.url === original.attachment?.url) { S.editingTimelineId = null; render(); return; }
    const snapshot = JSON.parse(JSON.stringify(original));
    const updated = {
      ...original, ...(attachment !== undefined ? { attachment } : { attachment: original.attachment }),
      ...(textChanged ? { edits: [...(original.edits || []), { text: original.update, editedAt: new Date().toISOString(), editedBy: S.user.name }], update: newText, lastEditedAt: new Date().toISOString(), lastEditedBy: S.user.name } : {})
    };
    i.timeline[idx] = updated;
    setBtnBusy(el, 'Saving…');
    try { await saveClients(`Edit timeline: ${i.name}`, [cid]); S.editingTimelineId = null; showToast('Update edited ✓'); navigate('integ-detail', { clientId: cid, integId: iid }); }
    catch (err) { i.timeline[idx] = snapshot; showToast('Failed: ' + err.message, 'error'); clearBtnBusy(el); }
    return;
  }
  if (act === 'save-impl-phase') {
    if (!can('editor')) return;
    const cid = el.dataset.cid, mid = el.dataset.mid, phaseName = el.dataset.phase;
    const c = S.clients.find(x => x.id === cid); const mod = (c?.modules || []).find(x => x.id === mid); if (!mod) return;
    const idx = mod.phases.findIndex(x => x.name === phaseName);
    const ph = idx >= 0 ? mod.phases[idx] : { name: phaseName, status: 'Not Started', startDate: '', targetDate: '', updates: [] };
    const prev = { ...ph };
    ph.status = document.getElementById('ip-status')?.value || ph.status;
    ph.assignee = document.getElementById('ip-assignee')?.value?.trim() || '';
    ph.startDate = document.getElementById('ip-start')?.value || '';
    ph.targetDate = document.getElementById('ip-target')?.value || '';
    ph.currentActivity = document.getElementById('ip-activity')?.value?.trim() || '';
    ph.nextAction = document.getElementById('ip-next')?.value?.trim() || '';
    // Signoff enforcement
    const isSignoff = SIGNOFF_PHASES.includes(phaseName);
    const hasAttachment = (ph.updates || []).some(u => u.attachment?.url);
    if (isSignoff && ph.status === 'Completed' && !hasAttachment) {
      showToast(`${phaseName} requires a document attached to an update. Upload a file before marking complete.`, 'error');
      return;
    }
    if (!isSignoff && ph.status === 'Completed' && !hasAttachment) {
      showToast('Tip: Consider attaching a reference document to this phase update.', 'warn');
    }
    if (idx >= 0) mod.phases[idx] = ph; else mod.phases.push(ph);
    setBtnBusy(el, 'Saving…');
    try { await saveClients(`Update ${phaseName}: ${mod.name}`, [cid]); showToast('Saved ✓'); navigate('impl-phase-detail', { clientId: cid, moduleId: mid, phase: phaseName }); }
    catch (err) { if (idx >= 0) mod.phases[idx] = prev; else mod.phases.pop(); showToast('Save failed: ' + err.message, 'error'); clearBtnBusy(el); }
    return;
  }
  if (act === 'add-impl-update') {
    if (!can('editor')) return;
    const cid = el.dataset.cid, mid = el.dataset.mid, phaseName = el.dataset.phase;
    const text = document.getElementById('ip-update-input')?.value.trim();
    if (!text) { showToast('Enter an update', 'error'); return; }
    const c = S.clients.find(x => x.id === cid); const mod = (c?.modules || []).find(x => x.id === mid); if (!mod) return;
    const ph = mod.phases.find(x => x.name === phaseName); if (!ph) return;
    if (!ph.updates) ph.updates = [];
    const attachUrl = document.getElementById('ip-attach-url')?.value.trim() || '';
    const attachLabel = document.getElementById('ip-attach-label')?.value.trim() || '';
    const attachMime = document.getElementById('ip-attach-mimetype')?.value || '';
    const attachName = document.getElementById('ip-attach-filename')?.value || '';
    const attachment = attachUrl ? { label: attachLabel || attachName || 'Attachment', url: attachUrl, fileName: attachName || attachLabel || 'Attachment', mimeType: attachMime } : undefined;
    const entry = { id: uid(), date: todayStr(), update: text, addedBy: S.user.name, addedAt: new Date().toISOString(), ...(attachment ? { attachment } : {}) };
    ph.updates.unshift(entry); setBtnBusy(el, 'Saving…');
    try { await saveClients(`Update ${phaseName}: ${mod.name}`, [cid]); showToast('Update added ✓'); navigate('impl-phase-detail', { clientId: cid, moduleId: mid, phase: phaseName }); }
    catch (err) { ph.updates.shift(); showToast('Failed: ' + err.message, 'error'); clearBtnBusy(el); }
    return;
  }
  if (act === 'save-edit-impl-update') {
    if (!can('editor')) return;
    const cid = el.dataset.cid, mid = el.dataset.mid, phaseName = el.dataset.phase, tid = el.dataset.tid;
    const c = S.clients.find(x => x.id === cid); const mod = (c?.modules || []).find(x => x.id === mid); if (!mod) return;
    const ph = mod.phases.find(x => x.name === phaseName); if (!ph || !ph.updates) return;
    const idx = ph.updates.findIndex(x => x.id === tid); if (idx < 0) return;
    const newText = document.getElementById(`edit-tl-${tid}`)?.value.trim();
    if (!newText) { showToast('Update cannot be empty', 'error'); return; }
    const attachUrl = document.getElementById(`eat-url-${tid}`)?.value.trim() || '';
    const attachLabel = document.getElementById(`eat-label-${tid}`)?.value.trim() || '';
    const attachMime = document.getElementById(`eat-mimetype-${tid}`)?.value || '';
    const attachName = document.getElementById(`eat-filename-${tid}`)?.value || '';
    const attachment = attachUrl ? { label: attachLabel || attachName || 'Attachment', url: attachUrl, fileName: attachName || attachLabel || 'Attachment', mimeType: attachMime } : undefined;
    const original = ph.updates[idx];
    const snapshot = JSON.parse(JSON.stringify(original));
    const textChanged = newText !== original.update;
    const updated = {
      ...original, ...(attachment !== undefined ? { attachment } : { attachment: original.attachment }),
      ...(textChanged ? { edits: [...(original.edits || []), { text: original.update, editedAt: new Date().toISOString(), editedBy: S.user.name }], update: newText, lastEditedAt: new Date().toISOString(), lastEditedBy: S.user.name } : {})
    };
    ph.updates[idx] = updated; setBtnBusy(el, 'Saving…');
    try { await saveClients(`Edit update: ${phaseName}, ${mod.name}`, [cid]); S.editingTimelineId = null; showToast('Update saved ✓'); navigate('impl-phase-detail', { clientId: cid, moduleId: mid, phase: phaseName }); }
    catch (err) { ph.updates[idx] = snapshot; showToast('Failed: ' + err.message, 'error'); clearBtnBusy(el); }
    return;
  }
  if (act === 'toggle-ams-history') {
    const eid = el.dataset.eid;
    if (S.expandedAmsHistory.has(eid)) S.expandedAmsHistory.delete(eid); else S.expandedAmsHistory.add(eid);
    render(); return;
  }
  if (act === 'select-ams-entry') { S.selectedAmsEntryId = el.dataset.eid; render(); return; }
  if (act === 'select-integ') { S.selectedIntegId = el.dataset.iid; render(); return; }
  // ── Milestone handlers ──
  if (act === 'add-milestone-btn') {
    if (!can('editor')) return;
    S.modal = { type: 'add-milestone', cid: el.dataset.cid, iid: el.dataset.iid }; render(); setTimeout(() => document.getElementById('ms-name')?.focus(), 50); return;
  }
  if (act === 'edit-milestone-btn') {
    if (!can('editor')) return;
    const c = S.clients.find(x => x.id === el.dataset.cid); const i = c?.integrations.find(x => x.id === el.dataset.iid); const ms = (i?.milestones || []).find(x => x.id === el.dataset.mid); if (!ms) return;
    S.modal = { type: 'edit-milestone', cid: el.dataset.cid, iid: el.dataset.iid, mid: ms.id, msName: ms.name, msDue: ms.dueDate || '', msStatus: ms.status, msOwner: ms.owner || '', msNotes: ms.notes || '' }; render(); setTimeout(() => document.getElementById('ms-name')?.focus(), 50); return;
  }
  if (act === 'delete-milestone') {
    if (!can('admin')) return;
    const c = S.clients.find(x => x.id === el.dataset.cid); const i = c?.integrations.find(x => x.id === el.dataset.iid); const ms = (i?.milestones || []).find(x => x.id === el.dataset.mid); if (!ms) return;
    S.modal = { type: 'confirm', msg: `Delete milestone "${ms.name}"? Cannot be undone.`, _act: 'delete-milestone', _cid: el.dataset.cid, _iid: el.dataset.iid, _mid: ms.id }; render(); return;
  }
  // ── Integrations: "Mine" quick filter, copy-link, reactions, bulk reassign/status ──
  if (act === 'toggle-integ-mine') { S.integMineOnly = !S.integMineOnly; render(); return; }
  if (act === 'copy-link') { try { await navigator.clipboard.writeText(el.dataset.url); showToast('Link copied ✓'); } catch (e) { showToast('Copy failed', 'error'); } return; }

  // ─── Pomodoro Focus Timer ───────────────────────────────────────
  if (act === 'pomodoro-mode') { S.pomodoroModePref = el.dataset.mode; render(); return; }
  if (act === 'pomodoro-start') {
    const mode = S.pomodoroModePref === 'pomodoro' ? 'pomodoro' : 'simple';
    const durSel = document.getElementById('pomodoro-dur');
    const mins = durSel ? parseInt(durSel.value, 10) : 25;
    pomodoroStart(el.dataset.cid, el.dataset.iid, mode, mins);
    return;
  }
  if (act === 'pomodoro-reset') { pomodoroStop(); render(); return; }
  if (act === 'pomodoro-skip-later') { pomodoroStop(); render(); return; }
  if (act === 'pomodoro-choice-post' || act === 'pomodoro-choice-details') {
    const targetId = act === 'pomodoro-choice-post' ? 'tl-input' : 'f-next';
    pomodoroStop();
    render();
    setTimeout(() => {
      const field = document.getElementById(targetId);
      if (!field) return;
      field.scrollIntoView({ behavior: 'smooth', block: 'center' });
      field.focus();
      const card = field.closest('.bg-white');
      if (card) { card.classList.add('pomodoro-highlight'); setTimeout(() => card.classList.remove('pomodoro-highlight'), 3300); }
    }, 50);
    return;
  }
  if (act === 'toggle-reaction') {
    const c = S.clients.find(x => x.id === el.dataset.cid); const i = c?.integrations.find(x => x.id === el.dataset.iid); if (!i) return;
    const t = (i.timeline || []).find(x => x.id === el.dataset.tid); if (!t) return;
    if (!t.reactions) t.reactions = [];
    const me = S.user?.name;
    const had = t.reactions.includes(me);
    if (had) t.reactions = t.reactions.filter(n => n !== me); else t.reactions.push(me);
    render();
    try { await saveClients(`React: ${i.name}`, [c.id]); }
    catch (err) { if (had) t.reactions.push(me); else t.reactions = t.reactions.filter(n => n !== me); showToast('Failed: ' + err.message, 'error'); render(); }
    return;
  }
  if (act === 'bulk-reassign-integ') {
    if (!can('admin')) return;
    const cid = el.dataset.cid; const c = S.clients.find(x => x.id === cid); if (!c || !S.bulkIntegSelected.size) return;
    const val = document.getElementById('bulk-reassign-select')?.value || '';
    const ids = new Set(S.bulkIntegSelected);
    const prev = new Map(c.integrations.filter(i => ids.has(i.id)).map(i => [i.id, i.assignee]));
    c.integrations.forEach(i => { if (ids.has(i.id)) i.assignee = val; });
    setBtnBusy(el, 'Reassigning…');
    try {
      await saveClients(`Bulk reassign ${ids.size} integration${ids.size !== 1 ? 's' : ''}: ${c.name}`, [cid]);
      S.bulkIntegMode = false; S.bulkIntegCid = null; S.bulkIntegSelected = new Set();
      showToast(`${ids.size} integration${ids.size !== 1 ? 's' : ''} reassigned ✓`);
      navigate('client-detail', { clientId: cid });
    } catch (err) { c.integrations.forEach(i => { if (prev.has(i.id)) i.assignee = prev.get(i.id); }); showToast('Failed: ' + err.message, 'error'); clearBtnBusy(el); }
    return;
  }
  if (act === 'bulk-status-integ') {
    if (!can('admin')) return;
    const cid = el.dataset.cid; const c = S.clients.find(x => x.id === cid); if (!c || !S.bulkIntegSelected.size) return;
    const val = document.getElementById('bulk-status-select')?.value; if (!val) return;
    const ids = new Set(S.bulkIntegSelected);
    const prev = new Map(c.integrations.filter(i => ids.has(i.id)).map(i => [i.id, i.status]));
    c.integrations.forEach(i => { if (ids.has(i.id)) i.status = val; });
    setBtnBusy(el, 'Saving…');
    try {
      await saveClients(`Bulk status ${ids.size} integration${ids.size !== 1 ? 's' : ''} → ${val}: ${c.name}`, [cid]);
      S.bulkIntegMode = false; S.bulkIntegCid = null; S.bulkIntegSelected = new Set();
      showToast(`${ids.size} integration${ids.size !== 1 ? 's' : ''} updated ✓`);
      navigate('client-detail', { clientId: cid });
    } catch (err) { c.integrations.forEach(i => { if (prev.has(i.id)) i.status = prev.get(i.id); }); showToast('Failed: ' + err.message, 'error'); clearBtnBusy(el); }
    return;
  }
  // ── Excel export handlers ──
  if (act === 'exp-excel') { setBtnBusy(el, 'Exporting…'); try { exportExcel(el.dataset.etype, el.dataset.cid); } finally { clearBtnBusy(el); } return; }
  if (act === 'exp-admin-excel') { setBtnBusy(el, 'Exporting…'); try { exportAdminTableExcel(el.dataset.domain); } finally { clearBtnBusy(el); } return; }
  // ── Bulk CSV import handlers ──
  if (act === 'open-import-ams') {
    S.modal = { type: 'import-ams-entries', cid: el.dataset.cid }; render(); return;
  }
  if (act === 'open-import-integ') {
    S.modal = { type: 'import-integrations', cid: el.dataset.cid }; render(); return;
  }
  if (act === 'download-ams-template') {
    const csv = 'date_raised,due_date,raised_by,module,project,description,type,query_level,entry_status,mode_of_support,hours\n2026-07-15,,Yashwanth K,Payroll,HDFC Bank,Issue with payroll run,Bug Fix,L2 - Medium,Open,Online / Remote,2.5\n';
    const a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv); a.download = 'ams_entries_template.csv'; document.body.appendChild(a); a.click(); document.body.removeChild(a); return;
  }
  if (act === 'download-integ-template') {
    const csv = 'name,status,assignee,due_date,description,next_action\nSAP Payroll Sync,In Progress,Yashwanth K,2026-08-15,SAP to Darwinbox payroll integration,Finish API mapping\n';
    const a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv); a.download = 'integrations_template.csv'; document.body.appendChild(a); a.click(); document.body.removeChild(a); return;
  }
  if (act === 'preview-ams-csv') {
    const csv = document.getElementById('bulk-csv')?.value || '';
    if (!csv.trim()) { showToast('Paste CSV first', 'error'); return; }
    const rows = parseAmsEntriesCsv(csv);
    S.modal = { ...S.modal, csvRows: rows, csvText: csv }; render(); return;
  }
  if (act === 'preview-integ-csv') {
    const csv = document.getElementById('bulk-csv')?.value || '';
    if (!csv.trim()) { showToast('Paste CSV first', 'error'); return; }
    const c = S.clients.find(x => x.id === S.modal?.cid);
    const rows = parseIntegrationsCsv(csv, c?.integrations || []);
    S.modal = { ...S.modal, csvRows: rows, csvText: csv }; render(); return;
  }
  // ── Portfolio export ──
  if (act === 'portfolio-export') {
    S.modal = { type: 'portfolio-export' }; render(); return;
  }
  if (act === 'clear-attach') {
    // prefix is 'ip'/'tl' for add-forms (real id prefix is actually
    // 'ip-attach'/'tl-attach' — historical naming) or 'eat'/'etl' for
    // edit-forms. Resolved generically so it works for all 4 attach forms,
    // not just the original Implementation ones.
    const prefix = el.dataset.prefix; const tid = el.dataset.tid || '';
    const base = (prefix === 'ip' || prefix === 'tl') ? `${prefix}-attach` : prefix;
    const uid_ = tid ? `${base}-url-${tid}` : `${base}-url`;
    const mid_ = tid ? `${base}-mimetype-${tid}` : `${base}-mimetype`;
    const nid_ = tid ? `${base}-filename-${tid}` : `${base}-filename`;
    const pid_ = tid ? `${base}-preview-${tid}` : `${base}-preview`;
    const urlEl = document.getElementById(uid_); const mEl = document.getElementById(mid_); const nEl = document.getElementById(nid_); const pEl = document.getElementById(pid_);
    if (urlEl) urlEl.value = ''; if (mEl) mEl.value = ''; if (nEl) nEl.value = '';
    if (pEl) { pEl.classList.add('hidden'); }
    return;
  }
  if (act === 'download-user-template') {
    const csv = 'username,full_name,role,email,password\nuser.one,User One,editor,user1@example.com,temp_pass_1\nuser.two,User Two,editor,user2@example.com,temp_pass_2\n';
    const a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv); a.download = 'integtrack_users_template.csv'; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    return;
  }
  if (act === 'preview-users-csv') {
    const csv = document.getElementById('bulk-csv')?.value || '';
    if (!csv.trim()) { showToast('Paste CSV content first', 'error'); return; }
    const rows = parseUsersCsv(csv);
    if (!rows.length) { showToast('No rows found in CSV', 'error'); return; }
    S.modal = { ...S.modal, csvRows: rows, csvText: csv }; render();
    return;
  }
  if (act === 'toggle-bulk-integ') {
    if (!can('admin')) return;
    const cid = el.dataset.cid;
    if (S.bulkIntegMode && S.bulkIntegCid === cid) {
      S.bulkIntegMode = false; S.bulkIntegCid = null; S.bulkIntegSelected = new Set();
    } else {
      S.bulkIntegMode = true; S.bulkIntegCid = cid; S.bulkIntegSelected = new Set();
    }
    render(); return;
  }
  if (act === 'toggle-bulk-integ-row') {
    if (!can('admin')) return;
    const iid = el.dataset.iid;
    if (S.bulkIntegSelected.has(iid)) S.bulkIntegSelected.delete(iid); else S.bulkIntegSelected.add(iid);
    render(); return;
  }
  if (act === 'toggle-bulk-integ-all') {
    if (!can('admin')) return;
    const cid = el.dataset.cid; const c = S.clients.find(x => x.id === cid); if (!c) return;
    const fl = S.filter === 'all' ? c.integrations : c.integrations.filter(i => i.status === S.filter);
    if (fl.length && fl.every(i => S.bulkIntegSelected.has(i.id))) { fl.forEach(i => S.bulkIntegSelected.delete(i.id)); }
    else { fl.forEach(i => S.bulkIntegSelected.add(i.id)); }
    render(); return;
  }
  if (act === 'bulk-delete-integ') {
    if (!can('admin')) return;
    const cid = el.dataset.cid; const c = S.clients.find(x => x.id === cid); if (!c || !S.bulkIntegSelected.size) return;
    const ids = new Set(S.bulkIntegSelected);
    const prev = JSON.parse(JSON.stringify(c.integrations));
    c.integrations = c.integrations.filter(i => !ids.has(i.id));
    setBtnBusy(el, 'Deleting…');
    try {
      await saveClients(`Bulk delete ${ids.size} integration${ids.size !== 1 ? 's' : ''}: ${c.name}`, [cid]);
      S.bulkIntegMode = false; S.bulkIntegCid = null; S.bulkIntegSelected = new Set();
      showToast(`${ids.size} integration${ids.size !== 1 ? 's' : ''} deleted ✓`);
      navigate('client-detail', { clientId: cid });
    } catch (err) { c.integrations = prev; showToast('Delete failed: ' + err.message, 'error'); clearBtnBusy(el); }
    return;
  }
  if (act === 'toggle-bulk-impl') {
    if (!can('admin')) return;
    const cid = el.dataset.cid;
    if (S.bulkImplMode && S.bulkImplCid === cid) {
      S.bulkImplMode = false; S.bulkImplCid = null; S.bulkSelected = new Set();
    } else {
      S.bulkImplMode = true; S.bulkImplCid = cid; S.bulkSelected = new Set();
    }
    render(); return;
  }
  if (act === 'toggle-bulk-phase') {
    if (!can('admin')) return;
    const key = `${el.dataset.mid}:${el.dataset.phase}`;
    if (S.bulkSelected.has(key)) S.bulkSelected.delete(key); else S.bulkSelected.add(key);
    render(); return;
  }
  if (act === 'bulk-mark-complete') {
    if (!can('admin')) return;
    const cid = el.dataset.cid;
    const c = S.clients.find(x => x.id === cid); if (!c || !S.bulkSelected.size) return;
    const now = new Date(); const dateStr = todayStr(); const isoStr = now.toISOString();
    const byUser = S.user.name;
    const changed = [];
    S.bulkSelected.forEach(key => {
      const [mid, phaseName] = key.split(/:(.+)/);
      const mod = (c.modules || []).find(x => x.id === mid); if (!mod) return;
      const idx = mod.phases.findIndex(x => x.name === phaseName);
      const ph = idx >= 0 ? mod.phases[idx] : { name: phaseName, status: 'Not Started', startDate: '', targetDate: '', updates: [] };
      if (!ph.updates) ph.updates = [];
      ph.status = 'Completed';
      ph.updates.unshift({ id: uid(), date: dateStr, update: `Marked complete via bulk action by ${byUser}.`, addedBy: byUser, addedAt: isoStr });
      if (idx >= 0) mod.phases[idx] = ph; else mod.phases.push(ph);
      changed.push(`${phaseName} (${mod.name})`);
    });
    setBtnBusy(el, `Saving…`);
    try {
      await saveClients(`Bulk complete: ${changed.length} phases — ${c.name}`, [cid]);
      S.bulkImplMode = false; S.bulkImplCid = null; S.bulkSelected = new Set();
      showToast(`${changed.length} phase${changed.length === 1 ? '' : 's'} marked complete ✓`);
      navigate('impl-client-detail', { clientId: cid });
    } catch (err) {
      showToast('Save failed: ' + err.message, 'error'); clearBtnBusy(el);
    }
    return;
  }
  if (act === 'delete-impl-module') {
    if (!can('admin')) return;
    const c = S.clients.find(x => x.id === el.dataset.cid); const m = (c?.modules || []).find(x => x.id === el.dataset.mid); if (!m) return;
    S.modal = { type: 'confirm', msg: `Delete module "${m.name}" and all its phase data? This cannot be undone.`, _act: 'delete-impl-module', _cid: c.id, _mid: m.id }; render(); return;
  }
  if (act === 'delete-timeline-entry') {
    if (!can('admin')) return;
    const c = S.clients.find(x => x.id === el.dataset.cid); const i = c?.integrations.find(x => x.id === el.dataset.iid); if (!i) return;
    S.modal = { type: 'confirm', msg: `Delete this update? This cannot be undone.`, _act: 'delete-timeline-entry', _cid: c.id, _iid: i.id, _tid: el.dataset.tid }; render(); return;
  }
  if (act === 'delete-impl-update') {
    if (!can('admin')) return;
    const c = S.clients.find(x => x.id === el.dataset.cid); const mod = (c?.modules || []).find(x => x.id === el.dataset.mid); if (!mod) return;
    const ph = mod.phases?.find(x => x.name === el.dataset.phase); if (!ph) return;
    S.modal = { type: 'confirm', msg: `Delete this update? This cannot be undone.`, _act: 'delete-impl-update', _cid: c.id, _mid: mod.id, _phase: el.dataset.phase, _tid: el.dataset.tid }; render(); return;
  }
  if (act === 'delete-ams-entry') {
    if (!can('admin')) return;
    const c = S.clients.find(x => x.id === el.dataset.cid); const e = c?.workLog?.find(x => x.id === el.dataset.eid); if (!e) return;
    S.modal = { type: 'confirm', msg: `Delete this entry (${fmtDate(entryDate(e))})? This cannot be undone.`, _act: 'delete-ams-entry', _cid: c.id, _eid: e.id }; render(); return;
  }
  if (act === 'edit-ams-entry') {
    if (!can('editor')) return;
    const c = S.clients.find(x => x.id === el.dataset.cid); const e = c?.workLog?.find(x => x.id === el.dataset.eid); if (!e) return;
    S.modal = {
      type: 'edit-ams-entry', cid: el.dataset.cid, eid: el.dataset.eid,
      dateRaised: entryDate(e), raisedBy: entryRaisedBy(e), module: e.module || '', project: e.project || '',
      description: e.description || '', etype: entryType(e), queryLevel: e.queryLevel || AMS_QUERY_LEVELS[0],
      dependencies: e.dependencies || '', entryStatus: e.entryStatus || 'Open', solution: e.solution || '',
      modeOfSupport: e.modeOfSupport || AMS_MODES[0], hours: e.hours || '',
      dueDate: e.dueDate || '', ragStatus: e.ragStatus || ''
    };
    render(); setTimeout(() => document.getElementById('ae-date')?.focus(), 50); return;
  }
  if (act === 'exp-ams-activity') { if (!can('admin')) return; setBtnBusy(el, 'Generating…'); try { exportAmsActivityPdf(el.dataset.cid); } finally { clearBtnBusy(el); } return; }
  if (act === 'delete-client') {
    if (!can('admin')) return; const c = S.clients.find(x => x.id === el.dataset.id); if (!c) return;
    const other = c.modules !== undefined || c.workLog !== undefined;
    S.modal = { type: 'confirm', msg: other ? `Remove "${c.name}" from Integrations (their ${c.integrations.length} integrations)? They'll stay in other sections. Cannot be undone.` : `Delete "${c.name}" entirely, including all ${c.integrations.length} integrations? Cannot be undone.`, _act: 'delete-client', _id: c.id }; render(); return;
  }
  if (act === 'delete-impl-client') {
    if (!can('admin')) return; const c = S.clients.find(x => x.id === el.dataset.id); if (!c) return;
    const other = c.integrations.length > 0 || c.workLog !== undefined;
    S.modal = { type: 'confirm', msg: other ? `Remove "${c.name}" from Implementations (their ${(c.modules || []).length} modules)? They'll stay in other sections. Cannot be undone.` : `Delete "${c.name}" entirely, including all ${(c.modules || []).length} modules? Cannot be undone.`, _act: 'delete-impl-client', _id: c.id }; render(); return;
  }
  if (act === 'delete-integ') {
    if (!can('admin')) return; const c = S.clients.find(x => x.id === el.dataset.cid); const i = c?.integrations.find(x => x.id === el.dataset.iid); if (!i) return;
    S.modal = { type: 'confirm', msg: `Delete "${i.name}"? Cannot be undone.`, _act: 'delete-integ', _cid: c.id, _iid: i.id }; render(); return;
  }
  if (act === 'delete-ams-client') {
    if (!can('admin')) return; const c = S.clients.find(x => x.id === el.dataset.id); if (!c) return;
    const other = c.integrations.length > 0 || c.modules !== undefined;
    S.modal = { type: 'confirm', msg: other ? `Remove "${c.name}" from AMS (all logged hours)? They'll stay in other sections. Cannot be undone.` : `Delete "${c.name}" entirely, including all logged hours? Cannot be undone.`, _act: 'delete-ams-client', _id: c.id }; render(); return;
  }
  if (act === 'edit-impl-client') {
    if (!can('editor')) return; const c = S.clients.find(x => x.id === el.dataset.id); if (!c) return;
    S.modal = { type: 'edit-impl-client', cid: c.id, masterAssignee: c.masterAssignee || '' }; render(); return;
  }
  if (act === 'edit-ams-client') {
    if (!can('admin')) return; const c = S.clients.find(x => x.id === el.dataset.id); if (!c) return;
    S.modal = { type: 'edit-ams-client', cid: c.id, description: c.description, manDayRate: c.manDayRate, totalAvailableHours: c.totalAvailableHours, currency: c.currency || 'INR' }; render(); return;
  }
  if (act === 'exec-undo') { execUndo(); return; }
  if (act === 'ams-month-prev' || act === 'ams-month-next') {
    let base = S.amsFrom ? new Date(S.amsFrom + 'T00:00:00') : new Date();
    if (isNaN(base.getTime())) base = new Date();
    const step = act === 'ams-month-next' ? 1 : -1;
    const target = new Date(base.getFullYear(), base.getMonth() + step, 1);
    const y = target.getFullYear();
    const m = target.getMonth();
    const lastDay = new Date(y, m + 1, 0).getDate();
    S.amsFrom = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    S.amsTo = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    S.amsQuick = '';
    render();
    return;
  }
  if (act === 'ams-quick') {
    const range = el.dataset.range; S.amsQuick = range;
    const now = new Date(); const y = now.getFullYear(), m = now.getMonth();
    if (range === 'this-month') { S.amsFrom = `${y}-${String(m + 1).padStart(2, '0')}-01`; S.amsTo = todayStr(); }
    else if (range === 'last-month') { const lmStart = new Date(y, m - 1, 1); const lmEnd = new Date(y, m, 0); S.amsFrom = lmStart.toISOString().slice(0, 10); S.amsTo = lmEnd.toISOString().slice(0, 10); }
    else if (range === 'this-quarter') { const q = Math.floor(m / 3); S.amsFrom = `${y}-${String(q * 3 + 1).padStart(2, '0')}-01`; S.amsTo = todayStr(); }
    else if (range === 'all-time') { S.amsFrom = ''; S.amsTo = ''; S.amsQuick = ''; }
    render(); return;
  }
  if (act === 'open-profile') {
    S.modal = { type: 'my-profile' }; render(); setTimeout(() => document.getElementById('pr-curr')?.focus(), 50); return;
  }
  if (act === 'open-digest-recipients') {
    if (!can('admin')) return;
    await fetchDigestRecipients();
    S.modal = { type: 'digest-recipients', emails: [...(S.digestRecipients.emails || [])] };
    render(); return;
  }
  if (act === 'digest-recipient-add') {
    S.modal = { ...S.modal, emails: [...(S.modal.emails || []), ''] }; render();
    setTimeout(() => { const inputs = document.querySelectorAll('.dr-email'); inputs[inputs.length - 1]?.focus(); }, 50); return;
  }
  if (act === 'digest-recipient-remove') {
    const idx = parseInt(el.dataset.idx, 10);
    S.modal = { ...S.modal, emails: (S.modal.emails || []).filter((_, i) => i !== idx) }; render(); return;
  }
  if (act === 'edit-user') {
    if (!can('admin')) return;
    const u = S.users.find(x => x.id === el.dataset.uid); if (!u) return;
    S.modal = { type: 'edit-user', uid: u.id, username: u.username, uname: u.name, email: u.email || '' };
    render(); setTimeout(() => document.getElementById('eu-name')?.focus(), 50); return;
  }
  if (act === 'delete-user') {
    if (!can('admin')) return; const u = S.users.find(x => x.id === el.dataset.uid); if (!u || u.id === S.user?.id) return;
    S.modal = { type: 'confirm', msg: `Delete user "${u.name}" (${u.username})?`, _act: 'delete-user', _uid: u.id }; render(); return;
  }
  if (act === 'force-logout-all') {
    if (!can('admin')) return;
    S.modal = { type: 'confirm', msg: 'Force logout every user, including yourself? Everyone will need to sign in again.', _act: 'force-logout-all' }; render(); return;
  }
  if (act === 'force-logout-user') {
    if (!can('admin')) return; const u = S.users.find(x => x.id === el.dataset.uid); if (!u) return;
    S.modal = { type: 'confirm', msg: `Force logout "${u.name}" (${u.username})? They'll need to sign in again.`, _act: 'force-logout-user', _uid: u.id }; render(); return;
  }
  if (act === 'clear-lockout') {
    if (!can('admin')) return; const u = S.users.find(x => x.id === el.dataset.uid); if (!u) return;
    S.modal = { type: 'confirm', msg: `Clear the login lockout for "${u.name}" (${u.username})? They'll be able to try logging in again immediately.`, _act: 'clear-lockout', _uid: u.id }; render(); return;
  }
  if (act === 'recompute-snapshot-now') {
    if (!can('admin')) return;
    setBtnBusy(el, 'Recomputing…');
    try { const d = await recomputeSnapshotNow(); showToast(`Snapshot recomputed ✓ (${d.captured} client${d.captured !== 1 ? 's' : ''})`); }
    catch (err) { showToast('Failed: ' + err.message, 'error'); }
    finally { clearBtnBusy(el); }
    return;
  }
  if (act === 'activate-view-as') {
    if (S.user?.role !== 'admin') return;
    const role = document.getElementById('view-as-select')?.value; if (!role) return;
    S.viewAsRole = role; showToast(`Previewing as ${role}`); navigate('dashboard'); return;
  }
  if (act === 'exit-view-as') { S.viewAsRole = null; showToast('Exited preview — back to your real access'); render(); return; }
  if (act === 'toggle-bulk-users') {
    if (!can('admin')) return;
    S.bulkUserMode = !S.bulkUserMode; S.bulkUserSelected = new Set(); render(); return;
  }
  if (act === 'toggle-bulk-user-row') {
    if (!can('admin')) return;
    const uid = el.dataset.uid;
    if (S.bulkUserSelected.has(uid)) S.bulkUserSelected.delete(uid); else S.bulkUserSelected.add(uid);
    render(); return;
  }
  if (act === 'bulk-role-apply') {
    if (!can('admin')) return;
    const role = document.getElementById('bulk-role-select')?.value; if (!role || !S.bulkUserSelected.size) return;
    const ids = [...S.bulkUserSelected];
    const prevRoles = new Map(ids.map(id => [id, S.users.find(u => u.id === id)?.role]));
    ids.forEach(id => { const u = S.users.find(x => x.id === id); if (u) u.role = role; });
    setBtnBusy(el, 'Saving…');
    try {
      await saveUsers(`Bulk role change: ${ids.length} user${ids.length !== 1 ? 's' : ''} → ${role}`, ids);
      S.bulkUserMode = false; S.bulkUserSelected = new Set();
      showToast(`${ids.length} user${ids.length !== 1 ? 's' : ''} updated ✓`); render();
    } catch (err) {
      ids.forEach(id => { const u = S.users.find(x => x.id === id); if (u) u.role = prevRoles.get(id); });
      showToast('Failed: ' + err.message, 'error'); clearBtnBusy(el);
    }
    return;
  }
  if (act === 'modal-confirm') {
    const m = S.modal; if (!m || m.busy) return;
    if (m.type === 'confirm') {
      S.modal = { ...m, busy: true }; render();
      if (m._act === 'delete-client') {
        const idx = S.clients.findIndex(x => x.id === m._id); if (idx < 0) { S.modal = null; render(); return; }
        const c = S.clients[idx]; const other = c.modules !== undefined || c.workLog !== undefined;
        const snapshot = JSON.parse(JSON.stringify(c));
        if (other) { c.integrations = []; } else { S.clients.splice(idx, 1); }
        try { await saveClients(`Remove Integration data: ${snapshot.name}`, [m._id]); S.modal = null; showToast(`${snapshot.name} removed from Integrations`); render(); }
        catch (err) { if (other) { c.integrations = snapshot.integrations; } else { S.clients.splice(idx, 0, snapshot); } S.modal = null; showToast('Failed: ' + err.message, 'error'); render(); }
      }
      else if (m._act === 'delete-integ') {
        const c = S.clients.find(x => x.id === m._cid); if (!c) { S.modal = null; render(); return; }
        const idx = c.integrations.findIndex(x => x.id === m._iid); if (idx < 0) { S.modal = null; render(); return; }
        const [rem] = c.integrations.splice(idx, 1);
        S.modal = null; navigate('client-detail', { clientId: m._cid });
        scheduleUndo(`"${rem.name}" deleted`, async () => { c.integrations.splice(idx, 0, rem); await saveClients(`Restore ${rem.name}`, [m._cid]); navigate('client-detail', { clientId: m._cid }); });
        try { await saveClients(`Delete ${rem.name}`, [m._cid]); }
        catch (err) { c.integrations.splice(idx, 0, rem); showToast('Failed: ' + err.message, 'error'); render(); }
      }
      else if (m._act === 'delete-user') {
        const idx = S.users.findIndex(x => x.id === m._uid); if (idx < 0) { S.modal = null; render(); return; }
        const [rem] = S.users.splice(idx, 1);
        S.modal = null; render();
        scheduleUndo(`${rem.name} removed`, async () => { S.users.splice(idx, 0, rem); await saveUsers(`Restore ${rem.username}`, [m._uid]); render(); });
        try { await saveUsers(`Delete ${rem.username}`, [m._uid]); }
        catch (err) { S.users.splice(idx, 0, rem); showToast('Failed: ' + err.message, 'error'); render(); }
      }
      else if (m._act === 'force-logout-all') {
        try {
          const r = await fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-token': S.sessionToken || '' }, body: JSON.stringify({ action: 'force-logout', scope: 'all' }) });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || 'Force logout failed');
          S.modal = null; showToast(`${d.affected} user${d.affected !== 1 ? 's' : ''} logged out — including you`);
          clearInterval(_bgRefreshTimer); _bgRefreshTimer = null; clearSession(); S.user = null; S.clients = []; S.users = []; S.usersForDropdown = []; S.shas = { clients: null, users: null }; S.sessionToken = null; navigate('login');
        } catch (err) { S.modal = null; showToast('Failed: ' + err.message, 'error'); render(); }
      }
      else if (m._act === 'force-logout-user') {
        try {
          const r = await fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-token': S.sessionToken || '' }, body: JSON.stringify({ action: 'force-logout', scope: 'user', userId: m._uid }) });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || 'Force logout failed');
          S.modal = null; showToast('User logged out ✓'); render();
        } catch (err) { S.modal = null; showToast('Failed: ' + err.message, 'error'); render(); }
      }
      else if (m._act === 'clear-lockout') {
        try {
          const r = await fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-token': S.sessionToken || '' }, body: JSON.stringify({ action: 'clear-lockout', userId: m._uid }) });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || 'Failed to clear lockout');
          const u = S.users.find(x => x.id === m._uid); if (u) { u.lockedUntil = null; u.failedAttempts = 0; u.lockoutLevel = 0; }
          S.modal = null; showToast('Lockout cleared ✓'); render();
        } catch (err) { S.modal = null; showToast('Failed: ' + err.message, 'error'); render(); }
      }
      else if (m._act === 'delete-impl-client') {
        const idx = S.clients.findIndex(x => x.id === m._id); if (idx < 0) { S.modal = null; render(); return; }
        const c = S.clients[idx]; const other = c.integrations.length > 0 || c.workLog !== undefined;
        const snapshot = JSON.parse(JSON.stringify(c));
        if (other) { delete c.modules; } else { S.clients.splice(idx, 1); }
        try { await saveClients(`Remove Implementation data: ${snapshot.name}`, [m._id]); S.modal = null; showToast(`${snapshot.name} removed from Implementations`); render(); }
        catch (err) { if (other) { c.modules = snapshot.modules; } else { S.clients.splice(idx, 0, snapshot); } S.modal = null; showToast('Failed: ' + err.message, 'error'); render(); }
      }
      else if (m._act === 'delete-ams-client') {
        const idx = S.clients.findIndex(x => x.id === m._id); if (idx < 0) { S.modal = null; render(); return; }
        const c = S.clients[idx]; const other = c.integrations.length > 0 || c.modules !== undefined;
        const snapshot = JSON.parse(JSON.stringify(c));
        if (other) { delete c.manDayRate; delete c.workLog; } else { S.clients.splice(idx, 1); }
        try { await saveClients(`Remove AMS data: ${snapshot.name}`, [m._id]); S.modal = null; showToast(`${snapshot.name} removed from AMS`); navigate('ams-clients'); }
        catch (err) { if (other) { c.manDayRate = snapshot.manDayRate; c.workLog = snapshot.workLog; } else { S.clients.splice(idx, 0, snapshot); } S.modal = null; showToast('Failed: ' + err.message, 'error'); render(); }
      }
      else if (m._act === 'delete-impl-module') {
        const c = S.clients.find(x => x.id === m._cid); if (!c) { S.modal = null; render(); return; }
        const idx = (c.modules || []).findIndex(x => x.id === m._mid); if (idx < 0) { S.modal = null; render(); return; }
        const [rem] = c.modules.splice(idx, 1);
        S.modal = null; navigate('impl-client-detail', { clientId: m._cid });
        scheduleUndo(`Module "${rem.name}" deleted`, async () => { c.modules.splice(idx, 0, rem); await saveClients(`Restore ${rem.name}`, [m._cid]); navigate('impl-client-detail', { clientId: m._cid }); });
        try { await saveClients(`Delete module: ${rem.name}`, [m._cid]); }
        catch (err) { c.modules.splice(idx, 0, rem); showToast('Failed: ' + err.message, 'error'); navigate('impl-client-detail', { clientId: m._cid }); }
      }
      else if (m._act === 'delete-timeline-entry') {
        const c = S.clients.find(x => x.id === m._cid); const i = c?.integrations.find(x => x.id === m._iid); if (!i) { S.modal = null; render(); return; }
        const idx = i.timeline.findIndex(x => x.id === m._tid); if (idx < 0) { S.modal = null; render(); return; }
        const [rem] = i.timeline.splice(idx, 1);
        try { await saveClients(`Delete update: ${i.name}`, [m._cid]); S.modal = null; showToast('Update deleted'); navigate('integ-detail', { clientId: m._cid, integId: m._iid }); }
        catch (err) { i.timeline.splice(idx, 0, rem); S.modal = null; showToast('Failed: ' + err.message, 'error'); render(); }
      }
      else if (m._act === 'delete-impl-update') {
        const c = S.clients.find(x => x.id === m._cid); const mod = (c?.modules || []).find(x => x.id === m._mid); if (!mod) { S.modal = null; render(); return; }
        const ph = mod.phases?.find(x => x.name === m._phase); if (!ph || !ph.updates) { S.modal = null; render(); return; }
        const idx = ph.updates.findIndex(x => x.id === m._tid); if (idx < 0) { S.modal = null; render(); return; }
        const [rem] = ph.updates.splice(idx, 1);
        try { await saveClients(`Delete update: ${m._phase}`, [m._cid]); S.modal = null; showToast('Update deleted'); navigate('impl-phase-detail', { clientId: m._cid, moduleId: m._mid, phase: m._phase }); }
        catch (err) { ph.updates.splice(idx, 0, rem); S.modal = null; showToast('Failed: ' + err.message, 'error'); render(); }
      }
      else if (m._act === 'delete-ams-entry') {
        const c = S.clients.find(x => x.id === m._cid); if (!c || !c.workLog) { S.modal = null; render(); return; }
        const idx = c.workLog.findIndex(x => x.id === m._eid); if (idx < 0) { S.modal = null; render(); return; }
        const [rem] = c.workLog.splice(idx, 1);
        try { await saveClients(`Delete entry: ${c.name}`, [m._cid]); S.modal = null; showToast('Entry deleted'); navigate('ams-client-detail', { clientId: m._cid }); }
        catch (err) { c.workLog.splice(idx, 0, rem); S.modal = null; showToast('Failed: ' + err.message, 'error'); render(); }
      }
      else if (m._act === 'delete-milestone') {
        const c = S.clients.find(x => x.id === m._cid); const i = c?.integrations.find(x => x.id === m._iid); if (!i) { S.modal = null; render(); return; }
        const idx = (i.milestones || []).findIndex(x => x.id === m._mid); if (idx < 0) { S.modal = null; render(); return; }
        const [rem] = (i.milestones || []).splice(idx, 1);
        try { await saveClients(`Delete milestone: ${rem.name}`, [m._cid]); S.modal = null; showToast('Milestone deleted'); navigate('integ-detail', { clientId: m._cid, integId: m._iid }); }
        catch (err) { i.milestones.splice(idx, 0, rem); S.modal = null; showToast('Failed: ' + err.message, 'error'); render(); }
      }
    } else if (m.type === 'add-milestone' || m.type === 'edit-milestone') {
      const name = document.getElementById('ms-name')?.value.trim();
      if (!name) { showToast('Milestone name required', 'error'); return; }
      const c = S.clients.find(x => x.id === m.cid); const i = c?.integrations.find(x => x.id === m.iid); if (!i) return;
      if (!i.milestones) i.milestones = [];
      const msObj = { id: m.mid || uid(), name, dueDate: document.getElementById('ms-due')?.value || '', status: document.getElementById('ms-status')?.value || 'Pending', owner: document.getElementById('ms-owner')?.value || '', notes: document.getElementById('ms-notes')?.value.trim() || '' };
      if (m.type === 'edit-milestone') {
        const idx = i.milestones.findIndex(x => x.id === m.mid); if (idx >= 0) i.milestones[idx] = msObj;
      } else { i.milestones.push(msObj); }
      S.modal = { ...m, busy: true }; render();
      try { await saveClients(`${m.type === 'edit-milestone' ? 'Edit' : 'Add'} milestone: ${name}`, [m.cid]); S.modal = null; showToast(`Milestone ${m.type === 'edit-milestone' ? 'updated' : 'added'} ✓`); navigate('integ-detail', { clientId: m.cid, integId: m.iid }); }
      catch (err) { if (m.type === 'add-milestone') i.milestones.pop(); S.modal = null; showToast('Failed: ' + err.message, 'error'); render(); }
    } else if (m.type === 'import-ams-entries') {
      const valid = (m.csvRows || []).filter(r => !r.error);
      if (!valid.length) { showToast('No valid rows to import', 'error'); return; }
      const c = S.clients.find(x => x.id === m.cid); if (!c) return;
      if (!c.workLog) c.workLog = [];
      const prev = JSON.parse(JSON.stringify(c.workLog));
      const newEntries = valid.map(r => ({ id: uid(), ...r, loggedAt: new Date().toISOString() }));
      c.workLog.push(...newEntries); S.modal = { ...m, busy: true }; render();
      try { await saveClients(`Import ${newEntries.length} AMS entries: ${c.name}`, [m.cid]); S.modal = null; showToast(`${newEntries.length} entr${newEntries.length === 1 ? 'y' : 'ies'} imported ✓`); navigate('ams-client-detail', { clientId: m.cid }); }
      catch (err) { c.workLog = prev; S.modal = null; showToast('Import failed: ' + err.message, 'error'); render(); }
    } else if (m.type === 'import-integrations') {
      const valid = (m.csvRows || []).filter(r => !r.error);
      if (!valid.length) { showToast('No valid rows to import', 'error'); return; }
      const c = S.clients.find(x => x.id === m.cid); if (!c) return;
      const prev = JSON.parse(JSON.stringify(c.integrations));
      const newIntegs = valid.map(r => ({ id: uid(), name: r.name, status: r.status, assignee: r.assignee, dueDate: r.dueDate, description: r.description, nextAction: r.nextAction, timeline: [], createdAt: new Date().toISOString() }));
      c.integrations.push(...newIntegs); S.modal = { ...m, busy: true }; render();
      try { await saveClients(`Import ${newIntegs.length} integrations: ${c.name}`, [m.cid]); S.modal = null; showToast(`${newIntegs.length} integration${newIntegs.length === 1 ? '' : 's'} imported ✓`); navigate('client-detail', { clientId: m.cid }); }
      catch (err) { c.integrations = prev; S.modal = null; showToast('Import failed: ' + err.message, 'error'); render(); }
    } else if (m.type === 'portfolio-export') {
      const selected = [...document.querySelectorAll('[data-act="portfolio-client-toggle"]:checked')].map(el => el.dataset.cid);
      const sections = [...document.querySelectorAll('[data-act="portfolio-section-toggle"]:checked')].map(el => el.dataset.section);
      if (!selected.length) { showToast('Select at least one client', 'error'); return; }
      if (!sections.length) { showToast('Select at least one section', 'error'); return; }
      S.modal = null; render();
      exportConsolidatedPdf(selected, sections);
    } else if (m.type === 'client-email') {
      if (!can('editor')) return;
      const to = document.getElementById('ce-to')?.value.trim();
      const cc = document.getElementById('ce-cc')?.value.trim();
      const subject = document.getElementById('ce-subject')?.value.trim();
      const bodyText = document.getElementById('ce-body')?.value;
      const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!to || !EMAIL_RE.test(to)) { showToast('Enter a valid recipient email', 'error'); return; }
      if (!subject) { showToast('Subject is required', 'error'); return; }
      if (!bodyText || !bodyText.trim()) { showToast('Message body is required', 'error'); return; }
      if (!m.attachmentReady || !m.attachmentBase64) { showToast('PDF is still generating — give it a moment', 'warn'); return; }
      // Preserve the typed values across the busy re-render.
      S.modal = { ...m, to, cc, subject, bodyText, busy: true }; render();
      try {
        const r = await fetch('/api/ops?op=send-client-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-session-token': S.sessionToken || '' },
          body: JSON.stringify({
            to, cc, subject, bodyText, clientName: m.clientName,
            attachment: { name: m.attachmentName, contentBytes: m.attachmentBase64 },
          }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { S.modal = { ...S.modal, busy: false }; showToast('Failed: ' + (d.detail || d.error || 'send error'), 'error'); render(); return; }
        S.modal = null;
        showToast(`Email sent to ${to} ✓`);
        render();
      } catch (err) {
        S.modal = { ...S.modal, busy: false };
        showToast('Failed to send: ' + err.message, 'error');
        render();
      }
    } else if (m.type === 'add-client') {
      const existingId = document.getElementById('m0')?.value;
      if (existingId) {
        const c = S.clients.find(x => x.id === existingId); if (!c) return;
        // Unlike Implementation/AMS, Integrations isn't opt-in — every
        // client already has `integrations: []` from the moment they're
        // created (see the "new client" branch below), so there's nothing
        // to enable here. Picking an existing client just takes you to
        // them, replacing what used to be a hard "already exists" error
        // if you typed their name instead.
        S.modal = null; showToast(`${c.name} already has Integrations — opening their page`); navigate('client-detail', { clientId: c.id });
        return;
      }
      const name = document.getElementById('m1')?.value.trim(), desc = document.getElementById('m2')?.value.trim();
      if (!name) { showToast('Pick a client above or enter a new name', 'error'); return; }
      if (S.clients.find(x => x.name.toLowerCase() === name.toLowerCase())) { showToast(`"${name}" already exists — select it above instead`, 'error'); return; }
      const nc = { id: uid(), name, description: desc || '', createdAt: new Date().toISOString(), integrations: [] };
      S.clients.push(nc); S.modal = { ...m, busy: true }; render();
      try { await saveClients(`Add ${name}`, [nc.id]); S.modal = null; showToast(`${name} added`); render(); }
      catch (err) { S.clients.pop(); S.modal = null; showToast('Failed: ' + err.message, 'error'); render(); }
    } else if (m.type === 'add-integ') {
      const cid = document.getElementById('m0')?.value, name = document.getElementById('m1')?.value.trim();
      if (!name) { showToast('Name required', 'error'); return; }
      const c = S.clients.find(x => x.id === cid); if (!c) return;
      const ni = { id: uid(), name, status: document.getElementById('m2')?.value || 'Not Started', assignee: document.getElementById('m3')?.value.trim() || '', dueDate: document.getElementById('m4')?.value || '', effortWeight: parseFloat(document.getElementById('m6')?.value) || 0.5, description: document.getElementById('m5')?.value.trim() || '', nextAction: '', timeline: [] };
      c.integrations.push(ni); S.modal = { ...m, busy: true }; render();
      try { await saveClients(`Add ${name} to ${c.name}`, [cid]); S.modal = null; showToast(`${name} added`); render(); }
      catch (err) { c.integrations.pop(); S.modal = null; showToast('Failed: ' + err.message, 'error'); render(); }
    } else if (m.type === 'my-profile') {
      const currPass = document.getElementById('pr-curr')?.value;
      const newPass = document.getElementById('pr-new')?.value;
      const confPass = document.getElementById('pr-conf')?.value;
      const newEmail = document.getElementById('pr-email')?.value.trim() || '';
      if (!currPass) { showToast('Current password is required', 'error'); return; }
      if (newPass && newPass !== confPass) { showToast('New passwords do not match', 'error'); return; }
      if (newPass && newPass.length < 8) { showToast('New password must be at least 8 characters', 'error'); return; }
      S.modal = { ...m, busy: true }; render();
      try {
        const r = await fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-token': S.sessionToken || '' }, body: JSON.stringify({ action: 'change-password', currentPassword: currPass, newPassword: newPass || undefined, email: newEmail }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || `Failed (${r.status})`);
        S.sessionToken = d.token; S.user = d.user; persistSession(d.token, d.user);
        const me = S.users.find(x => x.id === d.user.id); if (me) me.email = d.user.email;
        S.modal = null; showToast(newPass ? 'Password changed ✓' : 'Profile updated ✓'); render();
      } catch (err) { S.modal = null; showToast('Failed: ' + err.message, 'error'); render(); }
    } else if (m.type === 'digest-recipients') {
      if (!can('admin')) return;
      const emails = [...document.querySelectorAll('.dr-email')].map(inp => inp.value.trim()).filter(Boolean);
      const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const bad = emails.find(e => !EMAIL_RE.test(e));
      if (bad) { showToast(`Invalid email: ${bad}`, 'error'); return; }
      if (emails.length > 25) { showToast('Max 25 recipients', 'error'); return; }
      const prev = S.digestRecipients;
      S.modal = { ...m, busy: true }; render();
      try { await saveDigestRecipients({ emails }); S.modal = null; showToast('Digest recipients updated ✓'); render(); }
      catch (err) { S.digestRecipients = prev; S.modal = null; showToast('Failed: ' + err.message, 'error'); render(); }
    } else if (m.type === 'edit-user') {
      if (!can('admin')) return;
      const u = S.users.find(x => x.id === m.uid); if (!u) return;
      const newName = document.getElementById('eu-name')?.value.trim();
      const newEmail = document.getElementById('eu-email')?.value.trim() || '';
      const newPass = document.getElementById('eu-pass')?.value;
      if (!newName) { showToast('Full name is required', 'error'); return; }
      const snapshot = { name: u.name, email: u.email, passwordHash: u.passwordHash };
      u.name = newName; u.email = newEmail;
      S.modal = { ...m, busy: true }; render();
      if (newPass) { u.password = newPass; delete u.passwordHash; }
      try {
        await saveUsers(`Edit user: ${u.username}`, [m.uid]);
        delete u.password;
        // refresh dropdown with updated name
        S.usersForDropdown = S.users.map(x => ({ id: x.id, name: x.name || x.username, role: x.role, username: x.username }));
        // if editing self, update session
        if (u.id === S.user?.id) { S.user.name = newName; persistSession(S.sessionToken, S.user); }
        S.modal = null; showToast(`${newName} updated ✓`); render();
      } catch (err) { u.name = snapshot.name; u.email = snapshot.email; u.passwordHash = snapshot.passwordHash; delete u.password; S.modal = null; showToast('Failed: ' + err.message, 'error'); render(); }
    } else if (m.type === 'add-user') {
      const username = document.getElementById('m1')?.value.trim(), name = document.getElementById('m2')?.value.trim(), password = document.getElementById('m3')?.value, role = document.getElementById('m4')?.value, email = document.getElementById('m5')?.value.trim() || '';
      if (!username || !name || !password) { showToast('Username, name and password are required', 'error'); return; }
      if (S.users.find(x => x.username === username)) { showToast('Username taken', 'error'); return; }
      S.modal = { ...m, busy: true }; render();
      const nu = { id: uid(), username, name, email, password, role }; S.users.push(nu);
      try { await saveUsers(`Add ${username}`, [nu.id]); delete nu.password; S.usersForDropdown = S.users.map(u => ({ id: u.id, name: u.name || u.username, role: u.role, username: u.username })); S.modal = null; showToast(`${name} added`); render(); }
      catch (err) { S.users.pop(); S.modal = null; showToast('Failed: ' + err.message, 'error'); render(); }
    } else if (m.type === 'bulk-import-users') {
      const valid = (m.csvRows || []).filter(r => !r.error);
      if (!valid.length) { showToast('No valid rows to import', 'error'); return; }
      S.modal = { ...m, busy: true }; render();
      const newUsers = valid.map(r => ({ id: uid(), username: r.username, name: r.name, email: r.email || '', password: r.password, role: r.role }));
      const prev = JSON.parse(JSON.stringify(S.users));
      S.users = [...S.users, ...newUsers];
      try { await saveUsers(`Bulk import ${newUsers.length} users`, newUsers.map(u => u.id)); newUsers.forEach(u => delete u.password); S.usersForDropdown = S.users.map(u => ({ id: u.id, name: u.name || u.username, role: u.role, username: u.username })); S.modal = null; showToast(`${newUsers.length} user${newUsers.length !== 1 ? 's' : ''} imported ✓`); render(); }
      catch (err) { S.users = prev; S.modal = null; showToast('Import failed: ' + err.message, 'error'); render(); }
    } else if (m.type === 'rename-client') {
      const c = S.clients.find(x => x.id === m.cid); if (!c) return;
      const name = document.getElementById('m1')?.value.trim();
      if (!name) { showToast('Name required', 'error'); return; }
      const prev = c.name; c.name = name; S.modal = { ...m, busy: true }; render();
      try { await saveClients(`Rename client: ${prev} → ${name}`, [m.cid]); S.modal = null; showToast('Client renamed ✓'); render(); }
      catch (err) { c.name = prev; S.modal = null; showToast('Failed: ' + err.message, 'error'); render(); }
    } else if (m.type === 'rename-integrations') {
      const c = S.clients.find(x => x.id === m.cid); if (!c) return;
      const prev = JSON.parse(JSON.stringify(c.integrations));
      let changed = 0;
      c.integrations.forEach(i => { const v = document.getElementById(`ri-${i.id}`)?.value.trim(); if (v && v !== i.name) { i.name = v; changed++; } });
      if (!changed) { S.modal = null; render(); return; }
      S.modal = { ...m, busy: true }; render();
      try { await saveClients(`Rename ${changed} integration${changed !== 1 ? 's' : ''}: ${c.name}`, [m.cid]); S.modal = null; showToast('Integrations renamed ✓'); render(); }
      catch (err) { c.integrations = prev; S.modal = null; showToast('Failed: ' + err.message, 'error'); render(); }
    } else if (m.type === 'rename-modules') {
      const c = S.clients.find(x => x.id === m.cid); if (!c) return;
      const prev = JSON.parse(JSON.stringify(c.modules));
      let changed = 0;
      (c.modules || []).forEach(mod => { const v = document.getElementById(`rm-${mod.id}`)?.value.trim(); if (v && v !== mod.name) { mod.name = v; changed++; } });
      if (!changed) { S.modal = null; render(); return; }
      S.modal = { ...m, busy: true }; render();
      try { await saveClients(`Rename ${changed} module${changed !== 1 ? 's' : ''}: ${c.name}`, [m.cid]); S.modal = null; showToast('Modules renamed ✓'); render(); }
      catch (err) { c.modules = prev; S.modal = null; showToast('Failed: ' + err.message, 'error'); render(); }
    } else if (m.type === 'dashboard-layout') {
      saveDashLayout(m.tileOrder);
      S.modal = null; showToast('Dashboard layout saved ✓'); render();
    } else if (m.type === 'admin-task-runner') {
      if (m.done) { S.modal = null; render(); return; }
      // Generic batch-loop runner: any endpoint returning
      // {processed, failedCount, results:[{id,name,ok,error?}], done, nextOffset}
      // works here unchanged — this is the reusable part for future tasks.
      S.modal = { ...m, busy: true, log: [...m.log, `▶ Starting ${m.taskLabel}…`] }; render();
      let offset = 0;
      try {
        while (true) {
          const res = await fetch(m.taskEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-session-token': S.sessionToken || '' },
            body: JSON.stringify({ offset, limit: 5 }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
          const failedNames = (data.results || []).filter(r => !r.ok).map(r => r.name || r.id);
          const line = failedNames.length
            ? `⚠ Batch at offset ${offset}: ${data.processed} processed, ${data.failedCount} failed (${failedNames.join(', ')})`
            : `✓ Batch at offset ${offset}: ${data.processed} processed`;
          S.modal = {
            ...S.modal, log: [...S.modal.log, line],
            totalProcessed: (S.modal.totalProcessed || 0) + (data.processed || 0),
            totalFailed: (S.modal.totalFailed || 0) + (data.failedCount || 0),
          };
          render();
          if (data.done) break;
          offset = data.nextOffset;
        }
        S.modal = { ...S.modal, busy: false, done: true, log: [...S.modal.log, `🏁 Finished.`] }; render();
      } catch (err) {
        S.modal = { ...S.modal, busy: false, done: true, log: [...S.modal.log, `⚠ Stopped early: ${err.message}`] }; render();
      }
    } else if (m.type === 'capacity-weights') {
      const val = id => parseFloat(document.getElementById(id)?.value);
      const newWeights = { module: val('cw-module'), pmo: val('cw-pmo'), ams: val('cw-ams'), cap: val('cw-cap') };
      for (const k in newWeights) { if (!Number.isFinite(newWeights[k]) || newWeights[k] <= 0) { showToast(`Invalid value`, 'error'); return; } }
      const prev = S.capacityWeights;
      S.modal = { ...m, busy: true }; render();
      try { await saveCapacityWeights(newWeights); S.modal = null; showToast('Capacity weights updated ✓'); render(); }
      catch (err) { S.capacityWeights = prev; S.modal = null; showToast('Failed: ' + err.message, 'error'); render(); }
    } else if (m.type === 'add-impl-client') {
      const existingId = document.getElementById('m0')?.value;
      if (existingId) {
        const c = S.clients.find(x => x.id === existingId); if (!c) return;
        c.modules = []; S.modal = { ...m, busy: true }; render();
        try { await saveClients(`Enable Implementation tracking: ${c.name}`, [existingId]); S.modal = null; showToast(`${c.name} added to Implementations`); render(); }
        catch (err) { delete c.modules; S.modal = null; showToast('Failed: ' + err.message, 'error'); render(); }
      } else {
        const name = document.getElementById('m1')?.value.trim();
        if (!name) { showToast('Pick a client above or enter a new name', 'error'); return; }
        if (S.clients.find(x => x.name.toLowerCase() === name.toLowerCase())) { showToast(`"${name}" already exists — select it above instead`, 'error'); return; }
        const desc = document.getElementById('m2')?.value.trim();
        const nc = { id: uid(), name, description: desc || '', createdAt: new Date().toISOString(), integrations: [], modules: [] };
        S.clients.push(nc); S.modal = { ...m, busy: true }; render();
        try { await saveClients(`Add ${name}`, [nc.id]); S.modal = null; showToast(`${name} added`); render(); }
        catch (err) { S.clients.pop(); S.modal = null; showToast('Failed: ' + err.message, 'error'); render(); }
      }
    } else if (m.type === 'add-impl-module') {
      const name = document.getElementById('m1')?.value.trim();
      if (!name) { showToast('Name required', 'error'); return; }
      const c = S.clients.find(x => x.id === m.cid); if (!c) return;
      const nm = { id: uid(), name, phases: PHASES.map(ph => ({ name: ph, status: 'Not Started', startDate: '', targetDate: '', updates: [] })) };
      if (!c.modules) c.modules = []; c.modules.push(nm); S.modal = { ...m, busy: true }; render();
      try { await saveClients(`Add module ${name}`, [c.id]); S.modal = null; showToast(`${name} added`); navigate('impl-client-detail', { clientId: c.id }); }
      catch (err) { c.modules.pop(); S.modal = null; showToast('Failed: ' + err.message, 'error'); render(); }
    } else if (m.type === 'edit-impl-client') {
      const c = S.clients.find(x => x.id === m.cid); if (!c) return;
      const assignee = document.getElementById('m1')?.value || '';
      const snapshot = { masterAssignee: c.masterAssignee };
      if (assignee) { c.masterAssignee = assignee; } else { delete c.masterAssignee; }
      S.modal = { ...m, busy: true }; render();
      try { await saveClients(`Edit Implementation client: ${c.name}`, [c.id]); S.modal = null; showToast('Saved ✓'); navigate('impl-client-detail', { clientId: c.id }); }
      catch (err) { if (snapshot.masterAssignee === undefined) delete c.masterAssignee; else c.masterAssignee = snapshot.masterAssignee; S.modal = null; showToast('Failed: ' + err.message, 'error'); render(); }
    } else if (m.type === 'add-ams-client') {
      const existingId = document.getElementById('m0')?.value;
      const rateRaw = document.getElementById('m3')?.value;
      const rate = rateRaw ? parseFloat(rateRaw) : undefined;
      const availRaw = document.getElementById('m4')?.value;
      const avail = availRaw ? parseFloat(availRaw) : undefined;
      const currency = document.getElementById('m5')?.value || 'INR';
      if (existingId) {
        const c = S.clients.find(x => x.id === existingId); if (!c) return;
        if (rate) c.manDayRate = rate; c.workLog = c.workLog || []; c.currency = currency; if (avail !== undefined) c.totalAvailableHours = avail;
        S.modal = { ...m, busy: true }; render();
        try { await saveClients(`Enable AMS: ${c.name}`, [existingId]); S.modal = null; showToast(`${c.name} added to AMS`); render(); }
        catch (err) { delete c.manDayRate; delete c.totalAvailableHours; S.modal = null; showToast('Failed: ' + err.message, 'error'); render(); }
      } else {
        const name = document.getElementById('m1')?.value.trim();
        if (!name) { showToast('Pick a client above or enter a new name', 'error'); return; }
        if (S.clients.find(x => x.name.toLowerCase() === name.toLowerCase())) { showToast(`"${name}" already exists — select it above instead`, 'error'); return; }
        const desc = document.getElementById('m2')?.value.trim();
        const nc = { id: uid(), name, description: desc || '', createdAt: new Date().toISOString(), integrations: [], workLog: [], currency };
        if (rate) nc.manDayRate = rate; if (avail !== undefined) nc.totalAvailableHours = avail;
        S.clients.push(nc); S.modal = { ...m, busy: true }; render();
        try { await saveClients(`Add ${name}`, [nc.id]); S.modal = null; showToast(`${name} added`); render(); }
        catch (err) { S.clients.pop(); S.modal = null; showToast('Failed: ' + err.message, 'error'); render(); }
      }
    } else if (m.type === 'edit-ams-client') {
      const c = S.clients.find(x => x.id === m.cid); if (!c) return;
      const rateRaw = document.getElementById('m2')?.value;
      const desc = document.getElementById('m1')?.value.trim();
      const availRaw = document.getElementById('m3')?.value;
      const currency = document.getElementById('m4')?.value || 'INR';
      const snapshot = { description: c.description, manDayRate: c.manDayRate, totalAvailableHours: c.totalAvailableHours, currency: c.currency };
      c.description = desc || ''; c.currency = currency;
      if (rateRaw) { c.manDayRate = parseFloat(rateRaw); } else { delete c.manDayRate; }
      if (availRaw) { c.totalAvailableHours = parseFloat(availRaw); } else { delete c.totalAvailableHours; }
      S.modal = { ...m, busy: true }; render();
      try { await saveClients(`Edit AMS client: ${c.name}`, [c.id]); S.modal = null; showToast('Saved ✓'); navigate('ams-client-detail', { clientId: c.id }); }
      catch (err) { Object.assign(c, snapshot); if (snapshot.totalAvailableHours === undefined) delete c.totalAvailableHours; if (snapshot.manDayRate === undefined) delete c.manDayRate; S.modal = null; showToast('Failed: ' + err.message, 'error'); render(); }
    } else if (m.type === 'add-ams-entry' || m.type === 'edit-ams-entry') {
      if (!can('editor')) return;
      const cid = m.cid; const c = S.clients.find(x => x.id === cid); if (!c) return;
      const dateRaised = document.getElementById('ae-date')?.value;
      const hours = parseFloat(document.getElementById('ae-hours')?.value);
      if (!dateRaised || !hours || hours <= 0) { showToast('Date and hours are required', 'error'); return; }
      const fields = {
        dateRaised,
        dueDate: document.getElementById('ae-due')?.value || '',
        raisedBy: document.getElementById('ae-raised')?.value || S.user.name,
        module: document.getElementById('ae-module')?.value?.trim() || '',
        project: document.getElementById('ae-project')?.value?.trim() || '',
        description: document.getElementById('ae-desc')?.value?.trim() || '',
        type: document.getElementById('ae-type')?.value,
        queryLevel: document.getElementById('ae-level')?.value,
        modeOfSupport: document.getElementById('ae-mode')?.value,
        entryStatus: document.getElementById('ae-status')?.value,
        ragStatus: document.getElementById('ae-rag')?.value || '',
        dependencies: document.getElementById('ae-deps')?.value?.trim() || '',
        solution: document.getElementById('ae-solution')?.value?.trim() || '',
        hours
      };
      if (!c.workLog) c.workLog = [];
      if (m.type === 'add-ams-entry') {
        const entry = { id: uid(), ...fields, loggedAt: new Date().toISOString() };
        c.workLog.push(entry); S.modal = { ...m, busy: true }; render();
        try { await saveClients(`Add entry: ${c.name}`, [cid]); S.modal = null; showToast('Entry added ✓'); navigate('ams-client-detail', { clientId: cid }); }
        catch (err) { c.workLog.pop(); S.modal = null; showToast('Failed: ' + err.message, 'error'); render(); }
      } else {
        const idx = c.workLog.findIndex(x => x.id === m.eid); if (idx < 0) return;
        const original = c.workLog[idx];
        const snapshot = JSON.parse(JSON.stringify(original));
        const updated = { ...original, ...fields, edits: [...(original.edits || []), { description: original.description, hours: original.hours, dateRaised: entryDate(original), editedAt: new Date().toISOString(), editedBy: S.user.name }], lastEditedAt: new Date().toISOString(), lastEditedBy: S.user.name };
        c.workLog[idx] = updated; S.modal = { ...m, busy: true }; render();
        try { await saveClients(`Edit entry: ${c.name}`, [cid]); S.modal = null; showToast('Entry updated ✓'); navigate('ams-client-detail', { clientId: cid }); }
        catch (err) { c.workLog[idx] = snapshot; S.modal = null; showToast('Failed: ' + err.message, 'error'); render(); }
      }
    }
  }
});

document.addEventListener('change', async e => {
  const statusEl = e.target.closest('[data-act="inline-status"]');
  if (statusEl && can('editor')) {
    const c = S.clients.find(x => x.id === statusEl.dataset.cid); if (!c) return;
    const i = c.integrations.find(x => x.id === statusEl.dataset.iid); if (!i) return;
    const prev = i.status; i.status = statusEl.value; statusEl.disabled = true;
    try { await saveClients(`Status: ${i.name} → ${i.status}`, [c.id]); showToast(`${i.name} → ${i.status}`); statusEl.disabled = false; }
    catch (err) { i.status = prev; showToast('Failed: ' + err.message, 'error'); render(); }
    return;
  }
  const assigneeEl = e.target.closest('[data-act="inline-assignee"]');
  if (assigneeEl && can('editor')) {
    const c = S.clients.find(x => x.id === assigneeEl.dataset.cid); if (!c) return;
    const i = c.integrations.find(x => x.id === assigneeEl.dataset.iid); if (!i) return;
    const prev = i.assignee; i.assignee = assigneeEl.value; assigneeEl.disabled = true;
    try { await saveClients(`Assignee: ${i.name} → ${i.assignee || 'Unassigned'}`, [c.id]); showToast(`Assignee updated ✓`); assigneeEl.disabled = false; }
    catch (err) { i.assignee = prev; showToast('Failed: ' + err.message, 'error'); render(); }
    return;
  }
  const effortEl = e.target.closest('[data-act="inline-effort"]');
  if (effortEl && can('editor')) {
    const c = S.clients.find(x => x.id === effortEl.dataset.cid); if (!c) return;
    const i = c.integrations.find(x => x.id === effortEl.dataset.iid); if (!i) return;
    const prev = i.effortWeight; i.effortWeight = parseFloat(effortEl.value); effortEl.disabled = true;
    try { await saveClients(`Effort: ${i.name} → ${i.effortWeight}`, [c.id]); showToast(`Effort updated ✓`); effortEl.disabled = false; }
    catch (err) { i.effortWeight = prev; showToast('Failed: ' + err.message, 'error'); render(); }
    return;
  }
  const tileToggleEl = e.target.closest('[data-act="dash-tile-toggle"]');
  if (tileToggleEl) {
    const m = S.modal; if (!m || m.type !== 'dashboard-layout') return;
    const t = m.tileOrder.find(x => x.id === tileToggleEl.dataset.tileId);
    if (t) t.visible = tileToggleEl.checked;
    render();
    return;
  }
  const masterAssigneeEl = e.target.closest('[data-act="inline-master-assignee"]');
  if (masterAssigneeEl && can('editor')) {
    const c = S.clients.find(x => x.id === masterAssigneeEl.dataset.cid); if (!c) return;
    const prev = c.masterAssignee; const val = masterAssigneeEl.value;
    if (val) { c.masterAssignee = val; } else { delete c.masterAssignee; }
    masterAssigneeEl.disabled = true;
    try { await saveClients(`Master assignee: ${c.name} → ${val || 'Unassigned'}`, [c.id]); showToast(`Master assignee updated ✓`); masterAssigneeEl.disabled = false; }
    catch (err) { if (prev === undefined) delete c.masterAssignee; else c.masterAssignee = prev; showToast('Failed: ' + err.message, 'error'); render(); }
    return;
  }
  const roleEl = e.target.closest('[data-act="change-role"]');
  if (roleEl && can('admin')) {
    const u = S.users.find(x => x.id === roleEl.dataset.uid); if (!u || u.id === S.user?.id) return;
    const prev = u.role; u.role = roleEl.value; roleEl.disabled = true;
    try { await saveUsers(`Role: ${u.username}`, [u.id]); showToast(`${u.name} → ${u.role}`); roleEl.disabled = false; }
    catch (err) { u.role = prev; showToast('Failed', 'error'); render(); }
    return;
  }
  if (e.target.dataset?.act === 'integ-sort-select') { S.sort = { key: e.target.value, dir: 'asc' }; render(); return; }
  if (e.target.dataset?.act === 'integ-rail-sort') { S.integRailSort = e.target.value; render(); return; }
  if (e.target.dataset?.act === 'audit-from') { S.auditFrom = e.target.value; return; }
  if (e.target.dataset?.act === 'audit-to') { S.auditTo = e.target.value; return; }
  if (e.target.dataset?.act === 'audit-user') { S.auditUser = e.target.value; S.auditPage = 0; loadAuditLog(); return; }
  const rangeEl = e.target.closest('[data-act="ams-range"]');
  if (rangeEl) {
    S.amsFrom = document.getElementById('ams-from')?.value || '';
    S.amsTo = document.getElementById('ams-to')?.value || '';
    render();
  }
  // ── File attachment upload handler ────────────────────────────
  // Covers 4 forms total, 2 modules x (add form / edit form):
  //   Implementation add-update:  ip-attach-file   (prefix 'ip-attach', no tid)
  //   Implementation edit-update: eat-file-${tid}  (prefix 'eat', tid)
  //   Integration add-update:     tl-attach-file    (prefix 'tl-attach', no tid)
  //   Integration edit-update:    etl-file-${tid}   (prefix 'etl', tid)
  const fileEl = e.target;
  if (fileEl.type === 'file' && fileEl.accept && fileEl.files?.length) {
    const file = fileEl.files[0]; if (!file) return;
    const tid = fileEl.dataset.tid || '';
    let prefix;
    if (fileEl.id === 'ip-attach-file') prefix = 'ip-attach';
    else if (fileEl.id === 'tl-attach-file') prefix = 'tl-attach';
    else if (fileEl.id.startsWith('eat-file-')) prefix = 'eat';
    else if (fileEl.id.startsWith('etl-file-')) prefix = 'etl';
    else return; // unrecognized file input, not an attachment control
    const isAddForm = !tid;
    const urlId = isAddForm ? `${prefix}-url` : `${prefix}-url-${tid}`;
    const mimeId = isAddForm ? `${prefix}-mimetype` : `${prefix}-mimetype-${tid}`;
    const nameId = isAddForm ? `${prefix}-filename` : `${prefix}-filename-${tid}`;
    const previewId = isAddForm ? `${prefix}-preview` : `${prefix}-preview-${tid}`;
    const nameDisplayId = isAddForm ? `${prefix}-name` : `${prefix}-name-${tid}`;
    const iconDisplayId = isAddForm ? `${prefix}-icon` : `${prefix}-icon-${tid}`;
    const labelEl = document.getElementById(isAddForm ? `${prefix}-label` : `${prefix}-label-${tid}`);
    // Show uploading state
    const preview = document.getElementById(previewId);
    const nameDisplay = document.getElementById(nameDisplayId);
    const iconDisplay = document.getElementById(iconDisplayId);
    if (preview) { preview.classList.remove('hidden'); if (nameDisplay) nameDisplay.textContent = 'Uploading…'; }
    try {
      const result = await uploadAttachment(file);
      const urlEl = document.getElementById(urlId); const mEl = document.getElementById(mimeId); const nEl = document.getElementById(nameId);
      if (urlEl) urlEl.value = result.url; if (mEl) mEl.value = result.mimeType; if (nEl) nEl.value = result.fileName;
      if (nameDisplay) nameDisplay.textContent = result.fileName;
      if (iconDisplay) iconDisplay.textContent = fileIcon(result.url, result.mimeType);
      if (preview) preview.classList.remove('hidden');
      if (labelEl && !labelEl.value) labelEl.value = result.fileName.replace(/\.[^.]+$/, '');
      showToast('File uploaded ✓');
    } catch (err) {
      if (preview) preview.classList.add('hidden');
      fileEl.value = '';
      showToast(err.message, 'error');
    }
  }
});

let _st;
let _ct;
let _dat;
let _dct;
let _adt;
let _irft;
document.addEventListener('input', e => {
  if (e.target.dataset?.act === 'search') {
    clearTimeout(_st); const v = e.target.value;
    _st = setTimeout(() => { S.search = v; render(); setTimeout(() => { const el = document.getElementById('search-inp'); if (el) { el.focus(); try { el.setSelectionRange(v.length, v.length); } catch { } } }, 10); }, 120);
  }
  if (e.target.dataset?.act === 'cmdp-input') {
    clearTimeout(_ct); const v = e.target.value;
    _ct = setTimeout(() => { S.cmdQuery = v; S.cmdSelectedIdx = 0; render(); setTimeout(() => { const el = document.getElementById('cmdp-input'); if (el) { el.focus(); try { el.setSelectionRange(v.length, v.length); } catch { } } }, 10); }, 100);
  }
  if (e.target.dataset?.act === 'dash-assignee-search') {
    clearTimeout(_dat); const v = e.target.value;
    _dat = setTimeout(() => { S.dashAssigneeSearch = v; render(); setTimeout(() => { const el = document.getElementById('dash-assignee-search-inp'); if (el) { el.focus(); try { el.setSelectionRange(v.length, v.length); } catch { } } }, 10); }, 120);
  }
  if (e.target.dataset?.act === 'dash-crit-search') {
    clearTimeout(_dct); const v = e.target.value;
    _dct = setTimeout(() => { S.dashCritSearch = v; render(); setTimeout(() => { const el = document.getElementById('dash-crit-search-inp'); if (el) { el.focus(); try { el.setSelectionRange(v.length, v.length); } catch { } } }, 10); }, 120);
  }
  if (e.target.dataset?.act === 'admin-search') {
    clearTimeout(_adt); const v = e.target.value;
    _adt = setTimeout(() => { S.adminSearch = v; render(); setTimeout(() => { const el = document.getElementById('admin-search-inp'); if (el) { el.focus(); try { el.setSelectionRange(v.length, v.length); } catch { } } }, 10); }, 120);
  }
  if (e.target.dataset?.act === 'audit-search') { S.auditSearch = e.target.value; }
  if (e.target.dataset?.act === 'integ-rail-filter') {
    clearTimeout(_irft); const v = e.target.value;
    _irft = setTimeout(() => { S.integRailFilter = v; render(); setTimeout(() => { const el = document.getElementById('integ-rail-filter-inp'); if (el) { el.focus(); try { el.setSelectionRange(v.length, v.length); } catch { } } }, 10); }, 150);
  }
});

document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && S.user) {
    e.preventDefault();
    const saveBtn = document.querySelector('[data-act="save-integ"],[data-act="save-impl-phase"],[data-act="bulk-mark-complete"]');
    if (saveBtn) saveBtn.click();
    else showToast('Nothing to save on this page', 'info');
    return;
  }
  if (e.key === 'Enter' && S.view === 'login') document.querySelector('[data-act="login"]')?.click();
  if (e.key === 'Escape' && S.modal && !S.modal.busy) { S.modal = null; render(); return; }
  if (e.key === 'Escape' && S.cmdPaletteOpen) { S.cmdPaletteOpen = false; render(); return; }
  if (e.key === 'Escape' && S.shortcutsHelpOpen) { S.shortcutsHelpOpen = false; render(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && S.user) { e.preventDefault(); S.cmdPaletteOpen = !S.cmdPaletteOpen; S.cmdQuery = ''; S.cmdSelectedIdx = 0; render(); if (S.cmdPaletteOpen) setTimeout(() => document.getElementById('cmdp-input')?.focus(), 30); return; }
  if (S.cmdPaletteOpen && e.key === 'ArrowDown') { e.preventDefault(); const max = (_cmdpResults?.length || 1) - 1; S.cmdSelectedIdx = Math.min(S.cmdSelectedIdx + 1, Math.max(max, 0)); render(); return; }
  if (S.cmdPaletteOpen && e.key === 'ArrowUp') { e.preventDefault(); S.cmdSelectedIdx = Math.max(S.cmdSelectedIdx - 1, 0); render(); return; }
  if (S.cmdPaletteOpen && e.key === 'Enter') { const idx = Math.min(S.cmdSelectedIdx, (_cmdpResults?.length || 1) - 1); const sel = document.querySelector(`[data-act="cmdp-go"][data-idx="${idx}"]`); sel?.click(); return; }

  // ── Navigation shortcuts (Linear-style "g then letter") + ? help overlay ──
  // Never fire while typing in any field — bare single letters would otherwise
  // hijack normal text entry (typing "g" in a client name, for instance).
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName) || e.target?.isContentEditable;
  if (typing || !S.user || S.cmdPaletteOpen || S.modal) return;

  if (e.key === '?') { e.preventDefault(); S.shortcutsHelpOpen = !S.shortcutsHelpOpen; render(); return; }

  if (e.key.toLowerCase() === 'g' && !e.metaKey && !e.ctrlKey) {
    _gChordActive = true;
    clearTimeout(_gChordTimer);
    _gChordTimer = setTimeout(() => { _gChordActive = false; }, 800);
    return;
  }
  if (_gChordActive) {
    _gChordActive = false;
    clearTimeout(_gChordTimer);
    const dest = { d: 'dashboard', i: 'clients', m: 'impl-clients', a: 'ams-clients' }[e.key.toLowerCase()];
    if (dest) { e.preventDefault(); navigate(dest); }
  }
});
let _gChordActive = false;
let _gChordTimer = null;

// ─── INIT ─────────────────────────────────────────────────────────
let _resizeTimer = null;
window.addEventListener('resize', () => { clearTimeout(_resizeTimer); _resizeTimer = setTimeout(() => { if (S.user) render(); }, 150); });
// Dashboard tile customization: native HTML5 drag-and-drop reordering.
// Registered once at top level (not inside the click delegate above) —
// these are separate event types (dragstart/dragover/drop), not clicks.
let _dragTileId = null;
document.addEventListener('dragstart', e => {
  const el = e.target.closest('[data-act="dash-tile-drag"]');
  if (!el) return;
  _dragTileId = el.dataset.tileId;
  try { e.dataTransfer.effectAllowed = 'move'; } catch (err) { }
});
document.addEventListener('dragover', e => {
  const el = e.target.closest('[data-act="dash-tile-drag"]');
  if (!el) return;
  e.preventDefault();
});
document.addEventListener('drop', e => {
  const el = e.target.closest('[data-act="dash-tile-drag"]');
  if (!el || !_dragTileId) return;
  e.preventDefault();
  const targetId = el.dataset.tileId;
  const m = S.modal; if (!m || m.type !== 'dashboard-layout') { _dragTileId = null; return; }
  if (targetId === _dragTileId) { _dragTileId = null; return; }
  const arr = m.tileOrder;
  const fromIdx = arr.findIndex(t => t.id === _dragTileId);
  const toIdx = arr.findIndex(t => t.id === targetId);
  _dragTileId = null;
  if (fromIdx === -1 || toIdx === -1) return;
  const [moved] = arr.splice(fromIdx, 1);
  arr.splice(toIdx, 0, moved);
  render();
});

(async function init() {
  // Coming back from Microsoft sign-in: api/auth-microsoft.js's callback step
  // redirects to /?ssoTicket=... (success) or /?ssoError=<code> (denied /
  // failed). Handled before restoreSession() so it takes priority even if
  // an old/expired local session happens to still be sitting in
  // localStorage. Query string is stripped immediately either way — the
  // ticket is single-purpose and only valid for ~60s, but there's no
  // reason to leave it sitting in the visible URL even for that long.
  const qp = new URLSearchParams(location.search);
  const ssoTicket = qp.get('ssoTicket'), ssoError = qp.get('ssoError');
  if (ssoTicket || ssoError) history.replaceState({}, '', location.pathname);

  if (ssoTicket) {
    try {
      const r = await fetch('/api/auth-microsoft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket: ssoTicket }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Microsoft sign-in failed');
      await finishLogin(d);
    } catch (err) {
      S.authMessage = err.message || 'Microsoft sign-in failed'; render();
    }
    return;
  }
  if (ssoError) { S.authMessage = ssoErrorMessage(ssoError); render(); return; }

  const sess = restoreSession();
  if (sess && sess.token && sess.user) {
    S.sessionToken = sess.token; S.user = sess.user;
    document.getElementById('app').innerHTML = renderAppSkeleton();
    try {
      const cl = await apiRead('data/clients.json'); S.clients = cl.content; S.shas.clients = cl.sha;
      try { const ul = await apiRead('data/users.json'); S.usersForDropdown = ul.content.map(u => ({ id: u.id, name: u.name || u.username, role: u.role, username: u.username })); if (can('admin')) { S.users = ul.content; S.shas.users = ul.sha; } }
      catch (e) { S.usersForDropdown = [{ id: S.user.id, name: S.user.name || S.user.username, role: S.user.role, username: S.user.username }]; }
      const fromUrl = location.pathname && location.pathname !== '/' ? pathToView(location.pathname) : null;
      if (fromUrl && validateView(fromUrl.view, fromUrl.params || {})) { navigate(fromUrl.view, fromUrl.params || {}, { fromPopState: true, skipTransition: true }); history.replaceState({ view: fromUrl.view, params: fromUrl.params }, '', viewToPath(fromUrl.view, fromUrl.params)); }
      else {
        const rv = restoreView();
        if (rv && rv.view && validateView(rv.view, rv.params || {})) { navigate(rv.view, rv.params || {}, { skipTransition: true }); }
        else { navigate('dashboard', {}, { skipTransition: true }); }
      }
      clearInterval(_bgRefreshTimer);
      _bgRefreshTimer = setInterval(backgroundRefreshClients, 60000);
    } catch (e) {
      clearInterval(_bgRefreshTimer); _bgRefreshTimer = null;
      clearSession(); S.user = null; S.sessionToken = null; S.view = 'login'; render();
    }
  } else {
    if (location.pathname && location.pathname !== '/' && location.pathname !== '/login') S.pendingPath = location.pathname;
    render();
  }
})();