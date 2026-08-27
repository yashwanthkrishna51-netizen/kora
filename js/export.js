// ─── EXPORT: PPTX (Kognoz branded) ────────────────────────────────

// ─── EXPORT: shared filename helper ─────────────────────────────────
// Every export filename goes through this: strips characters that break a
// filesystem path (/ \ : * ? " < > |), and appends today's date in
// DDMonYYYY format (e.g. 28Jul2026) so re-exports on different days don't
// silently overwrite each other and re-collide in a Downloads folder.
function exportFileStamp(){
  const d=new Date();
  const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return`${String(d.getDate()).padStart(2,'0')}${MONTHS[d.getMonth()]}${d.getFullYear()}`;
}
function sanitizeFilePart(s){
  return String(s||'').replace(/[\/\\:*?"<>|]/g,'-').trim();
}
function exportFilename(clientName,reportType,ext){
  return`${sanitizeFilePart(clientName)}_${reportType}_${exportFileStamp()}.${ext}`;
}

function addLogoToDoc(doc, x, topY, maxH){
  // topY is the image's literal top-left Y — no anchor math. A previous
  // 3/4-of-height "anchor" version caused two separate mispositioning bugs
  // (thank-you-page overlap, and this header-bar vertical misalignment);
  // this direct form removes that whole bug class rather than patching y-values.
  const w=maxH*(315/94);
  try{doc.addImage(KOGNOZ_LOGO,'PNG',x,topY,w,maxH);}catch(e){}
}
async function exportPptx(clientId){
  if(typeof PptxGenJS==='undefined'){showToast('PPTX export library failed to load — check your connection and refresh','error');return;}
  const c=S.clients.find(x=>x.id===clientId);if(!c)return;
  showToast('Generating PPTX…','info');
  try{
    const pptx=new PptxGenJS();pptx.layout='LAYOUT_WIDE';
    const NV=TEAL,MG=BLUE_ACCENT;// app's live teal + blue accent, not the old navy/magenta
    // Cover
    const s1=pptx.addSlide();s1.background={color:NV};
    s1.addText('INTEGRATION STATUS REPORT',{x:.5,y:1.0,w:12.5,h:.4,fontSize:10,color:'7dd3e8',align:'center',charSpacing:4});
    s1.addText(c.name,{x:.5,y:1.6,w:12.5,h:1.2,fontSize:44,color:'FFFFFF',bold:true,align:'center'});
    s1.addShape(pptx.ShapeType.rect,{x:5.65,y:3.1,w:2,h:.05,fill:{color:MG},line:{type:'none'}});
    try{s1.addImage({path:KOGNOZ_LOGO,x:5.5,y:5.9,w:2.4,h:0.72});}catch(e){s1.addText('Kognoz',{x:.5,y:6.0,w:12.5,h:.4,fontSize:14,color:'7dd3e8',align:'center'});}
    s1.addText(new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'}),{x:.5,y:6.7,w:12.5,h:.3,fontSize:10,color:'64748b',align:'center'});
    // Summary
    const s2=pptx.addSlide();s2.background={color:'f5f9fa'};
    s2.addShape(pptx.ShapeType.rect,{x:0,y:0,w:13.3,h:.7,fill:{color:NV},line:{type:'none'}});
    try{s2.addImage({path:KOGNOZ_LOGO,x:.2,y:.05,w:1.2,h:0.36});}catch(e){}
    s2.addText('Integration Summary',{x:1.6,y:.1,w:11,h:.5,fontSize:15,color:'FFFFFF',bold:true});
    s2.addText(c.name,{x:.4,y:.1,w:12.5,h:.5,fontSize:11,color:'7dd3e8',align:'right'});
    const sg={};c.integrations.forEach(i=>sg[i.status]=(sg[i.status]||0)+1);
    [{l:'Total',v:c.integrations.length,col:NV},{l:'In Progress',v:sg['In Progress']||0,col:SHEX['In Progress']},{l:'At Risk',v:sg['At Risk']||0,col:SHEX['At Risk']},{l:'Completed',v:sg['Completed']||0,col:SHEX['Completed']},{l:'On Hold',v:(sg['On Hold — Internal']||0)+(sg['On Hold — Client']||0),col:SHEX['On Hold — Internal']}]
    .forEach(({l,v,col},i)=>{const x=.4+i*2.5;s2.addShape(pptx.ShapeType.rect,{x,y:.85,w:2.2,h:.85,fill:{color:col},line:{type:'none'}});s2.addText(String(v),{x,y:.88,w:2.2,h:.48,fontSize:22,color:'FFFFFF',bold:true,align:'center'});s2.addText(l,{x,y:1.36,w:2.2,h:.28,fontSize:7.5,color:'FFFFFF',align:'center'});});
    const rows=[['Integration','Status','Assignee','Due Date'].map(t=>({text:t,options:{bold:true,fill:{color:NV},color:'FFFFFF',fontSize:9}})),
      ...c.integrations.map((i,idx)=>[
        {text:i.name,options:{fontSize:8.5,color:'1f2937',fill:{color:idx%2?'FFFFFF':'f9fafb'}}},
        {text:i.status,options:{fontSize:8.5,bold:true,color:SHEX[i.status]||'64748b',fill:{color:idx%2?'FFFFFF':'f9fafb'}}},
        {text:i.assignee||'—',options:{fontSize:8.5,color:'4b5563',fill:{color:idx%2?'FFFFFF':'f9fafb'}}},
        {text:i.dueDate?fmtDate(i.dueDate):'—',options:{fontSize:8.5,color:'4b5563',fill:{color:idx%2?'FFFFFF':'f9fafb'}}},
      ])];
    s2.addTable(rows,{x:.3,y:1.9,w:12.7,colW:[5.2,2.2,2.8,2.5],border:{type:'solid',color:'e5e7eb',pt:.5}});
    // Integration Details — paginated table (replaces one-slide-per-integration)
    // No truncation: rows are packed per slide based on ESTIMATED rendered height
    // (PptxGenJS has no native auto-pagination with custom branding, so we pack manually,
    // erring conservative so nothing overflows the slide edge).
    const CHARS_PER_LINE=105,LINE_H=0.13;
    const estLines=(text)=>!text?1:text.split('\n').reduce((s,l)=>s+Math.max(1,Math.ceil(l.length/CHARS_PER_LINE)),0);
    const detailRows=c.integrations.map(i=>{
      const updates=i.timeline||[]; // already newest-first (unshift on add)
      const nextText=i.nextAction||'';
      const overdueTxt=isOverdue(i)?`⚠ ${daysOverdue(i)}d overdue`:'';
      // Compact: date + text share one wrapped run, no blank line between entries —
      // only the header line + a small 0.3-line visual gap per entry.
      const updatesLines=updates.length?updates.reduce((s,t)=>s+estLines(`(${fmtDate(t.date)}) ${t.update}`)+0.3,0):1;
      const blockLines=1+updatesLines+0.6+1+estLines(nextText||'No next action noted.');
      const estHeight=Math.max(0.5,blockLines*LINE_H+0.1);
      return{name:i.name,assignee:i.assignee||'Unassigned',status:i.status,due:i.dueDate?fmtDate(i.dueDate):'—',overdueTxt,updates,nextText,estHeight};
    });
    const SLIDE_BODY_H=5.7; // conservative usable height per slide, after header bar + table header row
    const chunks=[];let cur=[],curH=0;
    detailRows.forEach(row=>{
      if(cur.length&&curH+row.estHeight>SLIDE_BODY_H){chunks.push(cur);cur=[];curH=0;}
      cur.push(row);curH+=row.estHeight;
    });
    if(cur.length)chunks.push(cur);
    chunks.forEach((chunk,pageIdx)=>{
      const sl=pptx.addSlide();sl.background={color:'FFFFFF'};
      sl.addShape(pptx.ShapeType.rect,{x:0,y:0,w:13.3,h:.7,fill:{color:NV},line:{type:'none'}});
      sl.addText('Integration Details',{x:.4,y:.1,w:8,h:.5,fontSize:15,color:'FFFFFF',bold:true});
      sl.addText(`${c.name}${chunks.length>1?`  ·  Page ${pageIdx+1} of ${chunks.length}`:''}`,{x:.4,y:.1,w:12.5,h:.5,fontSize:10,color:'7dd3e8',align:'right'});
      const headerRow=[
        {text:'',options:{fill:{color:NV}}},
        {text:'Integration',options:{bold:true,fill:{color:NV},color:'FFFFFF',fontSize:9}},
        {text:'Assignee',options:{bold:true,fill:{color:NV},color:'FFFFFF',fontSize:9}},
        {text:'Status',options:{bold:true,fill:{color:NV},color:'FFFFFF',fontSize:9}},
        {text:'Due Date',options:{bold:true,fill:{color:NV},color:'FFFFFF',fontSize:9}},
        {text:'All Updates & Next Steps',options:{bold:true,fill:{color:NV},color:'FFFFFF',fontSize:9}},
      ];
      const bodyRows=chunk.map((row,ri)=>{
        const bg=ri%2?'FFFFFF':'f5f9fa';
        return[
          {text:'',options:{fill:{color:SHEX[row.status]||'64748b'}}},
          {text:row.name,options:{bold:true,fontSize:9,color:'1f2937',fill:{color:bg},valign:'top'}},
          {text:row.assignee,options:{fontSize:8.5,color:'4b5563',fill:{color:bg},valign:'top'}},
          {text:row.status,options:{bold:true,fontSize:8.5,color:SHEX[row.status]||'64748b',fill:{color:bg},valign:'top'}},
          {text:row.overdueTxt?[{text:row.due+'\n',options:{fontSize:8.5,color:'374151'}},{text:row.overdueTxt,options:{fontSize:7,bold:true,color:'be185d'}}]:row.due,options:{fill:{color:bg},valign:'top',fontSize:8.5,color:'374151'}},
          {text:[
            {text:`Updates (${row.updates.length}):\n`,options:{bold:true,fontSize:7.5,color:'1f2937'}},
            ...(row.updates.length?row.updates.flatMap(t=>[
              {text:`(${fmtDate(t.date)}) `,options:{bold:true,fontSize:7.5,color:'1f2937'}},
              {text:t.update+'\n',options:{fontSize:7.5,color:'4b5563'}},
            ]):[{text:'No updates yet.\n',options:{fontSize:7.5,italic:true,color:'9ca3af'}}]),
            {text:'\nNext:\n',options:{bold:true,fontSize:7.5,color:'1f2937'}},
            row.nextText?{text:row.nextText,options:{fontSize:7.5,color:'4b5563'}}:{text:'No next action noted.',options:{fontSize:7.5,italic:true,color:'9ca3af'}},
          ],options:{fill:{color:bg},valign:'top'}},
        ];
      });
      sl.addTable([headerRow,...bodyRows],{x:.3,y:.9,w:12.7,colW:[0.12,2.0,1.5,1.2,1.5,6.38],border:{type:'solid',color:'e5e7eb',pt:.5}});
    });
    // Thank you
    const sL=pptx.addSlide();sL.background={color:NV};
    sL.addText('Thank You',{x:.5,y:2.3,w:12.5,h:1.1,fontSize:44,color:'FFFFFF',bold:true,align:'center'});
    sL.addShape(pptx.ShapeType.rect,{x:5.9,y:3.3,w:1.5,h:.05,fill:{color:MG},line:{type:'none'}});
    try{sL.addImage({path:KOGNOZ_LOGO,x:5.5,y:5.9,w:2.4,h:0.72});}catch(e){}
    sL.addText('Kognoz · HR Transformation & Consulting',{x:.5,y:6.75,w:12.5,h:.4,fontSize:14,color:'7dd3e8',align:'center'});
    await pptx.writeFile({fileName:exportFilename(c.name,'Integration_Report','pptx')});
    showToast('PPTX downloaded ✓');
  }catch(e){console.error(e);showToast('PPTX failed: '+e.message,'error');}
}

// ─── EXPORT: Integration Report — worst-first + Exec Summary helpers ──
// Shared by exportPdf() below. Reuses core.js's isOverdue/isStale/integRagLabel
// rather than re-deriving RAG logic — core.js's own comments flag that two
// disagreeing health-score functions already exist elsewhere in this codebase;
// a third one here would make that worse, so this only formats what core.js
// already computes.
const INTEG_FALLBACK_RANK = { 'On Hold — Client': 2, 'On Hold — Internal': 3, 'Pending Client': 4, 'Under Review': 5, 'Delayed': 6, 'In Progress': 8, 'Not Started': 9, 'Completed': 10, 'Cancelled': 11 };
function integSeverityRank(i) {
  if (i.status === 'At Risk') return isOverdue(i) ? 0 : 1;
  if (i.status === 'In Progress' && isStale(i, 7)) return 7;
  return INTEG_FALLBACK_RANK[i.status] ?? 8;
}
function sortIntegWorstFirst(list) {
  return [...list].sort((a, b) => {
    const r = integSeverityRank(a) - integSeverityRank(b); if (r) return r;
    const ao = isOverdue(a), bo = isOverdue(b);
    if (ao && bo) return daysOverdue(b) - daysOverdue(a);
    if (ao !== bo) return ao ? -1 : 1;
    return (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
  });
}
function integRiskReason(i) {
  if (i.status === 'At Risk' && isOverdue(i)) return `${daysOverdue(i)}d overdue`;
  if (i.status === 'At Risk' && isStale(i, 7)) { const lu = lastUpdateDate(i); const d = lu ? daysDiff(lu) : null; return d !== null ? `No update in ${d}d` : 'No updates logged'; }
  if (i.status === 'At Risk') return 'Flagged At Risk';
  if (i.status === 'On Hold — Client') return 'Waiting on client';
  if (i.status === 'On Hold — Internal') return 'On hold internally';
  if (i.status === 'Pending Client') return 'Waiting on client input';
  if (i.status === 'Delayed') return 'Delayed';
  if (i.status === 'Under Review') return 'Under review';
  if (i.status === 'In Progress' && isStale(i, 7)) { const lu = lastUpdateDate(i); const d = lu ? daysDiff(lu) : null; return d !== null ? `No update in ${d}d` : 'Stale'; }
  const daysUntil = i.dueDate ? -daysDiff(i.dueDate) : null;
  return daysUntil !== null && daysUntil >= 0 ? `Due in ${daysUntil}d` : 'On track';
}
function integTopRisks(c, n = 3) {
  const RISKY = ['At Risk', 'On Hold — Client', 'On Hold — Internal', 'Pending Client', 'Under Review', 'Delayed'];
  const risky = c.integrations.filter(i => RISKY.includes(i.status) || (i.status === 'In Progress' && isStale(i, 7)));
  return sortIntegWorstFirst(risky).slice(0, n);
}
function integRagReason(c) {
  const label = integRagLabel(c);
  const total = c.integrations.length;
  const atRisk = c.integrations.filter(i => i.status === 'At Risk').length;
  const overdue = c.integrations.filter(isOverdue).length;
  const stale = c.integrations.filter(i => isStale(i, 7) && !isOverdue(i)).length;
  if (label === 'Red') {
    const parts = [];
    if (atRisk) parts.push(`${atRisk} At Risk`);
    if (overdue) parts.push(`${overdue} overdue`);
    if (stale) parts.push(`${stale} stale 7d+`);
    return { label, reason: parts.length ? `${parts.join(' · ')} of ${total} total` : 'See details below' };
  }
  if (label === 'Amber') return { label, reason: `${stale} integration${stale === 1 ? '' : 's'} stale 7+ days with no update` };
  if (label === 'Green') return { label, reason: 'All integrations on track' };
  return { label: '—', reason: 'No integrations tracked yet' };
}
function integMilestoneCounts(c) {
  const all = (c.integrations || []).flatMap(i => i.milestones || []);
  return { achieved: all.filter(m => m.status === 'Achieved').length, pending: all.filter(m => m.status === 'Pending').length, missed: all.filter(m => m.status === 'Missed').length, total: all.length };
}
// jsPDF has no native chart primitive — rasterize a donut via an offscreen
// canvas (real browser Canvas 2D, we're client-side not Node) and addImage()
// the PNG into the PDF. Caps at 5 slices + "Other" per chart-guidance max.
function buildDonutDataUrl(segments, px = 240) {
  const canvas = document.createElement('canvas'); canvas.width = px; canvas.height = px;
  const ctx = canvas.getContext('2d');
  const cx = px / 2, cy = px / 2, r = px * 0.36, lw = px * 0.22;
  const total = segments.reduce((s, x) => s + x.count, 0) || 1;
  let start = -Math.PI / 2;
  segments.forEach(seg => {
    const angle = (seg.count / total) * Math.PI * 2;
    ctx.beginPath(); ctx.arc(cx, cy, r, start, start + angle); ctx.lineWidth = lw; ctx.strokeStyle = '#' + seg.hex; ctx.stroke();
    start += angle;
  });
  ctx.font = `700 ${Math.round(px * 0.22)}px Arial`; ctx.fillStyle = '#1f2937'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(total), cx, cy - px * 0.03);
  ctx.font = `600 ${Math.round(px * 0.08)}px Arial`; ctx.fillStyle = '#4b5563';
  ctx.fillText('TOTAL', cx, cy + px * 0.14);
  return canvas.toDataURL('image/png');
}
function integStatusSegments(c) {
  const sg = {}; c.integrations.forEach(i => sg[i.status] = (sg[i.status] || 0) + 1);
  let entries = Object.entries(sg).map(([status, count]) => ({ status, count, hex: SHEX[status] || '64748b' })).sort((a, b) => b.count - a.count);
  if (entries.length > 6) {
    const kept = entries.slice(0, 5);
    const other = entries.slice(5).reduce((s, e) => s + e.count, 0);
    entries = [...kept, { status: 'Other', count: other, hex: '94a3b8' }];
  }
  return entries;
}
// Draws the RAG-colored info banner used at the top of the Executive Summary.
function drawRagBanner(doc, x, y, w, ragInfo) {
  const RAG_STYLE = { Red: { bg: [253, 242, 248], line: [190, 24, 93] }, Amber: { bg: [255, 251, 235], line: [217, 119, 6] }, Green: { bg: [240, 253, 244], line: [34, 197, 94] }, '—': { bg: [245, 245, 245], line: [148, 163, 184] } };
  const st = RAG_STYLE[ragInfo.label] || RAG_STYLE['—'];
  doc.setDrawColor(...st.line); doc.setFillColor(...st.bg); doc.setLineWidth(0.4); doc.roundedRect(x, y, w, 18, 2, 2, 'FD');
  doc.setFillColor(...st.line); doc.circle(x + 8, y + 9, 2.6, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...st.line); doc.text(`Portfolio Health: ${ragInfo.label.toUpperCase()}`, x + 16, y + 7.5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(75, 85, 99); doc.text(ragInfo.reason, x + 16, y + 13.5);
}

// ─── EXPORT: PDF (Kognoz branded) ──────────────────────────────────
// opts.returnDoc: when true, returns { base64, filename } instead of triggering
// a download — used by the "Email Report to Client" feature so it attaches the
// byte-for-byte identical PDF rather than regenerating it a second way.
//
// Async because the returnDoc path uses doc.output('blob') + FileReader
// instead of doc.output('datauristring'). datauristring internally calls the
// browser's btoa(), which throws "characters outside the Latin1 range" on
// jsPDF documents containing embedded raster images (this report embeds the
// Kognoz logo + a canvas-rendered donut chart via addImage) — a known jsPDF
// limitation, not something specific to any one client's data. .save() (the
// normal Export ▾ → PDF button) was never affected because it takes a
// different internal code path that doesn't go through datauristring/btoa.
// blob-based output avoids btoa entirely, sidestepping the issue.
async function exportPdf(clientId, opts = {}) {
  if (typeof window.jspdf === 'undefined') { showToast('PDF export library failed to load — check your connection and refresh', 'error'); return null; }
  const c = S.clients.find(x => x.id === clientId); if (!c) return null;
  if (!opts.returnDoc) showToast('Generating PDF…', 'info');
  try {
    const { jsPDF } = window.jspdf; const doc = new jsPDF({ orientation: 'landscape', format: 'a4', unit: 'mm' });
    const W = 297, H = 210, NV = [14, 116, 144], MG = [37, 99, 235]; // app's live teal #0e7490 + blue #2563eb, not the old navy/magenta

    // ── COVER ──────────────────────────────────────────────────────
    doc.setFillColor(...NV); doc.rect(0, 0, W, H, 'F');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(125, 211, 232); doc.text('INTEGRATION STATUS REPORT', W / 2, 58, { align: 'center' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(34); doc.setTextColor(255, 255, 255); doc.text(c.name, W / 2, 80, { align: 'center' });
    doc.setFillColor(...MG); doc.rect(W / 2 - 12, 92, 24, 1, 'F');
    addLogoToDoc(doc, W / 2 - 30, H - 33.5, 18); doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(125, 211, 232); doc.text('Prepared by Kognoz Consulting', W / 2, H - 9, { align: 'center' });
    doc.setFontSize(10); doc.setTextColor(100, 116, 139); doc.text(new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }), W / 2, H - 4, { align: 'center' });

    // ── PART 1 · EXECUTIVE SUMMARY (one page, safe to forward standalone) ──
    doc.addPage();
    doc.setFillColor(...MG); doc.rect(0, 0, W, 14, 'F'); addLogoToDoc(doc, 10, 2, 10);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(255, 255, 255); doc.text('PART 1 · Executive Summary', 58, 9.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.text(c.name, W - 10, 9.5, { align: 'right' });

    drawRagBanner(doc, 10, 20, 277, integRagReason(c));

    // Left card — top risks + milestones
    doc.setDrawColor(229, 231, 235); doc.setLineWidth(0.3); doc.roundedRect(10, 42, 160, 62, 2, 2, 'S');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...NV); doc.text('TOP ITEMS NEEDING ATTENTION', 14, 49);
    const topRisks = integTopRisks(c, 3);
    if (!topRisks.length) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); doc.setTextColor(107, 114, 128); doc.text('No items currently flagged — portfolio healthy.', 14, 58);
    } else {
      topRisks.forEach((i, idx) => {
        const ry = 56 + idx * 8.5; const rgb = SRGB[i.status] || [100, 116, 139];
        doc.setFillColor(...rgb); doc.circle(16, ry - 1.5, 1.3, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(31, 41, 55); doc.text(i.name, 20, ry);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(107, 114, 128); doc.text(integRiskReason(i), 20, ry + 3.7);
      });
    }
    const ms = integMilestoneCounts(c);
    if (ms.total > 0) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...NV); doc.text('MILESTONES', 14, 87);
      [{ l: 'Achieved', v: ms.achieved, bg: [220, 252, 231], fg: [22, 101, 52] }, { l: 'Pending', v: ms.pending, bg: [254, 243, 199], fg: [146, 64, 14] }, { l: 'Missed', v: ms.missed, bg: [252, 231, 243], fg: [157, 23, 77] }]
        .forEach((m, idx) => {
          const mx = 14 + idx * 51;
          doc.setFillColor(...m.bg); doc.roundedRect(mx, 90, 47, 11, 1.5, 1.5, 'F');
          doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...m.fg); doc.text(String(m.v), mx + 5, 97);
          doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.text(m.l, mx + 15, 97);
        });
    }

    // Right card — status mix donut
    doc.roundedRect(180, 42, 107, 62, 2, 2, 'S');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...NV); doc.text('STATUS MIX', 184, 49);
    const segments = integStatusSegments(c);
    try { doc.addImage(buildDonutDataUrl(segments), 'PNG', 184, 53, 32, 32); } catch (e) { }
    const segTotal = segments.reduce((s, x) => s + x.count, 0) || 1;
    let ly = 58;
    segments.forEach(seg => {
      doc.setFillColor(...(SRGB[seg.status] || [148, 163, 184])); doc.rect(220, ly - 2.2, 2.6, 2.6, 'F');
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(75, 85, 99); doc.text(seg.status, 224, ly);
      doc.setFont('helvetica', 'bold'); doc.text(`${seg.count} · ${Math.round(seg.count / segTotal * 100)}%`, 284, ly, { align: 'right' });
      ly += 7;
    });

    // Footer legend strip — status color key (static, app-wide meaning)
    let lx = 10; const legY = 113;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...NV); doc.text('Legend:', lx, legY); lx += doc.getTextWidth('Legend:') + 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    [['At Risk — action needed', SRGB['At Risk']], ['On Hold—Client — waiting on you', SRGB['On Hold — Client']], ['On Hold—Internal — waiting on Kognoz', SRGB['On Hold — Internal']], ['In Progress — on track', SRGB['In Progress']], ['Completed', SRGB['Completed']]]
      .forEach(([label, rgb]) => {
        doc.setFillColor(...rgb); doc.roundedRect(lx, legY - 2.6, 2.6, 2.6, 0.5, 0.5, 'F');
        doc.setTextColor(75, 85, 99); doc.text(label, lx + 4, legY);
        lx += 4 + doc.getTextWidth(label) + 7;
      });

    doc.setFont('helvetica', 'italic'); doc.setFontSize(7); doc.setTextColor(156, 163, 175);
    doc.text('This page is designed to stand alone — safe to forward to leadership without the appendix. Full detail on Part 2, next page.', 10, 203);

    // ── PART 2 · DIVIDER + MINI INDEX ────────────────────────────────
    doc.addPage(); doc.setFillColor(245, 249, 250); doc.rect(0, 0, W, H, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...MG); doc.text('PART 2', W / 2, 50, { align: 'center' });
    doc.setFontSize(24); doc.setTextColor(...NV); doc.text('Detailed Appendix', W / 2, 62, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(75, 85, 99);
    const introLines = doc.splitTextToSize('Integration-by-integration detail, full update history, and next actions for the working team. Sorted worst-first, same order as the Executive Summary\u2019s Top Items list.', 170);
    doc.text(introLines, W / 2, 71, { align: 'center' });

    const STATUS_ORDER = ['At Risk', 'On Hold — Client', 'On Hold — Internal', 'Pending Client', 'Under Review', 'Delayed', 'In Progress', 'Not Started', 'Completed', 'Cancelled'];
    const groups = STATUS_ORDER.map(st => ({ st, items: sortIntegWorstFirst(c.integrations.filter(i => i.status === st)) })).filter(g => g.items.length);
    const MAX_ROWS = 18; let rowsUsed = 0, truncatedCount = 0;
    const renderGroups = [];
    for (const g of groups) {
      if (rowsUsed >= MAX_ROWS) { truncatedCount += g.items.length; continue; }
      const take = g.items.slice(0, MAX_ROWS - rowsUsed);
      renderGroups.push({ st: g.st, items: take });
      rowsUsed += 1 + take.length;
      if (take.length < g.items.length) truncatedCount += g.items.length - take.length;
    }
    const boxH = Math.min(100, 10 + renderGroups.reduce((s, g) => s + 5 + g.items.length * 4.3, 0) + (truncatedCount ? 5 : 0));
    const boxX = (W - 160) / 2, boxY = 90;
    doc.setDrawColor(229, 231, 235); doc.roundedRect(boxX, boxY, 160, boxH, 2, 2, 'S');
    let ty = boxY + 7;
    renderGroups.forEach(g => {
      const rgb = SRGB[g.st] || [100, 116, 139];
      // Light tint + colored text/accent, not solid-color fill + white text —
      // white-on-color reads fine for dark statuses but goes near-invisible for
      // light ones (Cancelled grey, Pending Client amber). Tinted bg + dark
      // saturated text is readable regardless of how light the status color is.
      const tint = rgb.map(v => Math.round(v + (255 - v) * 0.85));
      doc.setFillColor(...tint); doc.rect(boxX, ty - 3.6, 160, 5, 'F');
      doc.setFillColor(...rgb); doc.rect(boxX, ty - 3.6, 1.6, 5, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...rgb); doc.text(g.st, boxX + 5, ty);
      ty += 5;
      g.items.forEach(i => {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.8); doc.setTextColor(55, 65, 81);
        doc.text(i.name.length > 62 ? i.name.slice(0, 60) + '…' : i.name, boxX + 4, ty);
        ty += 4.3;
      });
    });
    if (truncatedCount > 0) { doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(156, 163, 175); doc.text(`+${truncatedCount} more — see appendix`, boxX + 4, ty); }

    // ── PART 2 · APPENDIX DETAIL — worst-first ─────────────────────
    doc.addPage();
    const sortedIntegs = sortIntegWorstFirst(c.integrations);
    const UPD_LH = 3.3; // must match the line-height used in didDrawCell below —
    // computeUpdatesHeight() and the actual draw share this constant so the
    // row height autoTable reserves matches what gets drawn exactly, instead
    // of guessing from a fake sizing string (that guess was the actual cause
    // of the oversized gaps reported — reserved height didn't match drawn height).
    function computeUpdatesHeight(meta, maxW) {
      let h = 4;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); h += UPD_LH;
      if (meta.updates.length) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
        meta.updates.forEach(t => { h += UPD_LH; h += doc.splitTextToSize(t.update, maxW).length * UPD_LH + UPD_LH; });
      } else { h += UPD_LH + UPD_LH; }
      h += UPD_LH;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      h += doc.splitTextToSize(meta.nextText || 'No next action noted.', maxW).length * UPD_LH;
      // Safety clamp: caps one bad row at ~1 extra page instead of runaway blank
      // pages if width/measurement is ever off again (that's exactly what just
      // happened with the 'auto' column — this is the belt-and-suspenders fix).
      return Math.min(h + 4, 180);
    }
    const detailRows = sortedIntegs.map(i => {
      const updates = i.timeline || []; // already newest-first (unshift on add)
      const nextText = i.nextAction || '';
      const overdue = isOverdue(i);
      const dueCell = i.dueDate ? fmtDate(i.dueDate) : '—';
      return {
        status: i.status, overdue, updates, nextText,
        row: ['', i.name, i.assignee || 'Unassigned', i.status, overdue ? `${dueCell}\n${daysOverdue(i)}d OVERDUE` : dueCell, ''],
      };
    });
    doc.autoTable({
      startY: 16,
      margin: { top: 16, left: 10, right: 10, bottom: 10 },
      head: [['', 'Integration', 'Assignee', 'Status', 'Due Date', 'All Updates & Next Steps']],
      body: detailRows.map(d => d.row),
      headStyles: { fillColor: NV, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
      styles: { fontSize: 8, cellPadding: 3, valign: 'top' },
      alternateRowStyles: { fillColor: [245, 249, 250] },
      columnStyles: { 0: { cellWidth: 3 }, 1: { cellWidth: 50 }, 2: { cellWidth: 35 }, 3: { cellWidth: 28 }, 4: { cellWidth: 32 }, 5: { cellWidth: 129 } }, // fixed, not 'auto' — see note below
      didParseCell: d => {
        if (d.section !== 'body') return;
        const meta = detailRows[d.row.index]; if (!meta) return;
        if (d.column.index === 0) { d.cell.styles.fillColor = SRGB[meta.status] || [100, 116, 139]; d.cell.text = ['']; }
        if (d.column.index === 3) { const rgb = SRGB[meta.status]; if (rgb) { d.cell.styles.textColor = rgb; d.cell.styles.fontStyle = 'bold'; } }
        if (d.column.index === 4 && meta.overdue) { d.cell.styles.textColor = [190, 24, 93]; d.cell.styles.fontStyle = 'bold'; }
        if (d.column.index === 5) {
          // Fully custom-painted in didDrawCell below — no default text, and
          // the row height is forced to exactly what that custom draw needs
          // (see computeUpdatesHeight), not autoTable's own guess.
          d.cell.text = [''];
          d.cell.styles.minCellHeight = computeUpdatesHeight(meta, d.cell.width - 6);
        }
      },
      didDrawCell: d => {
        // Latest update stays dark/bold; older updates step back to grey — full
        // history is still printed (nothing deleted), just visually de-emphasized
        // so the one update that matters right now isn't buried at equal weight.
        if (d.section !== 'body' || d.column.index !== 5) return;
        const meta = detailRows[d.row.index]; if (!meta) return;
        const bg = d.row.index % 2 ? [255, 255, 255] : [245, 249, 250];
        doc.setFillColor(...bg); doc.rect(d.cell.x, d.cell.y, d.cell.width, d.cell.height, 'F');
        const x = d.cell.x + 3, maxW = d.cell.width - 6; let y = d.cell.y + 4; const lh = UPD_LH;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(31, 41, 55);
        doc.text(`Updates (${meta.updates.length}):`, x, y); y += lh;
        if (meta.updates.length) {
          meta.updates.forEach((t, idx) => {
            // Older entries step back to gray-500 (107,114,128), not gray-400 —
            // the lighter shade tested as "not visible" on a white/near-white
            // cell background. Still visibly secondary to the bold dark latest.
            const dateCol = idx === 0 ? [31, 41, 55] : [107, 114, 128];
            const bodyCol = idx === 0 ? [75, 85, 99] : [107, 114, 128];
            doc.setFont('helvetica', 'bold'); doc.setTextColor(...dateCol);
            doc.text(`(${fmtDate(t.date)})`, x, y); y += lh;
            doc.setFont('helvetica', 'normal'); doc.setTextColor(...bodyCol);
            const lines = doc.splitTextToSize(t.update, maxW);
            doc.text(lines, x, y); y += lines.length * lh + lh;
          });
        } else {
          doc.setFont('helvetica', 'italic'); doc.setTextColor(107, 114, 128);
          doc.text('No updates yet.', x, y); y += lh + lh;
        }
        doc.setFont('helvetica', 'bold'); doc.setTextColor(31, 41, 55);
        doc.text('Next:', x, y); y += lh;
        if (meta.nextText) {
          doc.setFont('helvetica', 'normal'); doc.setTextColor(75, 85, 99);
          doc.text(doc.splitTextToSize(meta.nextText, maxW), x, y);
        } else {
          doc.setFont('helvetica', 'italic'); doc.setTextColor(107, 114, 128);
          doc.text('No next action noted.', x, y);
        }
      },
      didDrawPage: () => {
        doc.setFillColor(...NV); doc.rect(0, 0, W, 14, 'F'); addLogoToDoc(doc, 10, 2, 10);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(255, 255, 255); doc.text('Appendix — Integration Detail', 58, 9.5);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.text(c.name, W - 10, 9.5, { align: 'right' });
      },
    });

    // ── THANK YOU ──────────────────────────────────────────────────
    doc.addPage(); doc.setFillColor(...NV); doc.rect(0, 0, W, H, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(36); doc.setTextColor(255, 255, 255); doc.text('Thank You', W / 2, H / 2 - 8, { align: 'center' });
    doc.setFillColor(...MG); doc.rect(W / 2 - 10, H / 2, 20, 1, 'F');
    addLogoToDoc(doc, W / 2 - 30, H / 2 + 16.5, 18);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(13); doc.setTextColor(125, 211, 232); doc.text('Kognoz · HR Transformation & Consulting', W / 2, H / 2 + 10, { align: 'center' });
    const filename = exportFilename(c.name, 'Integration_Report', 'pdf');
    if (opts.returnDoc) {
      const blob = doc.output('blob'); // avoids btoa() entirely, unlike 'datauristring'
      const base64 = await blobToBase64(blob);
      return { base64, filename };
    }
    doc.save(filename); showToast('PDF downloaded ✓');
  } catch (e) { console.error(e); showToast('PDF failed: ' + e.message, 'error'); if (opts.returnDoc) return null; }
}

// Blob -> raw base64 string (no "data:...;base64," prefix), via FileReader.
// Deliberately not btoa()-based — see exportPdf's comment for why.
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result;
      resolve(dataUrl.substring(dataUrl.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('Could not read the generated PDF'));
    reader.readAsDataURL(blob);
  });
}

// ─── EXPORT: Implementation Module Progress (PDF) ──────────────────
function exportImplPdf(clientId){
  if(typeof window.jspdf==='undefined'){showToast('PDF export library failed to load — check your connection and refresh','error');return;}
  const c=S.clients.find(x=>x.id===clientId);if(!c)return;
  showToast('Generating PDF…','info');
  try{
    const{jsPDF}=window.jspdf;const doc=new jsPDF({orientation:'landscape',format:'a4',unit:'mm'});
    const W=297,H=210,NV=[14,116,144],MG=[37,99,235]; // app's live teal #0e7490 + blue #2563eb, not the old navy/magenta
    const mods=c.modules||[];

    // ── COVER ──────────────────────────────────────────────────────
    doc.setFillColor(...NV);doc.rect(0,0,W,H,'F');
    doc.setFont('helvetica','normal');doc.setFontSize(10);doc.setTextColor(125,211,232);doc.text('IMPLEMENTATION STATUS REPORT',W/2,58,{align:'center'});
    doc.setFont('helvetica','bold');doc.setFontSize(34);doc.setTextColor(255,255,255);doc.text(c.name,W/2,80,{align:'center'});
    doc.setFillColor(...MG);doc.rect(W/2-12,92,24,1,'F');
    addLogoToDoc(doc,W/2-30,H-33.5,18);doc.setFont('helvetica','normal');doc.setFontSize(11);doc.setTextColor(125,211,232);doc.text('Prepared by Kognoz Consulting',W/2,H-9,{align:'center'});
    doc.setFontSize(10);doc.setTextColor(100,116,139);doc.text(new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'}),W/2,H-4,{align:'center'});

    // ── SUMMARY PAGE ───────────────────────────────────────────────
    doc.addPage();doc.setFillColor(...NV);doc.rect(0,0,W,14,'F');
    doc.setFont('helvetica','bold');doc.setFontSize(12);doc.setTextColor(255,255,255);doc.text('Implementation Summary',10,9.5);
    doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text(c.name,W-10,9.5,{align:'right'});
    // Stat boxes — total phases across all modules broken down by status
    const allPhases=mods.flatMap(m=>m.phases||[]);
    const sg={};allPhases.forEach(ph=>sg[ph.status]=(sg[ph.status]||0)+1);
    const totalPhases=allPhases.length;
    [{l:'Modules',v:mods.length,rgb:NV},{l:'Total Phases',v:totalPhases,rgb:[100,116,139]},{l:'In Progress',v:sg['In Progress']||0,rgb:SRGB['In Progress']},{l:'At Risk',v:sg['At Risk']||0,rgb:SRGB['At Risk']},{l:'Completed',v:sg['Completed']||0,rgb:SRGB['Completed']}]
    .forEach(({l,v,rgb},i)=>{const x=10+i*57;doc.setFillColor(...rgb);doc.roundedRect(x,18,50,20,2,2,'F');doc.setFont('helvetica','bold');doc.setFontSize(18);doc.setTextColor(255,255,255);doc.text(String(v),x+25,30,{align:'center'});doc.setFontSize(7.5);doc.setFont('helvetica','normal');doc.text(l,x+25,37,{align:'center'});});
    // Matrix table (condensed — one row per module, columns = phases)
    const matrixBody=mods.map(m=>{
      const row=[m.name];
      PHASES.forEach(phName=>{
        const ph=(m.phases||[]).find(x=>x.name===phName)||{status:'Not Started'};
        const cell=ph.status+(ph.targetDate?`\n${fmtDate(ph.targetDate)}`:'')+(ph.assignee?`\n${ph.assignee}`:'');
        row.push(cell);
      });
      return row;
    });
    doc.autoTable({
      startY:42,
      margin:{top:16,left:10,right:10,bottom:10},
      head:[['Module',...PHASES]],
      body:matrixBody,
      headStyles:{fillColor:NV,textColor:[255,255,255],fontStyle:'bold',fontSize:7.5},
      styles:{fontSize:7,cellPadding:2.5,valign:'middle',halign:'center'},
      columnStyles:{0:{halign:'left',fontStyle:'bold',cellWidth:38}},
      alternateRowStyles:{fillColor:[245,249,250]},
      didParseCell:d=>{
        if(d.section!=='body'||d.column.index===0)return;
        const st=String(d.cell.raw).split('\n')[0];
        const rgb=SRGB[st];if(rgb){d.cell.styles.textColor=rgb;d.cell.styles.fontStyle='bold';}
      },
      didDrawPage:()=>{doc.setFillColor(...NV);doc.rect(0,0,W,14,'F');addLogoToDoc(doc,10,2,10);doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(255,255,255);doc.text('Implementation Summary',58,9.5);doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text(c.name,W-10,9.5,{align:'right'});}
    });

    // ── DETAIL PAGES (one row per phase, grouped under module) ─────
    doc.addPage();
    const detailRows=[];
    mods.forEach(m=>{
      // Module header row
      detailRows.push({isHeader:true,moduleName:m.name,row:['',m.name,'','','',''],status:null});
      PHASES.forEach(phName=>{
        const ph=(m.phases||[]).find(x=>x.name===phName)||{name:phName,status:'Not Started',startDate:'',targetDate:'',updates:[]};
        const updates=ph.updates||[]; // already newest-first (unshift on add)
        const nextText=ph.nextAction||'';
        const actText=ph.currentActivity||'';
        const updatesSizing=updates.length?updates.map(t=>`(${fmtDate(t.date)}) ${t.update}`).join('\n\n'):'No updates yet.';
        const sizingStr=`Updates (${updates.length}):\n${updatesSizing}\n\nNext:\n${nextText||'No next action noted.'}`;
        detailRows.push({
          isHeader:false,moduleName:m.name,phaseName:phName,
          status:ph.status,updates,nextText,actText,
          assignee:ph.assignee||'',
          startDate:ph.startDate?fmtDate(ph.startDate):'-',
          targetDate:ph.targetDate?fmtDate(ph.targetDate):'-',
          row:['',phName,ph.status,ph.startDate?fmtDate(ph.startDate):'-',ph.targetDate?fmtDate(ph.targetDate):'-',sizingStr],
        });
      });
    });
    doc.autoTable({
      startY:16,
      margin:{top:16,left:10,right:10,bottom:10},
      head:[['','Phase','Status','Start Date','Target Date','All Updates & Next Action']],
      body:detailRows.map(d=>d.row),
      headStyles:{fillColor:NV,textColor:[255,255,255],fontStyle:'bold',fontSize:9},
      styles:{fontSize:8,cellPadding:3,valign:'top'},
      alternateRowStyles:{fillColor:[245,249,250]},
      columnStyles:{0:{cellWidth:3},1:{cellWidth:68},2:{cellWidth:30},3:{cellWidth:30},4:{cellWidth:30},5:{cellWidth:'auto'}},
      didParseCell:d=>{
        if(d.section!=='body')return;
        const meta=detailRows[d.row.index];if(!meta)return;
        if(meta.isHeader){
          // Module header rows span visually — teal background across all cols
          d.cell.styles.fillColor=NV;d.cell.styles.textColor=[255,255,255];d.cell.styles.fontStyle='bold';d.cell.styles.fontSize=9;
          if(d.column.index===0)d.cell.text=[''];
          if(d.column.index!==1)d.cell.text=[''];
          return;
        }
        if(d.column.index===0){d.cell.styles.fillColor=SRGB[meta.status]||[100,116,139];d.cell.text=[''];}
        if(d.column.index===2){const rgb=SRGB[meta.status];if(rgb){d.cell.styles.textColor=rgb;d.cell.styles.fontStyle='bold';}}
      },
      didDrawCell:d=>{
        if(d.section!=='body'||d.column.index!==5)return;
        const meta=detailRows[d.row.index];if(!meta||meta.isHeader)return;
        const bg=d.row.index%2?[255,255,255]:[245,249,250];
        doc.setFillColor(...bg);doc.rect(d.cell.x,d.cell.y,d.cell.width,d.cell.height,'F');
        const x=d.cell.x+3,maxW=d.cell.width-6;let y=d.cell.y+4;const lh=3.3;
        doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(31,41,55);
        doc.text(`Updates (${meta.updates.length}):`,x,y);y+=lh;
        if(meta.updates.length){
          meta.updates.forEach(t=>{
            doc.setFont('helvetica','bold');doc.setTextColor(31,41,55);
            doc.text(`(${fmtDate(t.date)})`,x,y);y+=lh;
            doc.setFont('helvetica','normal');doc.setTextColor(75,85,99);
            const lines=doc.splitTextToSize(t.update,maxW);
            doc.text(lines,x,y);y+=lines.length*lh+lh;
          });
        }else{
          doc.setFont('helvetica','italic');doc.setTextColor(156,163,175);
          doc.text('No updates yet.',x,y);y+=lh+lh;
        }
        doc.setFont('helvetica','bold');doc.setTextColor(31,41,55);
        doc.text('Next:',x,y);y+=lh;
        if(meta.nextText){
          doc.setFont('helvetica','normal');doc.setTextColor(75,85,99);
          doc.text(doc.splitTextToSize(meta.nextText,maxW),x,y);
        }else{
          doc.setFont('helvetica','italic');doc.setTextColor(156,163,175);
          doc.text('No next action noted.',x,y);
        }
      },
      didDrawPage:()=>{
        doc.setFillColor(...NV);doc.rect(0,0,W,14,'F');
        addLogoToDoc(doc,10,2,10);doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(255,255,255);doc.text('Phase Details & Updates',58,9.5);
        doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text(c.name,W-10,9.5,{align:'right'});
      },
    });

    // ── THANK YOU ──────────────────────────────────────────────────
    doc.addPage();doc.setFillColor(...NV);doc.rect(0,0,W,H,'F');
    doc.setFont('helvetica','bold');doc.setFontSize(36);doc.setTextColor(255,255,255);doc.text('Thank You',W/2,H/2-8,{align:'center'});
    doc.setFillColor(...MG);doc.rect(W/2-10,H/2,20,1,'F');
    addLogoToDoc(doc,W/2-30,H/2+16.5,18);
    doc.setFont('helvetica','normal');doc.setFontSize(13);doc.setTextColor(125,211,232);doc.text('Kognoz · HR Transformation & Consulting',W/2,H/2+10,{align:'center'});

    doc.save(exportFilename(c.name,'Implementation_Report','pdf'));showToast('PDF downloaded ✓');
  }catch(e){console.error(e);showToast('PDF failed: '+e.message,'error');}
}

// ─── EXPORT: AMS Billing Breakdown (PDF, admin only) ────────────────
function exportAmsActivityPdf(clientId){
  if(!can('admin'))return;
  if(typeof window.jspdf==='undefined'){showToast('PDF export library failed to load — check your connection and refresh','error');return;}
  const c=S.clients.find(x=>x.id===clientId);if(!c)return;
  showToast('Generating activity report…','info');
  try{
    const{jsPDF}=window.jspdf;const doc=new jsPDF({orientation:'landscape',format:'a4',unit:'mm'});
    const W=297,H=210,NV=[14,116,144],MG=[37,99,235]; // app's live teal #0e7490 + blue #2563eb, not the old navy/magenta
    const t=amsTotals(c,S.amsFrom,S.amsTo);
    const sorted=[...t.log].sort((a,b)=>entryDate(a).localeCompare(entryDate(b)));
    const periodLabel=(S.amsFrom||S.amsTo)?`${S.amsFrom?fmtDate(S.amsFrom):'Start'} - ${S.amsTo?fmtDate(S.amsTo):'Today'}`:'All Time';

    // ── COVER ──────────────────────────────────────────────────────
    doc.setFillColor(...NV);doc.rect(0,0,W,H,'F');
    doc.setFont('helvetica','normal');doc.setFontSize(10);doc.setTextColor(125,211,232);doc.text('AMS ACTIVITY REPORT',W/2,58,{align:'center'});
    doc.setFont('helvetica','bold');doc.setFontSize(34);doc.setTextColor(255,255,255);doc.text(c.name,W/2,80,{align:'center'});
    doc.setFont('helvetica','normal');doc.setFontSize(14);doc.setTextColor(125,211,232);doc.text(`Period: ${periodLabel}`,W/2,95,{align:'center'});
    doc.setFillColor(...MG);doc.rect(W/2-12,100,24,1,'F');
    doc.setFont('helvetica','normal');doc.setFontSize(10);doc.setTextColor(100,116,139);
    addLogoToDoc(doc,W/2-30,H-33.5,18);doc.text('Prepared by Kognoz Consulting',W/2,H-9,{align:'center'});
    doc.text(new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'}),W/2,H-4,{align:'center'});

    // ── SUMMARY PAGE ───────────────────────────────────────────────
    doc.addPage();
    const drawHdr=()=>{doc.setFillColor(...NV);doc.rect(0,0,W,14,'F');addLogoToDoc(doc,10,2,10);doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(255,255,255);doc.text('AMS Activity Log',58,9.5);doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text(c.name,W-10,9.5,{align:'right'});};
    drawHdr();
    // Stat boxes
    const openCount=sorted.filter(e=>(e.entryStatus||'Open')==='Open').length;
    const inprogCount=sorted.filter(e=>e.entryStatus==='In Progress').length;
    const closedCount=sorted.filter(e=>e.entryStatus==='Closed').length;
    [{l:'Total Entries',v:sorted.length,rgb:NV},{l:'Total Hours',v:t.totalHours.toFixed(1),rgb:[100,116,139]},{l:'Open',v:openCount,rgb:[29,78,216]},{l:'In Progress',v:inprogCount,rgb:[146,64,14]},{l:'Closed',v:closedCount,rgb:[21,128,61]}]
    .forEach(({l,v,rgb},i)=>{const x=10+i*57;doc.setFillColor(...rgb);doc.roundedRect(x,18,50,20,2,2,'F');doc.setFont('helvetica','bold');doc.setFontSize(18);doc.setTextColor(255,255,255);doc.text(String(v),x+25,30,{align:'center'});doc.setFontSize(7.5);doc.setFont('helvetica','normal');doc.text(l,x+25,37,{align:'center'});});

    // Activity table
    const HEADS=['#','Date Raised','Raised By','Module','Project','Description','Type','Level','Dependencies','Status','Solution','Mode','Hrs'];
    const body=sorted.map((e,i)=>[
      String(i+1),
      fmtDate(entryDate(e)),
      entryRaisedBy(e),
      e.module||'-',
      e.project||'-',
      e.description||'-',
      entryType(e),
      e.queryLevel||'-',
      e.dependencies||'-',
      e.entryStatus||'Open',
      e.solution||'-',
      e.modeOfSupport||'-',
      Number(e.hours||0).toFixed(1),
    ]);
    const statusColors={'Open':[29,78,216],'In Progress':[146,64,14],'Closed':[21,128,61]};
    doc.autoTable({
      startY:42,
      margin:{top:18,left:8,right:8,bottom:10},
      head:[HEADS],
      body,
      headStyles:{fillColor:NV,textColor:[255,255,255],fontStyle:'bold',fontSize:7.5},
      styles:{fontSize:7,cellPadding:2,valign:'top',overflow:'linebreak'},
      columnStyles:{
        0:{cellWidth:8,halign:'center'},1:{cellWidth:22},2:{cellWidth:24},3:{cellWidth:24},4:{cellWidth:22},
        5:{cellWidth:'auto'},6:{cellWidth:20},7:{cellWidth:18},8:{cellWidth:22},9:{cellWidth:20},
        10:{cellWidth:'auto'},11:{cellWidth:20},12:{cellWidth:12,halign:'right'},
      },
      alternateRowStyles:{fillColor:[245,249,250]},
      didParseCell:d=>{
        if(d.section!=='body'||d.column.index!==9)return;
        const rgb=statusColors[String(d.cell.raw)];
        if(rgb){d.cell.styles.textColor=rgb;d.cell.styles.fontStyle='bold';}
      },
      didDrawPage:drawHdr,
    });

    // ── THANK YOU ──────────────────────────────────────────────────
    doc.addPage();doc.setFillColor(...NV);doc.rect(0,0,W,H,'F');
    doc.setFont('helvetica','bold');doc.setFontSize(36);doc.setTextColor(255,255,255);doc.text('Thank You',W/2,H/2-8,{align:'center'});
    doc.setFillColor(...MG);doc.rect(W/2-10,H/2,20,1,'F');
    addLogoToDoc(doc,W/2-30,H/2+16.5,18);
    doc.setFont('helvetica','normal');doc.setFontSize(13);doc.setTextColor(125,211,232);doc.text('Kognoz · HR Transformation & Consulting',W/2,H/2+10,{align:'center'});

    doc.save(exportFilename(c.name,'AMS_Activity_Report','pdf'));showToast('Activity report downloaded ✓');
  }catch(e){console.error(e);showToast('PDF failed: '+e.message,'error');}
}

function exportAmsInvoicePdf(clientId){
  if(!can('admin'))return;
  if(typeof window.jspdf==='undefined'){showToast('PDF export library failed to load — check your connection and refresh','error');return;}
  const c=S.clients.find(x=>x.id===clientId);if(!c)return;
  if(!c.manDayRate){showToast('Invoice not available — no day rate set for this client. Use Activity Report instead.','warn');return;}
  showToast('Generating invoice…','info');
  try{
    const{jsPDF}=window.jspdf;const doc=new jsPDF({orientation:'landscape',format:'a4',unit:'mm'});
    const W=297,H=210,NV=[14,116,144],MG=[37,99,235]; // app's live teal #0e7490 + blue #2563eb, not the old navy/magenta
    const t=amsTotals(c,S.amsFrom,S.amsTo);
    const curSym=currencySymbol(c),curLoc=c.currency==='USD'?'en-US':'en-IN';
    const periodLabel=(S.amsFrom||S.amsTo)?`${S.amsFrom?fmtDate(S.amsFrom):'Start'} - ${S.amsTo?fmtDate(S.amsTo):'Today'}`:'All Time';
    // ── COVER ──────────────────────────────────────────────────────
    doc.setFillColor(...NV);doc.rect(0,0,W,H,'F');
    doc.setFont('helvetica','normal');doc.setFontSize(10);doc.setTextColor(125,211,232);doc.text('AMS BILLING BREAKDOWN',W/2,58,{align:'center'});
    doc.setFont('helvetica','bold');doc.setFontSize(34);doc.setTextColor(255,255,255);doc.text(c.name,W/2,80,{align:'center'});
    doc.setFont('helvetica','normal');doc.setFontSize(14);doc.setTextColor(125,211,232);doc.text(`Period: ${periodLabel}`,W/2,95,{align:'center'});
    doc.setFillColor(...MG);doc.rect(W/2-12,100,24,1,'F');
    addLogoToDoc(doc,W/2-30,H-33.5,18);doc.setFont('helvetica','normal');doc.setFontSize(11);doc.setTextColor(125,211,232);doc.text('Prepared by Kognoz Consulting — Internal Finance Use',W/2,H-9,{align:'center'});
    doc.setFontSize(10);doc.setTextColor(100,116,139);doc.text(new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'}),W/2,H-4,{align:'center'});
    doc.addPage();
    const drawHeaderBar=()=>{
      doc.setFillColor(...NV);doc.rect(0,0,W,14,'F');addLogoToDoc(doc,10,2,10);
      doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(255,255,255);doc.text('AMS Work Summary & Internal Billing Breakdown',58,9.5);
      doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text(c.name,W-10,9.5,{align:'right'});
    };
    drawHeaderBar();
    doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(100,116,139);
    doc.text(`Billing Period: ${periodLabel}`,10,21);
    doc.text(`Day Rate: ${curSym}${(c.manDayRate||0).toLocaleString(curLoc)} (${HOURS_PER_DAY}-hour day)`,10,26);
    doc.text(`Generated: ${new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'})}`,W-10,21,{align:'right'});
    let boxY=30;
    if(t.hasBucket){
      [{l:'Total Available',v:`${t.totalAvailableHours.toFixed(1)} hrs`},{l:'Consumed (all-time)',v:`${t.consumedAllTime.toFixed(1)} hrs`},{l:'Balance Available',v:`${t.balanceAvailable.toFixed(1)} hrs`}]
      .forEach((s,i)=>{const x=10+i*92;doc.setFillColor(...(i===2?(t.balanceAvailable>0?[34,197,94]:[190,24,93]):[100,116,139]));doc.roundedRect(x,boxY,86,16,2,2,'F');doc.setFont('helvetica','bold');doc.setFontSize(13);doc.setTextColor(255,255,255);doc.text(s.v,x+6,boxY+10);doc.setFontSize(7.5);doc.setFont('helvetica','normal');doc.text(s.l,x+6,boxY+14.5);});
      boxY+=20;
    }
    [{l:'Hours This Period',v:t.totalHours.toFixed(1)},{l:'Total Days',v:(t.totalHours/HOURS_PER_DAY).toFixed(2)},{l:`Billable Amount (${curSym})`,v:t.totalAmount.toLocaleString(curLoc,{maximumFractionDigits:0})}]
    .forEach((s,i)=>{const x=10+i*92;doc.setFillColor(...(i===2?MG:NV));doc.roundedRect(x,boxY,86,16,2,2,'F');doc.setFont('helvetica','bold');doc.setFontSize(15);doc.setTextColor(255,255,255);doc.text(String(s.v),x+6,boxY+10);doc.setFontSize(7.5);doc.setFont('helvetica','normal');doc.text(s.l,x+6,boxY+14.5);});
    const tableStartY=boxY+24;
    const sorted=[...t.log].sort((a,b)=>entryDate(a).localeCompare(entryDate(b)));
    doc.autoTable({
      startY:tableStartY,
      margin:{top:18,left:10,right:10,bottom:10},
      head:[['Date','Category','Description','Hours',`Amount (${curSym})`]],
      body:sorted.map(e=>[fmtDate(entryDate(e)),entryType(e),e.description||'-',Number(e.hours).toFixed(1),t.hasBucket?'Pooled':amsEntryAmount(Number(e.hours),c.manDayRate||0).toLocaleString(curLoc,{maximumFractionDigits:0})]),
      headStyles:{fillColor:NV,textColor:[255,255,255],fontStyle:'bold',fontSize:9},
      styles:{fontSize:8.5,cellPadding:3},
      alternateRowStyles:{fillColor:[245,249,250]},
      columnStyles:{0:{cellWidth:28},1:{cellWidth:35},2:{cellWidth:'auto'},3:{cellWidth:22,halign:'right'},4:{cellWidth:30,halign:'right'}},
      didDrawPage:drawHeaderBar,
    });
    const catRows=Object.entries(t.byType).map(([cat,hrs])=>[cat,hrs.toFixed(1),t.hasBucket?'Pooled':(amsEntryAmount(hrs,c.manDayRate||0)||0).toLocaleString(curLoc,{maximumFractionDigits:0})]);
    if(catRows.length){
      doc.autoTable({
        startY:doc.lastAutoTable.finalY+8,
        margin:{top:18,left:10,right:10,bottom:10},
        head:[['Breakdown by Category','Hours',`Amount (${curSym})`]],
        body:catRows,
        headStyles:{fillColor:[100,116,139],textColor:[255,255,255],fontStyle:'bold',fontSize:9},
        styles:{fontSize:8.5,cellPadding:3},
        columnStyles:{1:{halign:'right'},2:{halign:'right'}},
        didDrawPage:drawHeaderBar,
      });
    }
    doc.setFont('helvetica','italic');doc.setFontSize(7.5);doc.setTextColor(156,163,175);
    doc.text(t.hasBucket?'For internal finance use. Hours within the available pool are not separately billed - only usage beyond the pool is billed. Pre-tax breakdown - GST and other taxes to be applied by finance separately.':'For internal finance use. Pre-tax breakdown - GST and other taxes to be applied by finance separately.',10,H-6);
    // ── THANK YOU ──────────────────────────────────────────────────
    doc.addPage();doc.setFillColor(...NV);doc.rect(0,0,W,H,'F');
    doc.setFont('helvetica','bold');doc.setFontSize(36);doc.setTextColor(255,255,255);doc.text('Thank You',W/2,H/2-8,{align:'center'});
    doc.setFillColor(...MG);doc.rect(W/2-10,H/2,20,1,'F');
    addLogoToDoc(doc,W/2-30,H/2+16.5,18);
    doc.setFont('helvetica','normal');doc.setFontSize(13);doc.setTextColor(125,211,232);doc.text('Kognoz · HR Transformation & Consulting',W/2,H/2+10,{align:'center'});
    doc.save(exportFilename(c.name,'AMS_Billing','pdf'));showToast('Invoice downloaded ✓');
  }catch(e){console.error(e);showToast('PDF failed: '+e.message,'error');}
}

function exportExcel(type, clientId){
  if(typeof XLSX==='undefined'){showToast('Excel export not available','error');return;}
  const c=S.clients.find(x=>x.id===clientId);if(!c)return;
  let wb,ws,data,headers,filename;
  if(type==='integrations'){
    headers=['Integration','Status','Assignee','Due Date','Description','Next Action','All Updates'];
    data=(c.integrations||[]).map(i=>[i.name||'',i.status||'',i.assignee||'',i.dueDate?fmtDate(i.dueDate):'',i.description||'',i.nextAction||'',(i.timeline||[]).length?(i.timeline||[]).map(t=>`(${fmtDate(t.date)}) ${t.update}`).join('\n'):'']);
    filename=exportFilename(c.name,'Integrations','xlsx');
  }else if(type==='ams'){
    headers=['#','Date Raised','Due Date','Raised By','Module','Project','Description','Type','Query Level','Entry Status','RAG','Mode','Hours'];
    data=(c.workLog||[]).map((e,i)=>[i+1,fmtDate(entryDate(e)),e.dueDate?fmtDate(e.dueDate):'',entryRaisedBy(e),e.module||'',e.project||'',e.description||'',entryType(e),e.queryLevel||'',e.entryStatus||'Open',e.ragStatus||'',e.modeOfSupport||'',Number(e.hours||0).toFixed(1)]);
    filename=exportFilename(c.name,'AMS_Entries','xlsx');
  }else if(type==='impl'){
    headers=['Module','Phase','Status','Assignee','Start Date','Target Date','Current Activity','Next Action','All Updates'];
    data=(c.modules||[]).flatMap(m=>(m.phases||[]).map(ph=>[m.name,ph.name,ph.status||'',ph.assignee||'',ph.startDate?fmtDate(ph.startDate):'',ph.targetDate?fmtDate(ph.targetDate):'',ph.currentActivity||'',ph.nextAction||'',(ph.updates||[]).length?(ph.updates||[]).map(t=>`(${fmtDate(t.date)}) ${t.update}`).join('\n'):'']));
    filename=exportFilename(c.name,'Implementation','xlsx');
  }else if(type==='milestones'){
    headers=['Integration','Milestone','Status','Due Date','Owner','Notes'];
    data=(c.integrations||[]).flatMap(i=>(i.milestones||[]).map(ms=>[i.name,ms.name,ms.status,ms.dueDate?fmtDate(ms.dueDate):'',ms.owner||'',ms.notes||'']));
    filename=exportFilename(c.name,'Milestones','xlsx');
  }
  ws=XLSX.utils.aoa_to_sheet([headers,...(data||[])]);
  // Bold header row
  const range=XLSX.utils.decode_range(ws['!ref']);
  for(let C=range.s.c;C<=range.e.c;C++){const cell=XLSX.utils.encode_cell({r:0,c:C});if(ws[cell])ws[cell].s={font:{bold:true}};}
  wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Data');
  XLSX.writeFile(wb,filename);showToast('Excel downloaded ✓');
}

function exportAuditExcel(rows){
  if(typeof XLSX==='undefined'){showToast('Excel export not available','error');return;}
  const headers=['Timestamp','Username','Role','Action','Entity','Screen','IP','User Agent'];
  const data=(rows||[]).map(r=>[fmtDateTime(r.ts),r.username||'',r.role||'',r.action||'',r.entity||'',screenLabel(r.screen),r.ip||'',r.userAgent||'']);
  const ws=XLSX.utils.aoa_to_sheet([headers,...data]);
  const range=XLSX.utils.decode_range(ws['!ref']);
  for(let C=range.s.c;C<=range.e.c;C++){const cell=XLSX.utils.encode_cell({r:0,c:C});if(ws[cell])ws[cell].s={font:{bold:true}};}
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Audit Log');
  XLSX.writeFile(wb,exportFilename('Kora','Audit_Log','xlsx'));
  showToast(`Excel downloaded ✓ (${data.length} events)`);
}

// Portfolio-wide raw export for an Admin table — every client's summary row,
// not just one client's detail (that's what exportExcel(type, clientId) is
// for). Mirrors exportAuditExcel's global-dump style.
function exportAdminTableExcel(domain){
  if(typeof XLSX==='undefined'){showToast('Excel export not available','error');return;}
  let headers,data,sheetName;
  if(domain==='integrations'){
    const clients=S.clients.filter(c=>c.integrations.length>0||(c.modules===undefined&&c.workLog===undefined));
    headers=['Client','Integrations','At Risk','Completed'];
    data=clients.map(c=>{const ar=c.integrations.filter(i=>i.status==='At Risk').length;const co=c.integrations.filter(i=>i.status==='Completed').length;return[c.name,c.integrations.length,ar,co];});
    sheetName='Integrations';
  }else if(domain==='impl'){
    const clients=S.clients.filter(c=>c.modules!==undefined);
    headers=['Client','Modules','At Risk Phases'];
    data=clients.map(c=>{const pr=implProgress(c);return[c.name,(c.modules||[]).length,pr.atRisk];});
    sheetName='Implementation';
  }else if(domain==='ams'){
    const clients=S.clients.filter(c=>c.workLog!==undefined);
    headers=['Client','Day Rate','Total Hours Logged'];
    data=clients.map(c=>{const t=amsTotals(c,'','');return[c.name,c.manDayRate||'Retainer',t.totalHours.toFixed(1)];});
    sheetName='AMS';
  }else return;
  const ws=XLSX.utils.aoa_to_sheet([headers,...data]);
  const range=XLSX.utils.decode_range(ws['!ref']);
  for(let C=range.s.c;C<=range.e.c;C++){const cell=XLSX.utils.encode_cell({r:0,c:C});if(ws[cell])ws[cell].s={font:{bold:true}};}
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,sheetName);
  XLSX.writeFile(wb,exportFilename('Kora',`${sheetName}_Portfolio`,'xlsx'));
  showToast('Excel downloaded ✓');
}

function exportConsolidatedPdf(clientIds, sections){
  if(!clientIds.length){showToast('Select at least one client','error');return;}
  if(typeof window.jspdf==='undefined'){showToast('PDF export library failed to load — check your connection and refresh','error');return;}
  const{jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:'landscape',format:'a4',unit:'mm'});
  const W=297,H=210,NV=[14,116,144],MG=[37,99,235]; // app's live teal #0e7490 + blue #2563eb, not the old navy/magenta
  // Cover
  doc.setFillColor(...NV);doc.rect(0,0,W,H,'F');
  doc.setFont('helvetica','bold');doc.setFontSize(30);doc.setTextColor(255,255,255);
  doc.text('Portfolio Status Report',W/2,H/2-14,{align:'center'});
  doc.setFont('helvetica','normal');doc.setFontSize(12);doc.setTextColor(125,211,232);
  doc.text(`${clientIds.length} client${clientIds.length!==1?'s':''} · ${new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'})}`,W/2,H/2+2,{align:'center'});
  doc.setFillColor(...MG);doc.rect(W/2-14,H/2+10,28,1,'F');
  addLogoToDoc(doc,W/2-30,H-33.5,18);doc.setFontSize(10);doc.setTextColor(100,116,139);doc.text('Prepared by Kognoz Consulting',W/2,H-9,{align:'center'});

  const drawHdr=(title,clientName)=>{doc.setFillColor(...NV);doc.rect(0,0,W,14,'F');addLogoToDoc(doc,10,2,10);doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(255,255,255);doc.text(title,58,9.5);doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text(clientName,W-10,9.5,{align:'right'});};

  clientIds.forEach(cid=>{
    const c=S.clients.find(x=>x.id===cid);if(!c)return;
    if(sections.includes('integrations')&&(c.integrations||[]).length){
      doc.addPage();drawHdr('Integrations',c.name);
      doc.autoTable({startY:18,margin:{top:18,left:10,right:10},head:[['Integration','Status','Assignee','Due Date','Latest Update']],
        body:(c.integrations||[]).map(i=>{const latest=(i.timeline||[])[0];return[i.name,i.status,i.assignee||'—',i.dueDate?fmtDate(i.dueDate):'—',latest?`(${fmtDate(latest.date)}) ${(latest.update||'').slice(0,70)}`:'—'];}),
        headStyles:{fillColor:NV,textColor:[255,255,255],fontStyle:'bold',fontSize:9},styles:{fontSize:8,cellPadding:3},
        didParseCell:d=>{if(d.section==='body'&&d.column.index===1){const rgb=SRGB[d.cell.raw];if(rgb){d.cell.styles.textColor=rgb;d.cell.styles.fontStyle='bold';}}},
        didDrawPage:()=>drawHdr('Integrations',c.name)});
    }
    if(sections.includes('impl')&&c.modules?.length){
      doc.addPage();drawHdr('Implementations',c.name);
      const rag=implAutoRag(c);const pr=implProgress(c);
      doc.setFont('helvetica','normal');doc.setFontSize(10);doc.setTextColor(31,41,55);
      doc.text(`RAG: ${rag||'—'} · ${pr.completed}/${pr.total} phases complete (${pr.pct}%)`,10,19);
      doc.autoTable({startY:24,margin:{top:24,left:10,right:10},head:[['Module',...PHASES]],
        body:(c.modules||[]).map(m=>{const row=[m.name];PHASES.forEach(ph=>{const p=(m.phases||[]).find(x=>x.name===ph)||{status:'Not Started'};row.push(p.status);});return row;}),
        headStyles:{fillColor:NV,textColor:[255,255,255],fontStyle:'bold',fontSize:7.5},
        styles:{fontSize:7,cellPadding:2.5,halign:'center'},columnStyles:{0:{halign:'left',fontStyle:'bold',cellWidth:38}},
        didParseCell:d=>{if(d.section==='body'&&d.column.index>0){const rgb=SRGB[d.cell.raw];if(rgb){d.cell.styles.textColor=rgb;d.cell.styles.fontStyle='bold';}}},
        didDrawPage:()=>drawHdr('Implementations',c.name)});
    }
    if(sections.includes('ams')&&c.workLog?.length){
      doc.addPage();drawHdr('AMS & Support',c.name);
      const t=amsTotals(c,S.amsFrom,S.amsTo);
      doc.setFont('helvetica','normal');doc.setFontSize(10);doc.setTextColor(31,41,55);
      doc.text(`Total Hours: ${t.totalHours.toFixed(1)}h · Open entries: ${(c.workLog||[]).filter(e=>e.entryStatus!=='Closed').length}`,10,19);
      doc.autoTable({startY:24,margin:{top:24,left:10,right:10},
        head:[['#','Date','Description','Type','Level','Status','Hours']],
        body:(c.workLog||[]).sort((a,b)=>entryDate(b).localeCompare(entryDate(a))).map((e,i)=>[i+1,fmtDate(entryDate(e)),(e.description||'').slice(0,50),entryType(e),e.queryLevel||'',e.entryStatus||'Open',Number(e.hours||0).toFixed(1)]),
        headStyles:{fillColor:NV,textColor:[255,255,255],fontStyle:'bold',fontSize:9},styles:{fontSize:7.5,cellPadding:2.5},
        didDrawPage:()=>drawHdr('AMS & Support',c.name)});
    }
  });
  // Thank you
  doc.addPage();doc.setFillColor(...NV);doc.rect(0,0,W,H,'F');
  doc.setFont('helvetica','bold');doc.setFontSize(36);doc.setTextColor(255,255,255);doc.text('Thank You',W/2,H/2-8,{align:'center'});
  doc.setFillColor(...MG);doc.rect(W/2-10,H/2,20,1,'F');
  addLogoToDoc(doc,W/2-30,H/2+16.5,18);
  doc.setFont('helvetica','normal');doc.setFontSize(13);doc.setTextColor(125,211,232);doc.text('Kognoz · HR Transformation & Consulting',W/2,H/2+10,{align:'center'});
  doc.save(exportFilename('Kora','Portfolio_Report','pdf'));showToast('Portfolio PDF downloaded ✓');
}