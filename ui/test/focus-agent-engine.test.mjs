import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AgentEngine} from '../server/focus/agent-engine.mjs';

test('continuing jobs use Hermes; setup, research and review use the explicit Astra service',async()=>{
 const calls=[],codex={thinkingModes:async()=>({defaultEffort:'high'}),answer:async c=>{calls.push(['codex',c.phase]);return {reply:'done'};}},hermes={answer:async c=>{assert.equal(c.reasoningEffort,'high');calls.push(['hermes',c.phase]);return {reply:'done',execution:{status:'completed'}};}};
 const engine=new AgentEngine(codex,hermes);
 for(const phase of ['clarify','research','actionReview','execute','work'])await engine.answer({phase});
 assert.deepEqual(calls,[['codex','clarify'],['codex','research'],['codex','actionReview'],['hermes','execute'],['hermes','work']]);
});
test('Hermes failure never silently falls back to another execution engine',async()=>{
 const engine=new AgentEngine({thinkingModes:async()=>({defaultEffort:'medium'}),answer:()=>assert.fail('fallback forbidden')},{answer:async()=>{throw new Error('Synthetic Hermes failure');}});
 await assert.rejects(engine.answer({phase:'execute'}),/Synthetic Hermes failure/);
});
test('research tool steps remain in the checked app loop',async()=>{
 let calls=0,steps=0;
 const engine=new AgentEngine({answer:async()=>++calls===1?{action:{tool:'memory.search',arguments:{query:'synthetic'}}}:{reply:'done'}},{});
 assert.deepEqual(await engine.answer({phase:'research',toolResults:[]},null,()=>{},async action=>{steps++;assert.equal(action.tool,'memory.search');return {result:'found'};}),{reply:'done'});
 assert.equal(steps,1);assert.equal(engine.runsTools,true);
});
test('handoff review is isolated from Hermes and cannot execute returned actions',async()=>{
 let actions=0;const result={action:{tool:'browser.click',arguments:{}}};
 const engine=new AgentEngine({answer:async c=>{assert.equal(c.phase,'inputReview');return result;}},{answer:()=>assert.fail('review must not use job memory')});
 assert.deepEqual(await engine.answer({phase:'inputReview'},null,()=>{},()=>actions++),result);
 assert.equal(actions,0);
});
