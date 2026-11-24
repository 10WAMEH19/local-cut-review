import {applyPlan, overlaps, removeSource, segments, sourceRanges, validBounds} from '/project.mjs';

const $ = id => document.getElementById(id);
const video = $('video');
const KEY = 'lcr:project-v2';
const isSourceId = id => /^[a-f0-9]{32}$/.test(id);
const uid = () => crypto.randomUUID();
const blank = () => ({sources: [], order: [], cuts: [], duplicates: [], reasons: {}, goal: '',
  preserve: '', orderSuggested: false, orderLocked: false, planGoal: '', model: '', revision: 0});
let project = blank();
let token = '', aiReady = false, maxUpload = 0, busy = false, view = 'source';
let selected = null, draft = null, contextEnd = null, afterConfirm = null;
let playerChange = 0;
const states = new Map();
const stamp = value => {
  const tenths = Math.round(value * 10);
  return `${String(Math.floor(tenths / 600)).padStart(2, '0')}:${String(Math.floor(tenths / 10) % 60).padStart(2, '0')}.${tenths % 10}`;
};
const byId = id => project.sources.find(source => source.id === id);
const selectedSource = () => byId(selected);
const unresolved = () => project.orderSuggested || [...project.cuts, ...project.duplicates].some(item => item.status === 'draft');

function notice(value, error = false) {
  $('notice').textContent = value;
  $('notice').classList.toggle('error', error);
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({...project, selected}));
    $('save-state').textContent = 'Saved on this Mac';
  } catch {
    $('save-state').textContent = 'Saving unavailable';
  }
}

function changed() {
  project.revision++;
  draft = null;
  if (view === 'draft') playSource(selected);
  render();
  save();
}

async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : {
    method: 'POST', headers: {'Content-Type': 'application/json', 'X-App-Token': token}, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'The local request failed.');
  return result;
}

async function finishJob(start, progress) {
  if (!start.job) return start;
  while (true) {
    const job = await api('/api/jobs/' + start.job);
    progress(job.message);
    if (job.state === 'failed') throw Error(job.message);
    if (job.state === 'ready') return job.result;
    await new Promise(resolve => setTimeout(resolve, 700));
  }
}

function el(tag, text, css = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  if (css) node.className = css;
  return node;
}

function button(label, callback, css = '') {
  const node = el('button', label, css);
  node.type = 'button';
  node.onclick = callback;
  return node;
}

function confirm(title, message, label, action) {
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = message;
  $('confirm-yes').textContent = label;
  afterConfirm = action;
  video.pause();
  $('confirm').returnValue = '';
  $('confirm').showModal();
}

$('confirm').addEventListener('close', () => {
  const action = afterConfirm;
  afterConfirm = null;
  if ($('confirm').returnValue === 'confirm') action?.();
});

function modeUi() {
  for (const [id, active] of [['source-mode', view === 'source'], ['draft-mode', view === 'draft']]) {
    $(id).setAttribute('aria-pressed', String(active));
    $(id).classList.toggle('selected', active);
  }
  $('source-name').textContent = view === 'draft' ? 'Rough cut' : selectedSource()?.name || 'Preview';
  $('mode-note').textContent = view === 'draft' ? 'Combined playback' : 'Lightweight preview';
  $('player-empty').hidden = !!video.getAttribute('src');
  $('manual').hidden = view !== 'source' || !selectedSource()?.preview_ready;
  const track = $('sequence-track');
  track.replaceChildren();
  track.hidden = view !== 'draft' || !draft?.timeline.length;
  if (!track.hidden) draft.timeline.forEach((row, index) => {
    const marker = button(String(index + 1), () => { video.currentTime = row.offset; });
    marker.style.flexGrow = String(row.duration);
    marker.setAttribute('aria-label', `${byId(row.source).name} at ${stamp(row.offset)} in the rough cut`);
    track.append(marker);
  });
}

function setPlayer(url, portrait, start = 0, end = null, autoplay = false) {
  const revision = ++playerChange;
  contextEnd = end;
  video.dataset.portrait = String(portrait);
  const position = () => {
    if (revision !== playerChange) return;
    video.currentTime = start;
    if (autoplay) video.play().catch(() => notice('Press Play to review the selected interval.'));
  };
  if (!url) {
    video.removeAttribute('src');
    video.load();
  } else if (video.getAttribute('src') !== url) {
    video.src = url;
    video.addEventListener('loadedmetadata', position, {once: true});
  } else if (video.readyState) {
    position();
  } else {
    video.addEventListener('loadedmetadata', position, {once: true});
  }
  modeUi();
}

function playSource(id, start = 0, end = null, autoplay = false) {
  selected = byId(id)?.id ?? project.sources[0]?.id ?? null;
  const source = selectedSource();
  view = 'source';
  video.pause();
  const message = source ? (states.get(source.id)?.error ? 'Preview preparation failed' : 'Preparing source preview…') : 'Import a video to begin';
  $('player-empty').textContent = message;
  video.poster = '';
  setPlayer(source?.preview_ready ? source.preview_url : '', source?.height > source?.width, start, end, autoplay);
  render();
  save();
}

function withContext(item) {
  const source = byId(item.source);
  playSource(item.source, Math.max(0, item.start - 2), Math.min(source.duration, item.end + 2), true);
}

function requestRemoval(source) {
  confirm('Remove this video from the project?',
    `${source.name} and its cuts will be removed from this timeline. The video file stays on your Mac.`,
    'Remove from project', () => {
      const replacePlayer = view === 'source' && selected === source.id;
      removeSource(project, source.id);
      states.delete(source.id);
      if (selected === source.id) selected = project.order[0] ?? null;
      $('export-status').replaceChildren();
      changed();
      if (replacePlayer) playSource(selected);
      notice(`${source.name} removed from this project.`);
    });
}

function move(id, destination) {
  const from = project.order.indexOf(id);
  if (from < 0 || destination < 0 || destination >= project.order.length || from === destination) return;
  project.order.splice(from, 1);
  project.order.splice(destination, 0, id);
  project.orderLocked = true;
  project.orderSuggested = false;
  delete project.reasons[id];
  changed();
}

function changeCut(item, status) {
  const sameClip = project.cuts.filter(cut => cut.source === item.source &&
    ((cut.status === 'cut' || cut.status === 'draft') && cut !== item || cut === item && status === 'cut'));
  if (status === 'cut' && !sourceRanges(byId(item.source).duration, sameClip).length) {
    notice('Keep at least 0.1 seconds of this source. Adjust a cut boundary.', true);
    return;
  }
  item.status = status;
  changed();
  notice(status === 'keep' ? 'Interval kept. Refresh the rough-cut preview to hear and see it.' : 'Cut confirmed.');
}

function cardFor(item) {
  const card = el('article', '', 'suggestion ' + item.status);
  const labels = {draft: 'Proposed in rough cut', cut: 'Confirmed cut', keep: 'Kept', pending: 'Manual proposal'};
  const source = byId(item.source);
  const bounds = `${stamp(item.start)}–${stamp(item.end)}`;
  card.append(el('div', `${source.name} · ${bounds}`, 'time'), el('div', labels[item.status], 'status'),
    el('h3', item.title || (item.kind === 'repeat' ? 'Repeated content' : 'Possible unrelated content')),
    el('p', item.reason));
  if (item.observation) card.append(el('p', item.observation, 'evidence'));
  const actions = el('div', '', 'actions');
  actions.append(button('Watch with context', () => withContext(item)));
  if (item.comparison && byId(item.comparison.source)) {
    const comparison = item.comparison;
    card.append(el('p', `Compare ${byId(comparison.source).name} · ${stamp(comparison.start)}–${stamp(comparison.end)}`, 'evidence'));
    actions.append(button('Watch comparison', () => withContext(comparison)));
  }
  if (item.status === 'cut') actions.append(button('Restore', () => changeCut(item, 'keep'), 'primary'));
  else if (item.status === 'keep') actions.append(button('Review again', () => changeCut(item, 'pending')));
  else actions.append(button('Confirm cut', () => changeCut(item, 'cut'), 'primary'), button('Keep interval', () => changeCut(item, 'keep')));
  card.append(actions);
  if (item.status !== 'cut') {
    const details = document.createElement('details'), fields = el('div', '', 'bounds');
    details.append(el('summary', 'Adjust cut boundaries'));
    const inputs = ['Start', 'End'].map((label, index) => {
      const wrapper = el('label', label + ' (seconds)'), input = document.createElement('input');
      input.type = 'number'; input.min = '0'; input.max = source.duration; input.step = '0.01';
      input.value = index ? item.end : item.start;
      wrapper.append(input); fields.append(wrapper);
      return input;
    });
    details.append(fields, button('Save boundaries', () => {
      const [start, end] = inputs.map(input => input.valueAsNumber);
      if (!validBounds(start, end, source.duration)) return notice('Enter a valid range of at least 0.1 seconds.', true);
      if (project.cuts.some(other => other !== item && other.status === 'keep' && overlaps({...item, start, end}, other))) {
        return notice('This range overlaps a segment marked Keep. Review that decision first.', true);
      }
      Object.assign(item, {start, end, status: 'pending'});
      changed();
    }));
    card.append(details);
  }
  return card;
}

function render() {
  const sourceList = $('sources');
  sourceList.replaceChildren();
  for (const source of project.sources) {
    const li = document.createElement('li');
    const row = el('div', '', 'source-row');
    const btn = button(source.name, () => playSource(source.id), 'source-item');
    btn.setAttribute('aria-pressed', String(selected === source.id));
    const resolution = source.width && source.height ? `${source.width} × ${source.height}` : '';
    const status = states.get(source.id);
    const rate = source.fps ? `${Math.round(source.fps)} fps source` : '';
    btn.append(el('small', [stamp(source.duration), resolution, rate, source.preview_ready ? 'Preview ready' : status?.message || 'Preparing preview'].filter(Boolean).join(' · ')));
    const remove = button('Remove', () => requestRemoval(source), 'remove-source');
    remove.setAttribute('aria-label', `Remove ${source.name} from project`);
    remove.disabled = busy;
    row.append(btn, remove);
    li.append(row);
    if (status?.error) li.append(button('Retry preview', () => prepare(source)));
    sourceList.append(li);
  }
  const sequence = $('timeline');
  sequence.replaceChildren();
  project.order.forEach((id, index) => {
    const source = byId(id), row = document.createElement('li');
    const duplicate = project.duplicates.find(item => item.source === id && ['draft', 'cut'].includes(item.status));
    if (duplicate) row.classList.add('omitted');
    const description = el('div', '');
    description.append(el('strong', `${index + 1}. ${source.name}`),
      el('small', duplicate ? 'Alternate copy omitted from the rough cut' : project.reasons[id] || 'In current order'));
    const actions = el('div', '', 'timeline-controls');
    const up = button('↑', () => move(id, index - 1)), down = button('↓', () => move(id, index + 1));
    up.disabled = index === 0 || busy; down.disabled = index === project.order.length - 1 || busy;
    up.setAttribute('aria-label', 'Move ' + source.name + ' earlier');
    down.setAttribute('aria-label', 'Move ' + source.name + ' later');
    actions.append(up, down);
    row.append(description, actions);
    row.draggable = !busy;
    row.ondragstart = event => event.dataTransfer.setData('text/plain', id);
    row.ondragover = event => { if (!busy) event.preventDefault(); };
    row.ondrop = event => { event.preventDefault(); if (!busy) move(event.dataTransfer.getData('text/plain'), index); };
    sequence.append(row);
  });
  const review = $('suggestions');
  review.replaceChildren();
  for (const item of project.duplicates) {
    const card = el('article', '', 'suggestion ' + item.status);
    card.append(el('div', byId(item.source).name, 'time'), el('h3', 'Alternate copy'),
      el('p', `${item.reason} The rough cut uses ${byId(item.match).name}.`));
    const actions = el('div', '', 'actions');
    actions.append(button('Preview copy', () => playSource(item.source)));
    if (item.status === 'keep') actions.append(button('Omit copy', () => { item.status = 'draft'; changed(); }));
    else actions.append(button('Include copy', () => { item.status = 'keep'; changed(); }));
    card.append(actions); review.append(card);
  }
  for (const item of project.cuts) review.append(cardFor(item));
  if (!project.cuts.length && !project.duplicates.length) {
    review.append(el('div', project.model ? 'No cuts proposed for this footage.' : 'Editing suggestions will appear here.', 'empty'));
  }
  const list = segments(project);
  const n = [...project.cuts, ...project.duplicates].filter(item => ['draft', 'pending'].includes(item.status)).length;
  $('pending-count').textContent = n + ' to review';
  $('approve').hidden = !unresolved();
  $('approve').disabled = busy;
  $('plan-goal').textContent = project.planGoal ? `Editing goal: ${project.planGoal}` : '';
  $('edit-duration').textContent = list.length ? 'Rough cut · ' + stamp(list.reduce((sum, row) => sum + row.end - row.start, 0)) : '';
  $('analysis-status').textContent = project.model ? `Analyzed on this Mac · ${project.model}` : aiReady ? 'Local picture and speech analysis' : 'Local AI models are not ready. Refresh after setup.';
  $('suggest').disabled = busy || !project.sources.length || !aiReady || project.sources.some(source => !source.preview_ready);
  $('draft-mode').disabled = busy || !list.length || project.sources.some(source => !source.preview_ready);
  $('draft-mode').textContent = draft?.revision === project.revision ? 'Rough cut' : 'Build rough-cut preview';
  $('source-mode').disabled = !selected;
  $('export').disabled = busy || !list.length;
  $('import').disabled = $('new-project').disabled = busy;
  $('save-decisions').disabled = !project.sources.length;
  modeUi();
}

async function prepare(source) {
  if (source.preview_ready) return;
  states.set(source.id, {message: 'Queued for preview'});
  render();
  try {
    const result = await finishJob(await api('/api/prepare', {source: source.id}), message => {
      const normalized = message.startsWith('Waiting') ? 'Queued for preview' : 'Preparing preview';
      if (states.get(source.id)?.message !== normalized && byId(source.id) === source) {
        states.set(source.id, {message: normalized});
        render();
      }
    });
    if (byId(source.id) !== source) return;
    Object.assign(source, result.source);
    states.delete(source.id);
    if (selected === source.id && view === 'source' && !video.getAttribute('src')) playSource(source.id);
  } catch (error) {
    if (byId(source.id) !== source) return;
    states.set(source.id, {message: 'Preview failed', error: true});
    notice(error.message, true);
  } finally { render(); save(); }
}

async function buildPreview() {
  if (busy) return;
  if (draft?.revision === project.revision) {
    view = 'draft';
    video.pause(); video.poster = '';
    setPlayer(draft.url, draft.height > draft.width);
    return;
  }
  const revision = project.revision;
  busy = true;
  render();
  notice('Building continuous rough-cut playback…');
  try {
    const result = await finishJob(await api('/api/sequence-preview', {segments: segments(project)}), notice);
    if (revision !== project.revision) return;
    draft = {...result, revision};
    view = 'draft';
    video.pause(); video.poster = '';
    setPlayer(result.url, result.height > result.width);
    notice(unresolved() ? 'Rough cut ready. Review the order and cuts before confirming.' : 'Rough-cut preview ready.');
  } catch (error) { notice(error.message, true); }
  finally { busy = false; render(); }
}

async function analyze() {
  if (busy) return;
  busy = true;
  render();
  notice('Starting local picture and speech analysis…');
  let success = false;
  try {
    const input = {sources: project.sources.map(({id}) => id), goal: project.goal.trim(), preserve: project.preserve.trim()};
    const result = await finishJob(await api('/api/analyze', input), notice);
    applyPlan(project, result, uid);
    changed();
    success = true;
  } catch (error) { notice(error.message, true); }
  finally { busy = false; render(); }
  if (success) await buildPreview();
}

async function importFiles(files) {
  if (busy || !files.length) return;
  if (project.sources.length + files.length > 20) return notice('Use up to 20 source files in a project.', true);
  busy = true;
  render();
  const imported = [], pending = [], errors = [];
  for (const [index, file] of files.entries()) {
    notice(`Importing ${index + 1} of ${files.length} · ${file.name}`);
    if (!file.size || file.size > maxUpload) { errors.push(`${file.name}: choose a video no larger than 2 GB.`); continue; }
    try {
      const response = await fetch('/api/upload', {method: 'POST', body: file,
        headers: {'X-App-Token': token, 'X-Filename': encodeURIComponent(file.name)}});
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      project.sources.push(result); project.order.push(result.id);
      imported.push(result);
      if (!selected) playSource(result.id);
      else changed();
      pending.push(prepare(result));
    } catch (error) { errors.push(`${file.name}: ${error.message}`); }
  }
  busy = false;
  render();
  save();
  await Promise.all(pending);
  const ready = imported.filter(item => item.preview_ready).length;
  if (ready) notice(`${ready} of ${files.length} new videos ready.${errors.length ? ' ' + errors.join(' ') : ''}`, !!errors.length);
  else if (errors.length) notice(errors.join(' '), true);
}

function reset(refresh = true) {
  project = blank();
  draft = null; selected = null; states.clear();
  $('goal').value = ''; $('retain').value = ''; $('export-status').replaceChildren();
  if (refresh) playSource(null);
}

function switchProject(title, label, action) {
  if (!project.sources.length) { action(); return; }
  confirm(title, 'This replaces the current open timeline. Save its decisions first if you want a record. Your source and export files stay on this Mac.', label, action);
}

$('new-project').onclick = () => switchProject('Start a new project?', 'New project', () => { reset(); notice('Import the videos for your new project.'); });
$('import').onclick = () => $('file').click();
$('file').onchange = event => {
  const files = [...event.target.files];
  event.target.value = '';
  importFiles(files);
};
$('source-mode').onclick = () => playSource(selected);
$('draft-mode').onclick = buildPreview;
$('suggest').onclick = analyze;
for (const [element, key] of [['goal', 'goal'], ['retain', 'preserve']]) $(element).oninput = () => { project[key] = $(element).value; save(); };
$('use-time').onclick = () => {
  const source = selectedSource();
  if (!source) return;
  $('manual-start').value = Math.max(0, Math.min(video.currentTime, source.duration - .1)).toFixed(2);
  $('manual-end').value = Math.min(source.duration, video.currentTime + 2).toFixed(2);
};
$('add-manual').onclick = () => {
  const source = selectedSource(), start = $('manual-start').valueAsNumber, end = $('manual-end').valueAsNumber;
  if (!source || !validBounds(start, end, source.duration)) return notice('Enter a valid range of at least 0.1 seconds.', true);
  project.cuts.push({id: uid(), source: source.id, start, end, title: 'Manual local cut',
    reason: 'Interval marked by you.', status: 'pending', origin: 'manual'});
  changed(); notice('Manual proposal added for review.');
};
$('approve').onclick = () => {
  confirm('Confirm the rough cut?', 'Confirm the current order, proposed cuts and omitted alternate copies. You can still edit or restore them.', 'Confirm rough cut', () => {
    for (const item of [...project.cuts, ...project.duplicates]) if (item.status === 'draft') item.status = 'cut';
    project.orderSuggested = false;
    project.orderLocked = true;
    render(); save(); notice('Rough cut confirmed. You can now export it.');
  });
};
$('export').onclick = () => {
  if (busy) return;
  if (unresolved()) return notice('Confirm the rough cut or review the proposed edits first.', true);
  const rows = segments(project, false), height = Number($('quality').value);
  if (!rows.length) return;
  confirm('Export MP4?', `Render ${rows.length} segments from the source files at ${height === 2160 ? '4K' : height + 'p'}, 30 fps.`, 'Export MP4', async () => {
    busy = true; render(); $('export-status').textContent = 'Rendering from the original video files…';
    try {
      const result = await finishJob(await api('/api/sequence-export', {confirmed: true, segments: rows, height}),
        value => $('export-status').textContent = value);
      const link = el('a', 'Download MP4 · ' + stamp(result.duration)); link.href = result.url;
      $('export-status').replaceChildren(link);
      notice('MP4 export ready.');
    } catch (error) { $('export-status').textContent = error.message; notice(error.message, true); }
    finally { busy = false; render(); }
  });
};
$('save-decisions').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(project, null, 2)], {type: 'application/json'}));
  const link = document.createElement('a'); link.href = url; link.download = 'local-cut-review-project.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
video.addEventListener('timeupdate', () => {
  if (contextEnd !== null && video.currentTime >= contextEnd) { video.pause(); contextEnd = null; }
});
video.addEventListener('error', () => {
  if (video.getAttribute('src')) notice('The browser could not play this preview. Retry the preview or switch sources.', true);
});

async function init() {
  try {
    const setup = await api('/api/bootstrap');
    token = setup.token; maxUpload = setup.max_upload; aiReady = setup.ai_ready;
    let cached;
    try { cached = JSON.parse(localStorage.getItem(KEY)); } catch {}
    if (!cached) {
      let old;
      try { old = JSON.parse(localStorage.getItem('lcr:last')); } catch {}
      if (isSourceId(old?.source?.id)) cached = {...blank(), sources: [old.source], order: [old.source.id],
        cuts: (old.items || []).map(item => ({...item, source: old.source.id, origin: 'manual'})),
        goal: old.goal || '', preserve: old.retain || '', selected: old.source.id};
    }
    if (cached) {
      const recovered = await Promise.allSettled(cached.sources.filter(source => isSourceId(source.id)).map(source => api('/api/source/' + source.id)));
      const sources = recovered.filter(item => item.status === 'fulfilled').map(item => item.value);
      const ids = new Set(sources.map(({id}) => id));
      project = {...blank(), ...cached, sources, order: cached.order.filter(id => ids.has(id)),
        cuts: cached.cuts.filter(item => ids.has(item.source)),
        duplicates: cached.duplicates.filter(item => ids.has(item.source) && ids.has(item.match))};
      selected = ids.has(cached.selected) ? cached.selected : sources[0]?.id || null;
      $('goal').value = project.goal; $('retain').value = project.preserve;
      playSource(selected);
      sources.forEach(prepare);
    }
    render();
    notice(project.sources.length ? 'Local project opened.' : 'Import your videos together to start a rough cut.');
  } catch (error) { notice(error.message, true); }
}

init();
