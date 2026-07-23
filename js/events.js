// ─── EVENTS ───────────────────────────────────────────────────────
document.addEventListener('click',async e=>{
  if(e.target.id==='modal-overlay'&&e.target===e.currentTarget){if(S.modal?.busy)return;S.modal=null;render();return;}
  if(e.target.id==='cmdp-overlay'){S.cmdPaletteOpen=false;render();return;}
  const el=e.target.closest('[data-act]');if(!el)return;
  const act=el.dataset.act;

  if(act==='login'){
    const u=document.getElementById('lu')?.value.trim(),p=document.getElementById('lp')?.value;
    const errEl=document.getElementById('lerr');
    if(!u||!p){if(errEl){errEl.textContent='Enter username and password';errEl.classList.remove('hidden');}return;}
    setBtnBusy(el,'Signing in…');
    if(errEl)errEl.classList.add('hidden');
    let ld;
    try{
      const lr=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});
      ld=await lr.json();
      if(!lr.ok){clearBtnBusy(el);const e2=document.getElementById('lerr');if(e2){e2.textContent=ld.error||'Login failed';e2.classList.remove('hidden');}return;}
    }catch(err){clearBtnBusy(el);const e2=document.getElementById('lerr');if(e2){e2.textContent='Connection failed. Check repo/env setup.';e2.classList.remove('hidden');}return;}
    S.sessionToken=ld.token;S.user=ld.user;S.shas.users=ld.usersSha;
    document.getElementById('app').innerHTML=renderAppSkeleton();
    try{const cl=await apiRead('data/clients.json');S.clients=cl.content;S.shas.clients=cl.sha;}
    catch(err){S.user=null;S.sessionToken=null;render();const e2=document.getElementById('lerr');if(e2){e2.textContent='Loaded user but failed to load clients.';e2.classList.remove('hidden');}return;}
    try{const ul=await apiRead('data/users.json');S.usersForDropdown=ul.content.map(u=>({id:u.id,name:u.name||u.username,role:u.role,username:u.username}));if(can('admin')){S.users=ul.content;S.shas.users=ul.sha;}}
    catch(err){S.usersForDropdown=[{id:S.user.id,name:S.user.name||S.user.username,role:S.user.role,username:S.user.username}];}
    persistSession(S.sessionToken,S.user);
    navigate('dashboard');return;
  }
  if(act==='logout'){clearSession();S.user=null;S.clients=[];S.users=[];S.usersForDropdown=[];S.shas={clients:null,users:null};S.sessionToken=null;navigate('login');return;}
  if(act==='nav-dashboard'){navigate('dashboard');return;}
  if(act==='nav-clients'){navigate('clients');return;}
  if(act==='nav-impl'){navigate('impl-clients');return;}
  if(act==='nav-ams'){navigate('ams-clients');return;}
  if(act==='nav-admin'){if(can('admin'))navigate('admin');return;}
  if(act==='toggle-sidebar'){S.sidebarCollapsed=!S.sidebarCollapsed;try{localStorage.setItem('itk_sb_collapsed',S.sidebarCollapsed?'1':'0');}catch(e){}render();return;}
  if(act==='toggle-dark'){S.darkMode=!S.darkMode;document.documentElement.classList.toggle('dark',S.darkMode);try{localStorage.setItem('itk_dark',S.darkMode?'1':'0');}catch(e){}render();return;}
  if(act==='cmdp-open'){S.cmdPaletteOpen=true;S.cmdQuery='';render();setTimeout(()=>document.getElementById('cmdp-input')?.focus(),30);return;}
  if(act==='cmdp-go'){
    const r=_cmdpResults[Number(el.dataset.idx)];if(!r)return;
    S.cmdPaletteOpen=false;navigate(r.view,r.params);return;
  }
  if(act==='open-client'){navigate('client-detail',{clientId:el.dataset.id});return;}
  if(act==='open-integ'){navigate('integ-detail',{clientId:el.dataset.cid,integId:el.dataset.iid});return;}
  if(act==='open-impl-client'){navigate('impl-client-detail',{clientId:el.dataset.id});return;}
  if(act==='open-ams-client'){navigate('ams-client-detail',{clientId:el.dataset.id});return;}
  if(act==='filter'){S.filter=el.dataset.filter;render();return;}
  if(act==='sort'){const k=el.dataset.key;if(S.sort.key===k){S.sort.dir=S.sort.dir==='asc'?'desc':'asc';}else{S.sort={key:k,dir:'asc'};}render();return;}
  if(act==='sort-dash-attn'){const k=el.dataset.key;if(S.dashAttnSort.key===k){S.dashAttnSort.dir=S.dashAttnSort.dir==='asc'?'desc':'asc';}else{S.dashAttnSort={key:k,dir:'asc'};}render();return;}
  if(act==='dash-assignee-filter'){S.dashAssigneeFilter=el.dataset.key;render();return;}
  if(act==='sort-dash-assignee'){const k=el.dataset.key;if(S.dashAssigneeSort.key===k){S.dashAssigneeSort.dir=S.dashAssigneeSort.dir==='asc'?'desc':'asc';}else{S.dashAssigneeSort={key:k,dir:'desc'};}render();return;}
  if(act==='dash-assignee-toggle'){const key=el.dataset.key;if(S.dashAssigneeExpanded.has(key))S.dashAssigneeExpanded.delete(key);else S.dashAssigneeExpanded.add(key);render();return;}
  if(act==='sort-dash-client'){const k=el.dataset.key;if(S.dashClientSort.key===k){S.dashClientSort.dir=S.dashClientSort.dir==='asc'?'desc':'asc';}else{S.dashClientSort={key:k,dir:'asc'};}render();return;}
  if(act==='admin-tab'){S.adminTab=el.dataset.tab;S.adminSearch='';render();if(el.dataset.tab==='audit'&&!S.auditLoaded)loadAuditLog();return;}
  if(act==='audit-apply'){S.auditPage=0;loadAuditLog();return;}
  if(act==='audit-clear'){S.auditFrom='';S.auditTo='';S.auditUser='';S.auditSearch='';S.auditPage=0;loadAuditLog();return;}
  if(act==='audit-prev'){if(S.auditPage>0){S.auditPage--;loadAuditLog();}return;}
  if(act==='audit-next'){S.auditPage++;loadAuditLog();return;}
  if(act==='audit-export'){setBtnBusy(el,'Exporting…');try{const d=await fetchAuditLog({export:true});exportAuditExcel(d.rows);}catch(e){showToast(e.message||'Export failed','error');}finally{clearBtnBusy(el);}return;}
  if(act==='exp-pptx'){setBtnBusy(el,'Generating…');try{await exportPptx(el.dataset.id);}finally{clearBtnBusy(el);}return;}
  if(act==='exp-pdf'){setBtnBusy(el,'Generating…');try{await exportPdf(el.dataset.id);}finally{clearBtnBusy(el);}return;}
  if(act==='exp-impl-pdf'){setBtnBusy(el,'Generating…');try{exportImplPdf(el.dataset.cid);}finally{clearBtnBusy(el);}return;}
  if(act==='exp-ams-invoice'){if(!can('admin'))return;setBtnBusy(el,'Generating…');try{exportAmsInvoicePdf(el.dataset.cid);}finally{clearBtnBusy(el);}return;}
  if(act==='copy-update'){try{await navigator.clipboard.writeText(el.dataset.text);showToast('Copied ✓');}catch(e){showToast('Copy failed','error');}return;}
  if(act==='edit-timeline'){if(!can('edit'))return;S.editingTimelineId=el.dataset.tid;render();setTimeout(()=>{const ta=document.getElementById(`edit-tl-${el.dataset.tid}`);if(ta){ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length);}},50);return;}
  if(act==='cancel-edit-timeline'){S.editingTimelineId=null;render();return;}
  if(act==='toggle-history'){const tid=el.dataset.tid;if(S.expandedHistory.has(tid))S.expandedHistory.delete(tid);else S.expandedHistory.add(tid);render();return;}
  if(act==='modal-open'){S.modal={type:el.dataset.modal,cid:el.dataset.cid};render();setTimeout(()=>document.getElementById('m1')?.focus(),50);return;}
  if(act==='open-impl-phase'){
    navigate('impl-phase-detail',{clientId:el.dataset.cid,moduleId:el.dataset.mid,phase:el.dataset.phase});return;
  }
  if(act==='modal-close'){if(S.modal?.busy)return;S.modal=null;render();return;}

  if(act==='mark-complete'){
    if(!can('edit'))return;
    const cid=el.dataset.cid,iid=el.dataset.iid;
    const c=S.clients.find(x=>x.id===cid);const i=c?.integrations.find(x=>x.id===iid);if(!i)return;
    const prevStatus=i.status;i.status='Completed';
    const entry={id:uid(),date:todayStr(),update:'Marked as Completed.',addedBy:S.user.name,addedAt:new Date().toISOString()};
    i.timeline.unshift(entry);
    setBtnBusy(el,'Saving…');
    try{await saveClients(`Complete: ${i.name}`);showToast('Marked complete ✓');navigate('integ-detail',{clientId:cid,integId:iid});}
    catch(err){i.status=prevStatus;i.timeline.shift();showToast('Failed: '+err.message,'error');render();}
    return;
  }
  if(act==='save-integ'){
    if(!can('edit'))return;
    const cid=el.dataset.cid,iid=el.dataset.iid;
    const c=S.clients.find(x=>x.id===cid);const i=c?.integrations.find(x=>x.id===iid);if(!i)return;
    const prev={...i};
    i.status=document.getElementById('f-status')?.value||i.status;
    i.assignee=document.getElementById('f-assignee')?.value?.trim()||i.assignee;
    i.dueDate=document.getElementById('f-due')?.value||'';
    i.description=document.getElementById('f-desc')?.value?.trim()||'';
    i.nextAction=document.getElementById('f-next')?.value?.trim()||'';
    setBtnBusy(el,'Saving…');
    try{await saveClients(`Update ${i.name}`);showToast('Saved ✓');navigate('integ-detail',{clientId:cid,integId:iid});}
    catch(err){Object.assign(i,prev);showToast('Save failed: '+err.message,'error');clearBtnBusy(el);}
    return;
  }
  if(act==='add-timeline'){
    if(!can('edit'))return;
    const cid=el.dataset.cid,iid=el.dataset.iid;
    const text=document.getElementById('tl-input')?.value.trim();
    if(!text){showToast('Enter an update','error');return;}
    const c=S.clients.find(x=>x.id===cid);const i=c?.integrations.find(x=>x.id===iid);if(!i)return;
    const entry={id:uid(),date:todayStr(),update:text,addedBy:S.user.name,addedAt:new Date().toISOString()};
    i.timeline.unshift(entry);setBtnBusy(el,'Saving…');
    try{await saveClients(`Timeline: ${i.name}`);showToast('Update added ✓');navigate('integ-detail',{clientId:cid,integId:iid});}
    catch(err){i.timeline.shift();showToast('Failed: '+err.message,'error');clearBtnBusy(el);}
    return;
  }
  if(act==='save-edit-timeline'){
    if(!can('edit'))return;
    const cid=el.dataset.cid,iid=el.dataset.iid,tid=el.dataset.tid;
    const c=S.clients.find(x=>x.id===cid);const i=c?.integrations.find(x=>x.id===iid);if(!i)return;
    const idx=i.timeline.findIndex(x=>x.id===tid);if(idx<0)return;
    const newText=document.getElementById(`edit-tl-${tid}`)?.value.trim();
    if(!newText){showToast('Update cannot be empty','error');return;}
    const original=i.timeline[idx];
    if(newText===original.update){S.editingTimelineId=null;render();return;}
    const snapshot=JSON.parse(JSON.stringify(original));
    const updated={...original,edits:[...(original.edits||[]),{text:original.update,editedAt:new Date().toISOString(),editedBy:S.user.name}],update:newText,lastEditedAt:new Date().toISOString(),lastEditedBy:S.user.name};
    i.timeline[idx]=updated;
    setBtnBusy(el,'Saving…');
    try{await saveClients(`Edit timeline: ${i.name}`);S.editingTimelineId=null;showToast('Update edited ✓');navigate('integ-detail',{clientId:cid,integId:iid});}
    catch(err){i.timeline[idx]=snapshot;showToast('Failed: '+err.message,'error');clearBtnBusy(el);}
    return;
  }
  if(act==='save-impl-phase'){
    if(!can('edit'))return;
    const cid=el.dataset.cid,mid=el.dataset.mid,phaseName=el.dataset.phase;
    const c=S.clients.find(x=>x.id===cid);const mod=(c?.modules||[]).find(x=>x.id===mid);if(!mod)return;
    const idx=mod.phases.findIndex(x=>x.name===phaseName);
    const ph=idx>=0?mod.phases[idx]:{name:phaseName,status:'Not Started',startDate:'',targetDate:'',updates:[]};
    const prev={...ph};
    ph.status=document.getElementById('ip-status')?.value||ph.status;
    ph.assignee=document.getElementById('ip-assignee')?.value?.trim()||'';
    ph.startDate=document.getElementById('ip-start')?.value||'';
    ph.targetDate=document.getElementById('ip-target')?.value||'';
    ph.currentActivity=document.getElementById('ip-activity')?.value?.trim()||'';
    ph.nextAction=document.getElementById('ip-next')?.value?.trim()||'';
    // Signoff enforcement
    const isSignoff=SIGNOFF_PHASES.includes(phaseName);
    const hasAttachment=(ph.updates||[]).some(u=>u.attachment?.url);
    if(isSignoff&&ph.status==='Completed'&&!hasAttachment){
      showToast(`${phaseName} requires a document attached to an update. Upload a file before marking complete.`,'error');
      return;
    }
    if(!isSignoff&&ph.status==='Completed'&&!hasAttachment){
      showToast('Tip: Consider attaching a reference document to this phase update.','warn');
    }
    if(idx>=0)mod.phases[idx]=ph;else mod.phases.push(ph);
    setBtnBusy(el,'Saving…');
    try{await saveClients(`Update ${phaseName}: ${mod.name}`);showToast('Saved ✓');navigate('impl-phase-detail',{clientId:cid,moduleId:mid,phase:phaseName});}
    catch(err){if(idx>=0)mod.phases[idx]=prev;else mod.phases.pop();showToast('Save failed: '+err.message,'error');clearBtnBusy(el);}
    return;
  }
  if(act==='add-impl-update'){
    if(!can('edit'))return;
    const cid=el.dataset.cid,mid=el.dataset.mid,phaseName=el.dataset.phase;
    const text=document.getElementById('ip-update-input')?.value.trim();
    if(!text){showToast('Enter an update','error');return;}
    const c=S.clients.find(x=>x.id===cid);const mod=(c?.modules||[]).find(x=>x.id===mid);if(!mod)return;
    const ph=mod.phases.find(x=>x.name===phaseName);if(!ph)return;
    if(!ph.updates)ph.updates=[];
    const attachUrl=document.getElementById('ip-attach-url')?.value.trim()||'';
    const attachLabel=document.getElementById('ip-attach-label')?.value.trim()||'';
    const attachMime=document.getElementById('ip-attach-mimetype')?.value||'';
    const attachName=document.getElementById('ip-attach-filename')?.value||'';
    const attachment=attachUrl?{label:attachLabel||attachName||'Attachment',url:attachUrl,fileName:attachName||attachLabel||'Attachment',mimeType:attachMime}:undefined;
    const entry={id:uid(),date:todayStr(),update:text,addedBy:S.user.name,addedAt:new Date().toISOString(),...(attachment?{attachment}:{})};
    ph.updates.unshift(entry);setBtnBusy(el,'Saving…');
    try{await saveClients(`Update ${phaseName}: ${mod.name}`);showToast('Update added ✓');navigate('impl-phase-detail',{clientId:cid,moduleId:mid,phase:phaseName});}
    catch(err){ph.updates.shift();showToast('Failed: '+err.message,'error');clearBtnBusy(el);}
    return;
  }
  if(act==='save-edit-impl-update'){
    if(!can('edit'))return;
    const cid=el.dataset.cid,mid=el.dataset.mid,phaseName=el.dataset.phase,tid=el.dataset.tid;
    const c=S.clients.find(x=>x.id===cid);const mod=(c?.modules||[]).find(x=>x.id===mid);if(!mod)return;
    const ph=mod.phases.find(x=>x.name===phaseName);if(!ph||!ph.updates)return;
    const idx=ph.updates.findIndex(x=>x.id===tid);if(idx<0)return;
    const newText=document.getElementById(`edit-tl-${tid}`)?.value.trim();
    if(!newText){showToast('Update cannot be empty','error');return;}
    const attachUrl=document.getElementById(`eat-url-${tid}`)?.value.trim()||'';
    const attachLabel=document.getElementById(`eat-label-${tid}`)?.value.trim()||'';
    const attachMime=document.getElementById(`eat-mimetype-${tid}`)?.value||'';
    const attachName=document.getElementById(`eat-filename-${tid}`)?.value||'';
    const attachment=attachUrl?{label:attachLabel||attachName||'Attachment',url:attachUrl,fileName:attachName||attachLabel||'Attachment',mimeType:attachMime}:undefined;
    const original=ph.updates[idx];
    const snapshot=JSON.parse(JSON.stringify(original));
    const textChanged=newText!==original.update;
    const updated={...original,...(attachment!==undefined?{attachment}:{attachment:original.attachment}),
      ...(textChanged?{edits:[...(original.edits||[]),{text:original.update,editedAt:new Date().toISOString(),editedBy:S.user.name}],update:newText,lastEditedAt:new Date().toISOString(),lastEditedBy:S.user.name}:{})};
    ph.updates[idx]=updated;setBtnBusy(el,'Saving…');
    try{await saveClients(`Edit update: ${phaseName}, ${mod.name}`);S.editingTimelineId=null;showToast('Update saved ✓');navigate('impl-phase-detail',{clientId:cid,moduleId:mid,phase:phaseName});}
    catch(err){ph.updates[idx]=snapshot;showToast('Failed: '+err.message,'error');clearBtnBusy(el);}
    return;
  }
  if(act==='toggle-ams-history'){
    const eid=el.dataset.eid;
    if(S.expandedAmsHistory.has(eid))S.expandedAmsHistory.delete(eid);else S.expandedAmsHistory.add(eid);
    render();return;
  }
  // ── Milestone handlers ──
  if(act==='add-milestone-btn'){
    if(!can('edit'))return;
    S.modal={type:'add-milestone',cid:el.dataset.cid,iid:el.dataset.iid};render();setTimeout(()=>document.getElementById('ms-name')?.focus(),50);return;
  }
  if(act==='edit-milestone-btn'){
    if(!can('edit'))return;
    const c=S.clients.find(x=>x.id===el.dataset.cid);const i=c?.integrations.find(x=>x.id===el.dataset.iid);const ms=(i?.milestones||[]).find(x=>x.id===el.dataset.mid);if(!ms)return;
    S.modal={type:'edit-milestone',cid:el.dataset.cid,iid:el.dataset.iid,mid:ms.id,msName:ms.name,msDue:ms.dueDate||'',msStatus:ms.status,msOwner:ms.owner||'',msNotes:ms.notes||''};render();setTimeout(()=>document.getElementById('ms-name')?.focus(),50);return;
  }
  if(act==='delete-milestone'){
    if(!can('admin'))return;
    const c=S.clients.find(x=>x.id===el.dataset.cid);const i=c?.integrations.find(x=>x.id===el.dataset.iid);const ms=(i?.milestones||[]).find(x=>x.id===el.dataset.mid);if(!ms)return;
    S.modal={type:'confirm',msg:`Delete milestone "${ms.name}"? Cannot be undone.`,_act:'delete-milestone',_cid:el.dataset.cid,_iid:el.dataset.iid,_mid:ms.id};render();return;
  }
  // ── Excel export handlers ──
  if(act==='exp-excel'){setBtnBusy(el,'Exporting…');try{exportExcel(el.dataset.etype,el.dataset.cid);}finally{clearBtnBusy(el);}return;}
  // ── Bulk CSV import handlers ──
  if(act==='open-import-ams'){
    S.modal={type:'import-ams-entries',cid:el.dataset.cid};render();return;
  }
  if(act==='open-import-integ'){
    S.modal={type:'import-integrations',cid:el.dataset.cid};render();return;
  }
  if(act==='download-ams-template'){
    const csv='date_raised,due_date,raised_by,module,project,description,type,query_level,entry_status,mode_of_support,hours\n2026-07-15,,Yashwanth K,Payroll,HDFC Bank,Issue with payroll run,Bug Fix,L2 - Medium,Open,Online / Remote,2.5\n';
    const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);a.download='ams_entries_template.csv';document.body.appendChild(a);a.click();document.body.removeChild(a);return;
  }
  if(act==='download-integ-template'){
    const csv='name,status,assignee,due_date,description,next_action\nSAP Payroll Sync,In Progress,Yashwanth K,2026-08-15,SAP to Darwinbox payroll integration,Finish API mapping\n';
    const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);a.download='integrations_template.csv';document.body.appendChild(a);a.click();document.body.removeChild(a);return;
  }
  if(act==='preview-ams-csv'){
    const csv=document.getElementById('bulk-csv')?.value||'';
    if(!csv.trim()){showToast('Paste CSV first','error');return;}
    const rows=parseAmsEntriesCsv(csv);
    S.modal={...S.modal,csvRows:rows,csvText:csv};render();return;
  }
  if(act==='preview-integ-csv'){
    const csv=document.getElementById('bulk-csv')?.value||'';
    if(!csv.trim()){showToast('Paste CSV first','error');return;}
    const c=S.clients.find(x=>x.id===S.modal?.cid);
    const rows=parseIntegrationsCsv(csv,c?.integrations||[]);
    S.modal={...S.modal,csvRows:rows,csvText:csv};render();return;
  }
  // ── Portfolio export ──
  if(act==='portfolio-export'){
    S.modal={type:'portfolio-export'};render();return;
  }
  if(act==='clear-attach'){
    const prefix=el.dataset.prefix;const tid=el.dataset.tid||'';
    const uid_=tid?`${prefix}-url-${tid}`:`${prefix}-attach-url`;
    const mid_=tid?`${prefix}-mimetype-${tid}`:`${prefix}-attach-mimetype`;
    const nid_=tid?`${prefix}-filename-${tid}`:`${prefix}-attach-filename`;
    const pid_=tid?`eat-preview-${tid}`:`ip-attach-preview`;
    const urlEl=document.getElementById(uid_);const mEl=document.getElementById(mid_);const nEl=document.getElementById(nid_);const pEl=document.getElementById(pid_);
    if(urlEl)urlEl.value='';if(mEl)mEl.value='';if(nEl)nEl.value='';
    if(pEl){pEl.classList.add('hidden');}
    return;
  }
  if(act==='download-user-template'){
    const csv='username,full_name,role,email,password\npriya.s,Priya S,editor,priya@kognoz.in,Kognoz@123\nrahul.m,Rahul M,editor,rahul@kognoz.in,Kognoz@123\n';
    const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);a.download='integtrack_users_template.csv';document.body.appendChild(a);a.click();document.body.removeChild(a);
    return;
  }
  if(act==='preview-users-csv'){
    const csv=document.getElementById('bulk-csv')?.value||'';
    if(!csv.trim()){showToast('Paste CSV content first','error');return;}
    const rows=parseUsersCsv(csv);
    if(!rows.length){showToast('No rows found in CSV','error');return;}
    S.modal={...S.modal,csvRows:rows,csvText:csv};render();
    return;
  }
  if(act==='toggle-bulk-integ'){
    if(!can('admin'))return;
    const cid=el.dataset.cid;
    if(S.bulkIntegMode&&S.bulkIntegCid===cid){
      S.bulkIntegMode=false;S.bulkIntegCid=null;S.bulkIntegSelected=new Set();
    }else{
      S.bulkIntegMode=true;S.bulkIntegCid=cid;S.bulkIntegSelected=new Set();
    }
    render();return;
  }
  if(act==='toggle-bulk-integ-row'){
    if(!can('admin'))return;
    const iid=el.dataset.iid;
    if(S.bulkIntegSelected.has(iid))S.bulkIntegSelected.delete(iid);else S.bulkIntegSelected.add(iid);
    render();return;
  }
  if(act==='toggle-bulk-integ-all'){
    if(!can('admin'))return;
    const cid=el.dataset.cid;const c=S.clients.find(x=>x.id===cid);if(!c)return;
    const fl=S.filter==='all'?c.integrations:c.integrations.filter(i=>i.status===S.filter);
    if(fl.length&&fl.every(i=>S.bulkIntegSelected.has(i.id))){fl.forEach(i=>S.bulkIntegSelected.delete(i.id));}
    else{fl.forEach(i=>S.bulkIntegSelected.add(i.id));}
    render();return;
  }
  if(act==='bulk-delete-integ'){
    if(!can('admin'))return;
    const cid=el.dataset.cid;const c=S.clients.find(x=>x.id===cid);if(!c||!S.bulkIntegSelected.size)return;
    const ids=new Set(S.bulkIntegSelected);
    const prev=JSON.parse(JSON.stringify(c.integrations));
    c.integrations=c.integrations.filter(i=>!ids.has(i.id));
    setBtnBusy(el,'Deleting…');
    try{
      await saveClients(`Bulk delete ${ids.size} integration${ids.size!==1?'s':''}: ${c.name}`);
      S.bulkIntegMode=false;S.bulkIntegCid=null;S.bulkIntegSelected=new Set();
      showToast(`${ids.size} integration${ids.size!==1?'s':''} deleted ✓`);
      navigate('client-detail',{clientId:cid});
    }catch(err){c.integrations=prev;showToast('Delete failed: '+err.message,'error');clearBtnBusy(el);}
    return;
  }
  if(act==='toggle-bulk-impl'){
    if(!can('admin'))return;
    const cid=el.dataset.cid;
    if(S.bulkImplMode&&S.bulkImplCid===cid){
      S.bulkImplMode=false;S.bulkImplCid=null;S.bulkSelected=new Set();
    }else{
      S.bulkImplMode=true;S.bulkImplCid=cid;S.bulkSelected=new Set();
    }
    render();return;
  }
  if(act==='toggle-bulk-phase'){
    if(!can('admin'))return;
    const key=`${el.dataset.mid}:${el.dataset.phase}`;
    if(S.bulkSelected.has(key))S.bulkSelected.delete(key);else S.bulkSelected.add(key);
    render();return;
  }
  if(act==='bulk-mark-complete'){
    if(!can('admin'))return;
    const cid=el.dataset.cid;
    const c=S.clients.find(x=>x.id===cid);if(!c||!S.bulkSelected.size)return;
    const now=new Date();const dateStr=todayStr();const isoStr=now.toISOString();
    const byUser=S.user.name;
    const changed=[];
    S.bulkSelected.forEach(key=>{
      const [mid,phaseName]=key.split(/:(.+)/);
      const mod=(c.modules||[]).find(x=>x.id===mid);if(!mod)return;
      const idx=mod.phases.findIndex(x=>x.name===phaseName);
      const ph=idx>=0?mod.phases[idx]:{name:phaseName,status:'Not Started',startDate:'',targetDate:'',updates:[]};
      if(!ph.updates)ph.updates=[];
      ph.status='Completed';
      ph.updates.unshift({id:uid(),date:dateStr,update:`Marked complete via bulk action by ${byUser}.`,addedBy:byUser,addedAt:isoStr});
      if(idx>=0)mod.phases[idx]=ph;else mod.phases.push(ph);
      changed.push(`${phaseName} (${mod.name})`);
    });
    setBtnBusy(el,`Saving…`);
    try{
      await saveClients(`Bulk complete: ${changed.length} phases — ${c.name}`);
      S.bulkImplMode=false;S.bulkImplCid=null;S.bulkSelected=new Set();
      showToast(`${changed.length} phase${changed.length===1?'':'s'} marked complete ✓`);
      navigate('impl-client-detail',{clientId:cid});
    }catch(err){
      showToast('Save failed: '+err.message,'error');clearBtnBusy(el);
    }
    return;
  }
  if(act==='delete-impl-module'){
    if(!can('admin'))return;
    const c=S.clients.find(x=>x.id===el.dataset.cid);const m=(c?.modules||[]).find(x=>x.id===el.dataset.mid);if(!m)return;
    S.modal={type:'confirm',msg:`Delete module "${m.name}" and all its phase data? This cannot be undone.`,_act:'delete-impl-module',_cid:c.id,_mid:m.id};render();return;
  }
  if(act==='delete-timeline-entry'){
    if(!can('admin'))return;
    const c=S.clients.find(x=>x.id===el.dataset.cid);const i=c?.integrations.find(x=>x.id===el.dataset.iid);if(!i)return;
    S.modal={type:'confirm',msg:`Delete this update? This cannot be undone.`,_act:'delete-timeline-entry',_cid:c.id,_iid:i.id,_tid:el.dataset.tid};render();return;
  }
  if(act==='delete-impl-update'){
    if(!can('admin'))return;
    const c=S.clients.find(x=>x.id===el.dataset.cid);const mod=(c?.modules||[]).find(x=>x.id===el.dataset.mid);if(!mod)return;
    const ph=mod.phases?.find(x=>x.name===el.dataset.phase);if(!ph)return;
    S.modal={type:'confirm',msg:`Delete this update? This cannot be undone.`,_act:'delete-impl-update',_cid:c.id,_mid:mod.id,_phase:el.dataset.phase,_tid:el.dataset.tid};render();return;
  }
  if(act==='delete-ams-entry'){
    if(!can('admin'))return;
    const c=S.clients.find(x=>x.id===el.dataset.cid);const e=c?.workLog?.find(x=>x.id===el.dataset.eid);if(!e)return;
    S.modal={type:'confirm',msg:`Delete this entry (${fmtDate(entryDate(e))})? This cannot be undone.`,_act:'delete-ams-entry',_cid:c.id,_eid:e.id};render();return;
  }
  if(act==='edit-ams-entry'){
    if(!can('edit'))return;
    const c=S.clients.find(x=>x.id===el.dataset.cid);const e=c?.workLog?.find(x=>x.id===el.dataset.eid);if(!e)return;
    S.modal={type:'edit-ams-entry',cid:el.dataset.cid,eid:el.dataset.eid,
      dateRaised:entryDate(e),raisedBy:entryRaisedBy(e),module:e.module||'',project:e.project||'',
      description:e.description||'',etype:entryType(e),queryLevel:e.queryLevel||AMS_QUERY_LEVELS[0],
      dependencies:e.dependencies||'',entryStatus:e.entryStatus||'Open',solution:e.solution||'',
      modeOfSupport:e.modeOfSupport||AMS_MODES[0],hours:e.hours||'',
      dueDate:e.dueDate||'',ragStatus:e.ragStatus||''};
    render();setTimeout(()=>document.getElementById('ae-date')?.focus(),50);return;
  }
  if(act==='exp-ams-activity'){if(!can('admin'))return;setBtnBusy(el,'Generating…');try{exportAmsActivityPdf(el.dataset.cid);}finally{clearBtnBusy(el);}return;}
  if(act==='delete-client'){
    if(!can('admin'))return;const c=S.clients.find(x=>x.id===el.dataset.id);if(!c)return;
    const other=c.modules!==undefined||c.workLog!==undefined;
    S.modal={type:'confirm',msg:other?`Remove "${c.name}" from Integrations (their ${c.integrations.length} integrations)? They'll stay in other sections. Cannot be undone.`:`Delete "${c.name}" entirely, including all ${c.integrations.length} integrations? Cannot be undone.`,_act:'delete-client',_id:c.id};render();return;
  }
  if(act==='delete-impl-client'){
    if(!can('admin'))return;const c=S.clients.find(x=>x.id===el.dataset.id);if(!c)return;
    const other=c.integrations.length>0||c.workLog!==undefined;
    S.modal={type:'confirm',msg:other?`Remove "${c.name}" from Implementations (their ${(c.modules||[]).length} modules)? They'll stay in other sections. Cannot be undone.`:`Delete "${c.name}" entirely, including all ${(c.modules||[]).length} modules? Cannot be undone.`,_act:'delete-impl-client',_id:c.id};render();return;
  }
  if(act==='delete-integ'){
    if(!can('admin'))return;const c=S.clients.find(x=>x.id===el.dataset.cid);const i=c?.integrations.find(x=>x.id===el.dataset.iid);if(!i)return;
    S.modal={type:'confirm',msg:`Delete "${i.name}"? Cannot be undone.`,_act:'delete-integ',_cid:c.id,_iid:i.id};render();return;
  }
  if(act==='delete-ams-client'){
    if(!can('admin'))return;const c=S.clients.find(x=>x.id===el.dataset.id);if(!c)return;
    const other=c.integrations.length>0||c.modules!==undefined;
    S.modal={type:'confirm',msg:other?`Remove "${c.name}" from AMS (all logged hours)? They'll stay in other sections. Cannot be undone.`:`Delete "${c.name}" entirely, including all logged hours? Cannot be undone.`,_act:'delete-ams-client',_id:c.id};render();return;
  }
  if(act==='edit-ams-client'){
    if(!can('admin'))return;const c=S.clients.find(x=>x.id===el.dataset.id);if(!c)return;
    S.modal={type:'edit-ams-client',cid:c.id,description:c.description,manDayRate:c.manDayRate,totalAvailableHours:c.totalAvailableHours,currency:c.currency||'INR'};render();return;
  }
  if(act==='exec-undo'){execUndo();return;}
  if(act==='ams-quick'){
    const range=el.dataset.range;S.amsQuick=range;
    const now=new Date();const y=now.getFullYear(),m=now.getMonth();
    if(range==='this-month'){S.amsFrom=`${y}-${String(m+1).padStart(2,'0')}-01`;S.amsTo=todayStr();}
    else if(range==='last-month'){const lmStart=new Date(y,m-1,1);const lmEnd=new Date(y,m,0);S.amsFrom=lmStart.toISOString().slice(0,10);S.amsTo=lmEnd.toISOString().slice(0,10);}
    else if(range==='this-quarter'){const q=Math.floor(m/3);S.amsFrom=`${y}-${String(q*3+1).padStart(2,'0')}-01`;S.amsTo=todayStr();}
    else if(range==='all-time'){S.amsFrom='';S.amsTo='';S.amsQuick='';}
    render();return;
  }
  if(act==='open-profile'){
    S.modal={type:'my-profile'};render();setTimeout(()=>document.getElementById('pr-curr')?.focus(),50);return;
  }
  if(act==='send-welcome-all'){
    if(!can('admin'))return;
    const targets=S.users.filter(u=>u.id!==S.user?.id).map(u=>({id:u.id,name:u.name,username:u.username,email:u.email||''}));
    if(!targets.length){showToast('No other users to send to','warn');return;}
    S.modal={type:'send-welcome',targets};render();setTimeout(()=>document.getElementById('sw-pass')?.focus(),50);return;
  }
  if(act==='send-welcome-one'){
    if(!can('admin'))return;
    const u=S.users.find(x=>x.id===el.dataset.uid);if(!u)return;
    S.modal={type:'send-welcome',targets:[{id:u.id,name:u.name,username:u.username,email:u.email||''}]};render();setTimeout(()=>document.getElementById('sw-pass')?.focus(),50);return;
  }
  if(act==='edit-user'){
    if(!can('admin'))return;
    const u=S.users.find(x=>x.id===el.dataset.uid);if(!u)return;
    S.modal={type:'edit-user',uid:u.id,username:u.username,uname:u.name,email:u.email||''};
    render();setTimeout(()=>document.getElementById('eu-name')?.focus(),50);return;
  }
  if(act==='delete-user'){
    if(!can('admin'))return;const u=S.users.find(x=>x.id===el.dataset.uid);if(!u||u.id===S.user?.id)return;
    S.modal={type:'confirm',msg:`Delete user "${u.name}" (${u.username})?`,_act:'delete-user',_uid:u.id};render();return;
  }
  if(act==='force-logout-all'){
    if(!can('admin'))return;
    S.modal={type:'confirm',msg:'Force logout every user, including yourself? Everyone will need to sign in again.',_act:'force-logout-all'};render();return;
  }
  if(act==='force-logout-user'){
    if(!can('admin'))return;const u=S.users.find(x=>x.id===el.dataset.uid);if(!u)return;
    S.modal={type:'confirm',msg:`Force logout "${u.name}" (${u.username})? They'll need to sign in again.`,_act:'force-logout-user',_uid:u.id};render();return;
  }
  if(act==='modal-confirm'){
    const m=S.modal;if(!m||m.busy)return;
    if(m.type==='confirm'){
      S.modal={...m,busy:true};render();
      if(m._act==='delete-client'){
        const idx=S.clients.findIndex(x=>x.id===m._id);if(idx<0){S.modal=null;render();return;}
        const c=S.clients[idx];const other=c.modules!==undefined||c.workLog!==undefined;
        const snapshot=JSON.parse(JSON.stringify(c));
        if(other){c.integrations=[];}else{S.clients.splice(idx,1);}
        try{await saveClients(`Remove Integration data: ${snapshot.name}`);S.modal=null;showToast(`${snapshot.name} removed from Integrations`);render();}
        catch(err){if(other){c.integrations=snapshot.integrations;}else{S.clients.splice(idx,0,snapshot);}S.modal=null;showToast('Failed: '+err.message,'error');render();}
      }
      else if(m._act==='delete-integ'){
        const c=S.clients.find(x=>x.id===m._cid);if(!c){S.modal=null;render();return;}
        const idx=c.integrations.findIndex(x=>x.id===m._iid);if(idx<0){S.modal=null;render();return;}
        const[rem]=c.integrations.splice(idx,1);
        S.modal=null;navigate('client-detail',{clientId:m._cid});
        scheduleUndo(`"${rem.name}" deleted`,async()=>{c.integrations.splice(idx,0,rem);await saveClients(`Restore ${rem.name}`);navigate('client-detail',{clientId:m._cid});});
        try{await saveClients(`Delete ${rem.name}`);}
        catch(err){c.integrations.splice(idx,0,rem);showToast('Failed: '+err.message,'error');render();}
      }
      else if(m._act==='delete-user'){
        const idx=S.users.findIndex(x=>x.id===m._uid);if(idx<0){S.modal=null;render();return;}
        const[rem]=S.users.splice(idx,1);
        S.modal=null;render();
        scheduleUndo(`${rem.name} removed`,async()=>{S.users.splice(idx,0,rem);await saveUsers(`Restore ${rem.username}`);render();});
        try{await saveUsers(`Delete ${rem.username}`);}
        catch(err){S.users.splice(idx,0,rem);showToast('Failed: '+err.message,'error');render();}
      }
      else if(m._act==='force-logout-all'){
        try{
          const r=await fetch('/api/force-logout',{method:'POST',headers:{'Content-Type':'application/json','x-session-token':S.sessionToken||''},body:JSON.stringify({scope:'all'})});
          const d=await r.json();
          if(!r.ok)throw new Error(d.error||'Force logout failed');
          S.modal=null;showToast(`${d.affected} user${d.affected!==1?'s':''} logged out — including you`);
          clearSession();S.user=null;S.clients=[];S.users=[];S.usersForDropdown=[];S.shas={clients:null,users:null};S.sessionToken=null;navigate('login');
        }catch(err){S.modal=null;showToast('Failed: '+err.message,'error');render();}
      }
      else if(m._act==='force-logout-user'){
        try{
          const r=await fetch('/api/force-logout',{method:'POST',headers:{'Content-Type':'application/json','x-session-token':S.sessionToken||''},body:JSON.stringify({scope:'user',userId:m._uid})});
          const d=await r.json();
          if(!r.ok)throw new Error(d.error||'Force logout failed');
          S.modal=null;showToast('User logged out ✓');render();
        }catch(err){S.modal=null;showToast('Failed: '+err.message,'error');render();}
      }
      else if(m._act==='delete-impl-client'){
        const idx=S.clients.findIndex(x=>x.id===m._id);if(idx<0){S.modal=null;render();return;}
        const c=S.clients[idx];const other=c.integrations.length>0||c.workLog!==undefined;
        const snapshot=JSON.parse(JSON.stringify(c));
        if(other){delete c.modules;}else{S.clients.splice(idx,1);}
        try{await saveClients(`Remove Implementation data: ${snapshot.name}`);S.modal=null;showToast(`${snapshot.name} removed from Implementations`);render();}
        catch(err){if(other){c.modules=snapshot.modules;}else{S.clients.splice(idx,0,snapshot);}S.modal=null;showToast('Failed: '+err.message,'error');render();}
      }
      else if(m._act==='delete-ams-client'){
        const idx=S.clients.findIndex(x=>x.id===m._id);if(idx<0){S.modal=null;render();return;}
        const c=S.clients[idx];const other=c.integrations.length>0||c.modules!==undefined;
        const snapshot=JSON.parse(JSON.stringify(c));
        if(other){delete c.manDayRate;delete c.workLog;}else{S.clients.splice(idx,1);}
        try{await saveClients(`Remove AMS data: ${snapshot.name}`);S.modal=null;showToast(`${snapshot.name} removed from AMS`);navigate('ams-clients');}
        catch(err){if(other){c.manDayRate=snapshot.manDayRate;c.workLog=snapshot.workLog;}else{S.clients.splice(idx,0,snapshot);}S.modal=null;showToast('Failed: '+err.message,'error');render();}
      }
      else if(m._act==='delete-impl-module'){
        const c=S.clients.find(x=>x.id===m._cid);if(!c){S.modal=null;render();return;}
        const idx=(c.modules||[]).findIndex(x=>x.id===m._mid);if(idx<0){S.modal=null;render();return;}
        const[rem]=c.modules.splice(idx,1);
        S.modal=null;navigate('impl-client-detail',{clientId:m._cid});
        scheduleUndo(`Module "${rem.name}" deleted`,async()=>{c.modules.splice(idx,0,rem);await saveClients(`Restore ${rem.name}`);navigate('impl-client-detail',{clientId:m._cid});});
        try{await saveClients(`Delete module: ${rem.name}`);}
        catch(err){c.modules.splice(idx,0,rem);showToast('Failed: '+err.message,'error');navigate('impl-client-detail',{clientId:m._cid});}
      }
      else if(m._act==='delete-timeline-entry'){
        const c=S.clients.find(x=>x.id===m._cid);const i=c?.integrations.find(x=>x.id===m._iid);if(!i){S.modal=null;render();return;}
        const idx=i.timeline.findIndex(x=>x.id===m._tid);if(idx<0){S.modal=null;render();return;}
        const[rem]=i.timeline.splice(idx,1);
        try{await saveClients(`Delete update: ${i.name}`);S.modal=null;showToast('Update deleted');navigate('integ-detail',{clientId:m._cid,integId:m._iid});}
        catch(err){i.timeline.splice(idx,0,rem);S.modal=null;showToast('Failed: '+err.message,'error');render();}
      }
      else if(m._act==='delete-impl-update'){
        const c=S.clients.find(x=>x.id===m._cid);const mod=(c?.modules||[]).find(x=>x.id===m._mid);if(!mod){S.modal=null;render();return;}
        const ph=mod.phases?.find(x=>x.name===m._phase);if(!ph||!ph.updates){S.modal=null;render();return;}
        const idx=ph.updates.findIndex(x=>x.id===m._tid);if(idx<0){S.modal=null;render();return;}
        const[rem]=ph.updates.splice(idx,1);
        try{await saveClients(`Delete update: ${m._phase}`);S.modal=null;showToast('Update deleted');navigate('impl-phase-detail',{clientId:m._cid,moduleId:m._mid,phase:m._phase});}
        catch(err){ph.updates.splice(idx,0,rem);S.modal=null;showToast('Failed: '+err.message,'error');render();}
      }
      else if(m._act==='delete-ams-entry'){
        const c=S.clients.find(x=>x.id===m._cid);if(!c||!c.workLog){S.modal=null;render();return;}
        const idx=c.workLog.findIndex(x=>x.id===m._eid);if(idx<0){S.modal=null;render();return;}
        const[rem]=c.workLog.splice(idx,1);
        try{await saveClients(`Delete entry: ${c.name}`);S.modal=null;showToast('Entry deleted');navigate('ams-client-detail',{clientId:m._cid});}
        catch(err){c.workLog.splice(idx,0,rem);S.modal=null;showToast('Failed: '+err.message,'error');render();}
      }
      else if(m._act==='delete-milestone'){
        const c=S.clients.find(x=>x.id===m._cid);const i=c?.integrations.find(x=>x.id===m._iid);if(!i){S.modal=null;render();return;}
        const idx=(i.milestones||[]).findIndex(x=>x.id===m._mid);if(idx<0){S.modal=null;render();return;}
        const[rem]=(i.milestones||[]).splice(idx,1);
        try{await saveClients(`Delete milestone: ${rem.name}`);S.modal=null;showToast('Milestone deleted');navigate('integ-detail',{clientId:m._cid,integId:m._iid});}
        catch(err){i.milestones.splice(idx,0,rem);S.modal=null;showToast('Failed: '+err.message,'error');render();}
      }
    } else if(m.type==='add-milestone'||m.type==='edit-milestone'){
      const name=document.getElementById('ms-name')?.value.trim();
      if(!name){showToast('Milestone name required','error');return;}
      const c=S.clients.find(x=>x.id===m.cid);const i=c?.integrations.find(x=>x.id===m.iid);if(!i)return;
      if(!i.milestones)i.milestones=[];
      const msObj={id:m.mid||uid(),name,dueDate:document.getElementById('ms-due')?.value||'',status:document.getElementById('ms-status')?.value||'Pending',owner:document.getElementById('ms-owner')?.value||'',notes:document.getElementById('ms-notes')?.value.trim()||''};
      if(m.type==='edit-milestone'){
        const idx=i.milestones.findIndex(x=>x.id===m.mid);if(idx>=0)i.milestones[idx]=msObj;
      }else{i.milestones.push(msObj);}
      S.modal={...m,busy:true};render();
      try{await saveClients(`${m.type==='edit-milestone'?'Edit':'Add'} milestone: ${name}`);S.modal=null;showToast(`Milestone ${m.type==='edit-milestone'?'updated':'added'} ✓`);navigate('integ-detail',{clientId:m.cid,integId:m.iid});}
      catch(err){if(m.type==='add-milestone')i.milestones.pop();S.modal=null;showToast('Failed: '+err.message,'error');render();}
    } else if(m.type==='import-ams-entries'){
      const valid=(m.csvRows||[]).filter(r=>!r.error);
      if(!valid.length){showToast('No valid rows to import','error');return;}
      const c=S.clients.find(x=>x.id===m.cid);if(!c)return;
      if(!c.workLog)c.workLog=[];
      const prev=JSON.parse(JSON.stringify(c.workLog));
      const newEntries=valid.map(r=>({id:uid(),...r,loggedAt:new Date().toISOString()}));
      c.workLog.push(...newEntries);S.modal={...m,busy:true};render();
      try{await saveClients(`Import ${newEntries.length} AMS entries: ${c.name}`);S.modal=null;showToast(`${newEntries.length} entr${newEntries.length===1?'y':'ies'} imported ✓`);navigate('ams-client-detail',{clientId:m.cid});}
      catch(err){c.workLog=prev;S.modal=null;showToast('Import failed: '+err.message,'error');render();}
    } else if(m.type==='import-integrations'){
      const valid=(m.csvRows||[]).filter(r=>!r.error);
      if(!valid.length){showToast('No valid rows to import','error');return;}
      const c=S.clients.find(x=>x.id===m.cid);if(!c)return;
      const prev=JSON.parse(JSON.stringify(c.integrations));
      const newIntegs=valid.map(r=>({id:uid(),name:r.name,status:r.status,assignee:r.assignee,dueDate:r.dueDate,description:r.description,nextAction:r.nextAction,timeline:[],createdAt:new Date().toISOString()}));
      c.integrations.push(...newIntegs);S.modal={...m,busy:true};render();
      try{await saveClients(`Import ${newIntegs.length} integrations: ${c.name}`);S.modal=null;showToast(`${newIntegs.length} integration${newIntegs.length===1?'':'s'} imported ✓`);navigate('client-detail',{clientId:m.cid});}
      catch(err){c.integrations=prev;S.modal=null;showToast('Import failed: '+err.message,'error');render();}
    } else if(m.type==='portfolio-export'){
      const selected=[...document.querySelectorAll('[data-act="portfolio-client-toggle"]:checked')].map(el=>el.dataset.cid);
      const sections=[...document.querySelectorAll('[data-act="portfolio-section-toggle"]:checked')].map(el=>el.dataset.section);
      if(!selected.length){showToast('Select at least one client','error');return;}
      if(!sections.length){showToast('Select at least one section','error');return;}
      S.modal=null;render();
      exportConsolidatedPdf(selected,sections);
    } else if(m.type==='add-client'){
      const name=document.getElementById('m1')?.value.trim(),desc=document.getElementById('m2')?.value.trim();
      if(!name){showToast('Name required','error');return;}
      if(S.clients.find(x=>x.name.toLowerCase()===name.toLowerCase())){showToast(`"${name}" already exists as a client`,'error');return;}
      const nc={id:uid(),name,description:desc||'',createdAt:new Date().toISOString(),integrations:[]};
      S.clients.push(nc);S.modal={...m,busy:true};render();
      try{await saveClients(`Add ${name}`);S.modal=null;showToast(`${name} added`);render();}
      catch(err){S.clients.pop();S.modal=null;showToast('Failed: '+err.message,'error');render();}
    } else if(m.type==='add-integ'){
      const cid=document.getElementById('m0')?.value,name=document.getElementById('m1')?.value.trim();
      if(!name){showToast('Name required','error');return;}
      const c=S.clients.find(x=>x.id===cid);if(!c)return;
      const ni={id:uid(),name,status:document.getElementById('m2')?.value||'Not Started',assignee:document.getElementById('m3')?.value.trim()||'',dueDate:document.getElementById('m4')?.value||'',description:document.getElementById('m5')?.value.trim()||'',nextAction:'',timeline:[]};
      c.integrations.push(ni);S.modal={...m,busy:true};render();
      try{await saveClients(`Add ${name} to ${c.name}`);S.modal=null;showToast(`${name} added`);render();}
      catch(err){c.integrations.pop();S.modal=null;showToast('Failed: '+err.message,'error');render();}
    } else if(m.type==='my-profile'){
      // NOT changed in this pass — still uses the old client-side sha256 compare.
      // Fixing properly requires a small dedicated "verify current password"
      // server endpoint; retrofitting it here risked breaking password-change
      // for any user already lazily-migrated to bcrypt (a bcrypt hash can never
      // equal a client-computed sha256 hash, which would permanently lock them
      // out of changing their own password). Flagged as a follow-up, not fixed
      // tonight rather than shipped half-working.
      const currPass=document.getElementById('pr-curr')?.value;
      const newPass=document.getElementById('pr-new')?.value;
      const confPass=document.getElementById('pr-conf')?.value;
      const newEmail=document.getElementById('pr-email')?.value.trim()||'';
      if(!currPass){showToast('Current password is required','error');return;}
      const currHash=await sha256(currPass);
      const me=S.users.find(x=>x.id===S.user?.id);
      if(!me||me.passwordHash!==currHash){showToast('Current password is incorrect','error');return;}
      if(newPass&&newPass!==confPass){showToast('New passwords do not match','error');return;}
      const snapshot={email:me.email,passwordHash:me.passwordHash};
      me.email=newEmail;
      if(newPass)me.passwordHash=await sha256(newPass);
      S.modal={...m,busy:true};render();
      try{
        await saveUsers('Update profile');
        S.user.email=newEmail;persistSession(S.sessionToken,S.user);
        S.usersForDropdown=S.users.map(u=>({id:u.id,name:u.name||u.username,role:u.role,username:u.username}));
        S.modal=null;showToast(newPass?'Password changed ✓':'Profile updated ✓');render();
      }catch(err){me.email=snapshot.email;me.passwordHash=snapshot.passwordHash;S.modal=null;showToast('Failed: '+err.message,'error');render();}
    } else if(m.type==='send-welcome'){
      if(!can('admin'))return;
      const appUrl=document.getElementById('sw-url')?.value.trim();
      const pass=document.getElementById('sw-pass')?.value.trim();
      if(!appUrl||!pass){showToast('App URL and password are required','error');return;}
      const targets=(m.targets||[]).filter(u=>u.email);
      if(!targets.length){showToast('No recipients have an email address set','error');return;}
      S.modal={...m,busy:true};render();
      // Set passwords for all recipients — sent plaintext, hashed server-side (bcrypt)
      targets.forEach(t=>{const u=S.users.find(x=>x.id===t.id);if(u){u.password=pass;delete u.passwordHash;}});
      try{await saveUsers('Set passwords for welcome email');targets.forEach(t=>{const u=S.users.find(x=>x.id===t.id);if(u)delete u.password;});}catch(e){targets.forEach(t=>{const u=S.users.find(x=>x.id===t.id);if(u)delete u.password;});S.modal=null;showToast('Failed to update passwords','error');render();return;}
      // Send emails
      let sent=0,failed=0;
      await Promise.all(targets.map(async t=>{
        try{
          const r=await fetch('/api/send-email',{method:'POST',headers:{'Content-Type':'application/json','x-session-token':S.sessionToken||''},body:JSON.stringify({to:t.email,name:t.name,username:t.username,password:pass,appUrl})});
          if(r.ok)sent++;else failed++;
        }catch(e){failed++;}
      }));
      S.modal=null;
      showToast(failed?`${sent} sent, ${failed} failed — check Resend dashboard`:`Welcome emails sent to ${sent} user${sent===1?'':'s'} ✓`);
      render();
    } else if(m.type==='edit-user'){
      if(!can('admin'))return;
      const u=S.users.find(x=>x.id===m.uid);if(!u)return;
      const newName=document.getElementById('eu-name')?.value.trim();
      const newEmail=document.getElementById('eu-email')?.value.trim()||'';
      const newPass=document.getElementById('eu-pass')?.value;
      if(!newName){showToast('Full name is required','error');return;}
      const snapshot={name:u.name,email:u.email,passwordHash:u.passwordHash};
      u.name=newName;u.email=newEmail;
      S.modal={...m,busy:true};render();
      if(newPass){u.password=newPass;delete u.passwordHash;}
      try{
        await saveUsers(`Edit user: ${u.username}`);
        delete u.password;
        // refresh dropdown with updated name
        S.usersForDropdown=S.users.map(x=>({id:x.id,name:x.name||x.username,role:x.role,username:x.username}));
        // if editing self, update session
        if(u.id===S.user?.id){S.user.name=newName;persistSession(S.sessionToken,S.user);}
        S.modal=null;showToast(`${newName} updated ✓`);render();
      }catch(err){u.name=snapshot.name;u.email=snapshot.email;u.passwordHash=snapshot.passwordHash;delete u.password;S.modal=null;showToast('Failed: '+err.message,'error');render();}
    } else if(m.type==='add-user'){
      const username=document.getElementById('m1')?.value.trim(),name=document.getElementById('m2')?.value.trim(),password=document.getElementById('m3')?.value,role=document.getElementById('m4')?.value,email=document.getElementById('m5')?.value.trim()||'';
      if(!username||!name||!password){showToast('Username, name and password are required','error');return;}
      if(S.users.find(x=>x.username===username)){showToast('Username taken','error');return;}
      S.modal={...m,busy:true};render();
      const nu={id:uid(),username,name,email,password,role};S.users.push(nu);
      try{await saveUsers(`Add ${username}`);delete nu.password;S.usersForDropdown=S.users.map(u=>({id:u.id,name:u.name||u.username,role:u.role,username:u.username}));S.modal=null;showToast(`${name} added`);render();}
      catch(err){S.users.pop();S.modal=null;showToast('Failed: '+err.message,'error');render();}
    } else if(m.type==='bulk-import-users'){
      const valid=(m.csvRows||[]).filter(r=>!r.error);
      if(!valid.length){showToast('No valid rows to import','error');return;}
      S.modal={...m,busy:true};render();
      const newUsers=valid.map(r=>({id:uid(),username:r.username,name:r.name,email:r.email||'',password:r.password,role:r.role}));
      const prev=JSON.parse(JSON.stringify(S.users));
      S.users=[...S.users,...newUsers];
      try{await saveUsers(`Bulk import ${newUsers.length} users`);newUsers.forEach(u=>delete u.password);S.usersForDropdown=S.users.map(u=>({id:u.id,name:u.name||u.username,role:u.role,username:u.username}));S.modal=null;showToast(`${newUsers.length} user${newUsers.length!==1?'s':''} imported ✓`);render();}
      catch(err){S.users=prev;S.modal=null;showToast('Import failed: '+err.message,'error');render();}
    } else if(m.type==='rename-client'){
      const c=S.clients.find(x=>x.id===m.cid);if(!c)return;
      const name=document.getElementById('m1')?.value.trim();
      if(!name){showToast('Name required','error');return;}
      const prev=c.name;c.name=name;S.modal={...m,busy:true};render();
      try{await saveClients(`Rename client: ${prev} → ${name}`);S.modal=null;showToast('Client renamed ✓');render();}
      catch(err){c.name=prev;S.modal=null;showToast('Failed: '+err.message,'error');render();}
    } else if(m.type==='rename-integrations'){
      const c=S.clients.find(x=>x.id===m.cid);if(!c)return;
      const prev=JSON.parse(JSON.stringify(c.integrations));
      let changed=0;
      c.integrations.forEach(i=>{const v=document.getElementById(`ri-${i.id}`)?.value.trim();if(v&&v!==i.name){i.name=v;changed++;}});
      if(!changed){S.modal=null;render();return;}
      S.modal={...m,busy:true};render();
      try{await saveClients(`Rename ${changed} integration${changed!==1?'s':''}: ${c.name}`);S.modal=null;showToast('Integrations renamed ✓');render();}
      catch(err){c.integrations=prev;S.modal=null;showToast('Failed: '+err.message,'error');render();}
    } else if(m.type==='rename-modules'){
      const c=S.clients.find(x=>x.id===m.cid);if(!c)return;
      const prev=JSON.parse(JSON.stringify(c.modules));
      let changed=0;
      (c.modules||[]).forEach(mod=>{const v=document.getElementById(`rm-${mod.id}`)?.value.trim();if(v&&v!==mod.name){mod.name=v;changed++;}});
      if(!changed){S.modal=null;render();return;}
      S.modal={...m,busy:true};render();
      try{await saveClients(`Rename ${changed} module${changed!==1?'s':''}: ${c.name}`);S.modal=null;showToast('Modules renamed ✓');render();}
      catch(err){c.modules=prev;S.modal=null;showToast('Failed: '+err.message,'error');render();}
    } else if(m.type==='add-impl-client'){
      const existingId=document.getElementById('m0')?.value;
      if(existingId){
        const c=S.clients.find(x=>x.id===existingId);if(!c)return;
        c.modules=[];S.modal={...m,busy:true};render();
        try{await saveClients(`Enable Implementation tracking: ${c.name}`);S.modal=null;showToast(`${c.name} added to Implementations`);render();}
        catch(err){delete c.modules;S.modal=null;showToast('Failed: '+err.message,'error');render();}
      }else{
        const name=document.getElementById('m1')?.value.trim();
        if(!name){showToast('Pick a client above or enter a new name','error');return;}
        if(S.clients.find(x=>x.name.toLowerCase()===name.toLowerCase())){showToast(`"${name}" already exists — select it above instead`,'error');return;}
        const desc=document.getElementById('m2')?.value.trim();
        const nc={id:uid(),name,description:desc||'',createdAt:new Date().toISOString(),integrations:[],modules:[]};
        S.clients.push(nc);S.modal={...m,busy:true};render();
        try{await saveClients(`Add ${name}`);S.modal=null;showToast(`${name} added`);render();}
        catch(err){S.clients.pop();S.modal=null;showToast('Failed: '+err.message,'error');render();}
      }
    } else if(m.type==='add-impl-module'){
      const name=document.getElementById('m1')?.value.trim();
      if(!name){showToast('Name required','error');return;}
      const c=S.clients.find(x=>x.id===m.cid);if(!c)return;
      const nm={id:uid(),name,phases:PHASES.map(ph=>({name:ph,status:'Not Started',startDate:'',targetDate:'',updates:[]}))};
      if(!c.modules)c.modules=[];c.modules.push(nm);S.modal={...m,busy:true};render();
      try{await saveClients(`Add module ${name}`);S.modal=null;showToast(`${name} added`);navigate('impl-client-detail',{clientId:c.id});}
      catch(err){c.modules.pop();S.modal=null;showToast('Failed: '+err.message,'error');render();}
    } else if(m.type==='add-ams-client'){
      const existingId=document.getElementById('m0')?.value;
      const rateRaw=document.getElementById('m3')?.value;
      const rate=rateRaw?parseFloat(rateRaw):undefined;
      const availRaw=document.getElementById('m4')?.value;
      const avail=availRaw?parseFloat(availRaw):undefined;
      const currency=document.getElementById('m5')?.value||'INR';
      if(existingId){
        const c=S.clients.find(x=>x.id===existingId);if(!c)return;
        if(rate)c.manDayRate=rate;c.workLog=c.workLog||[];c.currency=currency;if(avail!==undefined)c.totalAvailableHours=avail;
        S.modal={...m,busy:true};render();
        try{await saveClients(`Enable AMS: ${c.name}`);S.modal=null;showToast(`${c.name} added to AMS`);render();}
        catch(err){delete c.manDayRate;delete c.totalAvailableHours;S.modal=null;showToast('Failed: '+err.message,'error');render();}
      }else{
        const name=document.getElementById('m1')?.value.trim();
        if(!name){showToast('Pick a client above or enter a new name','error');return;}
        if(S.clients.find(x=>x.name.toLowerCase()===name.toLowerCase())){showToast(`"${name}" already exists — select it above instead`,'error');return;}
        const desc=document.getElementById('m2')?.value.trim();
        const nc={id:uid(),name,description:desc||'',createdAt:new Date().toISOString(),integrations:[],workLog:[],currency};
        if(rate)nc.manDayRate=rate;if(avail!==undefined)nc.totalAvailableHours=avail;
        S.clients.push(nc);S.modal={...m,busy:true};render();
        try{await saveClients(`Add ${name}`);S.modal=null;showToast(`${name} added`);render();}
        catch(err){S.clients.pop();S.modal=null;showToast('Failed: '+err.message,'error');render();}
      }
    } else if(m.type==='edit-ams-client'){
      const c=S.clients.find(x=>x.id===m.cid);if(!c)return;
      const rateRaw=document.getElementById('m2')?.value;
      const desc=document.getElementById('m1')?.value.trim();
      const availRaw=document.getElementById('m3')?.value;
      const currency=document.getElementById('m4')?.value||'INR';
      const snapshot={description:c.description,manDayRate:c.manDayRate,totalAvailableHours:c.totalAvailableHours,currency:c.currency};
      c.description=desc||'';c.currency=currency;
      if(rateRaw){c.manDayRate=parseFloat(rateRaw);}else{delete c.manDayRate;}
      if(availRaw){c.totalAvailableHours=parseFloat(availRaw);}else{delete c.totalAvailableHours;}
      S.modal={...m,busy:true};render();
      try{await saveClients(`Edit AMS client: ${c.name}`);S.modal=null;showToast('Saved ✓');navigate('ams-client-detail',{clientId:c.id});}
      catch(err){Object.assign(c,snapshot);if(snapshot.totalAvailableHours===undefined)delete c.totalAvailableHours;if(snapshot.manDayRate===undefined)delete c.manDayRate;S.modal=null;showToast('Failed: '+err.message,'error');render();}
    } else if(m.type==='add-ams-entry'||m.type==='edit-ams-entry'){
      if(!can('edit'))return;
      const cid=m.cid;const c=S.clients.find(x=>x.id===cid);if(!c)return;
      const dateRaised=document.getElementById('ae-date')?.value;
      const hours=parseFloat(document.getElementById('ae-hours')?.value);
      if(!dateRaised||!hours||hours<=0){showToast('Date and hours are required','error');return;}
      const fields={dateRaised,
        dueDate:document.getElementById('ae-due')?.value||'',
        raisedBy:document.getElementById('ae-raised')?.value||S.user.name,
        module:document.getElementById('ae-module')?.value?.trim()||'',
        project:document.getElementById('ae-project')?.value?.trim()||'',
        description:document.getElementById('ae-desc')?.value?.trim()||'',
        type:document.getElementById('ae-type')?.value,
        queryLevel:document.getElementById('ae-level')?.value,
        modeOfSupport:document.getElementById('ae-mode')?.value,
        entryStatus:document.getElementById('ae-status')?.value,
        ragStatus:document.getElementById('ae-rag')?.value||'',
        dependencies:document.getElementById('ae-deps')?.value?.trim()||'',
        solution:document.getElementById('ae-solution')?.value?.trim()||'',
        hours};
      if(!c.workLog)c.workLog=[];
      if(m.type==='add-ams-entry'){
        const entry={id:uid(),...fields,loggedAt:new Date().toISOString()};
        c.workLog.push(entry);S.modal={...m,busy:true};render();
        try{await saveClients(`Add entry: ${c.name}`);S.modal=null;showToast('Entry added ✓');navigate('ams-client-detail',{clientId:cid});}
        catch(err){c.workLog.pop();S.modal=null;showToast('Failed: '+err.message,'error');render();}
      }else{
        const idx=c.workLog.findIndex(x=>x.id===m.eid);if(idx<0)return;
        const original=c.workLog[idx];
        const snapshot=JSON.parse(JSON.stringify(original));
        const updated={...original,...fields,edits:[...(original.edits||[]),{description:original.description,hours:original.hours,dateRaised:entryDate(original),editedAt:new Date().toISOString(),editedBy:S.user.name}],lastEditedAt:new Date().toISOString(),lastEditedBy:S.user.name};
        c.workLog[idx]=updated;S.modal={...m,busy:true};render();
        try{await saveClients(`Edit entry: ${c.name}`);S.modal=null;showToast('Entry updated ✓');navigate('ams-client-detail',{clientId:cid});}
        catch(err){c.workLog[idx]=snapshot;S.modal=null;showToast('Failed: '+err.message,'error');render();}
      }
    }
  }
});

document.addEventListener('change',async e=>{
  const statusEl=e.target.closest('[data-act="inline-status"]');
  if(statusEl&&can('editor')){
    const c=S.clients.find(x=>x.id===statusEl.dataset.cid);if(!c)return;
    const i=c.integrations.find(x=>x.id===statusEl.dataset.iid);if(!i)return;
    const prev=i.status;i.status=statusEl.value;statusEl.disabled=true;
    try{await saveClients(`Status: ${i.name} → ${i.status}`);showToast(`${i.name} → ${i.status}`);statusEl.disabled=false;}
    catch(err){i.status=prev;showToast('Failed: '+err.message,'error');render();}
    return;
  }
  const assigneeEl=e.target.closest('[data-act="inline-assignee"]');
  if(assigneeEl&&can('editor')){
    const c=S.clients.find(x=>x.id===assigneeEl.dataset.cid);if(!c)return;
    const i=c.integrations.find(x=>x.id===assigneeEl.dataset.iid);if(!i)return;
    const prev=i.assignee;i.assignee=assigneeEl.value;assigneeEl.disabled=true;
    try{await saveClients(`Assignee: ${i.name} → ${i.assignee||'Unassigned'}`);showToast(`Assignee updated ✓`);assigneeEl.disabled=false;}
    catch(err){i.assignee=prev;showToast('Failed: '+err.message,'error');render();}
    return;
  }
  const roleEl=e.target.closest('[data-act="change-role"]');
  if(roleEl&&can('admin')){
    const u=S.users.find(x=>x.id===roleEl.dataset.uid);if(!u||u.id===S.user?.id)return;
    const prev=u.role;u.role=roleEl.value;roleEl.disabled=true;
    try{await saveUsers(`Role: ${u.username}`);showToast(`${u.name} → ${u.role}`);roleEl.disabled=false;}
    catch(err){u.role=prev;showToast('Failed','error');render();}
    return;
  }
  if(e.target.dataset?.act==='audit-from'){S.auditFrom=e.target.value;return;}
  if(e.target.dataset?.act==='audit-to'){S.auditTo=e.target.value;return;}
  if(e.target.dataset?.act==='audit-user'){S.auditUser=e.target.value;S.auditPage=0;loadAuditLog();return;}
  const rangeEl=e.target.closest('[data-act="ams-range"]');
  if(rangeEl){
    S.amsFrom=document.getElementById('ams-from')?.value||'';
    S.amsTo=document.getElementById('ams-to')?.value||'';
    render();
  }
  // ── File attachment upload handler ────────────────────────────
  const fileEl=e.target;
  if(fileEl.type==='file'&&fileEl.accept&&fileEl.files?.length){
    const file=fileEl.files[0];if(!file)return;
    // Determine prefix and IDs based on input id
    const isAddForm=fileEl.id==='ip-attach-file';
    const tid=fileEl.dataset.tid||'';
    const urlId=isAddForm?'ip-attach-url':`eat-url-${tid}`;
    const mimeId=isAddForm?'ip-attach-mimetype':`eat-mimetype-${tid}`;
    const nameId=isAddForm?'ip-attach-filename':`eat-filename-${tid}`;
    const previewId=isAddForm?'ip-attach-preview':`eat-preview-${tid}`;
    const nameDisplayId=isAddForm?'ip-attach-name':`eat-name-${tid}`;
    const iconDisplayId=isAddForm?'ip-attach-icon':`eat-icon-${tid}`;
    const labelEl=document.getElementById(isAddForm?'ip-attach-label':`eat-label-${tid}`);
    // Show uploading state
    const preview=document.getElementById(previewId);
    const nameDisplay=document.getElementById(nameDisplayId);
    const iconDisplay=document.getElementById(iconDisplayId);
    if(preview){preview.classList.remove('hidden');if(nameDisplay)nameDisplay.textContent='Uploading…';}
    try{
      const result=await uploadAttachment(file);
      const urlEl=document.getElementById(urlId);const mEl=document.getElementById(mimeId);const nEl=document.getElementById(nameId);
      if(urlEl)urlEl.value=result.url;if(mEl)mEl.value=result.mimeType;if(nEl)nEl.value=result.fileName;
      if(nameDisplay)nameDisplay.textContent=result.fileName;
      if(iconDisplay)iconDisplay.textContent=fileIcon(result.url,result.mimeType);
      if(preview)preview.classList.remove('hidden');
      if(labelEl&&!labelEl.value)labelEl.value=result.fileName.replace(/\.[^.]+$/,'');
      showToast('File uploaded ✓');
    }catch(err){
      if(preview)preview.classList.add('hidden');
      fileEl.value='';
      showToast(err.message,'error');
    }
  }
});

let _st;
let _ct;
let _dat;
let _adt;
document.addEventListener('input',e=>{
  if(e.target.dataset?.act==='search'){
    clearTimeout(_st);const v=e.target.value;
    _st=setTimeout(()=>{S.search=v;render();setTimeout(()=>{const el=document.getElementById('search-inp');if(el){el.focus();try{el.setSelectionRange(v.length,v.length);}catch{}}},10);},120);
  }
  if(e.target.dataset?.act==='cmdp-input'){
    clearTimeout(_ct);const v=e.target.value;
    _ct=setTimeout(()=>{S.cmdQuery=v;render();setTimeout(()=>{const el=document.getElementById('cmdp-input');if(el){el.focus();try{el.setSelectionRange(v.length,v.length);}catch{}}},10);},100);
  }
  if(e.target.dataset?.act==='dash-assignee-search'){
    clearTimeout(_dat);const v=e.target.value;
    _dat=setTimeout(()=>{S.dashAssigneeSearch=v;render();setTimeout(()=>{const el=document.getElementById('dash-assignee-search-inp');if(el){el.focus();try{el.setSelectionRange(v.length,v.length);}catch{}}},10);},120);
  }
  if(e.target.dataset?.act==='admin-search'){
    clearTimeout(_adt);const v=e.target.value;
    _adt=setTimeout(()=>{S.adminSearch=v;render();setTimeout(()=>{const el=document.getElementById('admin-search-inp');if(el){el.focus();try{el.setSelectionRange(v.length,v.length);}catch{}}},10);},120);
  }
  if(e.target.dataset?.act==='audit-search'){S.auditSearch=e.target.value;}
});

document.addEventListener('keydown',e=>{
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'&&S.user){
    e.preventDefault();
    const saveBtn=document.querySelector('[data-act="save-integ"],[data-act="save-impl-phase"],[data-act="bulk-mark-complete"]');
    if(saveBtn)saveBtn.click();
    else showToast('Nothing to save on this page','info');
    return;
  }
  if(e.key==='Enter'&&S.view==='login')document.querySelector('[data-act="login"]')?.click();
  if(e.key==='Escape'&&S.modal&&!S.modal.busy){S.modal=null;render();return;}
  if(e.key==='Escape'&&S.cmdPaletteOpen){S.cmdPaletteOpen=false;render();return;}
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'&&S.user){e.preventDefault();S.cmdPaletteOpen=!S.cmdPaletteOpen;S.cmdQuery='';render();if(S.cmdPaletteOpen)setTimeout(()=>document.getElementById('cmdp-input')?.focus(),30);return;}
  if(S.cmdPaletteOpen&&e.key==='Enter'){const first=document.querySelector('[data-act="cmdp-go"][data-idx="0"]');first?.click();return;}
});

// ─── INIT ─────────────────────────────────────────────────────────
let _resizeTimer=null;
window.addEventListener('resize',()=>{clearTimeout(_resizeTimer);_resizeTimer=setTimeout(()=>{if(S.user)render();},150);});
(async function init(){
  const sess=restoreSession();
  if(sess&&sess.token&&sess.user){
    S.sessionToken=sess.token;S.user=sess.user;
    document.getElementById('app').innerHTML=renderAppSkeleton();
    try{
      const cl=await apiRead('data/clients.json');S.clients=cl.content;S.shas.clients=cl.sha;
      try{const ul=await apiRead('data/users.json');S.usersForDropdown=ul.content.map(u=>({id:u.id,name:u.name||u.username,role:u.role,username:u.username}));if(can('admin')){S.users=ul.content;S.shas.users=ul.sha;}}
      catch(e){S.usersForDropdown=[{id:S.user.id,name:S.user.name||S.user.username,role:S.user.role,username:S.user.username}];}
      const rv=restoreView();
      if(rv&&rv.view&&validateView(rv.view,rv.params||{})){navigate(rv.view,rv.params||{});}
      else{navigate('dashboard');}
    }catch(e){
      clearSession();S.user=null;S.sessionToken=null;render();
    }
  }else{render();}
})();