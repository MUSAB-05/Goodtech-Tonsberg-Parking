const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const newId = () => `${Date.now()}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
const recent = o => Object.entries(o || {}).filter(([,v])=>v&&typeof v==='object').sort((a,b)=>String(b[1].createdAt||'').localeCompare(String(a[1].createdAt||'')) || b[0].localeCompare(a[0]));
const time = value => { try { return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Oslo'}).format(new Date(value)); } catch { return ''; } };
export function poolRankings(matches,drivers) {
  const people=new Map(drivers.filter(p=>p.id!=='guest').map(p=>[p.id,{id:p.id,name:p.name,games:0,wins:0,streak:0,best:0,winPct:0}]));
  for(const [,m] of recent(matches).reverse()){
    if(!people.has(m.winnerId)||!people.has(m.loserId)||m.winnerId===m.loserId) continue;
    const w=people.get(m.winnerId),l=people.get(m.loserId);
    w.games++;w.wins++;w.streak++;w.best=Math.max(w.best,w.streak);
    l.games++;l.streak=0;
  }
  return [...people.values()].filter(p=>p.games).map(p=>({...p,winPct:100*p.wins/p.games})).sort((a,b)=>b.winPct-a.winPct||b.wins-a.wins||b.games-a.games||a.name.localeCompare(b.name)).slice(0,5);
}
export function initCommunityBoard({backend,drivers,toast}) {
  const announcements=document.querySelector('#announcements'),pool=document.querySelector('#pool-board');
  if(!announcements||!pool)return;
  const employees=drivers.filter(p=>p.id!=='guest');
  let notes={},matches={},busy=false,lastRefresh=0;
  const options=hint=>'<option value="">'+esc(hint)+'</option>'+employees.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join('');
  const say=message=>toast?.(message);
  function renderNotes(){
    const latest=recent(notes).slice(0,3);
    announcements.innerHTML='<div class="community-head"><h2>Announcements</h2><span>Latest 3</span></div><div class="community-notes">'+
    (latest.length?latest.map(([,n],i)=>i===0?'<article class="announcement-full"><strong>'+esc(n.title)+'</strong><p>'+esc(n.body)+'</p><small>'+esc(n.authorName)+' · '+esc(time(n.createdAt))+'</small></article>':'<details class="announcement-compact"><summary>'+esc(n.title)+'<span>'+esc(n.authorName)+'</span></summary><p>'+esc(n.body)+'</p><small>'+esc(time(n.createdAt))+'</small></details>').join(''):'<p class="community-empty">No announcements yet.</p>')+
    '</div><form id="announcement-form" class="community-form"><input name="title" maxlength="90" placeholder="Announcement title" required aria-label="Announcement title"><textarea name="body" maxlength="1500" placeholder="Information, note or reminder…" rows="2" required aria-label="Announcement text"></textarea><div class="community-form-actions"><select name="author" required aria-label="Your name">'+options('Select your name')+'</select><button type="submit">Publish</button></div></form>';
    announcements.querySelector('form').addEventListener('submit',async e=>{
      e.preventDefault();if(busy)return;
      const f=e.currentTarget,data=new FormData(f),author=employees.find(p=>p.id===data.get('author'));
      const title=String(data.get('title')||'').trim(),body=String(data.get('body')||'').trim();
      if(!author||!title||!body)return;
      const id=newId(),entry={title:title.slice(0,90),body:body.slice(0,1500),authorId:author.id,authorName:author.name,createdAt:new Date().toISOString()};
      busy=true;f.querySelector('button').disabled=true;
      try{await backend.addAnnouncement(id,entry);notes[id]=entry;renderNotes();say('Announcement published');}
      catch(error){console.error(error);say('Could not publish announcement');}
      finally{busy=false;}
    });
  }
  function renderPool(){
    const ranked=poolRankings(matches,employees);
    pool.innerHTML='<div class="community-head"><h2>Pool Leaderboard</h2><span>Top 5 by win %</span></div><form id="pool-result-form" class="pool-form"><label>Winner<select name="winner" required>'+options('Select winner')+'</select></label><label>Loser<select name="loser" required>'+options('Select loser')+'</select></label><button type="submit">Record match</button></form><div class="pool-table-wrap"><table class="pool-table"><thead><tr><th>Player</th><th>Games</th><th>Win %</th><th>Current streak</th><th>Best streak</th></tr></thead><tbody>'+
    (ranked.length?ranked.map((p,i)=>'<tr><td><b>'+(i+1)+'. '+esc(p.name)+'</b></td><td>'+p.games+'</td><td>'+p.winPct.toFixed(1)+'%</td><td>'+p.streak+'</td><td>'+p.best+'</td></tr>').join(''):'<tr><td colspan="5" class="community-empty">No pool matches recorded yet.</td></tr>')+'</tbody></table></div>';
    const f=pool.querySelector('form');
    f.addEventListener('submit',async e=>{
      e.preventDefault();if(busy)return;
      const w=f.elements.namedItem('winner').value,l=f.elements.namedItem('loser').value;
      if(!w||!l||w===l||!employees.some(p=>p.id===w)||!employees.some(p=>p.id===l)){say('Choose two different players');return;}
      const id=newId(),entry={winnerId:w,loserId:l,createdAt:new Date().toISOString()};
      busy=true;f.querySelector('button').disabled=true;
      try{await backend.addPoolMatch(id,entry);matches[id]=entry;renderPool();say('Pool match recorded');}
      catch(error){console.error(error);say('Could not record pool match');}
      finally{busy=false;}
    });
  }
  async function refresh(){
    if(busy||document.visibilityState==='hidden'||Date.now()-lastRefresh<60000)return;
    lastRefresh=Date.now();
    try{const [n,m]=await Promise.all([backend.getAnnouncements(),backend.getPoolMatches()]);notes=n;matches=m;renderNotes();renderPool();}
    catch(error){console.warn('Community board refresh failed',error);lastRefresh=0;}
  }
  renderNotes();renderPool();refresh();
  const interval=setInterval(refresh,120000);
  window.addEventListener('online',()=>{lastRefresh=0;refresh();});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){lastRefresh=0;refresh();}});
  return ()=>clearInterval(interval);
}
