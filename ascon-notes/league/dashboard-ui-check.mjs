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
for(const page of app.D.ui.pages){
  check(`render ${page.key}`,()=>{
    app.state.page=page.key;app.render();
    const text=element('page').innerHTML;
    assert.ok(text.includes(page.label));
    assert.ok(!text.includes('undefined'),'missing data must not leak');
    assert.ok(!text.includes('NaN'),'numbers must remain defined');
    assert.ok(!/src=["']https?:|<iframe|<script/i.test(text),'rendered UI must not load resources');
    assert.equal((text.match(/<h1\b/g)||[]).length,1,'one page heading');
    assert.ok(element('navigation').innerHTML.includes(`href="#${page.key}" class="nav-link" aria-current="page"`));
    rendered[page.key]=text;
  });
}
check('overview snapshot and no fake run percentage',()=>{
  const t=rendered.overview;
  assert.ok(t.includes(app.D.status.headline));
  assert.ok(t.includes('value="3" max="5"'));
  assert.ok(t.includes('本人が今やること'));
  assert.ok(t.includes('17:40 JST'));
  assert.ok(!/log-\d+/.test(t));
});
check('qualification result keeps failed and blocked states',()=>{
  app.state.page='results';app.state.results='qualification';app.render();
  const t=element('page').innerHTML;rendered.qualification=t;
  assert.ok(t.includes('44.56')&&t.includes('56.50')&&t.includes('48.07')&&t.includes('56.43'));
  assert.ok(t.includes('不合格')&&t.includes('ブロック'));
  assert.ok(t.includes('未実施'));
});
check('diagnostic metrics from JSON rather than display constants',()=>{
  app.state.results='diagnostic';app.D.status.dev2.result.p_candidate='TEST-VALUE';app.render();
  assert.ok(element('page').innerHTML.includes('TEST-VALUE'));
  app.D.status.dev2.result.p_candidate='149.0';
});
check('log count and complete history',()=>{
  assert.equal(app.filteredLogs().length,65);
  assert.equal((rendered.log.match(/class="log-entry"/g)||[]).length,65);
  for(const l of app.D.log.items)assert.ok(rendered.log.includes(l.id));
});
check('log AND search, kind and date filters compose',()=>{
  app.state.logQuery='Ollama';
  const selected=app.filteredLogs();assert.ok(selected.length>0&&selected.length<65);
  app.state.logType=selected[0].type;app.state.logDate=selected[0].timestamp.slice(0,10);
  const combined=app.filteredLogs();assert.ok(combined.length>0);
  assert.ok(combined.every(l=>l.type===app.state.logType&&l.timestamp.startsWith(app.state.logDate)));
  app.state.logQuery='cannot-match-any-log';assert.equal(app.filteredLogs().length,0);
  app.state.logQuery='';app.state.logType='all';app.state.logDate='all';
});
check('search input handler updates results without replacing input focus',()=>{
  app.state.page='log';app.render();
  listeners.get('input')({target:{id:'log-search',value:'Ollama'}});
  assert.ok(!element('log-count').textContent.startsWith('65 /'));
  assert.ok(element('log-items').innerHTML.includes('Ollama'));
  listeners.get('input')({target:{id:'log-search',value:'not-present-284'}});
  assert.ok(element('log-items').innerHTML.includes('一致するログはありません'));
  app.state.logQuery='';
});
check('glossary finds aliases and Japanese definitions',()=>{
  app.state.termQuery='FROZEN';assert.ok(app.filteredTerms().some(t=>t.id==='term-frozen'));
  app.state.termQuery='何もしない';assert.ok(app.filteredTerms().some(t=>t.id==='term-noop'));
  app.state.termQuery='';assert.equal(app.filteredTerms().length,49);
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
  const before={...app.D.status.dev3};
  Object.assign(app.D.status.dev3,{state:'measured-diagnostic-complete',expected_end:null,completed_at:'2026-10-04T17:41:00+09:00',completed_worlds:18,note:'test-only confirmed completion'});
  app.state.page='operations';app.render();
  assert.ok(element('page').innerHTML.includes('診断完了の引継ぎ'));
  assert.ok(element('page').innerHTML.includes('17:41'));
  assert.ok(!element('page').innerHTML.includes('NaN'));
  app.state.page='overview';app.render();assert.ok(element('page').innerHTML.includes('確認された完了時刻'));
  Object.assign(app.D.status.dev3,before);
});
if(process.argv.includes('--dump')){
  const target=process.argv[process.argv.indexOf('--dump')+1];
  assert.ok(target?.startsWith('/tmp/')||target?.startsWith('/private/tmp/'),'dump must be an explicit temporary path');
  writeFileSync(target,JSON.stringify(rendered));
}
console.log(`PASS dashboard UI: ${count} checks; 8 page renderers + qualification view; search/filter/navigation/tooltips/escaping`);
console.log('LIMIT: minimal DOM adapter, not a browser; visual layout and assistive technology unverified');
