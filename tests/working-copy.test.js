"use strict";
const assert=require('node:assert/strict');
const test=require('node:test');
const {create}=require('../web/working-copy');
function setup(overrides={}) {
  let time=0,id=0;const timers=new Map(),events=[];
  const scheduler=create({now:()=>time,setTimeout:(fn,delay)=>{timers.set(++id,{fn,at:time+delay});return id;},
    clearTimeout:key=>timers.delete(key),persist:s=>events.push({at:time,value:s.value}),
    discard:()=>events.push({at:time,discard:true}),...overrides});
  async function settle(){for(let n=0;n<8;n++)await Promise.resolve();}
  async function advance(to){
    await settle();
    while(true){const next=[...timers].filter(([,v])=>v.at<=to).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!next)break;time=next[1].at;timers.delete(next[0]);next[1].fn();await settle();}
    time=to;await settle();
  }
  return {scheduler,events,advance,snapshot:(value,context=1)=>({editor:'editor',context,savedSource:'saved',value})};
}
test('idle edits coalesce but continuous input cannot postpone the first checkpoint',async()=>{
  const q=setup();q.scheduler.schedule(q.snapshot('first'));await q.advance(1000);
  q.scheduler.schedule(q.snapshot('latest'));await q.advance(2999);assert.deepEqual(q.events,[]);
  await q.advance(3000);assert.deepEqual(q.events,[{at:3000,value:'latest'}]);
  q.scheduler.schedule(q.snapshot('continuous0'));
  for(let t=4000;t<=7000;t+=1000){await q.advance(t);q.scheduler.schedule(q.snapshot('continuous'+t));}
  await q.advance(8000);assert.deepEqual(q.events.at(-1),{at:8000,value:'continuous7000'});
});
test('a slow write serializes later edits and preserves their original deadline',async()=>{
  let resolve;const calls=[];const q=setup({persist:s=>{calls.push(s.value);return calls.length===1?new Promise(r=>{resolve=r;}):undefined;}});
  q.scheduler.schedule(q.snapshot('first'));await q.advance(2000);assert.deepEqual(calls,['first']);
  q.scheduler.schedule(q.snapshot('second'));await q.advance(6500);q.scheduler.schedule(q.snapshot('newest'));
  assert.deepEqual(calls,['first']);resolve();await q.advance(7000);
  assert.deepEqual(calls,['first','newest']);
});
test('returning to saved content removes a copy only after an in-flight write',async()=>{
  let resolve;const calls=[];const q=setup({persist:()=>{calls.push('write');return new Promise(r=>{resolve=r;});},discard:()=>calls.push('discard')});
  q.scheduler.schedule(q.snapshot('dirty'));await q.advance(2000);
  q.scheduler.schedule(q.snapshot('saved'));await q.advance(3000);assert.deepEqual(calls,['write']);
  resolve();await q.advance(3001);assert.deepEqual(calls,['write','discard']);
});
test('cancelled contexts cannot write or report stale failures',async()=>{
  let reject;const errors=[];const q=setup({persist:()=>new Promise((_,r)=>{reject=r;}),onError:e=>errors.push(e)});
  q.scheduler.schedule(q.snapshot('old'));await q.advance(2000);q.scheduler.cancel();
  reject(new Error('old context'));await q.advance(2001);assert.deepEqual(errors,[]);
  q.scheduler.schedule(q.snapshot('not written',2));q.scheduler.cancel();await q.advance(9000);
  assert.deepEqual(q.events,[]);
});
