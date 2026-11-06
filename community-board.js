const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const newId = () => `${Date.now()}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
const recent = o => Object.entries(o || {}).filter(([,v])=>v&&typeof v==='object').sort((a,b)=>String(b[1].createdAt||'').localeCompare(String(a[1].createdAt||'')) || b[0].localeCompare(a[0]));
const time = value => { try { return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Oslo'}).format(new Date(value)); } catch { return ''; } };
export function poolRankings(matches,drivers) {
  const people=new Map(drivers.filter(p=>p.id!=='guest').map(p=>[p.id,{id:p.id,name:p.name,games:0,wins:0,streak:0,best:0,winPct:0}]));
  for(const [,m] of recent(matches).reverse()){
    const w=people.get(m.winnerId),l=people.get(m.loserId);
    if(m.winnerId===m.loserId||(!w&&m.winnerId!=='guest')||(!l&&m.loserId!=='guest')) continue;
    if(w){
      w.games++;w.wins++;w.streak++;w.best=Math.max(w.best,w.streak);
    }
    if(l){
      l.games++;l.streak=0;
    }
  }
  return [...people.values()].filter(p=>p.games).map(p=>({...p,winPct:100*p.wins/p.games})).sort((a,b)=>b.winPct-a.winPct||b.wins-a.wins||b.games-a.games||a.name.localeCompare(b.name)).slice(0,5);
}
export function initCommunityBoard({backend,drivers,toast}) {
  const announcements=document.querySelector('#announcements'),pool=document.querySelector('#pool-board');
  if(!announcements||!pool)return;
  const employees=drivers.filter(p=>p.id!=='guest');
  const poolPlayers=new Map(employees.map(p=>[p.id,p.name]));
  poolPlayers.set('guest','Guest');
  let notes={},matches={},busy=false,lastRefresh=0,announcementsExpanded=false;
  let poolRevision=0;
  const options=hint=>'<option value="">'+esc(hint)+'</option>'+employees.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join('');
  const say=message=>toast?.(message);
  function renderNotes(){
    const latest=recent(notes).slice(0,3);
    announcements.innerHTML='<div class="community-head"><h2>Announcements</h2><button type="button" class="announcements-toggle" aria-controls="announcements-extra" aria-expanded="'+announcementsExpanded+'">'+(announcementsExpanded?'Hide ▲':'View / Add ▼')+'</button></div><div class="community-notes">'+
    (latest.length?latest.slice(0,1).map(([,n],i)=>i===0?'<article class="announcement-full"><strong>'+esc(n.title)+'</strong><p>'+esc(n.body)+'</p><small>'+esc(n.authorName)+' · '+esc(time(n.createdAt))+'</small></article>':'<details class="announcement-compact"><summary>'+esc(n.title)+'<span>'+esc(n.authorName)+'</span></summary><p>'+esc(n.body)+'</p><small>'+esc(time(n.createdAt))+'</small></details>').join('') :'<p class="community-empty">No announcements yet.</p>')+
    '</div><div id="announcements-extra" '+(announcementsExpanded?'':'hidden')+'><div class="community-notes">'+latest.slice(1).map(([,n])=>'<details class="announcement-compact"><summary>'+esc(n.title)+'<span>'+esc(n.authorName)+'</span></summary><p>'+esc(n.body)+'</p><small>'+esc(time(n.createdAt))+'</small></details>').join('')+'</div><form id="announcement-form" class="community-form"><input name="title" maxlength="90" placeholder="Announcement title" required aria-label="Announcement title"><textarea name="body" maxlength="1500" placeholder="Information, note or reminder…" rows="2" required aria-label="Announcement text"></textarea><div class="community-form-actions"><select name="author" required aria-label="Your name">'+options('Select your name')+'</select><button type="submit">Publish</button></div></form></div>';
    announcements.querySelector('.announcements-toggle').addEventListener('click',()=>{announcementsExpanded=!announcementsExpanded;const extra=announcements.querySelector('#announcements-extra');extra.hidden=!announcementsExpanded;const button=announcements.querySelector('.announcements-toggle');button.textContent=announcementsExpanded?'Hide ▲':'View / Add ▼';button.setAttribute('aria-expanded',String(announcementsExpanded));});
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
    const latest=recent(matches).slice(0,3);
    const poolForm=(match,id)=>`<form class="pool-form"${match?'':' id="pool-result-form"'}>
      ${['winner','loser'].map(role=>{
        const label=role==='winner'?'Winner':'Loser';
        const selected=match?.[role+'Id'];
        return `<label>${label}<select name="${role}" required><option value="">Select ${role}</option>
          ${[...poolPlayers].map(([value,name])=>`<option value="${esc(value)}"${value===selected?' selected':''}>${esc(name)}</option>`).join('')}
        </select></label>`;
      }).join('')}
      <div class="pool-form-actions">
        <button type="submit">${match?'Save changes':'Record match'}</button>
        ${match?`<button type="button" data-delete-match="${esc(id)}">Delete match</button>`:''}
      </div>
    </form>`;
    pool.innerHTML='<div class="community-head"><h2>Pool Leaderboard</h2><span>Top 5 by win %</span></div>'+poolForm()+'<div class="pool-table-wrap"><table class="pool-table"><thead><tr><th>Player</th><th>Games</th><th>Win %</th><th>Current streak</th><th>Best streak</th></tr></thead><tbody>'+
    (ranked.length?ranked.map((p,i)=>'<tr><td><b>'+(i+1)+'. '+esc(p.name)+'</b></td><td>'+p.games+'</td><td>'+p.winPct.toFixed(1)+'%</td><td>'+p.streak+'</td><td>'+p.best+'</td></tr>').join(''):'<tr><td colspan="5" class="community-empty">No pool matches recorded yet.</td></tr>')+'</tbody></table></div>';
    pool.insertAdjacentHTML('beforeend',`<section class="pool-recent"><h3>Recent matches</h3>
      ${latest.map(([id,match])=>`<details class="pool-match">
        <summary><span><strong>${esc(poolPlayers.get(match.winnerId) ?? match.winnerId)}</strong>
          beat ${esc(poolPlayers.get(match.loserId) ?? match.loserId)}</span>
          <time datetime="${esc(match.createdAt)}">${esc(time(match.createdAt))}</time>
          <span class="pool-edit-arrow" aria-label="Edit match">▾</span>
        </summary>${poolForm(match,id)}
      </details>`).join('') || '<p class="community-empty">No recent matches.</p>'}
    </section>`);

    pool.querySelectorAll('form').forEach((form,index)=>{
      const [id,match]=latest[index-1] ?? [];
      form.addEventListener('submit',event=>{
        event.preventDefault();
        const winnerId=form.elements.namedItem('winner').value;
        const loserId=form.elements.namedItem('loser').value;
        if(winnerId===loserId||!poolPlayers.has(winnerId)||!poolPlayers.has(loserId)){
          say('Choose two different players, including at least one member');
          return;
        }
        savePoolMatch(form,id ?? newId(),{
          ...match,winnerId,loserId,createdAt:match?.createdAt ?? new Date().toISOString()
        },match?'updated':'recorded');
      });
      form.querySelector('[data-delete-match]')?.addEventListener('click',()=>{
        if(!busy && window.confirm('Delete this pool match?')){
          savePoolMatch(form,id,null,'deleted');
        }
      });
    });
  }
  async function savePoolMatch(form,id,entry,action){
    if(busy)return;
    busy=true;
    const buttons=form.querySelectorAll('button');
    buttons.forEach(button=>{button.disabled=true;});
    try{
      await backend.setPoolMatch(id,entry);
      poolRevision++;
      if(entry)matches[id]=entry;
      else delete matches[id];
      renderPool();
      say('Pool match '+action);
    }catch(error){
      console.error(error);
      say('Could not save pool match changes');
    }finally{
      busy=false;
      buttons.forEach(button=>{button.disabled=false;});
    }
  }
  async function refresh(){
    if(busy||document.visibilityState==='hidden'||Date.now()-lastRefresh<60000)return;
    lastRefresh=Date.now();
    const revision=poolRevision;
    try{
      const [n,m]=await Promise.all([backend.getAnnouncements(),backend.getPoolMatches()]);
      if(busy)return;
      notes=n;
      renderNotes();
      if(revision===poolRevision&&!pool.querySelector('details[open]')&&!pool.contains(document.activeElement)){
        matches=m;
        renderPool();
      }
    }
    catch(error){console.warn('Community board refresh failed',error);lastRefresh=0;}
  }
  renderNotes();renderPool();refresh();
  const interval=setInterval(refresh,120000);
  window.addEventListener('online',()=>{lastRefresh=0;refresh();});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){lastRefresh=0;refresh();}});
  return ()=>clearInterval(interval);
}
