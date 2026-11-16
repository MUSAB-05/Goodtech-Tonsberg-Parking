import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { ScheduleView } from '../schedule-view.js';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const renderSource=source.slice(source.indexOf('function renderEventCountdown()'),source.indexOf('async function refreshPaydayEvents'));
function eventFor(today,payday){
 const element={}; const context={state:{today},$:()=>element,confirmedPaydayDates:()=>payday?[payday]:[],
 holidayCandidates:()=>[{name:'Christmas',icon:'',date:'2026-12-24'}],daysUntil:(a,b)=>(Date.parse(b)-Date.parse(a))/86400000,
 esc:String,formatPaydayDate:x=>x};
 vm.runInNewContext(renderSource+';renderEventCountdown();',context);return element;
}
test('one-off event is upcoming, yields to earlier payday, and expires',()=>{
 assert.match(eventFor('2026-11-16').innerHTML,/Julebord Oslo/);
 assert.match(eventFor('2026-11-16','2026-11-17').innerHTML,/Lønningspils/);
 assert.match(eventFor('2026-11-16','2026-12-10').innerHTML,/Julebord Oslo/);
 assert.match(eventFor('2026-12-04').innerHTML,/Today/);
 assert.match(eventFor('2026-12-05').innerHTML,/Christmas/);
});
test('social votes render separately from parking and keep click handling',()=>{
 const week=['2026-11-16','2026-11-17','2026-11-18','2026-11-19','2026-11-20','2026-11-21','2026-11-22'];
 let listener;const parking={innerHTML:'',querySelectorAll:()=>[]};
 const social={innerHTML:'',querySelectorAll:s=>s==='[data-payday-date]'?[{dataset:{paydayDate:week[1]},addEventListener:(name,fn)=>listener=fn}]:[]};
 const previous=globalThis.document;globalThis.document={querySelector:()=>social};
 let selected;
 try{
 const state={week,today:week[0],selectedDate:week[0],drivers:[],spaces:[],groups:[],bookings:{[week[1]+'__payday-drinks']:{voterIds:['a','b','c']}}};
 new ScheduleView(parking,{state,dayBookings:()=>({}),duplicatesFor:()=>new Map(),openPicker:()=>{},selectDate:()=>{},openRoomDetails:()=>{},openPaydayVotes:d=>selected=d}).render();
 assert.doesNotMatch(parking.innerHTML,/data-payday-date/);
 assert.equal((social.innerHTML.match(/data-payday-date=/g)||[]).length,7);
 assert.match(social.innerHTML,/confirmed/);listener();assert.equal(selected,week[1]);
 }finally{globalThis.document=previous;}
});
