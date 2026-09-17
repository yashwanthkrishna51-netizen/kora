// api/_dualwrite.js — shadow-writes the normalized v2 tables alongside the
// real (original, jsonb-based) clients table. This is Phase 1 of the
// jsonb→columns migration: schema + write-side only. Nothing reads from
// _v2 yet. Every function here is best-effort — call sites in write.js wrap
// these in try/catch and never let a v2 failure affect the actual response
// to the user, since the original clients table remains the sole source
// of truth during this phase.
//
// Soft-delete only, everywhere: when an item present in the v2 tables is no
// longer in the incoming data (removed client-side), it gets archived
// (archived=true), never DELETEd. Every archiving UPDATE is scoped to the
// specific client_id (and parent id, one level down) it belongs to, so a
// bug here can never cross into another client's rows — this is the same
// class of bug as the original delete-by-omission incident, deliberately
// designed out from the start rather than patched in later.
//
// PERFORMANCE NOTE (2026-08-14): this file used to do everything below the
// clients_v2 upsert strictly one request at a time — measured at ~19
// sequential round-trips for a 5-module client, all awaited before write.js
// sends its response, so it was real user-perceived save latency, not
// background cost. Rewritten to:
//   1) batch every module's phase rows into ONE upsert instead of a
//      2-round-trip-per-module loop (this was the single biggest
//      contributor — 10 of the 19 round-trips on a 5-module client), and
//   2) run the integrations/milestones, modules/phases, and work-log
//      subtrees concurrently, since none of the 3 top-level v2 tables
//      references another (only clients_v2, which lands first) — see the
//      `references` lines in sql_v2_migration.sql for the actual FK graph
//      this ordering is built around.
// upsertRows and archiveMissing on the SAME table are also run concurrently
// with each other wherever used below: an upsert only ever touches the ids
// being kept, archiveMissing only ever touches ids NOT in that list, so the
// two never race over the same row.

async function sbFetch(env, path, options = {}) {
  const url = `${env.SUPABASE_URL}/rest/v1/${path}`;
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...options.headers,
  };
  const r = await fetch(url, { ...options, headers });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`_dualwrite ${options.method || 'GET'} ${path} failed: ${r.status} ${body.slice(0, 300)}`);
  }
  return r;
}

async function upsertRows(env, table, rows) {
  if (!rows.length) return;
  await sbFetch(env, `${table}?on_conflict=id`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
}

async function archiveMissing(env, table, scopeCol, scopeVal, keepIds, actor) {
  const idList = keepIds.length ? keepIds.map(id => `"${encodeURIComponent(id)}"`).join(',') : '""';
  const filter = keepIds.length
    ? `${scopeCol}=eq.${encodeURIComponent(scopeVal)}&id=not.in.(${idList})&archived=eq.false`
    : `${scopeCol}=eq.${encodeURIComponent(scopeVal)}&archived=eq.false`;
  await sbFetch(env, `${table}?${filter}`, {
    method: 'PATCH',
    body: JSON.stringify({ archived: true, archived_at: new Date().toISOString(), archived_by: actor || null }),
  });
}

// integrations_v2 has no FK dependency on modules_v2 or ams_work_log_v2 (and
// vice versa) — only on clients_v2, already committed by the time this runs.
// Internally: milestones_v2.integration_id references integrations_v2(id),
// so the integrations upsert must land before milestones can be written;
// archiveMissing(integrations_v2) touches a disjoint id set from that
// upsert, so it can run alongside the milestones step instead of before it.
async function dualWriteIntegrationsAndMilestones(env, client, now, actor) {
  const integrations = client.integrations || [];
  if (!(integrations.length || client.integrations !== undefined)) return;

  const integRows = integrations.map(i => ({
    id: i.id,
    client_id: client.id,
    name: i.name,
    status: i.status || 'Not Started',
    assignee: i.assignee || null,
    due_date: i.dueDate || null,
    description: i.description || '',
    next_action: i.nextAction || '',
    effort_weight: i.effortWeight ?? 0.5,
    activity_log: i.timeline || [],
    updated_at: now,
  }));
  const allMilestones = integrations.flatMap(i => (i.milestones || []).map(ms => ({ ...ms, _integId: i.id })));
  const msRows = allMilestones.map(ms => ({
    id: ms.id,
    integration_id: ms._integId,
    client_id: client.id,
    name: ms.name,
    status: ms.status || 'Pending',
    due_date: ms.dueDate || null,
    owner: ms.owner || null,
    notes: ms.notes || '',
    updated_at: now,
  }));

  await upsertRows(env, 'integrations_v2', integRows);
  await Promise.all([
    upsertRows(env, 'milestones_v2', msRows),
    archiveMissing(env, 'integrations_v2', 'client_id', client.id, integrations.map(i => i.id), actor),
  ]);
  await archiveMissing(env, 'milestones_v2', 'client_id', client.id, allMilestones.map(ms => ms.id), actor);
}

// phases_v2.module_id references modules_v2(id), so the modules upsert must
// land before any phase row can be written. Once it has, every module's
// phase rows go in as ONE batched upsert (previously a 2-round-trip loop
// per module) and every module's archiveMissing runs concurrently (each is
// scoped to its own module_id, so none of them can race each other).
async function dualWriteModulesAndPhases(env, client, now, actor) {
  const modules = client.modules;
  if (modules === undefined) return;

  const modList = modules || [];
  const modRows = modList.map(m => ({ id: m.id, client_id: client.id, name: m.name, updated_at: now }));
  await upsertRows(env, 'modules_v2', modRows);

  const allPhaseRows = modList.flatMap(m => (m.phases || []).map(ph => ({
    id: ph.id || `${m.id}::${ph.name}`,
    module_id: m.id,
    client_id: client.id,
    phase_name: ph.name,
    status: ph.status || 'Not Started',
    assignee: ph.assignee || null,
    start_date: ph.startDate || null,
    target_date: ph.targetDate || null,
    current_activity: ph.currentActivity || '',
    next_action: ph.nextAction || '',
    activity_log: ph.updates || [],
    updated_at: now,
  })));

  await Promise.all([
    upsertRows(env, 'phases_v2', allPhaseRows),
    archiveMissing(env, 'modules_v2', 'client_id', client.id, modList.map(m => m.id), actor),
  ]);

  await Promise.all(modList.map(m => {
    const keepIds = (m.phases || []).map(ph => ph.id || `${m.id}::${ph.name}`);
    return archiveMissing(env, 'phases_v2', 'module_id', m.id, keepIds, actor);
  }));
}

// ams_work_log_v2 only references clients_v2 — upsert and archiveMissing
// touch disjoint id sets (this save's rows vs everything else), so they run
// together with no ordering dependency between them.
async function dualWriteWorkLog(env, client, now, actor) {
  const workLog = client.workLog;
  if (workLog === undefined) return;

  const entryRows = (workLog || []).map(e => ({
    id: e.id,
    client_id: client.id,
    date_raised: e.dateRaised,
    due_date: e.dueDate || null,
    raised_by: e.raisedBy || null,
    module: e.module || null,
    project: e.project || null,
    description: e.description || '',
    entry_type: e.type || null,
    query_level: e.queryLevel || null,
    entry_status: e.entryStatus || 'Open',
    rag_status: e.ragStatus || null,
    mode_of_support: e.modeOfSupport || null,
    dependencies: e.dependencies || '',
    solution: e.solution || '',
    hours: Number(e.hours || 0),
    edit_history: e.edits || [],
    updated_at: now,
  }));

  await Promise.all([
    upsertRows(env, 'ams_work_log_v2', entryRows),
    archiveMissing(env, 'ams_work_log_v2', 'client_id', client.id, entryRows.map(r => r.id), actor),
  ]);
}

async function dualWriteClient(env, client, actor) {
  const now = new Date().toISOString();

  // clients_v2 must land first — integrations_v2, modules_v2, and
  // ams_work_log_v2 all carry a real FK to clients_v2(id), so nothing else
  // here can safely run until this row is committed.
  await upsertRows(env, 'clients_v2', [{
    id: client.id,
    name: client.name,
    description: client.description || '',
    man_day_rate: client.manDayRate ?? null,
    total_available_hours: client.totalAvailableHours ?? null,
    currency: client.currency || 'INR',
    master_assignee: client.masterAssignee || null,
    updated_at: now,
  }]);

  // These 3 subtrees don't reference each other (only clients_v2, already
  // committed above) — they used to run one after another for no reason.
  await Promise.all([
    dualWriteIntegrationsAndMilestones(env, client, now, actor),
    dualWriteModulesAndPhases(env, client, now, actor),
    dualWriteWorkLog(env, client, now, actor),
  ]);
}

async function dualWriteClients(env, data, changedIds, actor) {
  if (!changedIds || !changedIds.length) return;
  const changedSet = new Set(changedIds);
  const changedClients = data.filter(c => changedSet.has(c.id));
  // Different clients share no rows or FK relationships with each other in
  // the v2 tables, so their dualWriteClient calls are fully independent.
  // (In today's app every save site passes exactly one id — this matters
  // if/when a future bulk-save path ever passes more than one.)
  await Promise.all(changedClients.map(client => dualWriteClient(env, client, actor)));
}

async function archiveDeletedClients(env, clientIds, actor) {
  if (!clientIds || !clientIds.length) return;
  const now = new Date().toISOString();
  const archivePatch = { archived: true, archived_at: now, archived_by: actor || null };
  // Soft-delete via PATCH (archived=true), never a real DELETE, so none of
  // the "on delete restrict" FKs in sql_v2_migration.sql are triggered here
  // — no ordering dependency between tables or between different
  // clientIds, so every (table, clientId) pair can run at once. Each is
  // independently caught so one table failing doesn't stop the rest.
  const tasks = [];
  for (const clientId of clientIds) {
    const cid = encodeURIComponent(clientId);
    for (const table of ['integrations_v2', 'milestones_v2', 'modules_v2', 'phases_v2', 'ams_work_log_v2', 'clients_v2']) {
      const col = table === 'clients_v2' ? 'id' : 'client_id';
      tasks.push(
        sbFetch(env, `${table}?${col}=eq.${cid}&archived=eq.false`, {
          method: 'PATCH',
          body: JSON.stringify(archivePatch),
        }).catch(err => console.error(`_dualwrite archiveDeletedClients: ${table} for ${clientId} failed:`, err.message))
      );
    }
  }
  await Promise.all(tasks);
}

module.exports = { dualWriteClients, archiveDeletedClients, dualWriteClient };