#!/usr/bin/env node
/** Browser-free contract checks for the actual inline app, using node:vm + a minimal DOM adapter.
 * This does NOT establish layout, browser compatibility, or screen-reader behavior.
 * No packages, browser, network, experiment imports, or measurement output access.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('./ASCON-DASHBOARD.html', import.meta.url), 'utf8');
const blocks = [...html.matchAll(/<script type="application\/json" id="(data-[\w-]+)">\s*([\s\S]*?)\s*<\/script>/g)]
  .map(m => ({id:m[1],textContent:m[2]}));
const code = html.match(/<script id="dashboard-app">([\s\S]*?)<\/script>/)?.[1];
assert.ok(code,'inline renderer exists');
const elements = new Map();
const listeners = new Map();
let lastFocused;
const element = id => {
  if(!elements.has(id))elements.set(id,{
    id,innerHTML:'',textContent:'',hidden:true,attributes:{},dataset:{},
    setAttribute(name,value){this.attributes[name]=value;},
    focus(){lastFocused=id;},scrollIntoView(){},
    querySelector(){return element('popover-close');}
  });
  return elements.get(id);
};
const document = {
  title:'',
  querySelectorAll(selector){assert.equal(selector,'script[type="application/json"]');return blocks;},
  getElementById:element,
  querySelector(selector){return element(selector);},
  addEventListener(type,callback){listeners.set(type,callback);}
};
const location={hash:'#overview'};
const window={addEventListener(type,callback){listeners.set('window:'+type,callback);},scrollTo(){}};
let app;
new vm.Script(code,{filename:'ASCON-DASHBOARD.html:inline'}).runInNewContext({document,window,location,
  __DASHBOARD_TEST__(api){app=api;}},{timeout:3000});
assert.ok(app,'renderer initialized');
assert.equal(element('render-error').innerHTML,'');
assert.equal(element('render-error').hidden,true,'initial render has no error');
const rendered={};
let count=0;
function check(name,fn){fn();count++;}
// Remaining data-specific assertions (intentional historical/content fixtures,
// NOT generalized by this change; their exact literals are listed in each check):
// - overview: Q-ZETA-01; excluded erroneous time 17:40 JST.
// - qualification: 44.56/56.50/48.07/56.43 and failed/blocked/unrun labels.
// - search/glossary/routes/popover: Ollama, FROZEN, 何もしない, term-frozen,
//   term-noop, term-q0, Q0; budget/provider labels 未精算/未確定/Free/Off.
// - dev3a/dev4: historical P/T/trades/submission figures, 9 regimes/18 worlds,
//   incz/completion/cancelled-heartbeat text.
// - rev9 decisions: authority commit, runtime/provider/seed/world facts and text.
// - rev10/mix1: historical live scores/deltas, stop/G0/seed/world facts and text.
// - rev12/rev13: incz values, seed/times/G0/Q0 labels, null completed_at,
//   completed_worlds=12, noop_below=4, q0_eligible=false and accounting metrics.
// Structural contracts (one h1, routes/classes/CSS, AA 4.5, 375px geometry),
// injection/search sentinels and synthetic future date/counts are test fixtures,
// not expected values of the current dashboard data.
// Only the renderer's hidden annotation icon is discarded. Unwrap buttons/tags,
// preserving their visible term text, then decode esc()'s entities (once).
// Decode AFTER stripping tags so escaped literal markup remains visible text.
function visibleText(markup){
  return markup.replace(/<sup\b[^>]*aria-hidden="true"[^>]*>ⓘ<\/sup>/g,'')
    .replace(/<[^>]*>/g,'')
    .replace(/&(amp|lt|gt|quot|#39);/g,(_,entity)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[entity]));
}
const currentRun=()=>app.D.plan.continuous_operation.current_run_ref.split('.').reduce((value,key)=>value[key],app.D);
function assertVisibleFields(markup,record,keys){
  const text=visibleText(markup);
  for(const key of keys){
    assert.ok(typeof record[key]==='string'&&record[key].length>0,`nonempty data field: ${key}`);
    // rich() gives internal decision/log IDs these human-readable labels.
    const expected=record[key].replace(/dec-007/g,'提出前の本人確認').replace(/dec-008/g,'初回の鍵登録確認').replace(/log-\d+/g,'過去の記録');
    assert.ok(text.includes(expected),`visible data field: ${key}`);
  }
}
const headlinePattern=/(<div class="summary-strip"><h2>)([\s\S]*?)(<\/h2>)/;
function assertHeadline(markup){
  const heading=markup.match(headlinePattern);
  assert.ok(heading,'overview headline element exists');
  assert.equal(visibleText(heading[2]),app.D.status.headline,'overview headline matches JSON');
}
function assertPriorityProgress(markup){
  const refs=app.D.status.priority.progress_refs;
  assert.ok(refs.length>0,'priority has progress references');
  const items=refs.map(id=>{
    const matches=app.D.progress.items.filter(item=>item.id===id);
    assert.equal(matches.length,1,`unique progress reference: ${id}`);
    return matches[0];
  });
  const bars=[...markup.matchAll(/<progress\b[^>]*>/g)];
  assert.equal(bars.length,1,'overview has one priority progress bar');
  const attr=name=>{
    const match=bars[0][0].match(new RegExp(`\\b${name}="(\\d+)"`));
    assert.ok(match,`progress ${name} is a nonnegative integer`);
    return Number(match[1]);
  };
  assert.equal(attr('value'),items.filter(item=>item.state==='done').length,'priority progress value matches done references');
  assert.equal(attr('max'),refs.length,'priority progress max matches reference count');
}
for(const page of app.D.ui.pages){
  check(`render ${page.key}`,()=>{
    app.state.page=page.key;app.render();
    const text=element('page').innerHTML;
    assert.ok(text.includes(page.label));
    assert.ok(!text.includes('undefined'),`missing data must not leak: ${page.key}: ${text.slice(Math.max(0,text.indexOf('undefined')-100),text.indexOf('undefined')+100)}`);
    assert.ok(!text.includes('NaN'),'numbers must remain defined');
    assert.ok(!/src=["']https?:|<iframe|<script/i.test(text),'rendered UI must not load resources');
    assert.equal((text.match(/<h1\b/g)||[]).length,1,'one page heading');
    assert.ok(element('navigation').innerHTML.includes(`href="#${page.key}" class="nav-link" aria-current="page"`));
    rendered[page.key]=text;
  });
}
check('overview snapshot and no fake run percentage',()=>{
  const t=rendered.overview;
  assertHeadline(t);
  assertPriorityProgress(t);
  assert.ok(t.includes('本人が今やること'));
  assert.ok(t.includes('Q-ZETA-01'));
  assert.ok(!t.includes('17:40 JST'));
  assert.ok(!/log-\d+/.test(t));
});
check('red controls reject changed headline, progress value and max',()=>{
  const original=rendered.overview;
  const badHeadline=original.replace(headlinePattern,(_,open,text,close)=>open+'ALTERED '+text+close);
  assert.notEqual(badHeadline,original);
  assert.throws(()=>assertHeadline(badHeadline),{code:'ERR_ASSERTION',message:/^overview headline matches JSON/});
  for(const name of ['value','max']){
    const altered=original.replace(/<progress\b[^>]*>/,bar=>bar.replace(new RegExp(`(${name}=")(\\d+)(")`),(_,prefix,value,suffix)=>prefix+(Number(value)+1)+suffix));
    assert.notEqual(altered,original);
    assert.throws(()=>assertPriorityProgress(altered),{code:'ERR_ASSERTION',message:name==='value'?/^priority progress value matches done references/:/^priority progress max matches reference count/});
  }
  // Mutations above affect strings only; the DOM, JSON and file stay unchanged.
  assertHeadline(original);assertPriorityProgress(original);
});
check('headline normalization preserves term text and escaped literal markup',()=>{
  assert.equal(visibleText('<button class="term" data-term="test">term<sup aria-hidden="true">ⓘ</sup></button> &lt;literal&gt; &amp; &quot;x&quot; &#39;y&#39; &amp;lt;'),
    'term <literal> & "x" \'y\' &lt;');
});
// INVARIANTS: these are evidence boundaries, not snapshots of refreshed numbers.
// The current schema has no signed qualification-result record. Approval/signers
// on policy decisions cannot authorize qualified=true; supporting such a record
// requires an explicit schema/checker change, not a truthy ad-hoc JSON field.
function assertQualification(){
  const q=app.D.plan.zeta_qualification,old=app.D.plan.zeta_qualification_rev14_snapshot;
  assert.equal(q.qualified,false,'INVARIANT r2 qualification remains false');
  // Q-ZETA-02 now contains a completed, FAILED r2 measurement: null here would
  // erase evidence. Preserve that boundary instead of the obsolete rev14 null.
  assert.equal(q.status,'failed','INVARIANT r2 qualification remains failed');
  assert.ok(q.result&&typeof q.result==='object','INVARIANT r2 has a recorded failed result');
  assert.match(q.result.criterion4,/^FAIL\b/,'INVARIANT r2 criterion4 remains failed');
  for(const key of ['criterion5','criterion6'])
    assert.equal(q.result[key],'BLOCKED',`INVARIANT r2 ${key} lacks complete evidence`);
  assert.equal(old.qualified,false,'INVARIANT historical qualification remains false');
  assert.equal(old.result,null,'INVARIANT historical qualification has no result');
  assert.equal(app.D.status.candidate.qualified,false,'INVARIANT r3 is not qualified');
  // r3 has no qualification result field in this schema (absence means unknown).
  assert.equal(app.D.status.candidate.result??null,null,'INVARIANT r3 has no qualification result');
}
function assertMeasurements(){
  for(const name of ['rehearsal','mixed_r3']){
    const run=app.D.status[name];
    // A non-null scalar is not a result record. A future completed record needs
    // source evidence and completion metadata; a running/partial report cannot
    // gain a result merely by adding a number or changing verified.
    if(run.state==='reported-running-unverified'||run.result==null){
      assert.equal(run.result,null,`INVARIANT ${name} running result is null`);
      assert.equal(run.verified,false,`INVARIANT ${name} running report is unverified`);
    }else{
      assert.ok(typeof run.result==='object'&&!Array.isArray(run.result)&&Object.keys(run.result).length>0,
        `INVARIANT ${name} completed result is a record`);
      assert.equal(run.state,'measured-diagnostic-complete',`INVARIANT ${name} completion state`);
      // Summary completion does not supply an exact wall-clock end time.
      // Keep unknown timestamps null; require explicit evidence instead.
      const summaryComplete=run.completion_evidence==='summary-world-count'&&
        run.verification_scope==='summary-facts-only'&&run.verified===true&&
        run.completed_at===null&&Boolean(run.completed_at_basis)&&
        run.sources?.includes('src-results-p60reh-mixed');
      assert.ok((run.completed_at||summaryComplete)&&run.completed_worlds===run.worlds&&run.sources?.length,
        `INVARIANT ${name} completion evidence`);
      if(summaryComplete&&name==='mixed_r3'){
        assert.match(run.g0,/^FAIL\b/,'INVARIANT mixed G0 failures remain flagged');
        assert.equal(run.result.g0_failed_worlds,7,'INVARIANT all seven failed worlds retained');
        assert.equal(run.result.g0_failures.length,7,'INVARIANT failed world records retained');
        assert.match(run.result.t_definition,/NOT official weighted T/,'INVARIANT simplified T boundary');
      }
    }
  }
}
function assertG3(){
  // There is no g3.blockers array: the blockers ledger owns the active G3
  // blockers. Match their explicit title/impact, not unrelated open blockers.
  const blockers=app.D.blockers.items.filter(b=>b.status!=='resolved'&&/\bG3\b/.test(b.title+' '+b.impact_note));
  const gate=app.D.plan.gates.find(g=>g.id==='gate-g3');
  assert.ok(gate,'INVARIANT G3 gate exists');
  if(blockers.length){
    assert.match(gate.state,/\bBLOCKED\b/,'INVARIANT G3 remains BLOCKED with active blockers');
    assert.ok(!/\b(?:PASS|done)\b|^完了$/i.test(gate.state),'INVARIANT G3 cannot also claim PASS');
    assert.equal(app.D.progress.items.find(p=>p.id==='progress-g3')?.state,'blocked',
      'INVARIANT G3 progress remains blocked with active blockers');
  }
}
// Extract only the tagged record's own container, never borrow a warning from
// another row or a page-wide notice. Nested same-name tags are balanced.
function recordFragments(views,key){
  const found=[];
  for(const markup of Object.values(views)){
    for(const match of markup.matchAll(/<([a-z][\w-]*)\b[^>]*\bdata-record="([^"]+)"[^>]*>/g)){
      if(match[2]!==key)continue;
      const tags=new RegExp(`<(/?)${match[1]}\\b[^>]*>`,'g');
      tags.lastIndex=match.index+match[0].length;
      let depth=1,next;
      while(depth&&(next=tags.exec(markup)))depth+=next[1]?-1:1;
      assert.equal(depth,0,`INVARIANT balanced record ${key}`);
      found.push(markup.slice(match.index,tags.lastIndex));
    }
  }
  return found;
}
const needsWarning=record=>record.verified===false||/blocked|unverified/i.test(String(record.status||''))||
  /blocked|unverified/i.test(String(record.state||''));
function assertRecordWarnings(views){
  function walk(value,path){
    if(!value||typeof value!=='object')return;
    if(needsWarning(value)){
      const key=path.startsWith('progress.items.')?'progress.'+value.id:path;
      assert.ok(!/^(PASS|done|closed|resolved)$/i.test(String(value.state||'')),`INVARIANT no successful state for ${key}`);
      assert.ok(!/^(PASS|done|closed|resolved)$/i.test(String(value.status||'')),`INVARIANT no successful status for ${key}`);
      const fragments=recordFragments(views,key);
      assert.ok(fragments.length>0,`INVARIANT warning record rendered: ${key}`);
      for(const fragment of fragments){
        assert.match(visibleText(fragment),/unverified|未検証|BLOCKED/i,`INVARIANT visible warning: ${key}`);
        assert.ok(!/class="(?:chip|step-dot) done"/.test(fragment),`INVARIANT no done badge: ${key}`);
        const badges=fragment.replace(/<span class="chip-symbol"[^>]*>[\s\S]*?<\/span>/g,'');
        for(const badge of badges.matchAll(/<(span|div) class="(?:chip[^" ]*(?: [^"]*)?|step-state)"[^>]*>([\s\S]*?)<\/\1>/g))
          assert.ok(!/^(?:[✓—!×◌?]\s*)?(?:PASS|done|完了)$/i.test(visibleText(badge[2]).trim()),`INVARIANT no PASS label: ${key}`);
      }
    }
    for(const [key,child] of Object.entries(value))walk(child,path+'.'+key);
  }
  walk(app.D.results,'results');walk(app.D.progress,'progress');
}
// The old exact count 23 became obsolete when dec-c-exception-r3 was added.
// Preserve every historical ID, allow additions, and require exactly one card
// per decision. A count equal to JSON alone cannot detect deleted history.
const retainedDecisions=['dec-original','dec-deep','dec-no-contact','dec-008','dec-007','dec-q0-keep',
  'dec-astra-update','dec-forward','dec-amend','dec-overnight','dec-q0-failure-branch','dec-q0b-g0',
  'dec-step1-policy','dec-ai-scope','dec-ai-contract','dec-ai-budget','dec-revert-limit','dec-h1-authority',
  'dec-full-executor','dec-rev10-direction','dec-zeta-original','dec-zeta-qualification','dec-pr-split','dec-c-exception-r3',
  'dec-retro-allocation','dec-retro-limited-lifting','dec-retro-risk-acceptance','dec-retro-revision-risk',
  'dec-retro-originality-loss','dec-retro-budget-schedule','dec-retro-final-submission',
  'dec-oct09-r3','dec-oct09-g3','dec-oct09-dev-billing','dec-oct09-ollama',
  'dec-oct10-organizer','dec-oct10-b03',
  'dec-oct11-req25','dec-oct11-dec007','dec-oct11-b03-tooling','dec-oct11-organizer'];
function assertDecisions(views){
  const ids=app.D.decisions.items.map(d=>d.id);
  for(const id of retainedDecisions)assert.ok(ids.includes(id),`INVARIANT retained decision ${id}`);
  assert.equal(new Set(ids).size,ids.length,'INVARIANT unique decisions');
  const cards=[...views.decisions.matchAll(/class="card decision-card" data-decision="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(cards.length,ids.length,'INVARIANT decision card count');
  assert.deepEqual(cards.sort(),[...ids].sort(),'INVARIANT one card per decision');
}
function invariantViews(){
  const prior={...app.state},views={};
  try{
    for(const [key,page,mode] of [['results','results','diagnostic'],['qualification','results','qualification'],
      ['overview','overview'],['decisions','decisions']]){
      app.state.page=page;if(mode)app.state.results=mode;app.render();
      views[key]=element('page').innerHTML;
    }
    return views;
  }finally{Object.assign(app.state,prior);app.render();}
}
// The paired summary adds a new evidence boundary: six runs are only three
// pairs and one seed. Reading a supplied summary cannot verify official gates.
function assertPairedDiagnostic(views){
  const run=app.D.status.r3x;
  assert.equal(run.state,'measured-diagnostic-complete','INVARIANT r3x diagnostic completion');
  assert.equal(run.verified,true,'INVARIANT r3x summary read');
  assert.equal(run.verification_scope,'summary-facts-only','INVARIANT r3x summary scope');
  assert.equal(run.completion_evidence,'summary-world-count','INVARIANT r3x completion evidence');
  assert.equal(run.completed_at,null,'INVARIANT r3x finish time unknown');
  assert.ok(run.completed_at_basis&&run.sources.includes('src-r3x-summary'),'INVARIANT r3x provenance');
  assert.equal(run.worlds,6,'INVARIANT r3x six runs');
  assert.equal(run.completed_worlds,run.worlds,'INVARIANT r3x complete runs');
  assert.equal(run.pairs,3,'INVARIANT r3x three pairs');
  assert.equal(run.seed_count,1,'INVARIANT r3x one seed');
  assert.equal(run.seeds,'64001','INVARIANT r3x seed');
  for(const key of ['q0_eligible','official_t_verified','p60_verified','g3_verified','g4_verified','safety_verified'])
    assert.equal(run[key],false,`INVARIANT r3x unverified ${key}`);
  assert.match(run.result.t_definition,/simplified T.*NOT official weighted T/,'INVARIANT r3x simplified T');
  const pairs=Object.values(run.result.paired);
  assert.equal(pairs.length,run.pairs,'INVARIANT r3x paired rows');
  assert.equal(run.result.worse_pairs,3,'INVARIANT r3x all pairs worse');
  for(const pair of pairs)for(const metric of ['t','p_minus_noop'])
    assert.ok(Number(pair['r3x_'+metric])<Number(pair['r3_'+metric]),'INVARIANT r3x negative paired result');
  const rows=app.D.results.comparison.diagnostic.filter(r=>r.scope_ref==='status.r3x');
  assert.equal(rows.length,1,'INVARIANT r3x one diagnostic comparison');
  assert.equal(rows[0].state,'warning','INVARIANT r3x no qualification PASS');
  assert.ok(!app.D.results.comparison.qualification.some(r=>r.scope_ref==='status.r3x'),'INVARIANT r3x not qualification');
  const text=visibleText(views.results);
  for(const value of ['r3x','66.28','58.49','64001','simplified T','公式T','未検証'])
    assert.ok(text.includes(value),`INVARIANT r3x visible ${value}`);
  for(const id of retainedDecisions.filter(id=>id.startsWith('dec-retro-')))
    assert.equal(app.D.decisions.items.find(d=>d.id===id)?.status,'open',`INVARIANT pending user decision ${id}`);
}
const diagnosticWarningId='recent-one-world-diagnostic';
function assertDiagnosticWarning(views){
  const records=app.D.status.recent.filter(r=>r.id===diagnosticWarningId);
  assert.equal(records.length,1,'INVARIANT retained one-world diagnostic warning by id');
  const record=records[0];
  assert.equal(record.kind,'warning','INVARIANT one-world diagnostic remains a warning');
  assert.equal(record.title,'1世界診断: revision採用0・監査BLOCKED','INVARIANT one-world diagnostic retains BLOCKED wording');
  assert.equal(record.text,'r2、F_ref calm/49002、360 blocks / 362 loops / 721.7秒。revision開始6、応答5（見送り4・無効1）、未完了1、採用0。recorder欠測。G3合否には数えない。',
    'INVARIANT one-world diagnostic retains original evidence');
  assert.deepEqual([...record.sources],['src-g3-diagnostic','src-revision-audit'],'INVARIANT one-world diagnostic sources retained');
  const fragments=recordFragments(views,'status.recent.'+diagnosticWarningId);
  assert.ok(fragments.length>0,'INVARIANT one-world diagnostic warning rendered');
  for(const fragment of fragments)
    assert.ok(visibleText(fragment).includes(record.title),'INVARIANT one-world diagnostic visible BLOCKED wording');
}
const documentedProgressIds=['progress-r3x','progress-retro-full'];
const documentedLabel='読取済み（文書化・ゲート完了ではない）';
function assertDocumentedProgress(views){
  for(const id of documentedProgressIds){
    const records=app.D.progress.items.filter(p=>p.id===id);
    assert.equal(records.length,1,`INVARIANT documented progress exists: ${id}`);
    assert.equal(records[0].state_label,documentedLabel,`INVARIANT documented progress label: ${id}`);
    assert.ok(records[0].evidence.startsWith(documentedLabel),`INVARIANT documented evidence scope: ${id}`);
    assert.ok(!app.D.status.priority.progress_refs.includes(id),`INVARIANT document reading cannot count as a gate: ${id}`);
    const fragments=recordFragments(views,'progress.'+id);
    assert.ok(fragments.length>0,`INVARIANT documented progress rendered: ${id}`);
    for(const fragment of fragments){
      const badges=[...fragment.matchAll(/<span class="chip [^"]*">([\s\S]*?)<\/span>([^<]*)<\/span>/g)];
      assert.ok(badges.length>0,`INVARIANT documented progress badge exists: ${id}`);
      for(const badge of badges)
        assert.equal(visibleText(badge[2]),documentedLabel,`INVARIANT no gate-complete badge for documented progress: ${id}`);
    }
  }
}
const invariantGuards=[assertQualification,assertMeasurements,assertG3,assertRecordWarnings,assertDecisions,assertPairedDiagnostic,assertDiagnosticWarning,assertDocumentedProgress];
check('INVARIANT qualification, running evidence, G3, per-record warnings and decisions',()=>{
  const views=invariantViews();for(const guard of invariantGuards)guard(views);
});
let invariantReds=0;
function rejectMutation(name,mutate,guard,alterViews=views=>views){
  const original={...app.D};
  try{
    Object.assign(app.D,structuredClone(app.D));
    mutate(app.D);
    const views=alterViews(invariantViews());
    assert.throws(()=>guard(views),error=>error.code==='ERR_ASSERTION'&&error.message.startsWith('INVARIANT'),
      `red control did not fail its invariant: ${name}`);
    invariantReds++;
  }finally{Object.assign(app.D,original);app.render();}
  const views=invariantViews();for(const check of invariantGuards)check(views);
}
check('red controls prove evidence invariants reject false claims and original still passes',()=>{
  for(const [path,key,value] of [
    ['plan.zeta_qualification','qualified',true],['plan.zeta_qualification','status','PASS'],
    ['plan.zeta_qualification','result',42],['plan.zeta_qualification.result','criterion4','PASS'],
    ['plan.zeta_qualification.result','criterion5','PASS'],['plan.zeta_qualification.result','criterion6','PASS'],
    ['plan.zeta_qualification_rev14_snapshot','qualified',true],['plan.zeta_qualification_rev14_snapshot','result',42],
    ['status.candidate','qualified',true],['status.candidate','result',42]
  ])rejectMutation(`${path}.${key}`,d=>{path.split('.').reduce((v,k)=>v[k],d)[key]=value;},assertQualification);
  for(const name of ['rehearsal','mixed_r3']){
    rejectMutation(`${name} fake result`,d=>{d.status[name].result=42;},assertMeasurements);
    // Preserve the running-report red control after actual completion arrives.
    rejectMutation(`${name} fake verification`,d=>{Object.assign(d.status[name],{
      state:'reported-running-unverified',result:null,verified:true});},assertMeasurements);
    rejectMutation(`${name} scalar completion`,d=>{Object.assign(d.status[name],{state:'measured-diagnostic-complete',result:42,verified:true});},assertMeasurements);
    rejectMutation(`${name} missing completion evidence`,d=>{
      d.status[name].completed_at=null;delete d.status[name].completion_evidence;
    },assertMeasurements);
    rejectMutation(`${name} incomplete world count`,d=>{d.status[name].completed_worlds--;},assertMeasurements);
  }
  rejectMutation('mixed G0 false PASS',d=>{d.status.mixed_r3.g0='PASS';},assertMeasurements);
  rejectMutation('mixed failed worlds erased',d=>{d.status.mixed_r3.result.g0_failed_worlds=0;},assertMeasurements);
  rejectMutation('mixed official T claim',d=>{d.status.mixed_r3.result.t_definition='official weighted T';},assertMeasurements);
  rejectMutation('G3 PASS with blockers',d=>{d.plan.gates.find(g=>g.id==='gate-g3').state='PASS';},assertG3);
  rejectMutation('G3 done with blockers',d=>{d.progress.items.find(p=>p.id==='progress-g3').state='done';},assertG3);
  for(const target of ['progress','results']){
    const item=d=>target==='progress'?d.progress.items.find(p=>p.id==='progress-smoke'):d.results.comparison.qualification[1];
    rejectMutation(`${target} BLOCKED rendered done`,d=>{Object.assign(item(d),{status:'BLOCKED',state:'done'});},assertRecordWarnings);
    rejectMutation(`${target} unverified rendered done`,d=>{Object.assign(item(d),{verified:false,state:'done'});},assertRecordWarnings);
    rejectMutation(`${target} PASS badge`,d=>{Object.assign(item(d),{status:'BLOCKED',state:'warning',state_label:'PASS'});},assertRecordWarnings,
      views=>{if(target==='progress'){
        const key='progress.progress-smoke';
        for(const page of Object.keys(views))for(const fragment of recordFragments({[page]:views[page]},key))
          views[page]=views[page].replace(fragment,fragment.replace(/(<span class="chip warning">)[\s\S]*?<\/span>[^<]*<\/span>/,'$1PASS</span>'));
      }return views;});
    rejectMutation(`${target} warning removed`,d=>{Object.assign(item(d),{verified:false,state:'warning'});},assertRecordWarnings,
      views=>{const key=target==='progress'?'progress.progress-smoke':'results.comparison.qualification.1';
        for(const page of Object.keys(views))for(const fragment of recordFragments({[page]:views[page]},key))
          views[page]=views[page].replace(fragment,fragment.replace(/unverified|未検証|BLOCKED/gi,''));
        return views;});
  }
  // Renderer-only regressions must also fail even when all JSON flags are intact.
  for(const key of ['progress.progress-smoke','results.comparison.qualification.1']){
    rejectMutation(`${key} rendered done badge`,()=>{},assertRecordWarnings,views=>{
      for(const page of Object.keys(views))for(const fragment of recordFragments({[page]:views[page]},key))
        views[page]=views[page].replace(fragment,fragment.replace('class="chip blocked"','class="chip done"'));
      return views;
    });
    rejectMutation(`${key} original warning removed`,()=>{},assertRecordWarnings,views=>{
      for(const page of Object.keys(views))for(const fragment of recordFragments({[page]:views[page]},key))
        views[page]=views[page].replace(fragment,fragment.replace(/unverified|未検証|BLOCKED/gi,''));
      return views;
    });
  }
  rejectMutation('deleted decision',d=>{d.decisions.items.pop();},assertDecisions);
  rejectMutation('missing rendered decision',()=>{},assertDecisions,views=>{
    views.decisions=views.decisions.replace(/class="card decision-card" data-decision="[^"]+"/,'class="card missing-card"');return views;
  });
});
check('retained warning and documented progress red controls',()=>{
  rejectMutation('one-world warning deleted',d=>{
    d.status.recent=d.status.recent.filter(r=>r.id!==diagnosticWarningId);
  },assertDiagnosticWarning);
  rejectMutation('one-world BLOCKED wording removed',d=>{
    const record=d.status.recent.find(r=>r.id===diagnosticWarningId);
    record.title=record.title.replace('BLOCKED','PASS');
  },assertDiagnosticWarning);
  rejectMutation('one-world rendered BLOCKED removed',()=>{},assertDiagnosticWarning,views=>{
    for(const fragment of recordFragments(views,'status.recent.'+diagnosticWarningId))
      views.overview=views.overview.replace(fragment,fragment.replace('BLOCKED','PASS'));
    return views;
  });
  for(const id of documentedProgressIds){
    for(const label of [undefined,'完了','PASS'])rejectMutation(`${id} gate-complete label ${label}`,d=>{
      d.progress.items.find(p=>p.id===id).state_label=label;
    },assertDocumentedProgress);
    rejectMutation(`${id} rendered gate-complete label`,()=>{},assertDocumentedProgress,views=>{
      for(const page of Object.keys(views))for(const fragment of recordFragments({[page]:views[page]},'progress.'+id))
        views[page]=views[page].replace(fragment,fragment.replace(documentedLabel,'完了'));
      return views;
    });
    rejectMutation(`${id} counted as gate`,d=>{d.status.priority.progress_refs.push(id);},assertDocumentedProgress);
  }
});
check('paired diagnostic red controls preserve summary limits and pending decisions',()=>{
  for(const [key,value] of [
    ['state','qualified'],['verified',false],['verification_scope','runtime-audited'],
    ['completion_evidence',null],['completed_at','2026-10-07T00:00:00+09:00'],
    ['worlds',3],['completed_worlds',5],['pairs',6],['seed_count',3],['seeds','63001'],
    ['q0_eligible',true],['official_t_verified',true],['p60_verified',true],
    ['g3_verified',true],['g4_verified',true],['safety_verified',true]
  ])rejectMutation(`r3x ${key}`,d=>{d.status.r3x[key]=value;},assertPairedDiagnostic);
  rejectMutation('r3x missing source',d=>{d.status.r3x.sources=[];},assertPairedDiagnostic);
  rejectMutation('r3x official T',d=>{d.status.r3x.result.t_definition='official weighted T';},assertPairedDiagnostic);
  rejectMutation('r3x false win',d=>{d.status.r3x.result.paired.whale.r3x_t='99';},assertPairedDiagnostic);
  rejectMutation('r3x false PASS',d=>{d.results.comparison.diagnostic.find(r=>r.scope_ref==='status.r3x').state='done';},assertPairedDiagnostic);
  for(const id of retainedDecisions.filter(id=>id.startsWith('dec-retro-')))
    rejectMutation(`unapproved decision ${id}`,d=>{d.decisions.items.find(r=>r.id===id).status='decided';},assertPairedDiagnostic);
});
check('qualification result keeps failed and blocked states',()=>{
  app.state.page='results';app.state.results='qualification';app.render();
  const t=element('page').innerHTML;rendered.qualification=t;
  assert.ok(t.includes('44.56')&&t.includes('56.50')&&t.includes('48.07')&&t.includes('56.43'));
  assert.ok(t.includes('不合格')&&t.includes('ブロック'));
  assert.ok(t.includes('未実施'));
});
check('diagnostic metrics from JSON rather than display constants',()=>{
  const before=app.D.status.dev2.result.p_candidate;
  app.state.results='diagnostic';app.D.status.dev2.result.p_candidate='TEST-VALUE';app.render();
  assert.ok(element('page').innerHTML.includes('TEST-VALUE'));
  app.D.status.dev2.result.p_candidate=before;
});
check('log count and complete history',()=>{
  assert.equal(app.filteredLogs().length,app.D.log.items.length);
  assert.equal((rendered.log.match(/class="log-entry"/g)||[]).length,app.D.log.items.length);
  for(const l of app.D.log.items)assert.ok(rendered.log.includes(l.id));
});
check('log AND search, kind and date filters compose',()=>{
  app.state.logQuery='Ollama';
  const selected=app.filteredLogs();assert.ok(selected.length>0&&selected.length<app.D.log.items.length);
  app.state.logType=selected[0].type;app.state.logDate=selected[0].timestamp.slice(0,10);
  const combined=app.filteredLogs();assert.ok(combined.length>0);
  assert.ok(combined.every(l=>l.type===app.state.logType&&l.timestamp.startsWith(app.state.logDate)));
  app.state.logQuery='cannot-match-any-log';assert.equal(app.filteredLogs().length,0);
  app.state.logQuery='';app.state.logType='all';app.state.logDate='all';
});
check('search input handler updates results without replacing input focus',()=>{
  app.state.page='log';app.render();
  listeners.get('input')({target:{id:'log-search',value:'Ollama'}});
  assert.ok(!element('log-count').textContent.startsWith(`${app.D.log.items.length} /`));
  assert.ok(element('log-items').innerHTML.includes('Ollama'));
  listeners.get('input')({target:{id:'log-search',value:'not-present-284'}});
  assert.ok(element('log-items').innerHTML.includes('一致するログはありません'));
  app.state.logQuery='';
});
check('glossary finds aliases and Japanese definitions',()=>{
  app.state.termQuery='FROZEN';assert.ok(app.filteredTerms().some(t=>t.id==='term-frozen'));
  app.state.termQuery='何もしない';assert.ok(app.filteredTerms().some(t=>t.id==='term-noop'));
  app.state.termQuery='';assert.equal(app.filteredTerms().length,app.D.glossary.items.length);
});
check('hash routes, back/forward handler and direct term links',()=>{
  location.hash='#glossary/term-q0';listeners.get('window:hashchange')();
  assert.equal(app.state.page,'glossary');assert.equal(lastFocused,'term-q0');
  location.hash='#operations';listeners.get('window:hashchange')();assert.equal(app.state.page,'operations');
  location.hash='#unknown';app.route();assert.equal(app.state.page,'overview');
});
check('tooltip opens with keyboard-focusable close; Escape restores focus',()=>{
  const button=element('test-term-button');button.dataset.term='term-q0';
  button.closest=()=>button;button.hasAttribute=key=>key==='data-term';
  listeners.get('click')({target:button});
  assert.equal(element('term-popover').hidden,false);assert.equal(lastFocused,'popover-close');
  assert.ok(element('term-popover').innerHTML.includes('Q0'));
  listeners.get('keydown')({key:'Escape'});assert.equal(element('term-popover').hidden,true);
  assert.equal(lastFocused,'test-term-button');
});
check('dynamic text is escaped; no injection through glossary or logs',()=>{
  const attack='<img src=x onerror="bad()"> & <script>alert(1)</script>';
  assert.ok(app.esc(attack).includes('&lt;img'));assert.ok(!app.rich(attack).includes('<img'));
  const entry=app.D.log.items[0],prior=entry.summary;entry.summary=attack;
  app.state.page='log';app.render();
  assert.ok(!element('page').innerHTML.includes('<img src=x'));
  assert.ok(element('page').innerHTML.includes('&lt;script&gt;'));entry.summary=prior;
});
check('plan, decisions and budget fields change with JSON',()=>{
  const old=app.D.plan.deadline_at;app.D.plan.deadline_at='2026-10-30T12:00:00+09:00';
  app.state.page='plan';app.render();assert.ok(element('page').innerHTML.includes('10/30 12:00'));
  app.D.plan.deadline_at=old;
  assert.ok(rendered.operations.includes('未精算')&&rendered.operations.includes('未確定'));
  assert.ok(rendered.decisions.includes('Free')&&rendered.decisions.includes('Off'));
});
check('AA text palette and responsive/reduced-motion provisions',()=>{
  const css=html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const colors=Object.fromEntries([...css.matchAll(/--([\w-]+):(#(?:[0-9a-f]{6}|[0-9a-f]{3}))(?=;|})/g)].map(m=>[m[1],m[2]]));
  const luminance=hex=>{
    const value=hex.length===4?'#'+[...hex.slice(1)].map(c=>c+c).join(''):hex;
    return [0.2126,0.7152,0.0722].reduce((sum,w,i)=>{const c=parseInt(value.slice(1+i*2,3+i*2),16)/255;return sum+w*(c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);},0);
  };
  for(const [fg,bg] of [['ink','surface'],['muted','surface'],['muted','bg'],['accent','surface'],['accent','accent-soft'],['good','good-bg'],['warn','warn-bg'],['bad','bad-bg']]){
    const a=luminance(colors[fg]),b=luminance(colors[bg]);assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,`${fg}/${bg} must meet AA`);
  }
  assert.ok(css.includes('@media(max-width:640px)'));
  assert.ok(css.includes('main{padding:23px 16px 32px}'));
  assert.ok(css.includes('prefers-reduced-motion:reduce'));
  assert.ok(!/@font-face|@import|url\(/i.test(css));
  assert.ok(!/@media print|beforeprint|afterprint/.test(html));
});
check('a future reported completion renders without a forecast or live guessing',()=>{
  const run=currentRun(),before={...run};
  try{
  Object.assign(run,{state:'measured-diagnostic-complete',state_label:'診断完了の引継ぎ',expected_end:null,completed_at:'2026-10-05T00:41:00+09:00',completed_worlds:24,note:'test-only confirmed completion'});
  app.state.page='operations';app.render();
  assert.ok(element('page').innerHTML.includes('診断完了の引継ぎ'));
  assert.ok(element('page').innerHTML.includes('00:41'));
  assert.ok(!element('page').innerHTML.includes('NaN'));
  app.state.page='overview';app.render();assert.ok(element('page').innerHTML.includes('確認された完了時刻'));
  }finally{Object.assign(run,before);}
});
check('all configured KPI cards appear on overview only, including qualification view',()=>{
  for(const [page,text] of Object.entries(rendered)){
    assert.equal((text.match(/class="kpi"/g)||[]).length,page==='overview'?app.D.ui.kpis.length:0,page);
    assert.equal((text.match(/class="kpis"/g)||[]).length,page==='overview'?1:0,page);
  }
});
check('comparison is the first results content section, before explanatory notices',()=>{
  for(const key of ['results','qualification']){
    const t=rendered[key];
    assert.ok(t.slice(t.indexOf('<div class="page-body">')).startsWith('<div class="page-body">\n    <section class="card table-card results-primary">'));
    assert.ok(t.indexOf('class="comparison"')<t.indexOf('class="notice'));
    assert.ok(t.indexOf('class="comparison"')<t.indexOf('測定の原表・条件'));
  }
});
check('dev3a historical figures and incz completed results stay distinct in visible pages',()=>{
  const t=rendered.results;
  const operationsText=rendered.operations.replace(/<[^>]*>/g,'').replace(/ⓘ/g,'');
  for(const value of ['842.3','2032.9','1050.3','54.4','288.7','61.3','46.83','55.93','980','27'])assert.ok(t.includes(value),value);
  assert.ok(t.includes('9レジーム')&&t.includes('18世界')&&t.includes('比較対象に未達'));
  assert.ok(operationsText.includes('incz'));
  assert.ok(operationsText.includes('全計測終了・走行中なし'));
  assert.ok(operationsText.includes('夜間のハートビートは取消済み'));
  assert.ok(!operationsText.includes('null'));
});
check('historical dev4 facts, configured current run and team are visible',()=>{
  const t=rendered.results;
  for(const value of ['49.72','55.02','488.2','1460.8','440.0','68.8','273.4','46.3','1652','23','+7.85'])assert.ok(t.includes(value),value);
  assertVisibleFields(rendered.operations,currentRun(),['name','note']);
  assertVisibleFields(rendered.operations,app.D.status.team,['primary','secondary','unavailable','support','independent_review','tool_policy','note']);
  for(const job of app.D.queue.side_jobs)assertVisibleFields(rendered.operations,job,['title','state','note']);
  assertVisibleFields(rendered.overview,app.D.status,['notice']);
});
check('dev4 display is sourced from JSON',()=>{
  app.state.page='results';app.state.results='diagnostic';
  const before=app.D.status.dev4.result.t_candidate;
  app.D.status.dev4.result.t_candidate='REV8-SENTINEL';app.render();
  assert.ok(element('page').innerHTML.includes('REV8-SENTINEL'));
  app.D.status.dev4.result.t_candidate=before;
});
check('375px static containment: shrinkable children, wrapping text, stacked tables',()=>{
  const css=html.match(/<style>([\s\S]*?)<\/style>/)[1];
  // A structural CSS audit, not a browser layout measurement.
  const mobile=css.slice(css.indexOf('@media(max-width:640px)'));
  assert.ok(css.includes('body{overflow-wrap:anywhere}'));
  for(const selector of ['.card-title>*','.section-title>*','.nav-link>*','.refs>*','.comparison td>*']){
    assert.ok(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'[^{}]*\\{min-width:0;max-width:100%\\}').test(css),selector);
  }
  assert.ok(mobile.includes('.section-title,.card-title,.progress-head{flex-wrap:wrap}'));
  assert.ok(mobile.includes('.toolbar>.field{flex-basis:100%;width:100%}'));
  assert.ok(mobile.includes('.raw-table,.comparison,.queue-table{display:block}'));
  assert.ok(mobile.includes('grid-template-columns:minmax(82px,.4fr) minmax(0,1fr)'));
  assert.ok(mobile.includes('.workspace{margin-left:0}')||css.includes('@media(max-width:960px)')&&css.includes('.workspace{margin-left:0}'));
  assert.ok(css.includes('width:min(390px,calc(100vw - 32px))'));
  // The narrowest table content: 375 - main margins - card borders - details padding - row padding.
  const content=375-32-2-32-34, label=83, gap=12;
  assert.ok(content-label-gap>0,'the fixed label track leaves positive space for a minmax(0,1fr) value');
  assert.ok(!/(?:body|html)\s*\{[^}]*overflow-x\s*:\s*(?:hidden|clip)/.test(css),'do not mask page overflow');
  assert.ok(!/[{;]\s*(?:min-width|width)\s*:\s*(?:[4-9]\d{2}|\d{4,})px/.test(mobile),'no wide fixed box in mobile overrides');
});
if(process.argv.includes('--dump')){
  const target=process.argv[process.argv.indexOf('--dump')+1];
  assert.ok(target?.startsWith('/tmp/')||target?.startsWith('/private/tmp/'),'dump must be an explicit temporary path');
  writeFileSync(target,JSON.stringify(rendered));
}
check('rev9 authority, runtime limit, no-cost provider and next branch are visible',()=>{
  const plain=page=>rendered[page].replace(/<[^>]*>/g,'');
  for(const value of ['a95054a','検査済み方針の選択+ENTRY','ON起動を拒否','VENDORED','プロンプト誘導','validator ok=true','能力評価ではない','claude-cli:haiku','39001/39002','OFF1+ON3=32世界','安全保証なしで本番と同条件で測るか'])assert.ok(plain('decisions').includes(value),value);
  assertVisibleFields(rendered.operations,app.D.plan.continuous_operation,['title','note']);
  assertVisibleFields(rendered.operations,app.D.status.repair_v5,['note']);
  assertVisibleFields(rendered.overview,app.D.status.priority,['title','note']);
});
check('rev10 live outcomes, xa stop and mix placeholder come from data',()=>{
  const t=rendered.results.replace(/<[^>]*>/g,'').replace(/ⓘ/g,'');
  for(const value of ['HEALTHY=no','50.15','55.73','54.74','48.91','52.80','53.62','-5.83','-1.93','-1.11','-229.4','+178.7','-19.75','PILOT-STOP','診断完了'])assert.ok(t.includes(value),value);
  assert.ok(!t.includes('undefined'));
  const run=currentRun(),before=run.note;
  try{
  run.note='REV10-MIX-SENTINEL';app.state.page='operations';app.render();
  assert.ok(element('page').innerHTML.includes('REV10-MIX-SENTINEL'));
  }finally{run.note=before;}
});
check('mix1 ranking, regimes and G0 exception render from measured JSON',()=>{
  const t=rendered.results.replace(/<[^>]*>/g,'').replace(/ⓘ/g,'');
  for(const row of app.D.status.mix1.result.ranking)for(const k of ['agent','t','worst_regime_t'])assert.ok(t.includes(String(row[k])),`${row.agent} ${k}`);
  for(const row of app.D.status.mix1.result.regime_t)for(const k of ['regime','t','mean_rank'])assert.ok(t.includes(String(row[k])),`${row.regime} ${k}`);
  // Current measurements may finish; retain the historical G0 boundary checks.
  for(const value of ['23世界PASS','crash/40001','grok-1','telemetry','BLOCKEDをPASSとは扱わない','40003/40004','48世界'])assert.ok(t.includes(value),value);
  const before=app.D.status.mix1.result.t_candidate;
  app.D.status.mix1.result.t_candidate='REV11-MIX-SENTINEL';app.state.page='results';app.state.results='diagnostic';app.render();
  assert.ok(element('page').innerHTML.includes('REV11-MIX-SENTINEL'));
  app.D.status.mix1.result.t_candidate=before;
});
check('completed rehearsal and mixed summaries render with diagnostic boundaries',()=>{
  const t=visibleText(rendered.results);
  for(const value of ['58.82','43.42','57.42','50.65','49.44','G0 FAIL 7世界','公式T','未検証'])
    assert.ok(t.includes(value),value);
  for(const name of ['rehearsal','mixed_r3']){
    assert.equal(app.D.status[name].completed_at,null,'unknown finish time remains null');
    assert.equal(app.D.status[name].verification_scope,'summary-facts-only');
    const rows=app.D.results.comparison.diagnostic.filter(r=>r.scope_ref==='status.'+name);
    assert.equal(rows.length,1,'one current comparison row per run');
    assert.equal(rows[0].state,'warning','diagnostic completion is not qualification PASS');
  }
  assert.ok(!app.D.queue.items.some(q=>['queue-rehearsal-r3','queue-mixed-r3'].includes(q.id)&&q.active));
});
check('rev12 all mixed rankings and incz completed boundary are rendered',()=>{
  const t=rendered.results.replace(/<[^>]*>/g,'').replace(/ⓘ/g,'');
  for(const name of ['mix2','mix48'])for(const row of app.D.status[name].result.ranking)
    for(const key of ['agent','t','worst_regime_t'])assert.ok(t.includes(String(row[key])),`${name} ${row.agent} ${key}`);
  for(const v of ['40005','07:20','08:15','診断完了','commit不一致でG0 FAIL','F_ref契約(Q0)未通過'])assert.ok(t.includes(v),v);
  assert.equal(app.D.status.incz.result.t_candidate,'56.30');
  assert.equal(app.D.status.incz.result.noop_below,4);
  assert.equal(app.D.status.incz.completed_at,null);
  assert.equal(app.D.status.incz.completed_worlds,12);
});
check('rev13 incz measured values, all regimes and accounting visible without qualification',()=>{
  const t=rendered.results.replace(/<[^>]*>/g,'').replace(/ⓘ/g,'');
  for(const v of ['56.30','44.44','1343.6','730.0','281.1','254.2','253.0','42.2','3057','90','2.9','−52.8','−131.4','−104.8','−142.1','−8.12','0.2/世界','8.4'])assert.ok(t.includes(v),v);
  for(const row of app.D.status.incz.result.regime_t)for(const k of ['regime','candidate','multi'])assert.ok(t.includes(row[k]),row[k]);
  assertVisibleFields(rendered.operations,app.D.budget.overnight,['note']);
  assertVisibleFields(rendered.overview,currentRun(),['note']);
  for(const item of app.D.queue.items)assertVisibleFields(rendered.operations,item,['title','state','dependency']);
  assert.equal(app.D.status.incz.q0_eligible,false);
});
check('current direction, recent events, next milestone and night operation come from JSON',()=>{
  assertVisibleFields(rendered.overview,app.D.status,['subhead','human_action']);
  assertVisibleFields(rendered.overview,app.D.status.next_milestone,['title','note']);
  assert.ok(app.D.status.recent.length>0);
  for(const event of app.D.status.recent)assertVisibleFields(rendered.overview,event,['title','text']);
  assertVisibleFields(rendered.operations,app.D.status.night_operation,['note']);
  for(const decision of app.D.decisions.items)assertVisibleFields(rendered.decisions,decision,['title']);
});
// 2026-10-11 evidence contract: the limited timing study is complete;
// live observation and the G3 gate remain unresolved. Keep these semantic checks alongside the
// existing historical-result and per-record warning controls.
function assertOctoberStatus(views){
  const d=app.D,t=d.status.timing;
  assert.equal(d.status.g3_state,'BLOCKED','INVARIANT October G3 blocked');
  assert.equal(d.status.budget_state,'UNKNOWN','INVARIANT October remaining budget unknown');
  assert.equal(d.budget.consumed_exact_hours,null,'INVARIANT October exact spend unknown');
  assert.equal(d.budget.consumed_forward_hours,null,'INVARIANT October forward spend unknown');
  assert.equal(t.state,'complete-limited-study','INVARIANT October study complete in limited scope');
  assert.equal(t.interference_state,'measured-once-limited-setting','INVARIANT October interference scope');
  assert.equal(t.g3_evidence,false,'INVARIANT October timing is not G3 evidence');
  assert.equal(t.verified,false,'INVARIANT October no independently verified interference');
  assert.equal(t.exploration.state,'complete-recorded','INVARIANT October exploration scope');
  assert.equal(t.exploration.evidence_kind,'saved-results-document','INVARIANT October exploration provenance');
  assert.equal(t.exploration.artifact_verified,false,'INVARIANT October exploration artifact absent');
  assert.deepEqual([t.exploration.deadline_ms,t.exploration.center_ms,t.exploration.grid_ms],[100,97.5,4],'INVARIANT October reported exploration values');
  const b=d.status.b03;
  assert.equal(b.state,'unresolved-user-accepted','INVARIANT October B03 unresolved');
  assert.equal(b.accepted_by,'user','INVARIANT October B03 user decision');
  for(const key of ['safety_pass','closed','organizer_premise_verified','question_sent','question_will_send'])
    assert.equal(b[key],false,`INVARIANT October B03 ${key}`);
  assert.equal(b.tooling_blocker_retained,true,'INVARIANT October B03 remains in tooling');
  // 2026-10-11: the user decided to keep the tooling unchanged (B03 still listed, still blocks start).
  assert.equal(b.tooling_representation,'unchanged-by-user-decision','INVARIANT October tooling unchanged by user decision');
  assert.deepEqual(JSON.parse(JSON.stringify(t.result)),{
    positive_injected_ms:6,positive_shift_ms:5.96875,positive_interval_ms:[5.78125,6.15625],
    negative_shift_ms:0,negative_interval_ms:[0,0],negative_degenerate:true,control_verdict:'descriptive only',
    signed_shift_ms:0.015625,interval_ms:[0,0.046875],margin_ms:[-2,2],interval_inside_margin:true,
    median_overhead_ms:0.7253435000000081,conservative_mde_ms:[3.095343602811989,2.4008375736214673],
    optimistic_mde_ms:[1.5476718014059945,1.2004187868107337],grid_ms:4,runs:1,hosts:1,load_thresholds:[2.5,3.5,5.0,8]
  },'INVARIANT October recorded result and inference limits');
  assert.equal(t.completed_at,'2026-10-11T00:06:50+09:00','INVARIANT October recorded completion');
  assert.equal(d.progress.items.find(x=>x.id==='progress-probe-timing').state,'done','INVARIANT October timing progress complete');
  assert.equal(d.queue.items.find(x=>x.id==='queue-probe-timing').active,false,'INVARIANT October measurement not running');
  assert.equal(d.queue.items.find(x=>x.id==='queue-g3-bounded').owner,'human','INVARIANT October continuation user only');
  assert.equal(d.queue.items.find(x=>x.id==='queue-offline-b04-b07').active,false,'INVARIANT October offline extension conditional');
  assert.equal(t.merged,true,'INVARIANT October timing results merged');
  assert.equal(d.plan.continuous_operation.current_run_ref,'status.timing','INVARIANT October current work is timing');
  assert.equal(d.status.next_steps.length,3,'INVARIANT October next three steps');
  const overview=visibleText(views.overview),operations=visibleText(app.renderers.operations());
  for(const phrase of ['前回更新から','次の3手','G3','BLOCKED','10/28'])
    assert.ok(overview.includes(phrase),`INVARIANT October overview ${phrase}`);
  for(const step of d.status.next_steps)assertVisibleFields(views.overview,step,['title','text','label']);
  for(const phrase of ['COMPLETE','main統合済み','descriptive only','DEGENERATE','6 ms','5.97 ms','0.0156 ms','[0, 0.047] ms','±2 ms','+0.73 ms','3.1 ms','2.4 ms','相関1','相関0','1.5 / 1.2 ms','4 ms','0.7 ms','1 run','1 host','synthetic fixtures','StrategyRunner-level probe','2.5→3.5→5.0→8','失敗','NOT G3 evidence','not found in files','Spotlight','Atomics.wait','busy-spin','43→84 GiB','outside the repo, local to the Air','SHA-256','19ファイル'])
    assert.ok(operations.includes(phrase),`INVARIANT October operations ${phrase}`);
  assertVisibleFields(app.renderers.operations(),d.status.infrastructure,['note','boundary']);
  for(const limit of t.limitations)assert.ok(operations.includes(limit),'INVARIANT October all limitations visible');
  for(const phrase of ['descriptive only','DEGENERATE','3.1 ms','2.4 ms','相関1','相関0','1.5 / 1.2 ms','4 ms','0.7 ms','1 run','1 host','synthetic fixtures','StrategyRunner-level probe'])
    assert.ok(t.limitations.join(' ').includes(phrase),`INVARIANT October limitation ${phrase}`);
  for(const phrase of ['USER','本人のみ','継続','中止','範囲・費用・期限','条件付き','10/20','10/28','提出前の本人確認'])
    assert.ok(overview.includes(phrase),`INVARIANT October next decision ${phrase}`);
  const resultView=visibleText(app.renderers.results());
  for(const n of [49,50,51,52,53,54,55,56])assert.ok(resultView.includes(`PR #${n}`),`INVARIANT October merged PR ${n}`);
  for(const phrase of ['synthetic-only','B07/B04を閉じない','B04/B07を閉じない','B03/B07','prestart-check.py','inputs.lock.json'])
    assert.ok(resultView.includes(phrase),`INVARIANT October preparation scope ${phrase}`);
  // Old logs are immutable historical records. Current surfaces must lose stale claims.
  const current=JSON.stringify([d.status.timing,d.status.next_steps,d.status.changes,d.queue.items.filter(x=>x.current),d.progress.items.find(x=>x.id==='progress-probe-timing')]);
  assert.doesNotMatch(current,/RUNNING|result pending|mini offline|UNMEASURED|main未統合|next: run the reduced protocol/i,'INVARIANT October stale current timing');

  const policy=visibleText(views.decisions);
  for(const id of ['dec-oct09-r3','dec-oct09-g3','dec-oct09-dev-billing','dec-oct09-ollama']){
    const item=d.decisions.items.find(x=>x.id===id);
    assert.equal(item?.status,'decided',`INVARIANT October decided policy ${id}`);
    assert.ok(item.sources.includes('src-decisions-oct09'),`INVARIANT October policy provenance ${id}`);
    assert.ok(policy.includes(item.title),`INVARIANT October policy displayed ${id}`);
  }
  for(const id of ['dec-oct10-organizer','dec-oct10-b03']){
    const item=d.decisions.items.find(x=>x.id===id);
    assert.equal(item?.status,'decided',`INVARIANT October user decision ${id}`);
    assert.equal(item.owner,'human',`INVARIANT October decision owner ${id}`);
    assert.ok(item.sources.includes('src-decisions-oct10'),`INVARIANT October decision source ${id}`);
    assertVisibleFields(views.decisions,item,['title','note']);
  }
  for(const phrase of ['運営は今出ている情報以上の強制はない、かつ、公式な方法はない、という判断で進めたい。','B03をあなたが残余リスクとして明示的に受け入れる','確認した事実ではなく','未送信（送信の決定は記録なし）','PASS・closedではない','REQUIRED_BLOCKERS','inputs.lock.json','本人の未決事項','エージェントは免除を推奨・決定しない'])
    assert.ok(policy.includes(phrase),`INVARIANT October risk boundary ${phrase}`);
  for(const phrase of ['B03','本人受容済み残余リスク','REQUIRED','BLOCKED','ツールは変えない'])
    assert.ok(overview.includes(phrase),`INVARIANT October overview risk ${phrase}`);
  assert.match(policy,/1日/,'INVARIANT October bounded investigation');
  assert.match(policy,/\$0/,'INVARIANT October no billing approval');
  assert.ok(overview.includes('合格済みではなく、提出準備も未完了'),'INVARIANT October candidate is conditional');
  // 2026-10-11 later: synthetic-only checkers for requirements 2-5 are merged; live observation is not done.
  const r=d.status.req25;
  assert.equal(r.state,'offline-checkers-merged-live-blocked','INVARIANT req25 state');
  assert.equal(r.scope,'requirements-2-5-all','INVARIANT req25 scope');
  assert.equal(r.deadline,'2026-10-12','INVARIANT req25 deadline');
  assert.equal(r.auto_extend,false,'INVARIANT req25 deadline not auto-extended');
  assert.equal(r.live_observation,'not-done','INVARIANT req25 live observation not done');
  assert.equal(r.live_completable_by_deadline,false,'INVARIANT req25 live not completable by deadline');
  assert.equal(r.synthetic_only,true,'INVARIANT req25 synthetic only');
  assert.equal(r.g3_status,'BLOCKED','INVARIANT req25 checker g3Status blocked');
  assert.equal(r.g3_evidence,false,'INVARIANT req25 not G3 evidence');
  assert.equal(r.g3_evidence_count,0,'INVARIANT zero G3 evidence');
  assert.deepEqual(JSON.parse(JSON.stringify(r.allowed_verdicts)),['CONTRACT_OK_ON_SYNTHETIC','BLOCKED','FAIL'],'INVARIANT req25 verdict vocabulary');
  assert.deepEqual(JSON.parse(JSON.stringify(r.checkers.map(c=>[c.requirement,c.pr,c.merge_commit]))),[[2,58,'ea2f44a'],[3,59,'384cfa8'],[4,60,'ae7dc3f'],[5,61,'cee6fe6']],'INVARIANT req25 merged checkers');
  assert.equal(r.node_tests_total,387,'INVARIANT req25 node tests');
  assert.equal(r.node_tests_fail,0,'INVARIANT req25 node test failures');
  assert.equal(d.progress.items.find(x=>x.id==='progress-req25-offline').state,'done','INVARIANT req25 offline progress');
  assert.equal(d.progress.items.find(x=>x.id==='progress-req25-live').state,'blocked','INVARIANT req25 live progress blocked');
  for(const id of ['dec-oct11-req25','dec-oct11-dec007','dec-oct11-b03-tooling','dec-oct11-organizer']){
    const item=d.decisions.items.find(x=>x.id===id);
    assert.equal(item?.status,'decided',`INVARIANT 10/11 user decision ${id}`);
    assert.equal(item.owner,'human',`INVARIANT 10/11 decision owner ${id}`);
    assert.ok(item.sources.includes('src-decisions-oct11'),`INVARIANT 10/11 decision source ${id}`);
    assertVisibleFields(views.decisions,item,['title','note']);
  }
  assert.equal(d.decisions.items.find(x=>x.id==='dec-007').status,'open','INVARIANT dec-007 result not recorded as done');
  for(const phrase of ['オフラインchecker','実観測は未実施','10/12','Ollama鍵','結果未共有','G3証拠は0件'])
    assert.ok(overview.includes(phrase),`INVARIANT req25 overview ${phrase}`);
  for(const n of [57,58,59,60,61])assert.ok(resultView.includes(`PR #${n}`),`INVARIANT 10/11 merged PR ${n}`);
  const claims=JSON.stringify([d.status.headline,d.status.subhead,d.status.changes,d.status.next_steps,d.status.priority,d.status.req25,d.ui.copy]);
  assert.doesNotMatch(claims,/実観測(?:は|を)?(?:完了|済み)|live observation (?:done|complete)|G3 ?(?:は)?PASS|G3証拠あり|verdict[^"]*PASS|B03[^"。]*(?:PASS済|解消済|closed済)|干渉なし|同等(?:性)?(?:を|が)?(?:確認|成立)|残り?\s*\d+(?:\.\d+)?\s*h/i,'INVARIANT req25 no false completion claims');
  // 2026-10-11 PR #63: B07 offline audit + unregistered r3 manifest DRAFT. B07 stays BLOCKED.
  const b7=d.status.b07;
  assert.equal(b7.state,'offline-audit-merged-blocked','INVARIANT B07 audit state');
  assert.equal(b7.b07_status,'BLOCKED','INVARIANT B07 blocked');
  assert.equal(b7.closed,false,'INVARIANT B07 not closed');
  assert.deepEqual([b7.pr,b7.merge_commit],[63,'68102ef'],'INVARIANT B07 audit merge');
  assert.equal(b7.candidate_sha256,'a03da51869cf8c8160aaa25eb5f1e87cfa74a3a9dfdac3050945a71f7d143dff','INVARIANT B07 candidate tree hash');
  assert.equal(b7.candidate_hash_matches_lock,true,'INVARIANT B07 candidate hash matches lock');
  assert.equal(b7.candidate_files_matching_lock,5,'INVARIANT B07 five candidate files');
  assert.equal(b7.chain_tools_r2_pinned,13,'INVARIANT B07 chain tools still r2');
  assert.deepEqual(JSON.parse(JSON.stringify(b7.r2_pins)),['release-r2','ec80bb8','/tmp/g3-chain'],'INVARIANT B07 r2 pins');
  assert.equal(b7.draft_registered,false,'INVARIANT B07 draft not registered');
  assert.equal(b7.check_py_scope,'synthetic-only','INVARIANT B07 check.py synthetic only');
  assert.equal(b7.check_py_run_on_draft,false,'INVARIANT B07 check.py not run on draft');
  assert.equal(b7.g3_evidence,false,'INVARIANT B07 audit not G3 evidence');
  assert.deepEqual(JSON.parse(JSON.stringify(b7.undecided_fields.map(f=>f.field))),['r3実行source（commit・path）','必須ファイル集合','eval領域','toolの再登録','state dump','ZIP・観測器・CLIの束縛'],'INVARIANT B07 undecided fields');
  for(const f of b7.undecided_fields)assert.ok(f.reason,`INVARIANT B07 null reason ${f.field}`);
  assert.equal(d.progress.items.find(x=>x.id==='progress-b07-offline-audit').state,'blocked','INVARIANT B07 progress blocked');
  assert.equal(d.blockers.items.find(x=>x.id==='B01').status,'open','INVARIANT G3 blocker open');
  assert.ok(resultView.includes('PR #62')&&resultView.includes('PR #63'),'INVARIANT 10/11 merged PR 62/63');
  for(const phrase of ['B07はBLOCKEDのまま','登録済みmanifestではない','意図的に実行していない','本人レビュー','Anvil','Docker'])
    assert.ok(overview.includes(phrase),`INVARIANT B07 overview ${phrase}`);
  const userSteps=d.status.next_steps.filter(s=>/USER · 本人のみ/.test(s.label)).map(s=>s.title);
  assert.equal(userSteps.length,3,'INVARIANT three user-only next steps');
  for(const re of [/Ollama/,/10\/12以降の実観測/,/B07のtool移植・再登録/])
    assert.ok(userSteps.some(t=>re.test(t)),`INVARIANT user-only step ${re}`);
  const b7claims=JSON.stringify([d.status.headline,d.status.subhead,d.status.last_update,d.status.changes,d.status.next_steps,d.status.priority,d.status.b07,d.blockers.items.find(x=>x.id==='B01'),d.progress.items.find(x=>x.id==='progress-b07-offline-audit')]);
  assert.doesNotMatch(b7claims,/B07(?:は|を)?(?:閉じた|解消済|解消した|closed|PASS)|(?:DRAFT|manifest)(?:は|を)?登録済み(?!manifestでは)|registered manifest(?! ?is not)|check\.py[^"。]*(?:実manifest|実入力)[^"。]*(?:検証済|合格|PASS|OK)|check\.py validated/i,'INVARIANT B07 no false closure claims');
}
check('October status separates completed timing, conditional work and blocked gates',()=>{
  assertOctoberStatus(invariantViews());
  const footer=element('footer').innerHTML;
  assert.ok(footer.includes('基準時点'));
  for(const id of app.D.status.footer_sources){
    const source=app.D.sources.sources.find(s=>s.id===id);
    assert.ok(footer.includes(source.path),'footer links to the actual source file');
  }
  const decisionHistory=rendered.decisions.indexOf('原判断・署名・過去の未決提案');
  assert.ok(decisionHistory>rendered.decisions.indexOf('決定済みの方針'),'current policy precedes historical proposals');
  assert.ok(rendered.overview.includes('<figure class="next-lane'),'next lane is a figure with a caption');
});
check('October red controls reject false gate, budget and interference completion',()=>{
  for(const [label,mutate] of [
    ['G3 false pass',d=>{d.status.g3_state='PASS';}],
    ['remaining hours invented',d=>{d.status.budget_state='70 h';}],
    ['exact spend invented',d=>{d.budget.consumed_exact_hours=30;}],
    ['harness false validation',d=>{d.status.timing.state='validated';}],
    ['interference result invented',d=>{d.status.timing.result={delay:0};}],
    ['timing merge lost',d=>{d.status.timing.merged=false;}],
    ['timing false G3 evidence',d=>{d.status.timing.g3_evidence=true;}],
    ['interference falsely resolved',d=>{d.status.timing.interference_state='resolved';}],
    ['control verdict inflated',d=>{d.status.timing.result.control_verdict='PASS';}],
    ['overhead erased',d=>{d.status.timing.result.median_overhead_ms=0;}],
    ['negative degeneracy removed',d=>{d.status.timing.result.negative_degenerate=false;}],
    ['MDE understated',d=>{d.status.timing.result.conservative_mde_ms=[1,1];}],
    ['optimistic MDE lost',d=>{d.status.timing.result.optimistic_mde_ms=null;}],
    ['limits removed',d=>{d.status.timing.limitations=[];}],
    ['failure thresholds erased',d=>{d.status.timing.result.load_thresholds=[8];}],
    ['timing progress stale',d=>{d.progress.items.find(x=>x.id==='progress-probe-timing').state='running';}],
    ['timing running again',d=>{d.queue.items.find(x=>x.id==='queue-probe-timing').active=true;}],
    ['continuation delegated',d=>{d.queue.items.find(x=>x.id==='queue-g3-bounded').owner='Codex';}],
    ['offline extension activated',d=>{d.queue.items.find(x=>x.id==='queue-offline-b04-b07').active=true;}],
    ['B03 false pass',d=>{d.status.b03.safety_pass=true;}],
    ['B03 false closure',d=>{d.status.b03.closed=true;}],
    ['B03 agent acceptance',d=>{d.status.b03.accepted_by='agent';}],
    ['organizer premise asserted as fact',d=>{d.status.b03.organizer_premise_verified=true;}],
    ['organizer question sent',d=>{d.status.b03.question_sent=true;}],
    ['organizer question rescheduled',d=>{d.status.b03.question_will_send=true;}],
    ['B03 silently removed from tooling',d=>{d.status.b03.tooling_blocker_retained=false;}],
    ['tooling representation decided',d=>{d.status.b03.tooling_representation='resolved';}],
    ['exploration artifact verification invented',d=>{d.status.timing.exploration.artifact_verified=true;}],
    ['exploration numerical result invented',d=>{d.status.timing.exploration.grid_ms=0;}],
    ['B03 decision reopened',d=>{d.decisions.items.find(x=>x.id==='dec-oct10-b03').status='open';}],
    ['next step removed',d=>{d.status.next_steps.pop();}],
    ['G3 policy reopened',d=>{d.decisions.items.find(x=>x.id==='dec-oct09-g3').status='open';}],
    ['tooling representation reopened',d=>{d.status.b03.tooling_representation='open-user-decision';}],
    ['req 2-5 live observation done',d=>{d.status.req25.live_observation='done';}],
    ['req 2-5 live finishable by deadline',d=>{d.status.req25.live_completable_by_deadline=true;}],
    ['req 2-5 live progress done',d=>{d.progress.items.find(x=>x.id==='progress-req25-live').state='done';}],
    ['req 2-5 deadline auto-extended',d=>{d.status.req25.auto_extend=true;}],
    ['req 2-5 scope narrowed',d=>{d.status.req25.scope='requirement-2-only';}],
    ['checker G3 PASS',d=>{d.status.req25.g3_status='PASS';}],
    ['checker verdict PASS',d=>{d.status.req25.allowed_verdicts.push('PASS');}],
    ['checker as G3 evidence',d=>{d.status.req25.g3_evidence=true;}],
    ['G3 evidence invented',d=>{d.status.req25.g3_evidence_count=1;}],
    ['synthetic-only dropped',d=>{d.status.req25.synthetic_only=false;}],
    ['node test count changed',d=>{d.status.req25.node_tests_total=400;}],
    ['merged checker lost',d=>{d.status.req25.checkers.pop();}],
    ['dec-007 result invented',d=>{d.decisions.items.find(x=>x.id==='dec-007').status='resolved';}],
    ['10/11 decision deleted',d=>{d.decisions.items=d.decisions.items.filter(x=>x.id!=='dec-oct11-req25');}],
    ['headline claims live done',d=>{d.status.headline='要件2〜5の実観測は完了。';}],
    ['headline claims G3 PASS',d=>{d.status.headline='G3 PASS。';}],
    ['changes claim checker verdict PASS',d=>{d.status.changes.items.push('checker verdict PASS');}],
    ['remaining hours number',d=>{d.status.subhead+=' 残り40h';}],
    ['no interference claimed',d=>{d.status.subhead+=' 干渉なし';}],
    ['equivalence claimed',d=>{d.status.subhead+=' 同等性を確認';}],
    ['B03 PASS claimed in text',d=>{d.status.priority.note+=' B03はPASS済み';}],
    ['B07 closed',d=>{d.status.b07.closed=true;}],
    ['B07 status PASS',d=>{d.status.b07.b07_status='PASS';}],
    ['B07 closed in text',d=>{d.status.changes.items.push('B07は解消済み');}],
    ['B07 closed in log summary',d=>{d.status.last_update+=' B07を閉じた';}],
    ['draft registered',d=>{d.status.b07.draft_registered=true;}],
    ['draft registered in text',d=>{d.status.changes.items.push('DRAFTは登録済み');}],
    ['check.py run on draft',d=>{d.status.b07.check_py_run_on_draft=true;}],
    ['check.py validated real manifest',d=>{d.status.changes.items.push('check.pyで実manifestを検証済み');}],
    ['check.py scope widened',d=>{d.status.b07.check_py_scope='real-input';}],
    ['B07 audit as G3 evidence',d=>{d.status.b07.g3_evidence=true;}],
    ['candidate hash altered',d=>{d.status.b07.candidate_sha256='0'.repeat(64);}],
    ['candidate lock mismatch hidden',d=>{d.status.b07.candidate_hash_matches_lock=false;}],
    ['r2 pins erased',d=>{d.status.b07.chain_tools_r2_pinned=0;}],
    ['undecided field dropped',d=>{d.status.b07.undecided_fields.pop();}],
    ['null reason erased',d=>{d.status.b07.undecided_fields[0].reason='';}],
    ['B07 progress done',d=>{d.progress.items.find(x=>x.id==='progress-b07-offline-audit').state='done';}],
    ['B07 user review delegated',d=>{d.status.next_steps[2].label='Claude / 自動';}],
    ['G3 blocker closed',d=>{d.blockers.items.find(x=>x.id==='B01').status='resolved';}]
  ])rejectMutation(label,mutate,assertOctoberStatus);
});
console.log(`PASS dashboard UI: ${count} checks; ${app.D.ui.pages.length} page renderers + qualification view; search/filter/navigation/tooltips/escaping`);
console.log('PASS red controls: altered headline, progress value and max each rejected in memory; original assertions pass');
console.log(`PASS invariant red controls: ${invariantReds} false claims rejected in memory; original passes after every mutation`);
console.log('LIMIT: minimal DOM adapter, not a browser; visual layout and assistive technology unverified');
