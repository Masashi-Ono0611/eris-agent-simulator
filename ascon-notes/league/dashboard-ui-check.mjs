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
  Object.assign(run,{state:'measured-diagnostic-complete',expected_end:null,completed_at:'2026-10-05T00:41:00+09:00',completed_worlds:24,note:'test-only confirmed completion'});
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
  for(const value of ['23世界PASS','crash/40001','grok-1','telemetry','BLOCKEDをPASSとは扱わない','40003/40004','結果未確認','48世界'])assert.ok(t.includes(value),value);
  const before=app.D.status.mix1.result.t_candidate;
  app.D.status.mix1.result.t_candidate='REV11-MIX-SENTINEL';app.state.page='results';app.state.results='diagnostic';app.render();
  assert.ok(element('page').innerHTML.includes('REV11-MIX-SENTINEL'));
  app.D.status.mix1.result.t_candidate=before;
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
console.log(`PASS dashboard UI: ${count} checks; ${app.D.ui.pages.length} page renderers + qualification view; search/filter/navigation/tooltips/escaping`);
console.log('PASS red controls: altered headline, progress value and max each rejected in memory; original assertions pass');
console.log('LIMIT: minimal DOM adapter, not a browser; visual layout and assistive technology unverified');
