// Deterministic review policy; this module does not analyse video or speech.
export function mergedCuts(items, duration) {
  const values = items.filter(s => s.status === 'cut').map(s => [s.start, s.end]);
  for (const [a,b] of values) if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b > duration || b-a < .1) throw Error('Invalid cut boundary.');
  const out=[];
  for (const [a,b] of values.sort((a,b)=>a[0]-b[0])) {
    if(out.length && a <= out.at(-1)[1]) out.at(-1)[1]=Math.max(b,out.at(-1)[1]); else out.push([a,b]);
  }
  return out;
}
export function editDuration(items,duration) {return duration-mergedCuts(items,duration).reduce((n,[a,b])=>n+b-a,0);}
export function validBounds(start,end,duration) {return Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&end<=duration&&end-start>=.1;}
export function changeBounds(item,start,end,duration) {
  if(!validBounds(start,end,duration))throw Error('Choose an interval of at least 0.1 seconds inside the source.');
  if(item.status==='cut')throw Error('Restore this cut before changing its boundaries.');
  return {...item,start,end,status:'pending'};
}
