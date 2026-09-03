import test from 'node:test';
import assert from 'node:assert/strict';
import { ParkingBackend } from '../backend-adapter.js';

function response(status,body){return{ok:status>=200&&status<300,status,text:async()=>body==null?'':JSON.stringify(body)}}

test('backend creates missing monthly shard then reads it', async()=>{
  const calls=[]; let created=false;
  const fetchImpl=async(url,options={})=>{const method=options.method||'GET';calls.push({url,method,body:options.body});if(method==='GET'&&!created)return response(404,{error:'missing'});if(method==='POST'){created=true;return response(200,{success:true})}return response(200,{})};
  const backend=new ParkingBackend({baseUrl:'https://example.test/v2',namespace:'parking',fetchImpl});
  assert.deepEqual(await backend.getBookings(['2026-09']),{});
  assert.deepEqual(calls.map(c=>c.method),['GET','POST']);
});

test('backend merges cross-month shards', async()=>{
  const fetchImpl=async url=>response(200,url.endsWith('2026-08')?{'2026-08-31__mg-50':{driverId:'a'}}:{'2026-09-01__mg-51':{driverId:'b'}});
  const backend=new ParkingBackend({baseUrl:'https://example.test/v2',namespace:'parking',fetchImpl});
  const result=await backend.getBookings(['2026-08','2026-09']);
  assert.equal(Object.keys(result).length,2);
});

test('backend patches only matching month and null clears field', async()=>{
  const calls=[];
  const fetchImpl=async(url,options={})=>{calls.push({url,method:options.method||'GET',body:options.body});return response(200,{})};
  const backend=new ParkingBackend({baseUrl:'https://example.test/v2',namespace:'parking',fetchImpl});
  await backend.setBooking('2026-09-03__mg-50',{driverId:'mustafa'});
  await backend.setBooking('2026-09-03__mg-50',null);
  const patch=calls.filter(c=>c.method==='PATCH');
  assert.equal(patch.length,2);
  assert.match(patch[0].url,/bookings\/2026-09$/);
  assert.deepEqual(JSON.parse(patch[1].body),{'2026-09-03__mg-50':null});
});
