// ─── PLAN IMPORT ──────────────────────────────────────────────────
// Turns a project-plan spreadsheet (any team's layout) into Implementation
// milestones: clients.modules[].phases[].milestones[]. Pure functions over a
// row matrix (SheetJS sheet_to_json header:1), so the same code runs in the
// browser and in a node test. Nothing here saves — events.js applies the
// result to S.clients and calls saveClients().
//
// Layouts handled (all auto-detected, every guess editable in the preview):
//   flat     one row per task with a module column (CSV exports, TVS
//            "Module Activity"); header may sit below a title (row 3)
//   gantt    "Plan / Actual" column with a Planned row and an Actual row per
//            step, module in merged cells (TVS "Project Plan")
//   outline  no module column: numbered sections, non-indented module rows,
//            indented task rows (Kognoz "Project Plan")

const PLAN_FIELDS = [
  // order matters: earlier fields claim a column first
  { key: 'tollGate', label: 'Toll gate / key milestone', re: /toll\s*gate|key\s*milestone|milestone\s*flag/ },
  { key: 'planActual', label: 'Plan / Actual row type', re: /plan\w*\s*\/\s*actual/ },
  { key: 'actualStart', label: 'Actual start', re: /actual\s*start/ },
  { key: 'actualEnd', label: 'Actual end', re: /actual\s*(end|finish)|completion\s*date|completed\s*on|date\s*completed/ },
  { key: 'module', label: 'Module', re: /^(darwinbox\s*)?modules?$|module|task\s*list\s*name|work\s*stream/ },
  { key: 'phase', label: 'Phase / stage', re: /phase|inflexion|stage|section/ },
  { key: 'task', label: 'Task / milestone', re: /task\s*name|task\s*\/\s*milestone|^tasks?$|^steps?$|activit|milestone\s*name|^milestones?$|deliverable/ },
  { key: 'owner', label: 'Owner', re: /owner|spoc|resource|responsib|assignee/ },
  { key: 'plannedStart', label: 'Planned start', re: /^(planned\s*|plan\s*|baseline\s*)?start(\s*date)?$/ },
  { key: 'plannedEnd', label: 'Planned end', re: /^(planned\s*|plan\s*|baseline\s*)?(end|finish)(\s*date)?$|due|target/ },
  { key: 'status', label: 'Status', re: /status/ },
  { key: 'pct', label: '% complete', re: /%|percent|work\s*completed/ },
  { key: 'remarks', label: 'Remarks', re: /remark|description|comment|^notes?$/ },
  { key: 'ref', label: 'Reference / ID', re: /task\s*id|^id$|^ref|^s\.?\s*no\.?$|^sr\.?\s*no|^#$/ },
];
const PLAN_FIELD_KEYS = PLAN_FIELDS.map(f => f.key);

const _pcell = v => (v === null || v === undefined) ? '' : (typeof v === 'string' ? v : String(v));
const _ptxt = v => _pcell(v).replace(/\s+/g, ' ').trim();
const _pnorm = s => _ptxt(s).toLowerCase();

// Canonical module name used for matching (not display): "~Core HR (Org)"
// and "core hr" are the same module; "HRIS Core" and "Core" are the same.
function planCanonModule(s) {
  return _pnorm(s).replace(/^~+/, '').replace(/\(.*?\)/g, '').replace(/^hris\s+/, '').replace(/[^a-z0-9& ]/g, ' ').replace(/\s+/g, ' ').trim();
}
function planCleanModule(s) {
  return _ptxt(s).replace(/^~+\s*/, '');
}
const _pcanonTask = s => _pnorm(s).replace(/[^a-z0-9]+/g, ' ').trim();

// ── dates ──
function planExcelSerialToIso(n) {
  const d = new Date(Math.round((n - 25569) * 86400000));
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}
const _MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
// dayFirst: decided once per file from the data (any first part > 12).
function planParseDate(v, dayFirst) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return (v > 20000 && v < 80000) ? planExcelSerialToIso(v) : '';
  if (v instanceof Date) return isNaN(v) ? '' : v.toISOString().slice(0, 10);
  const s = _ptxt(v);
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (m) {
    let [a, b, y] = [+m[1], +m[2], +m[3]]; if (y < 100) y += 2000;
    const [d, mo] = dayFirst ? [a, b] : [b, a];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3,4})[a-z]*[\s,-]+(\d{2,4})$/);
  if (m && _MON[m[2].toLowerCase()]) { let y = +m[3]; if (y < 100) y += 2000; return `${y}-${String(_MON[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  if (/^\d+(\.\d+)?$/.test(s)) return planParseDate(Number(s), dayFirst);
  return '';
}

// ── header detection ──
function planMatchHeader(label) {
  const t = _pnorm(label);
  if (!t) return null;
  const f = PLAN_FIELDS.find(f => f.re.test(t));
  return f ? f.key : null;
}
// Scores the first 25 rows; the header row is the one naming the most
// fields (and it must name a task column).
function planDetectHeader(rows) {
  let best = { idx: -1, score: 0 };
  for (let i = 0; i < Math.min(25, rows.length); i++) {
    const keys = new Set((rows[i] || []).map(planMatchHeader).filter(Boolean));
    const score = keys.size + (keys.has('task') ? 2 : 0);
    if (keys.has('task') && score > best.score) best = { idx: i, score };
  }
  return best.idx;
}
function planAutoMap(headerCells) {
  const map = {}; PLAN_FIELD_KEYS.forEach(k => map[k] = -1);
  (headerCells || []).forEach((h, i) => {
    const key = planMatchHeader(h);
    // first column wins, except "custom status" beats a plain "status"
    if (key && (map[key] < 0 || (key === 'status' && /custom/.test(_pnorm(h))))) map[key] = i;
  });
  return map;
}

// ── analysis of one sheet ──
function planAnalyze(rows, headerIdx) {
  const h = headerIdx === undefined || headerIdx < 0 ? planDetectHeader(rows) : headerIdx;
  const header = h >= 0 ? (rows[h] || []) : [];
  const map = planAutoMap(header);
  const mode = map.planActual >= 0 ? 'gantt' : (map.module < 0 ? 'outline' : 'flat');
  const columns = header.map((c, i) => ({ idx: i, label: _ptxt(c) || `Column ${i + 1}` }));
  return { headerIdx: h, map, mode, columns };
}
function planScoreSheet(name, rows) {
  const a = planAnalyze(rows);
  if (a.headerIdx < 0) return { a, score: -1 };
  const mapped = PLAN_FIELD_KEYS.filter(k => a.map[k] >= 0).length;
  const dataRows = rows.slice(a.headerIdx + 1).filter(r => _ptxt((r || [])[a.map.task])).length;
  let score = mapped * 10 + Math.min(dataRows, 200) / 10;
  if (/new|revised|latest/i.test(name)) score += 15;
  if (/activit|task/i.test(name)) score += 8;
  return { a, score };
}
// Picks the sheet to import by default. sheets: [{ name, rows }]
function planPickSheet(sheets) {
  let best = null;
  sheets.forEach(s => { const r = planScoreSheet(s.name, s.rows); if (!best || r.score > best.score) best = { name: s.name, score: r.score }; });
  return best && best.score >= 0 ? best.name : (sheets[0] && sheets[0].name);
}

// ── row extraction ──
function _pdayFirst(rows, start, map) {
  for (const k of ['plannedStart', 'plannedEnd', 'actualStart', 'actualEnd']) {
    if (map[k] < 0) continue;
    for (let i = start; i < rows.length; i++) {
      const m = _pcell((rows[i] || [])[map[k]]).trim().match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-]\d{2,4}$/);
      if (m && +m[1] > 12) return true;
      if (m && +m[2] > 12) return false;
    }
  }
  return false;
}
const _ptruthy = v => { const t = _pnorm(v); return !!t && !/^(n|no|false|0|-|na|n\/a)$/.test(t); };

function _pitem(r, map, dayFirst, extra) {
  const g = k => map[k] >= 0 ? (r[map[k]]) : '';
  return Object.assign({
    module: _ptxt(g('module')), srcPhase: _ptxt(g('phase')), name: _ptxt(g('task')),
    tollGate: map.tollGate >= 0 && _ptruthy(g('tollGate')),
    owner: _ptxt(g('owner')),
    plannedStart: planParseDate(g('plannedStart'), dayFirst), plannedEnd: planParseDate(g('plannedEnd'), dayFirst),
    actualStart: planParseDate(g('actualStart'), dayFirst), actualEnd: planParseDate(g('actualEnd'), dayFirst),
    statusRaw: _ptxt(g('status')), pct: g('pct'), remarks: _ptxt(g('remarks')), ref: _ptxt(g('ref')),
  }, extra);
}

function planExtract(rows, analysis) {
  const { headerIdx: h, map, mode } = analysis;
  const items = [], skipped = [];
  if (h < 0 || map.task < 0) return { items, skipped: [{ rowNo: 0, reason: 'No task / milestone column found' }] };
  const dayFirst = _pdayFirst(rows, h + 1, map);
  if (mode === 'outline') return _pExtractOutline(rows, analysis, dayFirst);
  let lastModule = '', lastPhase = '', group = '';
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const filled = r.map(_ptxt).filter(Boolean);
    if (!filled.length) continue;
    if (/^legend\b/i.test(filled[0])) break;
    const rowNo = i + 1;
    // Gantt: an "Actual" row carries the actual dates of the item above it.
    if (mode === 'gantt' && /^actual/.test(_pnorm(r[map.planActual]))) {
      const prev = items[items.length - 1];
      if (prev && prev.rowNo === rowNo - 1) {
        prev.actualStart = planParseDate(r[map.plannedStart], dayFirst) || prev.actualStart;
        prev.actualEnd = planParseDate(r[map.plannedEnd], dayFirst) || prev.actualEnd;
        if (map.status >= 0 && _ptxt(r[map.status])) prev.statusRaw = _ptxt(r[map.status]);
      }
      continue;
    }
    const taskTxt = _ptxt(r[map.task]);
    // Group-header row ("Core HR" alone in the first cell): sets the module
    // for the rows under it when they have none of their own.
    if (!taskTxt && filled.length === 1) { group = filled[0].replace(/\s*-\s*project initiation.*$/i, ''); continue; }
    if (!taskTxt) { skipped.push({ rowNo, reason: 'No task name' }); continue; }
    let moduleTxt = map.module >= 0 ? _pcell(r[map.module]).trim() : '';
    if (moduleTxt) lastModule = moduleTxt; else moduleTxt = lastModule || group;
    let phaseTxt = map.phase >= 0 ? _ptxt(r[map.phase]) : '';
    if (phaseTxt) lastPhase = phaseTxt; else phaseTxt = map.phase >= 0 ? lastPhase : '';
    if (!moduleTxt) { skipped.push({ rowNo, reason: 'No module' }); continue; }
    if (mode === 'gantt' && !planParseDate(r[map.plannedStart], dayFirst) && !planParseDate(r[map.plannedEnd], dayFirst)) { skipped.push({ rowNo, reason: 'No planned dates' }); continue; }
    // "~Leave\n~Attendance" → one item per module
    const mods = moduleTxt.split(/\r?\n/).map(planCleanModule).filter(Boolean);
    mods.forEach(mod => items.push(_pitem(r, map, dayFirst, { module: /^all$/i.test(mod) ? 'All Modules' : mod, srcPhase: phaseTxt, rowNo })));
  }
  return { items, skipped };
}

// Outline layout (Kognoz Project Plan): S.No "2" = section, non-indented
// "2.1 HRIS Core" with indented children = module, indented rows = tasks.
function _pExtractOutline(rows, analysis, dayFirst) {
  const { headerIdx: h, map } = analysis;
  const items = [], skipped = [];
  const lines = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const raw = _pcell(r[map.task]);
    lines.push({ i, r, raw, name: _ptxt(raw), indented: /^\s{2,}/.test(raw), ref: _ptxt(map.ref >= 0 ? r[map.ref] : ''), blank: !r.map(_ptxt).filter(Boolean).length });
  }
  const isSection = l => /^\d+$/.test(l.ref) || (!l.ref && l.name && !l.indented && false);
  // A non-indented row is a module header when indented rows follow it and
  // the same name heads children in more than one section (so a one-off
  // "Production Data Validation" stays a task under its module).
  const headerCount = {};
  lines.forEach((l, k) => { if (l.name && !l.indented && !isSection(l) && lines[k + 1] && lines[k + 1].indented) headerCount[planCanonModule(l.name)] = (headerCount[planCanonModule(l.name)] || 0) + 1; });
  let section = '', module = '', sectionHasIndent = false;
  for (let k = 0; k < lines.length; k++) {
    const l = lines[k];
    if (l.blank) continue;
    const rowNo = l.i + 1;
    if (isSection(l)) {
      section = l.name; module = '';
      sectionHasIndent = false;
      for (let j = k + 1; j < lines.length && !isSection(lines[j]); j++) if (lines[j].indented) { sectionHasIndent = true; break; }
      // "Final Go Live" style: modules listed in another column on the rows below, one date.
      const mods = [];
      for (let j = k; j < lines.length && (j === k || (!lines[j].ref && !lines[j].name)); j++) {
        const txt = lines[j].r.map(_ptxt).find((v, ci) => ci !== map.task && ci !== map.ref && v && !/^\d+(\.\d+)?$/.test(v) && !/day/i.test(v));
        if (txt) mods.push(txt);
      }
      if (mods.length > 1) {
        const it = _pitem(l.r, map, dayFirst, { srcPhase: section, rowNo });
        const date = it.plannedStart || it.plannedEnd || l.r.map(v => planParseDate(v, dayFirst)).find(Boolean) || '';
        mods.forEach(mod => items.push(Object.assign({}, it, { module: planCleanModule(mod), name: section, plannedStart: it.plannedStart || date, plannedEnd: it.plannedEnd || date })));
        while (k + 1 < lines.length && !lines[k + 1].ref && !lines[k + 1].name) k++;
      }
      continue;
    }
    if (!l.name) continue;
    if (!l.indented) {
      if (!sectionHasIndent) {
        // Section with no indented rows (Inception, Data Migration): each row is a module, the milestone is the section itself.
        items.push(_pitem(l.r, map, dayFirst, { module: planCleanModule(l.name), name: section || l.name, srcPhase: section, rowNo }));
        continue;
      }
      const next = lines[k + 1];
      if (headerCount[planCanonModule(l.name)] > 1 || (next && next.indented && !module)) { module = l.name; continue; }
    }
    if (!module) { skipped.push({ rowNo, reason: 'No module above this task' }); continue; }
    items.push(_pitem(l.r, map, dayFirst, { module: planCleanModule(module), name: l.name, srcPhase: section, rowNo }));
  }
  return { items, skipped };
}

// ── phase mapping ──
// Strong rules from the task's own name (sign-offs, UAT configuration…).
function planPhaseFromTask(task) {
  const t = _pnorm(task);
  if (/uat.{0,40}sign.?off|sign.?off.{0,15}uat/.test(t)) return 'UAT Signoff';
  if (/(crp|conference room pilot).{0,40}sign.?off/.test(t)) return 'CRP Signoff';
  if (/(blueprint|bpu|hld|dct|core data|bpm|requirement).{0,40}sign.?off|sign.?off.{0,10}(blueprint|bpu)/.test(t)) return 'BPU Signoff';
  if (/go.?live|deployment/.test(t)) return 'Go Live';
  if (/hypercare|stabili[sz]/.test(t)) return 'Hypercare';
  if (/production (migration|configuration|data)|sanity testing|data migration|replication|to production|^production$/.test(t)) return 'Data Migration / Production Migration';
  if (/uat configuration|staging/.test(t)) return 'Staging Config';
  if (/client uat|uat walkthrough|user acceptance/.test(t)) return 'UAT';
  if (/conference room pilot|\bcrp\b/.test(t)) return 'CRP';
  return null;
}
// Default for a source phase / section label (editable in the preview).
const _PKORA = ['BPU', 'BPU Signoff', 'Staging Config', 'CRP', 'CRP Signoff', 'UAT', 'UAT Signoff', 'Data Migration / Production Migration', 'Go Live', 'Hypercare'];
function planPhaseFromSource(src) {
  const t = _pnorm(src);
  if (!t) return null;
  // Already a Kora phase name (the standard template) → use it as-is.
  const exact = (typeof PHASES !== 'undefined' ? PHASES : _PKORA).find(p => p.toLowerCase() === t || p.toLowerCase().replace(/\s+/g, '') === t.replace(/\s+/g, ''));
  if (exact) return exact;
  if (/hypercare|stabili|customer success/.test(t)) return 'Hypercare';
  if (/go.?live|deployment/.test(t)) return 'Go Live';
  if (/uat|user acceptance/.test(t)) return 'UAT';
  if (/migration|production/.test(t)) return 'Data Migration / Production Migration';
  if (/conference room|\bcrp\b|train/.test(t)) return 'CRP';
  if (/staging|construction/.test(t)) return 'Staging Config';
  if (/transition/.test(t)) return 'Data Migration / Production Migration';
  return 'BPU';
}
const _PSIGNOFF = { 'BPU': 'BPU Signoff', 'CRP': 'CRP Signoff', 'UAT': 'UAT Signoff', 'Data Migration / Production Migration': 'Go Live' };
function planDefaultPhaseMap(items) {
  const map = {};
  items.forEach(it => { if (it.srcPhase && !(it.srcPhase in map)) map[it.srcPhase] = planPhaseFromSource(it.srcPhase); });
  return map;
}
function planPhaseFor(it, phaseMap, routeByTask) {
  const base = (it.srcPhase && phaseMap[it.srcPhase]) || planPhaseFromSource(it.name) || 'BPU';
  let ph = (routeByTask !== false && planPhaseFromTask(it.name)) || base;
  // Toll gates / sign-offs land on the Signoff phase of where they happen.
  if ((it.tollGate || /sign.?off/i.test(it.name)) && _PSIGNOFF[ph] && !/signoff/i.test(ph)) ph = _PSIGNOFF[ph];
  return ph;
}

function planStatus(it) {
  const s = _pnorm(it.statusRaw);
  const pct = typeof it.pct === 'number' ? it.pct : parseFloat(_pcell(it.pct));
  if (/missed/.test(s)) return 'Missed';
  if (/complete|done|closed|achieved/.test(s) || pct >= 100 || pct === 1) return 'Achieved';
  if (s) return 'Pending';   // "On Going", "WIP", "Delay", "Planned"… even if a date is filled in
  return it.actualEnd ? 'Achieved' : 'Pending';
}

// ── apply to a client (mutates; run it on a deep copy for the preview) ──
// opts: { phaseMap, routeByTask, batch, fileName, now, uid, phases }
function planApply(client, items, opts) {
  const phases = opts.phases, mkId = opts.uid, now = opts.now || new Date().toISOString();
  const stats = { created: 0, updated: 0, unchanged: 0, modulesCreated: [], perPhase: {}, moved: 0 };
  if (!client.modules) client.modules = [];
  const modByCanon = new Map(client.modules.map(m => [planCanonModule(m.name), m]));
  const seenKeys = {}, matched = new Set();
  items.forEach(it => {
    const canon = planCanonModule(it.module);
    let mod = modByCanon.get(canon);
    if (!mod) {
      mod = { id: mkId(), name: it.module, phases: phases.map(n => ({ name: n, status: 'Not Started', startDate: '', targetDate: '', updates: [] })), createdByImport: opts.batch };
      client.modules.push(mod); modByCanon.set(canon, mod); stats.modulesCreated.push(it.module);
    }
    const phaseName = mod.singlePhase ? mod.phases[0].name : planPhaseFor(it, opts.phaseMap || {}, opts.routeByTask);
    let ph = (mod.phases || (mod.phases = [])).find(p => p.name === phaseName);
    if (!ph) { ph = { name: phaseName, status: 'Not Started', startDate: '', targetDate: '', updates: [] }; mod.phases.push(ph); }
    let key = `${canon}|${_pcanonTask(it.name)}`;
    seenKeys[key] = (seenKeys[key] || 0) + 1;
    if (seenKeys[key] > 1) key += `#${seenKeys[key]}`;
    const fields = {
      name: it.name, plannedStart: it.plannedStart || '', dueDate: it.plannedEnd || it.plannedStart || '',
      actualStart: it.actualStart || '', actualEnd: it.actualEnd || '', status: planStatus(it),
      owner: it.owner || '', tollGate: !!it.tollGate,
      notes: [it.remarks, it.srcPhase && `Plan phase: ${it.srcPhase}`, it.ref && `Ref ${it.ref}`].filter(Boolean).join(' · '),
    };
    // existing: same import key first, else same task name in this module
    let found = null, foundPh = null;
    for (const p of mod.phases) for (const ms of (p.milestones || [])) {
      if (matched.has(ms)) continue;
      if (ms.source && ms.source.key === key) { found = ms; foundPh = p; break; }
    }
    if (!found) for (const p of mod.phases) { for (const ms of (p.milestones || [])) { if (!matched.has(ms) && !ms.source && _pcanonTask(ms.name) === _pcanonTask(it.name)) { found = ms; foundPh = p; break; } } if (found) break; }
    stats.perPhase[phaseName] = (stats.perPhase[phaseName] || 0) + 1;
    if (found) {
      matched.add(found);
      const changed = Object.keys(fields).some(k => (found[k] || (k === 'tollGate' ? false : '')) !== fields[k]) || foundPh !== ph;
      if (!changed) { stats.unchanged++; return; }
      Object.assign(found, fields);
      // file/importedAt/firstBatch describe the upload that created it (used by
      // "Remove import"); last* track the most recent upload that changed it.
      found.source = Object.assign({ file: opts.fileName, importedAt: now, firstBatch: null }, found.source || {}, { key, lastBatch: opts.batch, lastFile: opts.fileName, lastImportedAt: now });
      if (foundPh !== ph) { foundPh.milestones.splice(foundPh.milestones.indexOf(found), 1); (ph.milestones || (ph.milestones = [])).push(found); stats.moved++; }
      stats.updated++;
    } else {
      const ms = Object.assign({ id: mkId() }, fields, { source: { key, file: opts.fileName, firstBatch: opts.batch, lastBatch: opts.batch, importedAt: now } });
      (ph.milestones || (ph.milestones = [])).push(ms); matched.add(ms);
      stats.created++;
    }
  });
  return stats;
}

// Removes what one upload created: its new milestones, then any module it
// created that holds no other data. Updates it made are not reverted.
function planRemoveBatch(client, batch) {
  let removed = 0, modulesRemoved = 0;
  (client.modules || []).forEach(m => (m.phases || []).forEach(p => {
    if (!p.milestones) return;
    const before = p.milestones.length;
    p.milestones = p.milestones.filter(ms => !(ms.source && ms.source.firstBatch === batch));
    removed += before - p.milestones.length;
  }));
  client.modules = (client.modules || []).filter(m => {
    if (m.createdByImport !== batch) return true;
    const untouched = (m.phases || []).every(p => !(p.milestones || []).length && !(p.updates || []).length && (p.status || 'Not Started') === 'Not Started' && !p.assignee);
    if (untouched) modulesRemoved++;
    return !untouched;
  });
  return { removed, modulesRemoved };
}

// Uploads that still have milestones on this client, newest first.
function planImportBatches(client) {
  const by = {};
  (client.modules || []).forEach(m => (m.phases || []).forEach(p => (p.milestones || []).forEach(ms => {
    const s = ms.source; if (!s || !s.firstBatch) return;
    const b = by[s.firstBatch] || (by[s.firstBatch] = { batch: s.firstBatch, file: s.file, importedAt: s.importedAt, count: 0 });
    b.count++; if (s.importedAt < b.importedAt) b.importedAt = s.importedAt;
  })));
  return Object.values(by).sort((a, b) => (b.importedAt || '').localeCompare(a.importedAt || ''));
}

// Standard template everyone can share. Any number of modules; Phase must be
// one of PHASES (or anything — the importer maps free text too).
function planTemplateWorkbook(X, phases) {
  const head = ['Module', 'Phase', 'Task / Milestone', 'Toll Gate (Y/N)', 'Owner', 'Planned Start', 'Planned End', 'Actual Start', 'Actual End', 'Status', 'Remarks'];
  const ex = [
    ['Core HR', 'BPU', 'Data collection - Employee Master', '', 'Client SPOC', '2026-10-05', '2026-10-09', '2026-10-05', '2026-10-10', 'Completed', ''],
    ['Core HR', 'BPU Signoff', 'Core data sign-off', 'Y', 'Client SPOC', '2026-10-12', '2026-10-12', '', '', 'Planned', ''],
    ['Core HR', 'Staging Config', 'Organization structure configuration', '', 'Kognoz', '2026-10-13', '2026-10-16', '', '', 'Planned', ''],
    ['Leave', 'CRP', 'Conference room pilot - Leave', '', 'Kognoz', '2026-10-20', '2026-10-21', '', '', 'Planned', ''],
    ['Leave', 'UAT Signoff', 'UAT sign-off - Leave', 'Y', 'Client SPOC', '2026-11-02', '2026-11-02', '', '', 'Planned', 'Needs sign-off mail'],
  ];
  const guide = [
    ['Kora implementation plan template'], [],
    ['One row per task. Add as many modules and rows as you need; new module names are created in Kora on import.'],
    ['Dates: YYYY-MM-DD or real Excel dates. Leave Actual Start / Actual End empty until the work happens.'],
    ['A task is late when its Actual End (or today, if not finished) is after its Planned End.'],
    ['Re-upload the same file after updating it: matching tasks (same Module + Task) are updated, new rows are added.'],
    [], ['Phase values'], ...phases.map(p => [p]),
    [], ['Status values'], ['Planned'], ['WIP'], ['Completed'], ['Missed'],
  ];
  const wb = X.utils.book_new();
  const ws = X.utils.aoa_to_sheet([head, ...ex]);
  ws['!cols'] = [18, 16, 44, 14, 16, 13, 13, 13, 13, 12, 30].map(w => ({ wch: w }));
  X.utils.book_append_sheet(wb, ws, 'Plan');
  const gs = X.utils.aoa_to_sheet(guide); gs['!cols'] = [{ wch: 110 }];
  X.utils.book_append_sheet(wb, gs, 'Guide');
  return wb;
}

// ── browser glue (uses app globals: S, PHASES, uid, XLSX) ──
// The import modal keeps the parsed workbook in S.modal and rebuilds this
// preview on every dropdown change; nothing is saved until Import.
async function planReadFile(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', raw: /\.csv$/i.test(file.name) });
  const sheets = wb.SheetNames.map(name => ({ name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' }) }))
    .filter(s => s.rows.some(r => r.some(v => _ptxt(v))));
  if (!sheets.length) throw new Error('The file has no data');
  return sheets;
}
// (Re)analyses the chosen sheet. Called when the file or sheet changes.
function planInitSheet(m, sheetName) {
  const sh = m.sheets.find(s => s.name === sheetName) || m.sheets[0];
  const a = planAnalyze(sh.rows);
  m.sheet = sh.name; m.headerIdx = a.headerIdx; m.map = a.map; m.phaseMap = null;
}
function planPreview(m) {
  const sh = m.sheets.find(s => s.name === m.sheet) || m.sheets[0];
  const header = m.headerIdx >= 0 ? (sh.rows[m.headerIdx] || []) : [];
  const columns = header.map((c, i) => ({ idx: i, label: _ptxt(c) || `Column ${i + 1}` }));
  const map = m.map || planAutoMap(header);
  const mode = map.planActual >= 0 ? 'gantt' : (map.module < 0 ? 'outline' : 'flat');
  const { items, skipped } = planExtract(sh.rows, { headerIdx: m.headerIdx, map, mode });
  const phaseMap = Object.assign(planDefaultPhaseMap(items), m.phaseMap || {});
  const client = S.clients.find(x => x.id === m.cid);
  const clone = JSON.parse(JSON.stringify({ id: client.id, name: client.name, modules: client.modules || [] }));
  const stats = planApply(clone, items, { phaseMap, routeByTask: m.routeByTask !== false, batch: 'preview', fileName: m.fileName, uid, phases: PHASES });
  const srcCounts = {};
  items.forEach(it => { if (it.srcPhase) srcCounts[it.srcPhase] = (srcCounts[it.srcPhase] || 0) + 1; });
  const sample = items.slice(0, 15).map(it => ({ ...it, koraPhase: planPhaseFor(it, phaseMap, m.routeByTask !== false), status: planStatus(it) }));
  return { columns, map, mode, items, skipped, phaseMap, srcCounts, stats, schedule: implScheduleStatus(clone), sample };
}
function planDownloadTemplate() {
  XLSX.writeFile(planTemplateWorkbook(XLSX, PHASES), 'Kora_Implementation_Plan_Template.xlsx');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PLAN_FIELDS, planCanonModule, planParseDate, planDetectHeader, planAutoMap, planAnalyze, planPickSheet, planExtract, planPhaseFromTask, planPhaseFromSource, planDefaultPhaseMap, planPhaseFor, planStatus, planApply, planRemoveBatch, planImportBatches, planTemplateWorkbook };
}
