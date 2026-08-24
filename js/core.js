const KOGNOZ_LOGO = "/kognoz_Iogo.png";
let _bgRefreshTimer = null; // Phase 2 staleness-reduction poll, started on login, stopped on logout
// ─── STATE ────────────────────────────────────────────────────────
const S = { user: null, clients: [], archivedClients: [], users: [], usersForDropdown: [], shas: { clients: null, users: null }, sessionToken: null, view: 'login', params: {}, adminTab: 'integrations', filter: 'all', search: '', modal: null, toast: null, sidebarCollapsed: false, mobileSidebarOpen: false, sidebarClientsOpen: false, sort: { key: 'name', dir: 'asc' }, editingTimelineId: null, expandedHistory: new Set(), amsFrom: '', amsTo: '', amsQuick: '', editingAmsEntryId: null, expandedAmsHistory: new Set(), selectedAmsEntryId: null, selectedIntegId: null, openExportMenu: null, cmdPaletteOpen: false, cmdQuery: '', cmdSelectedIdx: 0, recentlyViewed: [], darkMode: false, shortcutsHelpOpen: false, bulkImplMode: false, bulkImplCid: null, bulkSelected: new Set(), offlineMode: false, bulkIntegMode: false, bulkIntegCid: null, bulkIntegSelected: new Set(), dashAttnSort: { key: 'reason', dir: 'desc' }, dashClientSort: { key: 'name', dir: 'asc' }, dashAssigneeSort: { key: 'total', dir: 'desc' }, dashAssigneeSearch: '', dashAssigneeExpanded: new Set(), dashCapacityExpanded: new Set(), dashAssigneeFilter: 'all', dashCritSearch: '', dashCritFilter: 'all', adminSearch: '', auditRows: [], auditTotal: 0, auditPage: 0, auditPageSize: 50, auditFrom: '', auditTo: '', auditUser: '', auditSearch: '', auditLoading: false, auditLoaded: false, snapshotHistory: [], snapshotChecked: false, snapshotHistoryFetched: false, capacityWeights: { module: 1, pmo: 0.5, ams: 0.25, cap: 5 }, capacityWeightsFetched: false, digestRecipients: { emails: [] }, digestRecipientsFetched: false, pendingPath: null, authMessage: null, integRailFilter: '', integRailSort: 'name', integMineOnly: false, lastActiveMap: {}, lastActiveFetched: false, viewAsRole: null, bulkUserMode: false, bulkUserSelected: new Set(), pomodoro: null, pomodoroModePref: 'simple' };

try { S.sidebarCollapsed = localStorage.getItem('itk_sb_collapsed') === '1'; } catch (e) { }
try { const r = localStorage.getItem('itk_recent'); if (r) S.recentlyViewed = JSON.parse(r); } catch (e) { }
try { S.darkMode = localStorage.getItem('itk_dark') === '1'; } catch (e) { }
if (S.darkMode) document.documentElement.classList.add('dark');

// ─── CONSTANTS — KOGNOZ BRAND ─────────────────────────────────────
const STATUSES = ['Not Started', 'In Progress', 'At Risk', 'On Hold — Internal', 'On Hold — Client', 'Pending Client', 'Under Review', 'Delayed', 'Cancelled', 'Completed'];
const ROLES = ['viewer', 'editor', 'admin'];
const PHASES = ['BPU', 'BPU Signoff', 'CRP', 'CRP Signoff', 'UAT', 'UAT Signoff', 'Data Migration / Production Migration', 'Go Live', 'Hypercare'];
const SIGNOFF_PHASES = ['BPU Signoff', 'CRP Signoff', 'UAT Signoff'];
const CURRENCIES = { INR: { symbol: '₹', code: 'INR' }, USD: { symbol: '$', code: 'USD' } };
const MILESTONE_STATUSES = ['Pending', 'Achieved', 'Missed'];
const AMS_TYPES = ['Bug Fix', 'Enhancement', 'Config Change', 'Support Ticket', 'Reporting', 'Training', 'Meeting', 'Consultation'];
const AMS_QUERY_LEVELS = ['L1 - Low', 'L2 - Medium', 'L3 - High', 'L4 - Critical'];
const AMS_ENTRY_STATUSES = ['Open', 'In Progress', 'Closed'];
const AMS_MODES = ['Online / Remote', 'Offline / In-person'];
const HOURS_PER_DAY = 8;
const TEAL = '0e7490', TEAL_DARK = '0d3d4f', MAGENTA = 'b5179e', VIOLET = '7c3aed', BLUE_ACCENT = '2563eb';
const SBG = { 'Completed': 'k-status k-status-completed', 'In Progress': 'k-status k-status-inprogress', 'At Risk': 'k-status k-status-atrisk', 'On Hold — Internal': 'k-status k-status-onhold', 'On Hold — Client': 'k-status k-status-onhold', 'Pending Client': 'k-status k-status-pending', 'Under Review': 'k-status k-status-review', 'Delayed': 'k-status k-status-delayed', 'Cancelled': 'k-status k-status-cancelled', 'Not Started': 'k-status k-status-notstarted' };
const SHEX = { 'Completed': '22c55e', 'In Progress': '0e7490', 'At Risk': 'be185d', 'On Hold — Internal': '7c3aed', 'On Hold — Client': '9333ea', 'Pending Client': 'd97706', 'Under Review': '0284c7', 'Delayed': 'ea580c', 'Cancelled': '94a3b8', 'Not Started': '64748b' };
const SDOT = Object.fromEntries(Object.entries(SHEX).map(([s, hex]) => [s, `#${hex}`]));
const SRGB = { 'Completed': [34, 197, 94], 'In Progress': [14, 116, 144], 'At Risk': [190, 24, 93], 'On Hold — Internal': [124, 58, 237], 'On Hold — Client': [147, 51, 234], 'Pending Client': [217, 119, 6], 'Under Review': [2, 132, 199], 'Delayed': [234, 88, 12], 'Cancelled': [148, 163, 184], 'Not Started': [100, 116, 139] };

// ─── UTILS ────────────────────────────────────────────────────────
async function sha256(str) { const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)); return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''); }
function persistSession(token, user) { try { localStorage.setItem('itk_sess', btoa(JSON.stringify({ token, user }))); } catch (e) { } }
function clearSession() { try { localStorage.removeItem('itk_sess'); localStorage.removeItem('itk_view'); } catch (e) { } }
function restoreSession() { try { const r = localStorage.getItem('itk_sess'); return r ? JSON.parse(atob(r)) : null; } catch (e) { return null; } }
function persistView(view, params) { try { if (view === 'login') return; localStorage.setItem('itk_view', JSON.stringify({ view, params })); } catch (e) { } }
function restoreView() { try { const r = localStorage.getItem('itk_view'); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
function validateView(view, params) {
  if (['dashboard', 'clients', 'impl-clients', 'ams-clients', 'admin'].includes(view)) return true;
  if (view === 'client-detail' || view === 'impl-client-detail' || view === 'ams-client-detail') return !!S.clients.find(x => x.id === params.clientId);
  if (view === 'integ-detail') { const c = S.clients.find(x => x.id === params.clientId); return !!(c && c.integrations.find(x => x.id === params.integId)); }
  if (view === 'impl-phase-detail') { const c = S.clients.find(x => x.id === params.clientId); if (!c) return false; const m = (c.modules || []).find(x => x.id === params.moduleId); return !!(m && (m.phases || []).find(p => p.name === params.phase)); }
  return false;
}
// Offline detection
window.addEventListener('online', () => { S.offlineMode = false; render(); });
window.addEventListener('offline', () => { S.offlineMode = true; render(); });
// Undo delete
let _undoTimer = null, _undoFn = null;
function scheduleUndo(label, undoFn) {
  if (_undoTimer) clearTimeout(_undoTimer);
  _undoFn = undoFn;
  showToast(`${label} — undo?`, 'warn', 5000, 'undo-delete');
  _undoTimer = setTimeout(() => { _undoFn = null; _undoTimer = null; }, 5000);
}
function execUndo() { if (_undoFn) { _undoFn(); _undoFn = null; if (_undoTimer) { clearTimeout(_undoTimer); _undoTimer = null; } showToast('Restored ✓'); } }
function assigneeSelect(id, currentVal = '', extra = '') {
  const users = (S.usersForDropdown || []).filter(u => u.role === 'admin' || u.role === 'editor');
  if (!users.length) return `<input id="${id}" type="text" value="${esc(currentVal)}" placeholder="Assignee name" ${extra} class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/>`;
  return `<select id="${id}" ${extra} class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"><option value="">— Unassigned —</option>${users.map(u => `<option value="${esc(u.name)}"${u.name === currentVal ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}</select>`;
}
function assigneeOptionsOnly(currentVal = '') {
  const users = (S.usersForDropdown || []).filter(u => u.role === 'admin' || u.role === 'editor');
  return `<option value="">— Unassigned —</option>${users.map(u => `<option value="${esc(u.name)}"${u.name === currentVal ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}`;
}
function fileIcon(url = '', mimeType = '') {
  const u = url.toLowerCase(); const m = mimeType.toLowerCase();
  if (m.includes('pdf') || u.endsWith('.pdf')) return '📄';
  if (m.includes('sheet') || m.includes('excel') || u.endsWith('.xlsx') || u.endsWith('.xls')) return '📊';
  if (m.includes('image') || u.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/)) return '🖼';
  if (m.includes('rfc822') || m.includes('outlook') || u.match(/\.(eml|msg)(\?|$)/)) return '📧';
  return '📎';
}
// Extension -> canonical mimeType. Upload trusts this map, not the browser's
// reported file.type — browsers are inconsistent about what type (if any)
// they report for .eml/.msg (often '' or application/octet-stream depending
// on OS file association), which would otherwise get silently rejected
// server-side even for a genuinely valid email export.
const ATTACH_EXT_MIME = {
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.eml': 'message/rfc822',
  '.msg': 'application/vnd.ms-outlook',
};
async function uploadAttachment(file) {
  const MAX = 3 * 1024 * 1024;
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  const canonicalMime = ATTACH_EXT_MIME[ext];
  if (!canonicalMime) throw new Error(`Extension "${ext}" not supported. Use PDF, Excel (.xlsx/.xls), images (JPG, PNG, GIF, WEBP), or email (.eml, .msg).`);
  if (file.size > MAX) throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max is 3MB.`);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async e => {
      const base64 = e.target.result.split(',')[1];
      try {
        const r = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-token': S.sessionToken || '' }, body: JSON.stringify({ base64, fileName: file.name, mimeType: canonicalMime }) });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Upload failed');
        resolve(data);
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
function attachmentChip(att) {
  if (!att?.url) return '';
  const icon = fileIcon(att.url, att.mimeType || '');
  const name = att.fileName || att.label || 'Attachment';
  return `<a href="${esc(att.url)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 text-[11px] text-[#0e7490] hover:underline mt-1.5 bg-[#0e7490]/8 px-2 py-0.5 rounded-full max-w-full" title="${esc(name)}">${icon} <span class="truncate max-w-[200px]">${esc(name)}</span></a>`;
}
function parseUsersCsv(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (!lines.length) return [];
  const hasHeader = lines[0].toLowerCase().includes('username');
  const dataLines = hasHeader ? lines.slice(1) : lines;
  return dataLines.map((line, i) => {
    const p = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    const [username, full_name, role, email, password] = p;
    let error = null;
    if (!username) error = 'Username required';
    else if (!full_name) error = 'Full name required';
    else if (!role || !ROLES.includes(role.toLowerCase())) error = `Role must be: ${ROLES.join('/')}`;
    else if (!password) error = 'Password required';
    else if ((S.users || []).find(u => u.username === username)) error = `"${username}" already exists`;
    return { username, name: full_name, role: role?.toLowerCase(), email: email || '', password, error, row: i + (hasHeader ? 2 : 1) };
  });
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
const IS_MAC = /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
function kbdHint(letter) { return IS_MAC ? `⌘${letter}` : `Ctrl+${letter}`; }
// Eye / eye-slash toggle button for a password field. Pure DOM toggle (see
// the 'toggle-pwd' handler in events.js) — deliberately does NOT call
// render(), since these inputs aren't bound to S state; re-rendering would
// wipe out whatever the person had already typed.
function pwdToggleBtn(targetId) {
  return `<button type="button" data-act="toggle-pwd" data-target="${targetId}" tabindex="-1" aria-label="Show password" style="position:absolute;right:9px;top:50%;transform:translateY(-50%);background:none;border:none;padding:2px;cursor:pointer;color:var(--mute-2,#9ca3af);display:flex;align-items:center;line-height:0;">
    <svg data-eye-open width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/></svg>
    <svg data-eye-closed width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" style="display:none;"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/><line x1="1" y1="1" x2="15" y2="15"/></svg>
  </button>`;
}
function fmtDate(s) { if (!s) return '—'; try { return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return s; } }
function fmtDateTime(s) { if (!s) return '—'; try { return new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return s; } }
function can(p) {
  if (!S.user) return false;
  const r = { admin: 3, editor: 2, viewer: 1 };
  // "View As" preview: an admin can temporarily see the app as an editor/viewer
  // would. This ONLY affects this client-side gate — the real session token
  // still carries the real role, so nothing is actually granted or revoked;
  // it's a UI preview for the admin's own account, never a real permission change.
  const effectiveRole = (S.user.role === 'admin' && S.viewAsRole) ? S.viewAsRole : S.user.role;
  return (r[effectiveRole] || 0) >= (r[p] || 0);
}
function recordRecent(view, params) {
  let entry = null;
  if (view === 'client-detail') { const c = S.clients.find(x => x.id === params.clientId); if (c) entry = { type: 'client', label: c.name, sub: 'Integration Client', view, params: { clientId: c.id } }; }
  else if (view === 'integ-detail') { const c = S.clients.find(x => x.id === params.clientId); const i = c?.integrations.find(x => x.id === params.integId); if (c && i) entry = { type: 'integ', label: i.name, sub: `Integration · ${c.name}`, view, params: { clientId: c.id, integId: i.id } }; }
  else if (view === 'impl-client-detail') { const c = S.clients.find(x => x.id === params.clientId); if (c) entry = { type: 'implClient', label: c.name, sub: 'Implementation Client', view, params: { clientId: c.id } }; }
  else if (view === 'ams-client-detail') { const c = S.clients.find(x => x.id === params.clientId); if (c) entry = { type: 'amsClient', label: c.name, sub: 'AMS Client', view, params: { clientId: c.id } }; }
  if (!entry) return;
  const key = `${entry.view}:${entry.params.integId || entry.params.projectId || entry.params.clientId}`;
  S.recentlyViewed = S.recentlyViewed.filter(r => `${r.view}:${r.params.integId || r.params.projectId || r.params.clientId}` !== key);
  S.recentlyViewed.unshift(entry);
  S.recentlyViewed = S.recentlyViewed.slice(0, 8);
  try { localStorage.setItem('itk_recent', JSON.stringify(S.recentlyViewed)); } catch (e) { }
}
// ─── URL routing — clean paths, no server routing changes needed ──
// (Vercel rewrites every non-/api path to index.html; all real routing
// logic lives here, client-side, same as the rest of this app.)
function viewToPath(view, params = {}) {
  const e = v => encodeURIComponent(v ?? '');
  switch (view) {
    case 'dashboard': return '/dashboard';
    case 'clients': return '/integrations';
    case 'client-detail': return `/integrations/${e(params.clientId)}`;
    case 'integ-detail': return `/integrations/${e(params.clientId)}/${e(params.integId)}`;
    case 'impl-clients': return '/implementation';
    case 'impl-client-detail': return `/implementation/${e(params.clientId)}`;
    case 'impl-phase-detail': return `/implementation/${e(params.clientId)}/${e(params.moduleId)}/${e(params.phase)}`;
    case 'ams-clients': return '/ams';
    case 'ams-client-detail': return `/ams/${e(params.clientId)}`;
    case 'admin': return '/admin';
    case 'login': return '/login';
    default: return '/dashboard';
  }
}
function pathToView(pathname) {
  const d = v => decodeURIComponent(v);
  const seg = pathname.split('/').filter(Boolean);
  if (!seg.length) return { view: 'dashboard', params: {} };
  const [root, ...rest] = seg;
  if (root === 'dashboard') return { view: 'dashboard', params: {} };
  if (root === 'integrations') {
    if (rest.length === 0) return { view: 'clients', params: {} };
    if (rest.length === 1) return { view: 'client-detail', params: { clientId: d(rest[0]) } };
    if (rest.length === 2) return { view: 'integ-detail', params: { clientId: d(rest[0]), integId: d(rest[1]) } };
  }
  if (root === 'implementation') {
    if (rest.length === 0) return { view: 'impl-clients', params: {} };
    if (rest.length === 1) return { view: 'impl-client-detail', params: { clientId: d(rest[0]) } };
    if (rest.length === 3) return { view: 'impl-phase-detail', params: { clientId: d(rest[0]), moduleId: d(rest[1]), phase: d(rest[2]) } };
  }
  if (root === 'ams') {
    if (rest.length === 0) return { view: 'ams-clients', params: {} };
    if (rest.length === 1) return { view: 'ams-client-detail', params: { clientId: d(rest[0]) } };
  }
  if (root === 'admin') return { view: 'admin', params: {} };
  if (root === 'login') return { view: 'login', params: {} };
  return null; // unrecognized path
}
function navigate(view, params = {}, opts = {}) {
  const isRealNav = S.view !== view;
  const go = () => {
    S.view = view; S.params = params; S.filter = 'all'; S.search = ''; S.modal = null; S.sort = { key: 'name', dir: 'asc' }; S.editingTimelineId = null; S.expandedHistory = new Set(); S.bulkImplMode = false; S.bulkImplCid = null; S.bulkSelected = new Set(); S.selectedAmsEntryId = null; S.selectedIntegId = null; S.openExportMenu = null; recordRecent(view, params); persistView(view, params);
    if (!opts.fromPopState) {
      const path = viewToPath(view, params);
      if (location.pathname !== path) history.pushState({ view, params }, '', path);
    }
    render();
  };
  if (isRealNav && document.startViewTransition && !opts.skipTransition) {
    try { document.startViewTransition(go); } catch (e) { go(); }
  } else {
    go();
  }
}
window.addEventListener('popstate', (e) => {
  if (!S.user) return; // not logged in — nothing meaningful to restore client-side
  const resolved = e.state || pathToView(location.pathname);
  if (resolved && validateView(resolved.view, resolved.params || {})) navigate(resolved.view, resolved.params || {}, { fromPopState: true });
  else navigate('dashboard', {}, { fromPopState: true });
});
function todayStr() { return new Date().toISOString().slice(0, 10); }
function daysDiff(dateStr) { if (!dateStr) return null; const d = new Date(dateStr + 'T00:00:00'); const t = new Date(todayStr() + 'T00:00:00'); return Math.round((t - d) / 86400000); }
function isOverdue(i) { if (i.status === 'Completed' || !i.dueDate) return false; return daysDiff(i.dueDate) > 0; }
function daysOverdue(i) { return daysDiff(i.dueDate); }
function lastUpdateDate(i) { return i.timeline?.[0]?.date || null; }
function isStale(i, days = 7) { if (i.status === 'Completed') return false; const lu = lastUpdateDate(i); if (!lu) return true; return daysDiff(lu) >= days; }
function overdueBadge(i) { if (!isOverdue(i)) return ''; const d = daysOverdue(i); return `<span class="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">⏰ ${d}d overdue</span>`; }
// Staleness badge — distinct from overdueBadge (no due date needed to trigger
// this one). Never shown alongside overdueBadge; overdue already says enough.
function staleBadge(i) { if (isOverdue(i) || !isStale(i, 7)) return ''; const lu = lastUpdateDate(i); const d = lu ? daysDiff(lu) : null; return `<span class="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">🕐 ${d !== null ? d + 'd stale' : 'No updates'}</span>`; }
// Urgency color for a Pending milestone, based on due-date proximity — Achieved/Missed
// milestones don't call this, they keep their own fixed green/rose.
function milestoneUrgencyColor(ms) { if (!ms.dueDate) return 'amber'; const d = daysDiff(ms.dueDate); if (d > 0) return 'rose'; if (d >= -3) return 'orange'; return 'amber'; }
function healthColor(c) { const integs = c.integrations || []; const ar = integs.filter(i => i.status === 'At Risk').length; const od = integs.filter(isOverdue).length; if (ar > 0 || od > 0) return 'bg-rose-500'; const oh = integs.filter(i => i.status === 'On Hold — Internal' || i.status === 'On Hold — Client').length; if (oh > 0) return 'bg-violet-400'; return 'bg-green-500'; }
function healthVar(c) { const cls = healthColor(c); if (cls === 'bg-rose-500') return 'var(--red)'; if (cls === 'bg-violet-400') return `#${VIOLET}`; return 'var(--green)'; }

// Discrete Red/Amber/Green labels (not just CSS colors) — used by the
// Portfolio Health Scorecard and snapshot capture to combine all three
// domains into one glance per client.
function integRagLabel(c) {
  const integs = c.integrations || [];
  if (!integs.length) return null;
  const ar = integs.filter(i => i.status === 'At Risk').length;
  const od = integs.filter(isOverdue).length;
  if (ar > 0 || od > 0) return 'Red';
  const stale = integs.filter(i => isStale(i, 7) && !isOverdue(i)).length;
  if (stale > 0) return 'Amber';
  return 'Green';
}
function overallRagLabel(...rags) {
  const present = rags.filter(Boolean);
  if (!present.length) return null;
  if (present.includes('Red')) return 'Red';
  if (present.includes('Amber')) return 'Amber';
  return 'Green';
}
const RAG_HEX = { Red: 'var(--red)', Amber: 'var(--amber)', Green: 'var(--green)' };

// Snapshot capture — fire-and-forget, once per browser session per day.
// Idempotent server-side (upsert on date+client), so calling this more than
// once (multiple tabs, multiple people opening Dashboard the same day) is safe.
function buildSnapshotRows() {
  return S.clients.map(c => {
    const integTotal = c.integrations?.length || 0;
    const integAtRisk = (c.integrations || []).filter(i => i.status === 'At Risk').length;
    const integInProgress = (c.integrations || []).filter(i => i.status === 'In Progress').length;
    const integCompleted = (c.integrations || []).filter(i => i.status === 'Completed').length;
    const isImpl = c.modules !== undefined;
    const implRag = isImpl ? implAutoRag(c) : null;
    const pr = isImpl ? implProgress(c) : { completed: 0, total: 0 };
    const isAms = c.workLog !== undefined;
    const amsRag = isAms ? amsClientRag(c) : null;
    const openEntries = (c.workLog || []).filter(e => e.entryStatus !== 'Closed');
    const amsOpenL3L4 = openEntries.filter(e => { const q = e.queryLevel || ''; return q.includes('L3') || q.includes('L4'); }).length;
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    const amsHoursMonth = isAms ? amsTotals(c, monthStart, todayStr()).totalHours : 0;
    const overallRag = overallRagLabel(integRagLabel(c), implRag, amsRag);
    return {
      clientId: c.id, clientName: c.name, integTotal, integAtRisk, integInProgress, integCompleted,
      implRag, implTotalPhases: pr.total, implCompletedPhases: pr.completed,
      amsRag, amsOpenEntries: openEntries.length, amsOpenL3L4, amsHoursMonth, overallRag
    };
  });
}
async function ensureSnapshotCaptured() {
  const today = todayStr();
  if (S.snapshotChecked) return;
  S.snapshotChecked = true;
  try {
    const rows = buildSnapshotRows();
    if (!rows.length) return;
    await fetch('/api/snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-token': S.sessionToken || '' }, body: JSON.stringify({ rows }) });
  } catch (e) {/* never let snapshot capture break the dashboard */ }
}
// Manual "Recompute Snapshot Now" (Admin → System Maintenance) — reuses the
// exact same row-building + upsert-by-date logic as the automatic daily
// capture above (idempotent on the server, so calling it early/again is safe).
async function recomputeSnapshotNow() {
  const rows = buildSnapshotRows();
  if (!rows.length) throw new Error('No clients to snapshot');
  const r = await fetch('/api/snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-token': S.sessionToken || '' }, body: JSON.stringify({ rows }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Snapshot failed');
  S.snapshotHistoryFetched = false; // force the trend history to refetch next time it's shown
  return d;
}
// "Last Active" (Admin → Users) — reuses the existing admin-only /api/audit
// endpoint rather than a new backend route: one call for "Login success"
// rows ordered newest-first, reduced client-side to the first (= most
// recent) row per username.
async function loadLastActive() {
  if (S.lastActiveFetched) return;
  S.lastActiveFetched = true;
  try {
    const r = await fetch(`/api/ops?op=audit&q=${encodeURIComponent('Login success')}&limit=200`, { headers: { 'x-session-token': S.sessionToken || '' } });
    if (!r.ok) return;
    const d = await r.json();
    const map = {};
    (d.rows || []).forEach(row => { if (row.username && !map[row.username]) map[row.username] = row.ts; });
    S.lastActiveMap = map;
    render();
  } catch (e) {/* non-critical, table just shows "Never" */ }
}
async function fetchSnapshotHistory(days = 14) {
  if (S.snapshotHistoryFetched) return;
  S.snapshotHistoryFetched = true;
  try {
    const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const r = await fetch(`/api/snapshot?from=${from}`, { headers: { 'x-session-token': S.sessionToken || '' } });
    if (!r.ok) return;
    const d = await r.json();
    S.snapshotHistory = d.rows || [];
    render();
  } catch (e) {/* trend is a nice-to-have, never block on it */ }
}
// ─── DASHBOARD TILE CUSTOMIZATION ──────────────────────────────────
// Per-person (keyed by username, not just per-browser) drag-and-drop
// tile order + show/hide, stored in localStorage like dark-mode/sidebar
// prefs already are. Registry is the default order/set — anything the
// person hasn't customized yet just uses this.
const DASH_TILE_REGISTRY = [
  { id: 'critical-items', label: 'Critical Items' },
  { id: 'health-scorecard', label: 'Portfolio Health Scorecard' },
  { id: 'upcoming-deadlines', label: 'Upcoming Deadlines' },
  { id: 'ams-workmix', label: 'AMS Work-Mix' },
  { id: 'severity-aging', label: 'Severity & Aging' },
  { id: 'phase-funnel', label: 'Phase-Stage Funnel' },
  { id: 'financial-rollup', label: 'Financial Rollup' },
  { id: 'data-hygiene', label: 'Data Hygiene Score' },
  { id: 'blockers', label: 'Blockers / Dependencies' },
  { id: 'team-bandwidth', label: 'Team Bandwidth', adminOnly: true },
];
function dashLayoutKey() { return `itk_dash_layout_${(S.user?.username || 'default').toLowerCase()}`; }
function getDashLayout() {
  let saved = null;
  try { const r = localStorage.getItem(dashLayoutKey()); if (r) saved = JSON.parse(r); } catch (e) { }
  if (!Array.isArray(saved)) return DASH_TILE_REGISTRY.map(t => ({ id: t.id, visible: true }));
  // Merge forward: any tile in the registry that isn't in the saved layout yet
  // (e.g. Team Bandwidth, added after someone last customized) gets appended,
  // visible by default, instead of silently disappearing.
  const knownIds = new Set(saved.map(s => s.id));
  const merged = saved.filter(s => DASH_TILE_REGISTRY.some(t => t.id === s.id)); // drop stale ids from old registry versions
  DASH_TILE_REGISTRY.forEach(t => { if (!knownIds.has(t.id)) merged.push({ id: t.id, visible: true }); });
  return merged;
}
function saveDashLayout(tileOrder) {
  try { localStorage.setItem(dashLayoutKey(), JSON.stringify(tileOrder.map(t => ({ id: t.id, visible: t.visible })))); } catch (e) { }
}

async function fetchCapacityWeights() {
  if (S.capacityWeightsFetched) return;
  S.capacityWeightsFetched = true;
  try {
    const r = await fetch('/api/ops?op=settings', { headers: { 'x-session-token': S.sessionToken || '' } });
    if (!r.ok) return;
    const d = await r.json();
    if (d.capacityWeights) S.capacityWeights = d.capacityWeights;
    render();
  } catch (e) {/* falls back to defaults already in state, never block on it */ }
}
async function saveCapacityWeights(newWeights) {
  const r = await fetch('/api/ops?op=settings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-token': S.sessionToken || '' }, body: JSON.stringify({ key: 'capacity_weights', value: newWeights }) });
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Failed to save weights'); }
  S.capacityWeights = newWeights;
}
// Fallback recipient list for the daily-digest cron (api/cron/daily-digest.js)
// — unassigned/unmatched items get routed to these addresses instead of
// silently disappearing. Same fetch-once/cache pattern as capacity weights.
async function fetchDigestRecipients() {
  if (S.digestRecipientsFetched) return;
  S.digestRecipientsFetched = true;
  try {
    const r = await fetch('/api/ops?op=settings', { headers: { 'x-session-token': S.sessionToken || '' } });
    if (!r.ok) return;
    const d = await r.json();
    if (d.digestRecipients) S.digestRecipients = d.digestRecipients;
    render();
  } catch (e) {/* falls back to defaults already in state, never block on it */ }
}
async function saveDigestRecipients(newValue) {
  const r = await fetch('/api/ops?op=settings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-token': S.sessionToken || '' }, body: JSON.stringify({ key: 'digest_recipients', value: newValue }) });
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Failed to save recipients'); }
  S.digestRecipients = newValue;
}
// Shared card visual for Integration + Implementation client-list cards —
// a small progress ring (health % + color) paired with a metric strip below.
// Keeping this in one place means both domains' cards can never drift apart
// again the way the old bespoke card markup did.
function ringSvg(pct, color, size = 48) {
  const p = Math.max(0, Math.min(100, Math.round(pct || 0)));
  const r = (size - 10) / 2, circ = 2 * Math.PI * r, off = circ - (p / 100) * circ;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="shrink-0">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="5"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="5" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" stroke-linecap="round" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="${size / 2}" y="${size / 2 + 4}" text-anchor="middle" font-size="12" font-weight="600" fill="var(--ink)">${p}%</text>
  </svg>`;
}
function miniStat(value, label, color) {
  return `<div><div class="text-base font-semibold text-gray-900"${color ? ` style="color:${color}"` : ''}>${value}</div><div class="text-[11px] text-gray-400">${esc(label)}</div></div>`;
}
function emptyIcon(type) { const icons = { search: '🔍', inbox: '📭', clock: '🕐', chart: '📊', doc: '📄', hours: '⏱️', team: '👥' }; return `<div class="text-3xl mb-2 opacity-30">${icons[type] || '📭'}</div>`; }
// Deterministic avatar color per person, used in the Activity feed (chat-style
// update entries) — same person always gets the same color across renders.
const AVATAR_PALETTE = [['#dbeafe', '#1e40af'], ['#dcfce7', '#166534'], ['#fef3c7', '#92400e'], ['#fce7f3', '#9d174d'], ['#ede9fe', '#5b21b6'], ['#e0f2fe', '#0369a1']];
function initials(name) { const p = (name || '?').trim().split(/\s+/); return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?'; }
function avatarChip(name, size = 32) {
  let h = 0; for (const ch of (name || '?')) h = (h + ch.charCodeAt(0)) | 0;
  const [bg, fg] = AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
  return `<div class="rounded-full flex items-center justify-center font-semibold shrink-0" style="width:${size}px;height:${size}px;background:${bg};color:${fg};font-size:${Math.round(size * 0.38)}px">${esc(initials(name))}</div>`;
}

let _tt;
function showToast(msg, type = 'success', duration = 3500, action = null) {
  S.toast = { msg, type };
  const el = document.getElementById('toast');
  const bg = { success: '#15803d', error: '#b91c1c', info: '#18181b', warn: '#a16207' }[type] || '#18181b';
  const icon = { success: '✓', error: '✕', info: 'i', warn: '!' }[type] || '✓';
  const style = `position:fixed;bottom:20px;right:20px;z-index:100;background:${bg};color:#fff;font-size:13px;font-weight:500;padding:10px 14px;border-radius:6px;box-shadow:0 8px 24px -4px rgba(0,0,0,.25);display:flex;align-items:center;gap:8px;letter-spacing:-0.005em;`;
  const undoBtn = action === 'undo-delete' ? `<button data-act="exec-undo" style="margin-left:6px;padding:2px 8px;background:rgba(255,255,255,.15);border-radius:3px;color:#fff;font-weight:600;font-size:11px;letter-spacing:0.02em;text-transform:uppercase;">Undo</button>` : '';
  const html = `<span style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:rgba(255,255,255,.15);font-size:10px;font-weight:700;">${icon}</span><span>${esc(msg)}</span>${undoBtn}`;
  if (el) { el.className = 'toast-in'; el.style.cssText = style; el.innerHTML = html; el.style.display = 'flex'; }
  else { const d = document.createElement('div'); d.id = 'toast'; d.className = 'toast-in'; d.style.cssText = style; d.innerHTML = html; document.body.appendChild(d); }
  if (_tt) clearTimeout(_tt); _tt = setTimeout(() => { const x = document.getElementById('toast'); if (x) x.style.display = 'none'; }, duration);
}

// ─── GLOBAL LOADING BAR + CENTER OVERLAY ──────────────────────────
let _loadingCount = 0;
let _overlayTimer = null;
let _overlayTextTimer = null;
const OVERLAY_DELAY_MS = 200; // only show the center blur overlay if the op is still running after this — keeps quick inline edits (status/assignee dropdowns etc.) feeling instant instead of flashing a blur
const OVERLAY_TEXT_INTERVAL_MS = 1600;
// Playful cycling status words — same idea as Claude's own "thinking" labels.
// Order is randomized per appearance so it doesn't feel scripted on repeat use.
const OVERLAY_PHRASES = ['Loading…', 'Fetching…', 'Syncing…', 'Organizing…', 'Sifting through data…', 'Tidying up…', 'Almost there…', 'Double-checking…', 'Chasing down updates…', 'Crunching RAG status…', 'Lining up phases…', 'Reconciling client records…', 'Counting overdue items…', 'Polishing the dashboard…', 'Herding integrations…', 'Balancing the ledger…'];
//const OVERLAY_PHRASES = ['Loading…', 'Fetching…', 'Syncing…', 'Organizing…', 'Sifting through data…', 'Tidying up…', 'Almost there…', 'Double-checking…'];
function startLoadingTextCycle() {
  const el = document.getElementById('loading-overlay-text'); if (!el) return;
  let pool = [...OVERLAY_PHRASES].sort(() => Math.random() - 0.5);
  let i = 0;
  el.textContent = pool[0];
  if (_overlayTextTimer) clearInterval(_overlayTextTimer);
  _overlayTextTimer = setInterval(() => {
    i = (i + 1) % pool.length;
    if (i === 0) pool = [...OVERLAY_PHRASES].sort(() => Math.random() - 0.5); // reshuffle each full lap
    el.textContent = pool[i];
  }, OVERLAY_TEXT_INTERVAL_MS);
}
function stopLoadingTextCycle() {
  if (_overlayTextTimer) { clearInterval(_overlayTextTimer); _overlayTextTimer = null; }
}
function startLoading() {
  _loadingCount++;
  const b = document.getElementById('loading-bar'); if (b) { b.style.opacity = '1'; b.style.width = '65%'; }
  if (!_overlayTimer) {
    _overlayTimer = setTimeout(() => {
      _overlayTimer = null;
      if (_loadingCount > 0) { const o = document.getElementById('loading-overlay'); if (o) o.classList.add('visible'); startLoadingTextCycle(); }
    }, OVERLAY_DELAY_MS);
  }
}
function stopLoading() {
  _loadingCount = Math.max(0, _loadingCount - 1);
  const b = document.getElementById('loading-bar');
  if (b && _loadingCount === 0) {
    b.style.width = '100%';
    setTimeout(() => { if (_loadingCount === 0) { b.style.opacity = '0'; b.style.width = '0%'; } }, 250);
  }
  if (_loadingCount === 0) {
    if (_overlayTimer) { clearTimeout(_overlayTimer); _overlayTimer = null; }
    const o = document.getElementById('loading-overlay'); if (o) o.classList.remove('visible');
    stopLoadingTextCycle();
  }
}
function spinnerSvg(extra = '') { return `<svg class="animate-spin h-3.5 w-3.5 ${extra}" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>`; }
// Shared click-toggle export dropdown — used identically across Integration,
// Implementation, and AMS detail pages. Deliberately click-driven, not
// hover-driven: a hover menu (:hover / group-hover) closes the instant the
// mouse leaves the button on the way to an item, which was reported as hard
// to actually click. A click toggle stays open until the person picks an
// item or clicks elsewhere (closed via the outside-click check in events.js).
function exportMenuButton(menuId, items) {
  const open = S.openExportMenu === menuId;
  return `<div class="relative inline-block" data-export-menu="${esc(menuId)}">
    <button data-act="toggle-export-menu" data-menu-id="${esc(menuId)}" class="flex items-center gap-1.5 btn-grad text-white text-sm font-medium px-4 py-2 rounded-xl transition">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>Export ▾
    </button>
    ${open ? `<div class="absolute right-0 top-full mt-1 bg-white border border-gray-100 rounded-xl shadow-xl w-56 py-1 z-20">
      ${items.map(it => `<button data-act="${esc(it.act)}"${Object.entries(it.data || {}).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('')} class="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">${it.label}</button>`).join('')}
    </div>`: ''}
  </div>`;
}
function setBtnBusy(el, label) { if (!el) return; el.dataset._origHtml = el.innerHTML; el.disabled = true; el.classList.add('btn-busy'); el.innerHTML = `<span class="inline-flex items-center justify-center gap-2">${spinnerSvg()}${label || 'Working…'}</span>`; }
function clearBtnBusy(el) { if (!el) return; if (el.dataset._origHtml !== undefined) { el.innerHTML = el.dataset._origHtml; delete el.dataset._origHtml; } el.disabled = false; el.classList.remove('btn-busy'); }
// ─── API ──────────────────────────────────────────────────────────
function forceReauth(msg) {
  clearInterval(_bgRefreshTimer); _bgRefreshTimer = null;
  clearSession(); S.user = null; S.sessionToken = null; S.authMessage = msg; S.view = 'login';
  render();
}
function authMessageFor(reason) {
  if (reason === 'expired') return 'Your session expired — please sign in again.';
  if (reason === 'revoked') return 'Your session was ended (a force-logout was issued) — please sign in again.';
  return 'You were signed out — please sign in again.';
}
async function apiRead(path) {
  startLoading();
  try {
    const r = await fetch(`/api/read?path=${encodeURIComponent(path)}`, { headers: { 'x-session-token': S.sessionToken || '' } });
    if (r.status === 401) {
      const d = await r.json().catch(() => ({}));
      forceReauth(authMessageFor(d.reason));
      throw new Error('Session ended');
    }
    if (!r.ok) throw new Error(`Read ${r.status}`);
    const d = await r.json();
    if (d.message && !d.content) throw new Error(d.message);
    return { content: JSON.parse(atob(d.content.replace(/\n/g, ''))), sha: d.sha };
  } finally { stopLoading(); }
}
async function apiReadSilent(path) {
  // Same as apiRead but skips the loading bar — used for background polling
  // that shouldn't visually interrupt whatever the person is doing.
  const r = await fetch(`/api/read?path=${encodeURIComponent(path)}`, { headers: { 'x-session-token': S.sessionToken || '' } });
  if (!r.ok) throw new Error(`Read ${r.status}`);
  const d = await r.json();
  if (d.message && !d.content) throw new Error(d.message);
  return { content: JSON.parse(atob(d.content.replace(/\n/g, ''))), sha: d.sha };
}
// Phase 2: reduce how stale a long-open tab gets, without ever discarding
// unsaved input. Runs silently on a timer — never while a modal is open
// (someone's actively filling out a form), and never for whichever single
// client the person currently has a detail page open on, since that page
// can hold in-progress inline edits (status/dates/next-action text) that
// were never routed through a modal and would otherwise get clobbered by a
// blanket refresh. Everything else gets quietly kept current.
async function backgroundRefreshClients() {
  if (!S.user || S.modal || document.hidden) return;
  try {
    const fresh = await apiReadSilent('data/clients.json');
    const keepLocalId = S.params && S.params.clientId ? S.params.clientId : null;
    const freshMap = new Map(fresh.content.map(c => [c.id, c]));
    if (keepLocalId) {
      const mine = S.clients.find(c => c.id === keepLocalId);
      if (mine) freshMap.set(keepLocalId, mine);
    }
    S.clients = Array.from(freshMap.values());
    S.shas.clients = fresh.sha;
    // Deliberately NOT calling render() here. This app's render() fully
    // replaces the page's HTML — there is no partial/diffed update. Doing
    // that on a timer would wipe out anything typed into an open text field
    // that hasn't been saved yet (integ/phase detail pages have several,
    // none of them behind a modal). Updating S.clients silently is enough:
    // the data is current the moment the person's own next action — saving,
    // navigating, anything — triggers the render that was going to happen
    // anyway. Nothing forces a redraw out from under them.
  } catch (e) {/* a failed background refresh is never worth surfacing to the person */ }
}
async function apiWrite(path, obj, sha, msg, changedIds) {
  startLoading();
  try {
    const r = await fetch('/api/write', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-token': S.sessionToken || '' }, body: JSON.stringify({ path, content: JSON.stringify(obj, null, 2), sha, message: msg, screen: S.view, changedIds }) });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) {
      forceReauth(authMessageFor(d.reason));
      throw new Error('Session ended');
    }
    if (r.status === 409 && d.error === 'conflict') {
      const err = new Error(`${(d.conflicts || []).map(c => c.name).join(', ') || 'This'} was updated by someone else just now — your change wasn't saved.`);
      err.isConflict = true; err.conflicts = d.conflicts || []; err.succeeded = d.succeeded || [];
      throw err;
    }
    if (!r.ok) throw new Error(d.error || d.message || `Write ${r.status}`);
    return { sha: d.sha || d.content?.sha, updated: d.updated || [] };
  } finally { stopLoading(); }
}
async function fetchAuditLog(opts = {}) {
  const params = new URLSearchParams();
  if (S.auditFrom) params.set('from', new Date(S.auditFrom).toISOString());
  if (S.auditTo) params.set('to', new Date(S.auditTo + 'T23:59:59').toISOString());
  if (S.auditUser) params.set('user', S.auditUser);
  if (S.auditSearch) params.set('q', S.auditSearch);
  if (opts.export) { params.set('export', '1'); }
  else { params.set('limit', S.auditPageSize); params.set('offset', S.auditPage * S.auditPageSize); }
  const r = await fetch(`/api/ops?op=audit&${params.toString()}`, { headers: { 'x-session-token': S.sessionToken || '' } });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `Audit ${r.status}`); }
  return r.json();
}
async function loadAuditLog() {
  S.auditLoading = true; render();
  try {
    const d = await fetchAuditLog();
    S.auditRows = d.rows; S.auditTotal = d.total; S.auditLoaded = true;
  } catch (e) { showToast(e.message || 'Failed to load audit log', 'error'); }
  finally { S.auditLoading = false; render(); }
}
async function saveClients(msg, changedIds) {
  // Historical note: this used to matter for SHA-conflict resolution back
  // when writes went through the GitHub Contents API. That's long gone —
  // write.js now talks to Supabase directly. The 'sha' field is vestigial,
  // always just 'supabase', kept only so the request/response shape didn't
  // need changing.
  //
  // changedIds narrows a save to just the client(s) actually touched here —
  // fetch fresh server state, splice in only the locally-changed one(s), and
  // work from that instead of this tab's whole (possibly stale) array. On
  // top of that, write.js now checks each changed client's _v (its
  // last-known updated_at) against the database at write time: if someone
  // else changed that exact record since this tab last saw it, the write is
  // rejected as a real conflict instead of silently overwriting them —
  // narrowing cross-record risk isn't enough on its own, since two people
  // can still be editing the very same client at once.
  let fresh = null;
  try {
    if (changedIds && changedIds.length) {
      fresh = await apiRead('data/clients.json');
      const freshMap = new Map(fresh.content.map(c => [c.id, c]));
      changedIds.forEach(id => {
        const local = S.clients.find(c => c.id === id);
        if (local) freshMap.set(id, local); else freshMap.delete(id);
      });
      S.clients = Array.from(freshMap.values());
      S.shas.clients = fresh.sha;
    }
    const result = await apiWrite('data/clients.json', S.clients, S.shas.clients, msg || 'Update clients', changedIds);
    S.shas.clients = result.sha;
    (result.updated || []).forEach(u => { const c = S.clients.find(x => x.id === u.id); if (c) c._v = u.updatedAt; });
  } catch (err) {
    if (err.isConflict && fresh) {
      // Heal with the fresh copy already fetched moments ago — it's what
      // actually caused the conflict, so it's the truth to show right now.
      const freshMap = new Map(fresh.content.map(c => [c.id, c]));
      (err.conflicts || []).forEach(cf => {
        const f = freshMap.get(cf.id); if (!f) return;
        const idx = S.clients.findIndex(x => x.id === cf.id);
        if (idx >= 0) S.clients[idx] = f; else S.clients.push(f);
      });
      // A multi-id save can partially succeed even when one id conflicts —
      // update those ids' version too, or they'd falsely conflict next time.
      (err.succeeded || []).forEach(u => { const c = S.clients.find(x => x.id === u.id); if (c) c._v = u.updatedAt; });
    } else if (!err.isConflict) {
      // Refresh our local SHA so the next save attempt starts clean.
      try { const cl = await apiRead('data/clients.json'); S.shas.clients = cl.sha; } catch (_) { }
    }
    throw err;
  }
}
async function saveUsers(msg, changedIds) {
  let fresh = null;
  try {
    if (changedIds && changedIds.length) {
      fresh = await apiRead('data/users.json');
      const freshMap = new Map(fresh.content.map(u => [u.id, u]));
      changedIds.forEach(id => {
        const local = S.users.find(u => u.id === id);
        if (local) freshMap.set(id, local); else freshMap.delete(id);
      });
      S.users = Array.from(freshMap.values());
      S.shas.users = fresh.sha;
    }
    const result = await apiWrite('data/users.json', S.users, S.shas.users, msg || 'Update users', changedIds);
    S.shas.users = result.sha;
    (result.updated || []).forEach(u => { const usr = S.users.find(x => x.id === u.id); if (usr) usr._v = u.updatedAt; });
  } catch (err) {
    if (err.isConflict && fresh) {
      const freshMap = new Map(fresh.content.map(u => [u.id, u]));
      (err.conflicts || []).forEach(cf => {
        const f = freshMap.get(cf.id); if (!f) return;
        const idx = S.users.findIndex(x => x.id === cf.id);
        if (idx >= 0) S.users[idx] = f; else S.users.push(f);
      });
      (err.succeeded || []).forEach(u => { const usr = S.users.find(x => x.id === u.id); if (usr) usr._v = u.updatedAt; });
    } else if (!err.isConflict) {
      try { const ul = await apiRead('data/users.json'); S.shas.users = ul.sha; } catch (_) { }
    }
    throw err;
  }
}
// ─── Pomodoro Focus Timer ────────────────────────────────────────
// Entirely client-side, in-memory only (S.pomodoro) — nothing is ever
// saved to Supabase/localStorage, matches the explicit "no persistence"
// decision. Only one timer can be active at a time (starting a new one
// silently replaces any other running session — a deliberate simplification,
// not a bug). The per-second tick deliberately does NOT call render() (see
// pomodoroTickDom) — render() replaces the entire page DOM, which would be
// disruptive if called every second, and actively wrong if the user has
// since navigated to a different page. render() is only called at real
// state transitions (start / phase change / complete), same as every other
// user action in the app.
const POMODORO_DURATIONS = { work: 25 * 60, break: 5 * 60 };
const POMODORO_SIMPLE_OPTIONS = [15, 25, 45, 60];

function pomodoroMmss(totalSec) {
  const m = Math.floor(totalSec / 60), s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function pomodoroStop() {
  if (S.pomodoro?.intervalId) clearInterval(S.pomodoro.intervalId);
  S.pomodoro = null;
}

function pomodoroStart(cid, iid, mode, simpleMinutes) {
  pomodoroStop();
  const total = mode === 'pomodoro' ? POMODORO_DURATIONS.work : (simpleMinutes || 25) * 60;
  S.pomodoro = { cid, iid, mode, cyclePhase: 'work', phase: 'running', total, remaining: total, cycle: 0, intervalId: null };
  S.pomodoro.intervalId = setInterval(pomodoroTick, 1000);
  render();
}

// Only re-renders if the person is still looking at the integration the
// timer belongs to — if they've navigated elsewhere, updating state quietly
// and re-rendering next time they actually visit that page avoids yanking
// away whatever they're doing on the page they're currently on.
function pomodoroMaybeRender() {
  if (S.view === 'integ-detail' && S.pomodoro && S.params?.clientId === S.pomodoro.cid && S.params?.integId === S.pomodoro.iid) render();
}

function pomodoroTick() {
  if (!S.pomodoro) return;
  S.pomodoro.remaining--;
  if (S.pomodoro.remaining <= 0) {
    if (S.pomodoro.mode === 'pomodoro' && S.pomodoro.cyclePhase === 'work' && S.pomodoro.cycle < 3) {
      S.pomodoro.cyclePhase = 'break';
      S.pomodoro.total = S.pomodoro.remaining = POMODORO_DURATIONS.break;
      pomodoroMaybeRender();
    } else if (S.pomodoro.mode === 'pomodoro' && S.pomodoro.cyclePhase === 'break') {
      S.pomodoro.cycle++;
      S.pomodoro.cyclePhase = 'work';
      S.pomodoro.total = S.pomodoro.remaining = POMODORO_DURATIONS.work;
      pomodoroMaybeRender();
    } else {
      clearInterval(S.pomodoro.intervalId);
      S.pomodoro.intervalId = null;
      S.pomodoro.phase = 'complete';
      pomodoroMaybeRender();
    }
    return;
  }
  pomodoroTickDom();
}

// Targeted update — finds the two live elements and edits them directly,
// no innerHTML replacement of anything. No-ops harmlessly if the person has
// navigated away (elements simply won't be in the DOM).
function pomodoroTickDom() {
  if (!S.pomodoro) return;
  const digitsEl = document.getElementById('pomodoro-digits');
  if (!digitsEl) return;
  digitsEl.textContent = pomodoroMmss(S.pomodoro.remaining);
  const barEl = document.getElementById('pomodoro-bar-fill');
  if (barEl) barEl.style.width = ((1 - S.pomodoro.remaining / S.pomodoro.total) * 100).toFixed(1) + '%';
}