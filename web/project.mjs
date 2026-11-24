const MIN_INTERVAL = 0.1;

export function validBounds(start, end, duration) {
  return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end <= duration && end - start >= MIN_INTERVAL;
}

export function sourceRanges(duration, cuts) {
  const ordered = cuts.map(({start, end}) => [start, end]).sort((a,b) => a[0] - b[0]);
  const ranges = [];
  let cursor = 0;
  for (const [start, end] of ordered) {
    if (start - cursor >= MIN_INTERVAL - 1e-8) ranges.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (duration - cursor >= MIN_INTERVAL - 1e-8) ranges.push([cursor, duration]);
  return ranges;
}

export function segments(project, draft = true) {
  const active = status => status === 'cut' || (draft && status === 'draft');
  return project.order.flatMap(id => {
    const source = project.sources.find(item => item.id === id);
    if (!source || project.duplicates.some(item => item.source === id && active(item.status))) return [];
    const cuts = project.cuts.filter(item => item.source === id && active(item.status));
    return sourceRanges(source.duration, cuts).map(([start, end]) => ({source: id, sha256: source.sha256, start, end}));
  });
}

export const overlaps = (a, b) => a.source === b.source && Math.min(a.end, b.end) > Math.max(a.start, b.start);

export function removeSource(project, id) {
  project.sources = project.sources.filter(source => source.id !== id);
  project.order = project.order.filter(source => source !== id);
  delete project.reasons[id];
  project.duplicates = project.duplicates.filter(item => item.source !== id && item.match !== id);
  project.cuts = project.cuts.filter(item => item.source !== id).map(item => {
    if (item.comparison?.source !== id) return item;
    return {...item, comparison: null, status: item.status === 'keep' ? 'keep' : 'pending',
      reason: 'The comparison clip was removed. Review this interval again before cutting.'};
  });
  if (project.order.length < 2) project.orderSuggested = false;
  if (!project.sources.length) {
    project.orderLocked = false;
    project.planGoal = '';
    project.model = '';
  }
}

export function applyPlan(project, plan, makeId) {
  const before = project.cuts.filter(item => item.origin !== 'ai' || item.status !== 'draft');
  const proposed = [];
  for (const item of plan.cuts) {
    const source = project.sources.find(candidate => candidate.id === item.source);
    const active = [...before, ...proposed].filter(old => old.source === item.source && ['cut', 'draft'].includes(old.status));
    if (source && !before.some(old => overlaps(item, old)) && !proposed.some(old => overlaps(item, old)) &&
        sourceRanges(source.duration, [...active, item]).length) {
      proposed.push({...item, id: makeId(), origin: 'ai', status: 'draft'});
    }
  }
  project.cuts = [...before, ...proposed];
  const duplicateDecisions = project.duplicates.filter(item => item.status !== 'draft');
  const incoming = plan.duplicates.filter(item => !duplicateDecisions.some(old => old.source === item.source));
  project.duplicates = [...duplicateDecisions, ...incoming.map(item => ({...item, id: makeId(), status: 'draft'}))];
  const proposedOrder = [...plan.order.map(item => item.source), ...plan.duplicates.map(item => item.source)];
  const oldActive = project.order.filter(id => !plan.duplicates.some(item => item.source === id));
  if (!project.orderLocked) {
    project.orderSuggested = oldActive.join(',') !== plan.order.map(item => item.source).join(',');
    project.order = [...new Set([...proposedOrder, ...project.order])];
    project.reasons = Object.fromEntries(plan.order.map(item => [item.source, item.reason]));
  }
  project.planGoal = plan.goal;
  project.model = plan.model;
}
