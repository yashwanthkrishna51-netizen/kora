// ─── EXPORT: PPTX (Kognoz branded) ────────────────────────────────

function addLogoToDoc(doc, x, y, maxH){
  // maxH in mm — logo is 315x94px, so w = maxH*(315/94)
  const w=maxH*(315/94);
  try{doc.addImage(KOGNOZ_LOGO,'PNG',x,y-(maxH*0.75),w,maxH);}catch(e){}
}
async function exportPptx(clientId){
  if(typeof PptxGenJS==='undefined'){showToast('PPTX export library failed to load — check your connection and refresh','error');return;}
  const c=S.clients.find(x=>x.id===clientId);if(!c)return;
  showToast('Generating PPTX…','info');
  try{
    const pptx=new PptxGenJS();pptx.layout='LAYOUT_WIDE';
    const NV=TEAL_DARK,MG=MAGENTA;
    // Cover
    const s1=pptx.addSlide();s1.background={color:NV};
    s1.addText('INTEGRATION STATUS REPORT',{x:.5,y:1.0,w:12.5,h:.4,fontSize:10,color:'7dd3e8',align:'center',charSpacing:4});
    s1.addText(c.name,{x:.5,y:1.6,w:12.5,h:1.2,fontSize:44,color:'FFFFFF',bold:true,align:'center'});
    try{s1.addImage({path:KOGNOZ_LOGO,x:5.15,y:2.9,w:2.8,h:0.84});}catch(e){s1.addText('Kognoz',{x:.5,y:3.0,w:12.5,h:.4,fontSize:14,color:'7dd3e8',align:'center'});}
    s1.addShape(pptx.ShapeType.rect,{x:5.65,y:3.55,w:2,h:.05,fill:{color:MG},line:{type:'none'}});
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
    const CHARS_PER_LINE=95,LINE_H=0.15;
    const estLines=(text)=>!text?1:text.split('\n').reduce((s,l)=>s+Math.max(1,Math.ceil(l.length/CHARS_PER_LINE)),0);
    const detailRows=c.integrations.map(i=>{
      const latest=i.timeline?.[0];
      const updateText=latest?latest.update:'No updates yet.';
      const updateDate=latest?fmtDate(latest.date):'';
      const nextText=i.nextAction||'';
      const overdueTxt=isOverdue(i)?`⚠ ${daysOverdue(i)}d overdue`:'';
      const blockLines=1+estLines(updateText)+1+1+estLines(nextText||'No next action noted.');
      const estHeight=Math.max(0.6,blockLines*LINE_H+0.12);
      return{name:i.name,assignee:i.assignee||'Unassigned',status:i.status,due:i.dueDate?fmtDate(i.dueDate):'—',overdueTxt,updateText,updateDate,nextText,estHeight};
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
        {text:'Latest Update & Next Steps',options:{bold:true,fill:{color:NV},color:'FFFFFF',fontSize:9}},
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
            {text:'Update:'+(row.updateDate?` (${row.updateDate})`:'')+'\n',options:{bold:true,fontSize:8,color:'1f2937'}},
            {text:row.updateText+'\n\n',options:{fontSize:8,color:'4b5563'}},
            {text:'Next:\n',options:{bold:true,fontSize:8,color:'1f2937'}},
            row.nextText?{text:row.nextText,options:{fontSize:8,color:'4b5563'}}:{text:'No next action noted.',options:{fontSize:8,italic:true,color:'9ca3af'}},
          ],options:{fill:{color:bg},valign:'top'}},
        ];
      });
      sl.addTable([headerRow,...bodyRows],{x:.3,y:.9,w:12.7,colW:[0.12,2.0,1.5,1.2,1.5,6.38],border:{type:'solid',color:'e5e7eb',pt:.5}});
    });
    // Thank you
    const sL=pptx.addSlide();sL.background={color:NV};
    sL.addText('Thank You',{x:.5,y:2.3,w:12.5,h:1.1,fontSize:44,color:'FFFFFF',bold:true,align:'center'});
    sL.addShape(pptx.ShapeType.rect,{x:5.9,y:3.3,w:1.5,h:.05,fill:{color:MG},line:{type:'none'}});
    sL.addText('Kognoz · HR Transformation & Consulting',{x:.5,y:3.5,w:12.5,h:.5,fontSize:14,color:'7dd3e8',align:'center'});
    await pptx.writeFile({fileName:`${c.name}_Integration_Report.pptx`});
    showToast('PPTX downloaded ✓');
  }catch(e){console.error(e);showToast('PPTX failed: '+e.message,'error');}
}

// ─── EXPORT: PDF (Kognoz branded) ──────────────────────────────────
function exportPdf(clientId){
  if(typeof window.jspdf==='undefined'){showToast('PDF export library failed to load — check your connection and refresh','error');return;}
  const c=S.clients.find(x=>x.id===clientId);if(!c)return;
  showToast('Generating PDF…','info');
  try{
    const{jsPDF}=window.jspdf;const doc=new jsPDF({orientation:'landscape',format:'a4',unit:'mm'});
    const W=297,H=210,NV=[13,61,79],MG=[181,23,158];
    // Cover
    doc.setFillColor(...NV);doc.rect(0,0,W,H,'F');
    doc.setFont('helvetica','normal');doc.setFontSize(10);doc.setTextColor(125,211,232);doc.text('INTEGRATION STATUS REPORT',W/2,58,{align:'center'});
    doc.setFont('helvetica','bold');doc.setFontSize(34);doc.setTextColor(255,255,255);doc.text(c.name,W/2,80,{align:'center'});
    addLogoToDoc(doc,W/2-30,92,18);doc.setFont('helvetica','normal');doc.setFontSize(11);doc.setTextColor(125,211,232);doc.text('Prepared by Kognoz Consulting',W/2,98,{align:'center'});
    doc.setFillColor(...MG);doc.rect(W/2-12,100,24,1,'F');
    doc.setFontSize(10);doc.setTextColor(100,116,139);doc.text(new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'}),W/2,H-8,{align:'center'});
    // Summary
    doc.addPage();doc.setFillColor(...NV);doc.rect(0,0,W,14,'F');addLogoToDoc(doc,10,13,10);
    doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(255,255,255);doc.text('Integration Summary',58,9.5);doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text(c.name,W-10,9.5,{align:'right'});
    const sg={};c.integrations.forEach(i=>sg[i.status]=(sg[i.status]||0)+1);
    [{l:'Total',v:c.integrations.length,rgb:NV},{l:'In Progress',v:sg['In Progress']||0,rgb:SRGB['In Progress']},{l:'At Risk',v:sg['At Risk']||0,rgb:SRGB['At Risk']},{l:'Completed',v:sg['Completed']||0,rgb:SRGB['Completed']},{l:'On Hold',v:(sg['On Hold — Internal']||0)+(sg['On Hold — Client']||0),rgb:SRGB['On Hold — Internal']}]
    .forEach(({l,v,rgb},i)=>{const x=10+i*57;doc.setFillColor(...rgb);doc.roundedRect(x,18,50,20,2,2,'F');doc.setFont('helvetica','bold');doc.setFontSize(18);doc.setTextColor(255,255,255);doc.text(String(v),x+25,30,{align:'center'});doc.setFontSize(7.5);doc.setFont('helvetica','normal');doc.text(l,x+25,37,{align:'center'});});
    doc.autoTable({startY:42,head:[['Integration','Status','Assignee','Due Date']],body:c.integrations.map(i=>[i.name,i.status,i.assignee||'—',i.dueDate?fmtDate(i.dueDate):'—']),headStyles:{fillColor:NV,textColor:[255,255,255],fontStyle:'bold',fontSize:9},styles:{fontSize:8.5,cellPadding:3},alternateRowStyles:{fillColor:[245,249,250]},columnStyles:{0:{cellWidth:127},1:{cellWidth:40},2:{cellWidth:60},3:{cellWidth:50}},didParseCell:d=>{if(d.column.index===1&&d.section==='body'){const rgb=SRGB[d.cell.raw];if(rgb){d.cell.styles.textColor=rgb;d.cell.styles.fontStyle='bold';}}},margin:{left:10,right:10}});
    // Integration Details — single autoTable call, natively paginates across as many pages as needed
    doc.addPage();
    const detailRows=c.integrations.map(i=>{
      const latest=i.timeline?.[0];
      const updateText=latest?latest.update:'No updates yet.';
      const updateDate=latest?fmtDate(latest.date):'';
      const nextText=i.nextAction||'';
      const overdue=isOverdue(i);
      const dueCell=i.dueDate?fmtDate(i.dueDate):'—';
      // Sizing string: autoTable wraps this to compute row height. Line count here must
      // match what didDrawCell below actually draws, so nothing gets cut off.
      const sizingStr=`Update:${updateDate?` (${updateDate})`:''}\n${updateText}\n\nNext:\n${nextText||'No next action noted.'}`;
      return{
        status:i.status,overdue,updateText,updateDate,nextText,
        row:['',i.name,i.assignee||'Unassigned',i.status,overdue?`${dueCell}\n${daysOverdue(i)}d OVERDUE`:dueCell,sizingStr],
      };
    });
    doc.autoTable({
      startY:16,
      margin:{top:16,left:10,right:10,bottom:10},
      head:[['','Integration','Assignee','Status','Due Date','Latest Update & Next Steps']],
      body:detailRows.map(d=>d.row),
      headStyles:{fillColor:NV,textColor:[255,255,255],fontStyle:'bold',fontSize:9},
      styles:{fontSize:8,cellPadding:3,valign:'top'},
      alternateRowStyles:{fillColor:[245,249,250]},
      columnStyles:{0:{cellWidth:3},1:{cellWidth:50},2:{cellWidth:35},3:{cellWidth:28},4:{cellWidth:32},5:{cellWidth:'auto'}},
      didParseCell:d=>{
        if(d.section!=='body')return;
        const meta=detailRows[d.row.index];if(!meta)return;
        if(d.column.index===0){d.cell.styles.fillColor=SRGB[meta.status]||[100,116,139];d.cell.text=[''];}
        if(d.column.index===3){const rgb=SRGB[meta.status];if(rgb){d.cell.styles.textColor=rgb;d.cell.styles.fontStyle='bold';}}
        if(d.column.index===4&&meta.overdue){d.cell.styles.textColor=[190,24,93];d.cell.styles.fontStyle='bold';}
      },
      didDrawCell:d=>{
        // Custom render for the Update/Next column: bold labels, bold date, blank line gap.
        // We let autoTable draw+size the cell normally (so pagination/height stays exact),
        // then cover that plain text here and redraw it styled, using the same line count.
        if(d.section!=='body'||d.column.index!==5)return;
        const meta=detailRows[d.row.index];if(!meta)return;
        const bg=d.row.index%2?[255,255,255]:[245,249,250];
        doc.setFillColor(...bg);doc.rect(d.cell.x,d.cell.y,d.cell.width,d.cell.height,'F');
        const x=d.cell.x+3,maxW=d.cell.width-6;let y=d.cell.y+4;const lh=3.3;
        doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(31,41,55);
        doc.text('Update:'+(meta.updateDate?` (${meta.updateDate})`:''),x,y);y+=lh;
        doc.setFont('helvetica','normal');doc.setTextColor(75,85,99);
        const updLines=doc.splitTextToSize(meta.updateText,maxW);
        doc.text(updLines,x,y);y+=updLines.length*lh;
        y+=lh;
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
        doc.setFont('helvetica','bold');doc.setFontSize(12);doc.setTextColor(255,255,255);doc.text('Integration Details',10,9.5);
        doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text(c.name,W-10,9.5,{align:'right'});
      },
    });
    // Thank you
    doc.addPage();doc.setFillColor(...NV);doc.rect(0,0,W,H,'F');
    doc.setFont('helvetica','bold');doc.setFontSize(36);doc.setTextColor(255,255,255);doc.text('Thank You',W/2,H/2-8,{align:'center'});
    doc.setFillColor(...MG);doc.rect(W/2-10,H/2,20,1,'F');
    doc.setFont('helvetica','normal');doc.setFontSize(13);doc.setTextColor(125,211,232);doc.text('Kognoz · HR Transformation & Consulting',W/2,H/2+10,{align:'center'});
    doc.save(`${c.name}_Integration_Report.pdf`);showToast('PDF downloaded ✓');
  }catch(e){console.error(e);showToast('PDF failed: '+e.message,'error');}
}

// ─── EXPORT: Implementation Module Progress (PDF) ──────────────────
function exportImplPdf(clientId){
  if(typeof window.jspdf==='undefined'){showToast('PDF export library failed to load — check your connection and refresh','error');return;}
  const c=S.clients.find(x=>x.id===clientId);if(!c)return;
  showToast('Generating PDF…','info');
  try{
    const{jsPDF}=window.jspdf;const doc=new jsPDF({orientation:'landscape',format:'a4',unit:'mm'});
    const W=297,H=210,NV=[13,61,79],MG=[181,23,158];
    const mods=c.modules||[];

    // ── COVER ──────────────────────────────────────────────────────
    doc.setFillColor(...NV);doc.rect(0,0,W,H,'F');
    doc.setFont('helvetica','normal');doc.setFontSize(10);doc.setTextColor(125,211,232);doc.text('IMPLEMENTATION STATUS REPORT',W/2,58,{align:'center'});
    doc.setFont('helvetica','bold');doc.setFontSize(34);doc.setTextColor(255,255,255);doc.text(c.name,W/2,80,{align:'center'});
    addLogoToDoc(doc,W/2-30,92,18);doc.setFont('helvetica','normal');doc.setFontSize(11);doc.setTextColor(125,211,232);doc.text('Prepared by Kognoz Consulting',W/2,98,{align:'center'});
    doc.setFillColor(...MG);doc.rect(W/2-12,100,24,1,'F');
    doc.setFontSize(10);doc.setTextColor(100,116,139);doc.text(new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'}),W/2,H-8,{align:'center'});

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
      didDrawPage:()=>{doc.setFillColor(...NV);doc.rect(0,0,W,14,'F');addLogoToDoc(doc,10,13,10);doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(255,255,255);doc.text('Implementation Summary',58,9.5);doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text(c.name,W-10,9.5,{align:'right'});}
    });

    // ── DETAIL PAGES (one row per phase, grouped under module) ─────
    doc.addPage();
    const detailRows=[];
    mods.forEach(m=>{
      // Module header row
      detailRows.push({isHeader:true,moduleName:m.name,row:['',m.name,'','','',''],status:null});
      PHASES.forEach(phName=>{
        const ph=(m.phases||[]).find(x=>x.name===phName)||{name:phName,status:'Not Started',startDate:'',targetDate:'',updates:[]};
        const latest=(ph.updates||[])[0];
        const updateText=latest?latest.update:'No updates yet.';
        const updateDate=latest?fmtDate(latest.date):'';
        const updateCount=(ph.updates||[]).length;
        const nextText=ph.nextAction||'';
        const actText=ph.currentActivity||'';
        const sizingStr=`Update:${updateDate?` (${updateDate})`:''}\n${updateText}\n\nNext:\n${nextText||'No next action noted.'}`;
        detailRows.push({
          isHeader:false,moduleName:m.name,phaseName:phName,
          status:ph.status,updateText,updateDate,updateCount,nextText,actText,
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
      head:[['','Phase','Status','Start Date','Target Date','Latest Update & Next Action']],
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
        doc.text('Update:'+(meta.updateDate?` (${meta.updateDate})`:''),x,y);y+=lh;
        doc.setFont('helvetica','normal');doc.setTextColor(75,85,99);
        const updLines=doc.splitTextToSize(meta.updateText,maxW);
        doc.text(updLines,x,y);y+=updLines.length*lh;
        y+=lh;
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
        addLogoToDoc(doc,10,13,10);doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(255,255,255);doc.text('Phase Details & Updates',58,9.5);
        doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text(c.name,W-10,9.5,{align:'right'});
      },
    });

    // ── THANK YOU ──────────────────────────────────────────────────
    doc.addPage();doc.setFillColor(...NV);doc.rect(0,0,W,H,'F');
    doc.setFont('helvetica','bold');doc.setFontSize(36);doc.setTextColor(255,255,255);doc.text('Thank You',W/2,H/2-8,{align:'center'});
    doc.setFillColor(...MG);doc.rect(W/2-10,H/2,20,1,'F');
    doc.setFont('helvetica','normal');doc.setFontSize(13);doc.setTextColor(125,211,232);doc.text('Kognoz · HR Transformation & Consulting',W/2,H/2+10,{align:'center'});

    doc.save(`${c.name}_Implementation_Report.pdf`);showToast('PDF downloaded ✓');
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
    const W=297,H=210,NV=[13,61,79],MG=[181,23,158];
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
    addLogoToDoc(doc,W/2-30,H-22,18);doc.text('Prepared by Kognoz Consulting',W/2,H-8,{align:'center'});
    doc.text(new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'}),W/2,H-7,{align:'center'});

    // ── SUMMARY PAGE ───────────────────────────────────────────────
    doc.addPage();
    const drawHdr=()=>{doc.setFillColor(...NV);doc.rect(0,0,W,14,'F');addLogoToDoc(doc,10,13,10);doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(255,255,255);doc.text('AMS Activity Log',58,9.5);doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text(c.name,W-10,9.5,{align:'right'});};
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
    doc.setFont('helvetica','normal');doc.setFontSize(13);doc.setTextColor(125,211,232);doc.text('Kognoz · HR Transformation & Consulting',W/2,H/2+10,{align:'center'});

    doc.save(`${c.name}_AMS_Activity_Report.pdf`);showToast('Activity report downloaded ✓');
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
    const W=297,H=210,NV=[13,61,79],MG=[181,23,158];
    const t=amsTotals(c,S.amsFrom,S.amsTo);
    const periodLabel=(S.amsFrom||S.amsTo)?`${S.amsFrom?fmtDate(S.amsFrom):'Start'} - ${S.amsTo?fmtDate(S.amsTo):'Today'}`:'All Time';
    const drawHeaderBar=()=>{
      doc.setFillColor(...NV);doc.rect(0,0,W,14,'F');addLogoToDoc(doc,10,13,10);
      doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(255,255,255);doc.text('AMS Work Summary & Internal Billing Breakdown',58,9.5);
      doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text(c.name,W-10,9.5,{align:'right'});
    };
    drawHeaderBar();
    doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(100,116,139);
    doc.text(`Billing Period: ${periodLabel}`,10,21);
    doc.text(`Day Rate: Rs. ${(c.manDayRate||0).toLocaleString('en-IN')} (${HOURS_PER_DAY}-hour day)`,10,26);
    doc.text(`Generated: ${new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'})}`,W-10,21,{align:'right'});
    let boxY=30;
    if(t.hasBucket){
      [{l:'Total Available',v:`${t.totalAvailableHours.toFixed(1)} hrs`},{l:'Consumed (all-time)',v:`${t.consumedAllTime.toFixed(1)} hrs`},{l:'Balance Available',v:`${t.balanceAvailable.toFixed(1)} hrs`}]
      .forEach((s,i)=>{const x=10+i*92;doc.setFillColor(...(i===2?(t.balanceAvailable>0?[34,197,94]:[190,24,93]):[100,116,139]));doc.roundedRect(x,boxY,86,16,2,2,'F');doc.setFont('helvetica','bold');doc.setFontSize(13);doc.setTextColor(255,255,255);doc.text(s.v,x+6,boxY+10);doc.setFontSize(7.5);doc.setFont('helvetica','normal');doc.text(s.l,x+6,boxY+14.5);});
      boxY+=20;
    }
    [{l:'Hours This Period',v:t.totalHours.toFixed(1)},{l:'Total Days',v:(t.totalHours/HOURS_PER_DAY).toFixed(2)},{l:'Billable Amount (Rs.)',v:t.totalAmount.toLocaleString('en-IN',{maximumFractionDigits:0})}]
    .forEach((s,i)=>{const x=10+i*92;doc.setFillColor(...(i===2?MG:NV));doc.roundedRect(x,boxY,86,16,2,2,'F');doc.setFont('helvetica','bold');doc.setFontSize(15);doc.setTextColor(255,255,255);doc.text(String(s.v),x+6,boxY+10);doc.setFontSize(7.5);doc.setFont('helvetica','normal');doc.text(s.l,x+6,boxY+14.5);});
    const tableStartY=boxY+24;
    const sorted=[...t.log].sort((a,b)=>a.date.localeCompare(b.date));
    doc.autoTable({
      startY:tableStartY,
      margin:{top:18,left:10,right:10,bottom:10},
      head:[['Date','Category','Description','Hours','Amount (Rs.)']],
      body:sorted.map(e=>[fmtDate(e.date),e.category,e.description||'-',Number(e.hours).toFixed(1),t.hasBucket?'Pooled':amsEntryAmount(Number(e.hours),c.manDayRate||0).toLocaleString('en-IN',{maximumFractionDigits:0})]),
      headStyles:{fillColor:NV,textColor:[255,255,255],fontStyle:'bold',fontSize:9},
      styles:{fontSize:8.5,cellPadding:3},
      alternateRowStyles:{fillColor:[245,249,250]},
      columnStyles:{0:{cellWidth:28},1:{cellWidth:35},2:{cellWidth:'auto'},3:{cellWidth:22,halign:'right'},4:{cellWidth:30,halign:'right'}},
      didDrawPage:drawHeaderBar,
    });
    const catRows=Object.entries(t.byType).map(([cat,hrs])=>[cat,hrs.toFixed(1),t.hasBucket?'Pooled':(amsEntryAmount(hrs,c.manDayRate||0)||0).toLocaleString('en-IN',{maximumFractionDigits:0})]);
    if(catRows.length){
      doc.autoTable({
        startY:doc.lastAutoTable.finalY+8,
        margin:{top:18,left:10,right:10,bottom:10},
        head:[['Breakdown by Category','Hours','Amount (Rs.)']],
        body:catRows,
        headStyles:{fillColor:[100,116,139],textColor:[255,255,255],fontStyle:'bold',fontSize:9},
        styles:{fontSize:8.5,cellPadding:3},
        columnStyles:{1:{halign:'right'},2:{halign:'right'}},
        didDrawPage:drawHeaderBar,
      });
    }
    doc.setFont('helvetica','italic');doc.setFontSize(7.5);doc.setTextColor(156,163,175);
    doc.text(t.hasBucket?'For internal finance use. Hours within the available pool are not separately billed - only usage beyond the pool is billed. Pre-tax breakdown - GST and other taxes to be applied by finance separately.':'For internal finance use. Pre-tax breakdown - GST and other taxes to be applied by finance separately.',10,H-6);
    doc.save(`${c.name}_AMS_Billing.pdf`);showToast('Invoice downloaded ✓');
  }catch(e){console.error(e);showToast('PDF failed: '+e.message,'error');}
}

function exportExcel(type, clientId){
  if(typeof XLSX==='undefined'){showToast('Excel export not available','error');return;}
  const c=S.clients.find(x=>x.id===clientId);if(!c)return;
  let wb,ws,data,headers,filename;
  if(type==='integrations'){
    headers=['Integration','Status','Assignee','Due Date','Description','Next Action','Last Update'];
    data=(c.integrations||[]).map(i=>[i.name||'',i.status||'',i.assignee||'',i.dueDate?fmtDate(i.dueDate):'',i.description||'',i.nextAction||'',(i.timeline||[])[0]?.date?fmtDate((i.timeline||[])[0].date):'']);
    filename=`${c.name}_Integrations.xlsx`;
  }else if(type==='ams'){
    headers=['#','Date Raised','Due Date','Raised By','Module','Project','Description','Type','Query Level','Entry Status','RAG','Mode','Hours'];
    data=(c.workLog||[]).map((e,i)=>[i+1,fmtDate(entryDate(e)),e.dueDate?fmtDate(e.dueDate):'',entryRaisedBy(e),e.module||'',e.project||'',e.description||'',entryType(e),e.queryLevel||'',e.entryStatus||'Open',e.ragStatus||'',e.modeOfSupport||'',Number(e.hours||0).toFixed(1)]);
    filename=`${c.name}_AMS_Entries.xlsx`;
  }else if(type==='impl'){
    headers=['Module','Phase','Status','Assignee','Start Date','Target Date','Current Activity','Next Action','Updates Count'];
    data=(c.modules||[]).flatMap(m=>(m.phases||[]).map(ph=>[m.name,ph.name,ph.status||'',ph.assignee||'',ph.startDate?fmtDate(ph.startDate):'',ph.targetDate?fmtDate(ph.targetDate):'',ph.currentActivity||'',ph.nextAction||'',(ph.updates||[]).length]));
    filename=`${c.name}_Implementation.xlsx`;
  }else if(type==='milestones'){
    headers=['Integration','Milestone','Status','Due Date','Owner','Notes'];
    data=(c.integrations||[]).flatMap(i=>(i.milestones||[]).map(ms=>[i.name,ms.name,ms.status,ms.dueDate?fmtDate(ms.dueDate):'',ms.owner||'',ms.notes||'']));
    filename=`${c.name}_Milestones.xlsx`;
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
  const stamp=new Date().toISOString().slice(0,10);
  XLSX.writeFile(wb,`Kora_Audit_Log_${stamp}.xlsx`);
  showToast(`Excel downloaded ✓ (${data.length} events)`);
}

function exportConsolidatedPdf(clientIds, sections){
  if(!clientIds.length){showToast('Select at least one client','error');return;}
  if(typeof window.jspdf==='undefined'){showToast('PDF export library failed to load — check your connection and refresh','error');return;}
  const{jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:'landscape',format:'a4',unit:'mm'});
  const W=297,H=210,NV=[13,61,79],MG=[181,23,158];
  // Cover
  doc.setFillColor(...NV);doc.rect(0,0,W,H,'F');
  doc.setFont('helvetica','bold');doc.setFontSize(30);doc.setTextColor(255,255,255);
  doc.text('Portfolio Status Report',W/2,H/2-14,{align:'center'});
  doc.setFont('helvetica','normal');doc.setFontSize(12);doc.setTextColor(125,211,232);
  doc.text(`${clientIds.length} client${clientIds.length!==1?'s':''} · ${new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'})}`,W/2,H/2+2,{align:'center'});
  doc.setFillColor(...MG);doc.rect(W/2-14,H/2+10,28,1,'F');
  addLogoToDoc(doc,W/2-30,H-18,18);doc.setFontSize(10);doc.setTextColor(100,116,139);doc.text('Prepared by Kognoz Consulting',W/2,H-5,{align:'center'});

  const drawHdr=(title,clientName)=>{doc.setFillColor(...NV);doc.rect(0,0,W,14,'F');addLogoToDoc(doc,10,13,10);doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(255,255,255);doc.text(title,58,9.5);doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text(clientName,W-10,9.5,{align:'right'});};

  clientIds.forEach(cid=>{
    const c=S.clients.find(x=>x.id===cid);if(!c)return;
    if(sections.includes('integrations')&&(c.integrations||[]).length){
      doc.addPage();drawHdr('Integrations',c.name);
      doc.autoTable({startY:18,margin:{top:18,left:10,right:10},head:[['Integration','Status','Assignee','Due Date','Latest Update']],
        body:(c.integrations||[]).map(i=>[i.name,i.status,i.assignee||'—',i.dueDate?fmtDate(i.dueDate):'—',(i.timeline||[])[0]?.update?.slice(0,80)||'—']),
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
  doc.setFont('helvetica','normal');doc.setFontSize(13);doc.setTextColor(125,211,232);doc.text('Kognoz · HR Transformation & Consulting',W/2,H/2+10,{align:'center'});
  doc.save(`Portfolio_Report_${new Date().toISOString().slice(0,10)}.pdf`);showToast('Portfolio PDF downloaded ✓');
}