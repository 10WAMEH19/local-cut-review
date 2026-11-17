import {mergedCuts,editDuration,validBounds,changeBounds} from '/cuts.mjs';
const $=id=>document.getElementById(id), video=$('video');
let source=null,items=[],history=[],token='',mode='source',clipEnd=null,confirmAction=null,busy=false;
const stamp=t=>`${Math.floor(t/60).toString().padStart(2,'0')}:${(t%60).toFixed(t%1 ? 1:0).padStart(t%1?4:2,'0')}`;
function notice(text,error=false){$('notice').textContent=text;$('notice').classList.toggle('error',error);}
function log(text){history.unshift({at:new Date().toISOString(),text});history=history.slice(0,40);}
function save(){
  if(!source)return;
  try{localStorage.setItem('lcr:last',JSON.stringify({source,items,history,goal:$('goal').value,retain:$('retain').value,preferred:$('preferred').value}));$('save-state').textContent='Saved locally';}
  catch{$('save-state').textContent='Not saved — download decisions JSON';notice('Browser storage is unavailable. Save decisions JSON before closing.',true);}
}
async function api(path,body){const r=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','X-App-Token':token}:{},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw Error(data.error||'The local request failed.');return data;}
function button(text,fn,classes=''){const b=document.createElement('button');b.textContent=text;b.className=classes;b.onclick=fn;return b;}
function showConfirm(title,text,yes,action){$('confirm-title').textContent=title;$('confirm-text').textContent=text;$('confirm-note').textContent=title==='Apply this local cut?'?'The original stays available. Restore returns this interval without changing other decisions.':title==='Export this working edit?'?'The export uses this confirmed snapshot. Later edits require a new export.':'Source media files are retained. Save the decision record first if needed.';$('confirm-yes').textContent=yes;confirmAction=action;video.pause();$('confirm').showModal();}
$('confirm').addEventListener('close',()=>{const f=confirmAction;confirmAction=null;if($('confirm').returnValue==='confirm'&&f)f();});
function switchMode(next){mode=next;clipEnd=null;$('source-mode').classList.toggle('selected',next==='source');$('edit-mode').classList.toggle('selected',next==='edit');$('source-mode').setAttribute('aria-pressed',next==='source');$('edit-mode').setAttribute('aria-pressed',next==='edit');$('mode-note').textContent=next==='source'?'Original footage includes every interval.':'Only confirmed cuts are skipped.';$('playback-label').hidden=true;}
async function watch(start,end,label,context=true){switchMode('source');video.currentTime=Math.max(0,start-(context?3:0));clipEnd=Math.min(source.duration,end+(context?3:0));$('playback-label').textContent=label;$('playback-label').hidden=false;try{await video.play();}catch{notice('Press Play to review this interval.');}}
function render(){
  if(!source)return;
  $('source-name').textContent=source.name;$('original-duration').textContent=stamp(source.duration);$('edit-duration').textContent=stamp(editDuration(items,source.duration));$('ruler-end').textContent=stamp(source.duration);$('cut-count').textContent=items.filter(s=>s.status==='cut').length;$('pending-count').textContent=items.filter(s=>s.status==='pending').length+' pending';
  const list=$('suggestions');list.replaceChildren();
  if(!items.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='No automatic suggestions. Add a manual local cut after watching your video.';list.append(empty);}
  items.forEach(s=>{
    const card=document.createElement('article');card.className='suggestion '+s.status;card.dataset.id=s.id;
    const row=document.createElement('div');row.className='row';const time=document.createElement('span');time.className='time';time.textContent=stamp(s.start)+'–'+stamp(s.end);const status=document.createElement('span');status.className='status';status.textContent={pending:'Review needed',cut:'Cut applied',keep:'Kept by you'}[s.status];row.append(time,status);
    const title=document.createElement('h3');title.textContent=s.title;const reason=document.createElement('p');reason.textContent=s.reason;const evidence=document.createElement('p');evidence.className='evidence';evidence.textContent=s.evidence||'Manually marked by the creator.';
    const actions=document.createElement('div');actions.className='actions';actions.append(button('Watch with context',()=>watch(s.start,s.end,'Review '+stamp(s.start)+'–'+stamp(s.end))));
    if(s.status==='pending'){
      actions.append(button('Apply cut',()=>showConfirm('Apply this local cut?',`Remove ${stamp(s.start)}–${stamp(s.end)} (${(s.end-s.start).toFixed(1)} seconds) from the working edit?`,'Confirm cut',()=>{const remaining=editDuration([...items.filter(x=>x.id!==s.id),{...s,status:'cut'}],source.duration);if(remaining<.1){notice('Keep at least 0.1 seconds of footage.',true);return;}s.status='cut';log('Applied '+stamp(s.start)+'–'+stamp(s.end));switchMode('edit');render();save();notice('Cut applied. The original is unchanged; Restore returns this interval.');}),'primary'));
      actions.append(button('Keep',()=>{s.status='keep';log('Kept '+stamp(s.start)+'–'+stamp(s.end));render();save();notice('Interval kept.');}));
    } else if(s.status==='cut')actions.append(button('Restore',()=>{s.status='keep';log('Restored '+stamp(s.start)+'–'+stamp(s.end));render();save();notice('Interval restored. Other edit decisions are unchanged.');},'primary'));
    else actions.append(button('Review again',()=>{s.status='pending';log('Reopened review '+stamp(s.start)+'–'+stamp(s.end));render();save();}));
    card.append(row,title,reason,evidence,actions);
    if(s.status!=='cut'){
      const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Adjust cut boundaries';const bounds=document.createElement('div');bounds.className='bounds';
      const inputs=['Start','End'].map((name,i)=>{const label=document.createElement('label');label.textContent=name+' (seconds)';const input=document.createElement('input');input.type='number';input.step='.1';input.min=0;input.max=source.duration;input.value=i?s.end:s.start;input.setAttribute('aria-label',name+' for '+s.title);label.append(input);bounds.append(label);return input;});
      details.append(summary,bounds,button('Save boundaries',()=>{try{const changed=changeBounds(s,Number(inputs[0].value),Number(inputs[1].value),source.duration);Object.assign(s,changed);log('Adjusted '+stamp(s.start)+'–'+stamp(s.end));render();save();notice('New boundaries saved as a proposal. Review before applying.');}catch(e){notice(e.message,true);}}));card.append(details);
    }
    list.append(card);
  });
  const timeline=$('timeline');timeline.replaceChildren();items.forEach(s=>{const b=button(stamp(s.start),()=>watch(s.start,s.end,'Review '+stamp(s.start)+'–'+stamp(s.end)),s.status);b.style.left=s.start/source.duration*100+'%';b.style.width=(s.end-s.start)/source.duration*100+'%';b.setAttribute('aria-label',`${s.title}: ${stamp(s.start)} to ${stamp(s.end)}, ${s.status}`);timeline.append(b);});const head=document.createElement('i');head.className='playhead';head.id='playhead';timeline.append(head);
  $('history').replaceChildren();history.slice(0,12).forEach(h=>{const li=document.createElement('li');li.textContent=h.text;$('history').append(li);});
}
async function openSource(info,old=null){video.pause();source=info;items=old?.items||[];history=old?.history||[];$('goal').value=old?.goal??'';$('retain').value=old?.retain??'';$('preferred').value=old?.preferred||'';$('export-status').textContent='';video.src=info.url;switchMode('source');render();save();notice('Video imported. Automatic content analysis is unavailable; manual local review is ready.');}
$('source-mode').onclick=()=>switchMode('source');$('edit-mode').onclick=()=>switchMode('edit');
$('file').onchange=async e=>{
 const file=e.target.files[0];if(!file)return;if(busy){notice('Wait for the current operation to finish.');return;}
 if(file.size>512*1024*1024){notice('Choose a file smaller than 512 MB.',true);return;}
 const proceed=async()=>{busy=true;$('file').disabled=true;video.pause();notice('Importing video on this computer…');try{const r=await fetch('/api/upload',{method:'POST',headers:{'X-App-Token':token,'X-Filename':encodeURIComponent(file.name)},body:file});const data=await r.json();if(!r.ok)throw Error(data.error);await openSource(data);}catch(err){notice(err.message,true);}finally{busy=false;$('file').disabled=false;$('file').value='';}};
 if(source&&items.length)showConfirm('Switch to another video?','A new review will replace the current browser workspace. Save decisions JSON first if you need this record. The original media is retained.','Import video',proceed);else proceed();
};
$('use-time').onclick=()=>{if(!source)return;$('manual-start').value=video.currentTime.toFixed(1);$('manual-end').value=Math.min(source.duration,video.currentTime+2).toFixed(1);};
$('add-manual').onclick=()=>{if(!source)return;const a=Number($('manual-start').value),b=Number($('manual-end').value);if(!validBounds(a,b,source.duration)){notice('Choose an interval of at least 0.1 seconds inside the source.',true);return;}items.push({id:'manual-'+crypto.randomUUID(),start:a,end:b,title:'Manual local cut',reason:$('manual-reason').value.trim()||'Creator-marked interval for review.',status:'pending'});log('Marked manual proposal '+stamp(a)+'–'+stamp(b));render();save();notice('Manual proposal added. Nothing is removed until you confirm it.');};
for(const id of ['goal','retain','preferred'])$(id).addEventListener('input',save);
video.addEventListener('timeupdate',()=>{
  if(source&&$('playhead'))$('playhead').style.left=video.currentTime/source.duration*100+'%';
  if(clipEnd!==null&&video.currentTime>=clipEnd){video.pause();clipEnd=null;$('playback-label').hidden=true;}
  if(mode==='edit'&&!video.paused){const cut=mergedCuts(items,source.duration).find(([a,b])=>video.currentTime>=a&&video.currentTime<b);if(cut){if(cut[1]>=source.duration-.01){video.pause();video.currentTime=source.duration;}else video.currentTime=cut[1];}}
});
video.addEventListener('play',()=>{if(source&&mode==='edit'){const cut=mergedCuts(items,source.duration).find(([a,b])=>video.currentTime>=a&&video.currentTime<b);if(cut)video.currentTime=cut[1];}});
video.addEventListener('error',()=>notice('The browser could not play this source. Try an H.264 MP4. The original and decisions are retained.',true));
$('save-decisions').onclick=()=>{if(!source)return;const blob=new Blob([JSON.stringify({version:1,source,brief:{goal:$('goal').value,retain:$('retain').value,preferred_duration:$('preferred').value||null},suggestions:items,history,analysis:'manual; automatic understanding unavailable'},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='local-cut-review-decisions.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notice('Decision record downloaded. It does not contain the video.');};
$('export').onclick=()=>{if(!source||busy)return;const cuts=mergedCuts(items,source.duration).map(([start,end])=>({start,end}));showConfirm('Export this working edit?',`${cuts.length} confirmed cut range(s). Original: ${stamp(source.duration)}. Export: ${stamp(editDuration(items,source.duration))}. Pending and kept intervals will remain.`,'Export MP4',async()=>{busy=true;$('export').disabled=true;const sourceAtExport=source;const payload={source:source.id,source_hash:source.sha256,cuts,confirmed:true};$('export-status').textContent='Rendering the confirmed edit…';notice('Export is running on this computer. The original is unchanged.');try{const data=await api('/api/export',payload);const a=document.createElement('a');a.href=data.url;a.textContent='Download MP4 ('+stamp(data.duration)+')';$('export-status').replaceChildren(a);if(source===sourceAtExport){log('Exported '+stamp(data.duration)+'; original preserved');save();}notice('Export verified and ready to download. Any later decisions require a new export.');}catch(e){$('export-status').textContent=e.message;notice(e.message,true);}finally{busy=false;$('export').disabled=false;}});};
async function init(){try{const setup=await api('/api/bootstrap');token=setup.token;let old;try{old=JSON.parse(localStorage.getItem('lcr:last'));}catch{}if(old?.source){const r=await fetch(old.source.url,{method:'HEAD'});if(r.ok){await openSource(old.source,old);return;}}notice('Import a video to start reviewing.');if(!setup.export_available)$('export-status').textContent='FFmpeg is required to import and export video.';}catch(e){notice(e.message,true);}}
init();
