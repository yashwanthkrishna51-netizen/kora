// ─── MODAL ────────────────────────────────────────────────────────
function renderModal(){
  const m=S.modal;if(!m)return'';
  let title='',body='',btnLabel='Create',btnCls='btn-grad';
  if(m.type==='add-client'){
    title='Add Client';
    body=`<div class="space-y-3">
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Client Name *</label><input id="m1" type="text" placeholder="e.g. HDFC Bank" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Description</label><textarea id="m2" rows="2" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490] resize-none"></textarea></div>
    </div>`;
  } else if(m.type==='add-integ'){
    const cid=m.cid||'';title='Add Integration';
    body=`<div class="space-y-3">
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Client</label>
        <select id="m0" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]">${S.clients.map(c=>`<option value="${c.id}"${c.id===cid?' selected':''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Integration Name *</label><input id="m1" type="text" placeholder="e.g. Darwinbox → SAP SF" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="block text-xs font-medium text-gray-500 mb-1">Status</label>
          <select id="m2" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]">${STATUSES.map(s=>`<option>${s}</option>`).join('')}</select></div>
        <div><label class="block text-xs font-medium text-gray-500 mb-1">Assignee</label>${assigneeSelect('m3')}</div>
      </div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Due Date</label><input id="m4" type="date" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Description</label><textarea id="m5" rows="2" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490] resize-none"></textarea></div>
    </div>`;
  } else if(m.type==='add-user'){
    title='Add User';
    body=`<div class="space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <div><label class="block text-xs font-medium text-gray-500 mb-1">Username *</label><input id="m1" type="text" placeholder="john.doe" autocomplete="off" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
        <div><label class="block text-xs font-medium text-gray-500 mb-1">Full Name *</label><input id="m2" type="text" placeholder="John Doe" autocomplete="off" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      </div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Email</label><input id="m5" type="email" placeholder="john@kognoz.in" autocomplete="off" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Password *</label><input id="m3" type="password" placeholder="••••••••" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Role</label>
        <select id="m4" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]">${ROLES.map(r=>`<option>${r}</option>`).join('')}</select></div>
    </div>`;
  } else if(m.type==='my-profile'){
    title='My Profile';btnLabel='Save Profile';
    body=`<div class="space-y-4">
      <div class="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
        <div class="w-10 h-10 rounded-full bg-[#0e7490] text-white flex items-center justify-center text-sm font-bold shrink-0">${esc((S.user?.name||'?')[0])}</div>
        <div><div class="font-semibold text-gray-900">${esc(S.user?.name)}</div><div class="text-xs text-gray-400 capitalize">${esc(S.user?.role)}</div></div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="block text-xs font-medium text-gray-500 mb-1">Username</label><div class="px-3 py-2 bg-gray-50 rounded-xl text-sm text-gray-500 font-mono">${esc(S.user?.username)}</div></div>
        <div><label class="block text-xs font-medium text-gray-500 mb-1">Email</label><input id="pr-email" type="email" value="${esc(S.user?.email||'')}" autocomplete="off" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      </div>
      <div class="border-t border-gray-100 pt-3">
        <div class="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wide">Change Password <span class="font-normal normal-case text-gray-400">— leave blank to keep current</span></div>
        <div class="space-y-2.5">
          <div><label class="block text-xs font-medium text-gray-500 mb-1">Current Password *</label><input id="pr-curr" type="password" placeholder="Required to save any changes" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="block text-xs font-medium text-gray-500 mb-1">New Password</label><input id="pr-new" type="password" placeholder="Leave blank to keep current" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
            <div><label class="block text-xs font-medium text-gray-500 mb-1">Confirm New Password</label><input id="pr-conf" type="password" placeholder="Repeat new password" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
          </div>
        </div>
      </div>
    </div>`;
  } else if(m.type==='send-welcome'){
    title='Send Welcome Email';
    const emailUsers=(m.targets||[]).filter(u=>u.email);
    btnLabel=`Send to ${emailUsers.length} User${emailUsers.length===1?'':'s'}`;
    body=`<div class="space-y-3">
      <div class="bg-[#0e7490]/8 border border-[#0e7490]/20 rounded-xl p-3 text-xs text-[#0d3d4f] leading-relaxed">Sends a branded welcome email to each recipient with the app URL, their username, and the password you set below. Their password is also updated to match so login works immediately.</div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Recipients (${(m.targets||[]).length} selected)</label>
        <div class="bg-gray-50 rounded-xl px-3 py-2 text-xs text-gray-600 max-h-28 overflow-y-auto space-y-0.5">
          ${(m.targets||[]).map(u=>`<div class="${u.email?'':'text-amber-600'}">${esc(u.name)} <span class="text-gray-400">(${esc(u.username)})</span> ${u.email?`<span class="text-gray-400">${esc(u.email)}</span>`:'<span class="text-amber-500 font-medium">— no email set, will skip</span>'}</div>`).join('')}
        </div>
      </div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Application URL *</label><input id="sw-url" type="url" value="${esc(window?.location?.origin||'https://your-app.vercel.app')}" placeholder="https://your-app.vercel.app" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Password to send & set *</label><input id="sw-pass" type="text" placeholder="e.g. Kognoz@123" autocomplete="off" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/>
      <p class="text-xs text-gray-400 mt-1">This becomes their login password immediately. Tell them to change it after first login via My Profile.</p></div>
    </div>`;
  } else if(m.type==='edit-user'){
    title='Edit User';btnLabel='Save User';
    body=`<div class="space-y-3">
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Username</label><div class="px-3 py-2 bg-gray-50 rounded-xl text-sm text-gray-500 font-mono">${esc(m.username||'')}</div></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Full Name *</label><input id="eu-name" type="text" value="${esc(m.uname||'')}" autocomplete="off" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Email</label><input id="eu-email" type="email" value="${esc(m.email||'')}" autocomplete="off" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">New Password <span class="text-gray-400 font-normal">leave blank to keep current</span></label><input id="eu-pass" type="password" placeholder="••••••••" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
    </div>`;
  } else if(m.type==='bulk-import-users'){
    title='Import Users from CSV';
    const rows=m.csvRows||[];
    const valid=rows.filter(r=>!r.error);
    const errors=rows.filter(r=>r.error);
    btnLabel=rows.length?`Import ${valid.length} User${valid.length!==1?'s':''}`:'Preview';
    body=`<div class="space-y-3">
      <div class="flex items-center justify-between">
        <p class="text-xs text-gray-500">Paste CSV or use the template. One user per row.</p>
        <button data-act="download-user-template" class="text-xs text-[#0e7490] font-semibold hover:underline">⬇ Download Template</button>
      </div>
      <textarea id="bulk-csv" rows="8" placeholder="username,full_name,role,email,password&#10;yashwanth.k,Yashwanth K,admin,yashwanth@kognoz.in,Kognoz@123&#10;priya.s,Priya S,editor,priya@kognoz.in,Kognoz@123" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#0e7490] resize-none">${esc(m.csvText||'')}</textarea>
      <button data-act="preview-users-csv" class="w-full text-sm font-medium bg-gray-50 hover:bg-[#0e7490]/10 hover:text-[#0e7490] text-gray-700 border border-gray-200 rounded-xl py-2 transition">Preview Rows</button>
      ${rows.length?`<div class="text-xs font-semibold text-gray-700 mt-1">${rows.length} rows parsed · <span class="text-green-600">${valid.length} valid</span>${errors.length?` · <span class="text-rose-600">${errors.length} errors</span>`:''}
      </div>
      <div class="max-h-48 overflow-y-auto space-y-1">
        ${rows.map(r=>`<div class="flex items-start gap-2 text-xs px-2 py-1.5 rounded-lg ${r.error?'bg-rose-50':'bg-green-50'}">
          <span class="${r.error?'text-rose-500':'text-green-600'} shrink-0">${r.error?'✕':'✓'}</span>
          <div class="min-w-0 flex-1"><span class="font-medium">${esc(r.name)}</span> <span class="text-gray-400">(${esc(r.username)}, ${esc(r.role)})</span>${r.error?`<div class="text-rose-500">${esc(r.error)}</div>`:''}</div>
        </div>`).join('')}
      </div>`:''}
    </div>`;
  } else if(m.type==='add-impl-client'){
    title='Add Client to Implementations';
    body=`<div class="space-y-3">
      ${clientPickerHtml(c=>c.modules!==undefined)}
      <p class="text-xs text-gray-400 text-center">— or create a new client —</p>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">New Client Name</label><input id="m1" type="text" placeholder="e.g. HDFC Bank" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Description</label><textarea id="m2" rows="2" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490] resize-none"></textarea></div>
    </div>`;
  } else if(m.type==='add-impl-module'){
    title='Add Module';
    body=`<div class="space-y-3">
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Module Name *</label><input id="m1" type="text" placeholder="e.g. Core HR, Payroll, Leave & Attendance" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <p class="text-xs text-gray-400">All ${PHASES.length} phases (BPU through Hypercare) will start as "Not Started" for this module.</p>
    </div>`;
  } else if(m.type==='add-ams-client'){
    title='Add Client to AMS';
    body=`<div class="space-y-3">
      ${clientPickerHtml(c=>c.workLog!==undefined)}
      <p class="text-xs text-gray-400 text-center">— or create a new client —</p>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">New Client Name</label><input id="m1" type="text" placeholder="e.g. HDFC Bank" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Description</label><textarea id="m2" rows="2" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490] resize-none"></textarea></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Man-Day Rate (₹) <span class="text-gray-400 font-normal">optional — leave blank for retainer/hours-only</span></label><input id="m3" type="number" min="0" placeholder="e.g. 15000" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Total Available Hours <span class="text-gray-400 font-normal">optional</span></label><input id="m4" type="number" min="0" step="0.5" autocomplete="off" placeholder="Leave blank if not applicable" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/>
      <p class="text-xs text-gray-400 mt-1">If set, hours are deducted from this pool first — only overages get billed.</p></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Billing Currency</label>
        <select id="m5" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]">
          <option value="INR">INR (₹ Indian Rupee)</option>
          <option value="USD">USD ($ US Dollar)</option>
        </select>
      </div>
    </div>`;
  } else if(m.type==='edit-ams-client'){
    title='Edit AMS Client';
    body=`<div class="space-y-3">
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Description</label><textarea id="m1" rows="2" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490] resize-none">${esc(m.description||'')}</textarea></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Man-Day Rate (₹) <span class="text-gray-400 font-normal">optional</span></label><input id="m2" type="number" min="0" value="${m.manDayRate||''}" placeholder="Leave blank for retainer/hours-only" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Total Available Hours <span class="text-gray-400 font-normal">optional</span></label><input id="m3" type="number" min="0" step="0.5" value="${m.totalAvailableHours??''}" placeholder="Leave blank if not applicable" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Billing Currency</label>
        <select id="m4" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]">
          <option value="INR"${(m.currency||'INR')==='INR'?' selected':''}>INR (₹ Indian Rupee)</option>
          <option value="USD"${m.currency==='USD'?' selected':''}>USD ($ US Dollar)</option>
        </select>
      </div>
    </div>`;
    btnLabel='Save';
  } else if(m.type==='add-ams-entry'||m.type==='edit-ams-entry'){
    const isEdit=m.type==='edit-ams-entry';
    title=isEdit?'Edit Entry':'Add AMS Entry';btnLabel=isEdit?'Save Entry':'Add Entry';
    const fg=(id,label,el,hint='')=>`<div><label class="block text-xs font-medium text-gray-500 mb-1">${label}${hint?`<span class="text-gray-400 font-normal ml-1">${hint}</span>`:''}</label>${el}</div>`;
    const inp=(id,type,val='',ph='',extra='')=>`<input id="${id}" type="${type}" value="${esc(val)}" placeholder="${ph}" ${extra} class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/>`;
    const sel=(id,opts,cur='')=>`<select id="${id}" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]">${opts.map(o=>`<option${o===cur?' selected':''}>${o}</option>`).join('')}</select>`;
    const ta=(id,val='',ph='',rows=2)=>`<textarea id="${id}" rows="${rows}" placeholder="${ph}" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490] resize-none">${esc(val)}</textarea>`;
    const ragSel=`<select id="ae-rag" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]">
      <option value=""${!m.ragStatus?' selected':''}>— Not Set —</option>
      <option value="Green"${m.ragStatus==='Green'?' selected':''}>🟢 Green — On Track</option>
      <option value="Amber"${m.ragStatus==='Amber'?' selected':''}>🟡 Amber — At Risk</option>
      <option value="Red"${m.ragStatus==='Red'?' selected':''}>🔴 Red — Blocked</option>
    </select>`;
    body=`<div class="grid grid-cols-2 gap-3">
      ${fg('ae-date','Date Raised',inp('ae-date','date',m.dateRaised||todayStr()))}
      ${fg('ae-due','Due Date',inp('ae-due','date',m.dueDate||''),'optional')}
      ${fg('ae-raised','Raised / Attended By',assigneeSelect('ae-raised',m.raisedBy||S.user?.name||''))}
      ${fg('ae-module','Module / Meeting',inp('ae-module','text',m.module||'','e.g. Payroll, UAT Meeting'))}
      ${fg('ae-project','Project',inp('ae-project','text',m.project||'','Project name'))}
      ${fg('ae-type','Type',sel('ae-type',AMS_TYPES,m.etype||AMS_TYPES[0]))}
      ${fg('ae-level','Query Level',sel('ae-level',AMS_QUERY_LEVELS,m.queryLevel||AMS_QUERY_LEVELS[0]))}
      ${fg('ae-mode','Mode of Support',sel('ae-mode',AMS_MODES,m.modeOfSupport||AMS_MODES[0]))}
      ${fg('ae-status','Status',sel('ae-status',AMS_ENTRY_STATUSES,m.entryStatus||'Open'))}
      ${fg('ae-rag','Entry RAG Status',ragSel,'optional')}
      ${fg('ae-hours','Hours Consumed',inp('ae-hours','number',m.hours||'','e.g. 1.5','step="0.5" min="0"'))}
      ${fg('ae-deps','Any Dependencies',inp('ae-deps','text',m.dependencies||'','Dependencies or blockers'),'optional')}
    </div>
    <div class="mt-3 space-y-3">
      ${fg('ae-desc','Description',ta('ae-desc',m.description||'','What was the issue, query or activity?',2))}
      ${fg('ae-solution','Solution Discussed',ta('ae-solution',m.solution||'','Summary of resolution or discussion',2),'optional')}
    </div>`;
  } else if(m.type==='import-ams-entries'){
    const rows=m.csvRows||[];const valid=rows.filter(r=>!r.error);const errs=rows.filter(r=>r.error);
    title='Import AMS Entries';btnLabel=rows.length?`Import ${valid.length} ${valid.length===1?'Entry':'Entries'}`:'Preview';
    body=`<div class="space-y-3">
      <div class="flex items-center justify-between">
        <p class="text-xs text-gray-500">Paste CSV content below. First row can be headers.</p>
        <button data-act="download-ams-template" class="text-xs text-[#0e7490] font-semibold hover:underline">⬇ Download Template</button>
      </div>
      <textarea id="bulk-csv" rows="7" placeholder="date_raised,due_date,raised_by,module,project,description,type,query_level,entry_status,mode_of_support,hours&#10;2026-07-15,,Yashwanth K,Payroll,HDFC Bank,Issue with payroll run,Bug Fix,L2 - Medium,Open,Online / Remote,2.5" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#0e7490] resize-none">${esc(m.csvText||'')}</textarea>
      <button data-act="preview-ams-csv" class="w-full text-sm font-medium bg-gray-50 hover:bg-[#0e7490]/10 hover:text-[#0e7490] text-gray-700 border border-gray-200 rounded-xl py-2 transition">Preview Rows</button>
      ${rows.length?`<div class="text-xs font-semibold text-gray-700">${rows.length} rows · <span class="text-green-600">${valid.length} valid</span>${errs.length?` · <span class="text-rose-600">${errs.length} errors</span>`:''}</div>
      <div class="max-h-40 overflow-y-auto space-y-1">${rows.map(r=>`<div class="text-xs px-2 py-1 rounded-lg ${r.error?'bg-rose-50':'bg-green-50'} flex gap-2"><span class="${r.error?'text-rose-500':'text-green-600'}">${r.error?'✕':'✓'}</span><span>${esc(r.description||r.dateRaised)}${r.error?` — ${esc(r.error)}`:''}</span></div>`).join('')}</div>`:''}
    </div>`;
  } else if(m.type==='import-integrations'){
    const rows=m.csvRows||[];const valid=rows.filter(r=>!r.error);const errs=rows.filter(r=>r.error);
    title='Import Integrations';btnLabel=rows.length?`Import ${valid.length} ${valid.length===1?'Integration':'Integrations'}`:'Preview';
    body=`<div class="space-y-3">
      <div class="flex items-center justify-between">
        <p class="text-xs text-gray-500">Paste CSV content below.</p>
        <button data-act="download-integ-template" class="text-xs text-[#0e7490] font-semibold hover:underline">⬇ Download Template</button>
      </div>
      <textarea id="bulk-csv" rows="6" placeholder="name,status,assignee,due_date,description,next_action&#10;SAP Payroll Sync,In Progress,Yashwanth K,2026-08-15,SAP to Darwinbox payroll integration,Finish API mapping" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#0e7490] resize-none">${esc(m.csvText||'')}</textarea>
      <button data-act="preview-integ-csv" class="w-full text-sm font-medium bg-gray-50 hover:bg-[#0e7490]/10 hover:text-[#0e7490] text-gray-700 border border-gray-200 rounded-xl py-2 transition">Preview Rows</button>
      ${rows.length?`<div class="text-xs font-semibold text-gray-700">${rows.length} rows · <span class="text-green-600">${valid.length} valid</span>${errs.length?` · <span class="text-rose-600">${errs.length} errors</span>`:''}</div>
      <div class="max-h-40 overflow-y-auto space-y-1">${rows.map(r=>`<div class="text-xs px-2 py-1 rounded-lg ${r.error?'bg-rose-50':'bg-green-50'} flex gap-2"><span class="${r.error?'text-rose-500':'text-green-600'}">${r.error?'✕':'✓'}</span><span>${esc(r.name)}${r.error?` — ${esc(r.error)}`:` · ${esc(r.status)}`}</span></div>`).join('')}</div>`:''}
    </div>`;
  } else if(m.type==='add-milestone'||m.type==='edit-milestone'){
    const isEdit=m.type==='edit-milestone';
    title=isEdit?'Edit Milestone':'Add Milestone';btnLabel=isEdit?'Save Milestone':'Add Milestone';
    body=`<div class="space-y-3">
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Milestone Name *</label><input id="ms-name" type="text" value="${esc(m.msName||'')}" placeholder="e.g. API spec agreed, Signoff received" autocomplete="off" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="block text-xs font-medium text-gray-500 mb-1">Due Date</label><input id="ms-due" type="date" value="${esc(m.msDue||'')}" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
        <div><label class="block text-xs font-medium text-gray-500 mb-1">Status</label>
          <select id="ms-status" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]">
            ${MILESTONE_STATUSES.map(s=>`<option${s===(m.msStatus||'Pending')?' selected':''}>${s}</option>`).join('')}
          </select>
        </div>
      </div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Owner</label>${assigneeSelect('ms-owner',m.msOwner||'')}</div>
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Notes</label><input id="ms-notes" type="text" value="${esc(m.msNotes||'')}" placeholder="Any context or dependencies" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
    </div>`;
  } else if(m.type==='portfolio-export'){
    title='Portfolio Export';btnLabel='Generate PDF';
    const implC=S.clients.filter(c=>c.modules!==undefined);
    const integC=S.clients.filter(c=>(c.integrations||[]).length>0);
    const amsC=S.clients.filter(c=>c.workLog!==undefined);
    const allC=[...new Set([...implC,...integC,...amsC])];
    body=`<div class="space-y-4">
      <div>
        <div class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Select Clients</div>
        <div class="max-h-48 overflow-y-auto space-y-1.5">
          ${allC.map(c=>`<label class="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 cursor-pointer">
            <input type="checkbox" data-act="portfolio-client-toggle" data-cid="${c.id}" class="rounded" checked/>
            <span class="text-sm text-gray-800">${esc(c.name)}</span>
            <span class="text-xs text-gray-400 ml-auto">${[c.modules&&'Impl',((c.integrations||[]).length>0)&&'Integ',c.workLog&&'AMS'].filter(Boolean).join(' · ')}</span>
          </label>`).join('')}
        </div>
      </div>
      <div>
        <div class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Include Sections</div>
        <div class="flex gap-3">
          ${[['impl','Implementations'],['integrations','Integrations'],['ams','AMS']].map(([k,l])=>`<label class="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer"><input type="checkbox" data-act="portfolio-section-toggle" data-section="${k}" class="rounded" checked/>${l}</label>`).join('')}
        </div>
      </div>
      <p class="text-xs text-gray-400">Sections are skipped if a client has no data in that section.</p>
    </div>`;
  } else if(m.type==='rename-client'){
    const c=S.clients.find(x=>x.id===m.cid);
    title='Rename Client';
    body=`<div class="space-y-3">
      <div><label class="block text-xs font-medium text-gray-500 mb-1">Client Name *</label><input id="m1" type="text" value="${esc(c?.name||'')}" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>
    </div>`;
    btnLabel='Save';
  } else if(m.type==='rename-integrations'){
    const c=S.clients.find(x=>x.id===m.cid);
    title=`Rename Integrations — ${esc(c?.name||'')}`;
    body=`<div class="space-y-2.5 max-h-[50vh] overflow-y-auto pr-1">
      ${(c?.integrations||[]).length?(c.integrations.map(i=>`<div><label class="block text-xs font-medium text-gray-500 mb-1">Integration</label><input id="ri-${i.id}" type="text" value="${esc(i.name)}" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>`).join('')):'<p class="text-sm text-gray-400">No integrations for this client.</p>'}
    </div>`;
    btnLabel='Save All';
  } else if(m.type==='rename-modules'){
    const c=S.clients.find(x=>x.id===m.cid);
    title=`Rename Modules — ${esc(c?.name||'')}`;
    body=`<div class="space-y-2.5 max-h-[50vh] overflow-y-auto pr-1">
      ${(c?.modules||[]).length?(c.modules.map(mod=>`<div><label class="block text-xs font-medium text-gray-500 mb-1">Module</label><input id="rm-${mod.id}" type="text" value="${esc(mod.name)}" class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0e7490]"/></div>`).join('')):'<p class="text-sm text-gray-400">No modules for this client.</p>'}
    </div>`;
    btnLabel='Save All';
  } else if(m.type==='confirm'){
    title='Confirm';btnLabel='Delete';btnCls='bg-rose-600 hover:bg-rose-700';
    body=`<p class="text-sm text-gray-600">${esc(m.msg||'Are you sure? This cannot be undone.')}</p>`;
  }
  const busy=!!m.busy;
  const busyLabel=m.type==='confirm'?'Deleting…':'Saving…';
  return`<div class="k-modal-overlay fade" id="modal-overlay">
  <div class="k-modal modal-pop" style="max-width:${['add-ams-entry','edit-ams-entry','bulk-import-users','portfolio-export','import-ams-entries','import-integrations'].includes(m.type)?'640px':'440px'};">
    <div class="k-modal-header flex items-center justify-between">
      <h2 class="k-h2">${esc(title)}</h2>
      <button data-act="modal-close" ${busy?'disabled':''} class="k-btn k-btn-ghost k-btn-sm" style="height:28px;width:28px;padding:0;">✕</button>
    </div>
    <div class="k-modal-body">${body}</div>
    <div class="k-modal-footer">
      <button data-act="modal-close" ${busy?'disabled':''} class="k-btn k-btn-secondary">Cancel</button>
      <button data-act="modal-confirm" ${busy?'disabled':''} class="k-btn k-btn-primary" style="min-width:120px;">${busy?spinnerSvg()+busyLabel:btnLabel}</button>
    </div>
  </div>
</div>`;
}