import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const {loadCore,baseState,HTML,withIdb}=require('./_load.js');
const C=loadCore();
const row=(extra={})=>({board:'B1',figure:'1',comp:'U1',pad:'P1',group:'G',volume:100,height:120,area:100,offx:0,offy:0,pressure:4,speed:30,sep:2,...extra});
const state=rows=>baseState(C,{rows,specSrc:'sample',metric:'volume',group:'ALL',heightUnit:'um'});
test('診斷分母限規格可判定列，多代碼只計一次，保留缺值及零分母',()=>{
  const rows=[row({volume:200,height:300,area:200}),row({volume:null,height:null,area:null,offx:null,offy:null}),row({volume:100,height:null}),row({group:'NO',volume:100})];
  const st=state(rows);st.specsG={NO:{volume:{lsl:null,usl:null},height:{lsl:null,usl:null},area:{lsl:null,usl:null},offx:{lsl:null,usl:null},offy:{lsl:null,usl:null}}};
  const before=JSON.stringify(st),M=C.buildDiagnosticModel(st,{matrixBy:'group'}),g=M.cells.get('B1').get(JSON.stringify(['group','G']));
  assert.equal(g.n,2);assert.equal(g.bad,1);assert.equal(g.rate,.5);assert.equal(g.missing,1);assert.equal(g.partial,1);
  assert.equal(M.cells.get('B1').get(JSON.stringify(['group','NO'])).rate,null);assert.equal(JSON.stringify(st),before);
  const none=C.buildDiagnosticModel({...st,specSrc:'none'});assert.equal([...none.cells.get('B1').values()][0].rate,null);
});
test('跨子板相同位號分開；元件範圍、單邊面積規格與未知高度沿用既有語意',()=>{
  const st=state([row(),row({figure:'2'}),row({comp:'U2'})]);
  assert.equal(C.buildDiagnosticModel(st).entities.length,3);
  st.comp=C.compKeyOf(st.rows[1]);assert.equal(C.buildDiagnosticModel(st).rows.length,1);
  const only=state([row({volume:null,height:200,area:50,offx:null,offy:null})]);only.heightUnit='unknown';only.specs.area={lsl:70,usl:null};
  const c=[...C.buildDiagnosticModel(only).cells.get('B1').values()][0];assert.equal(c.n,0);assert.equal(c.rate,null);
});
test('盒鬚圖用 1.5 IQR，另列板數，方向缺值不做奇偶補值；因素排除 null 和空字串',()=>{
  const rows=[1,2,3,4,100].map((v,i)=>row({board:'B'+(i+1),volume:v,stroke:i===4?null:'F',pressure:i===0?null:i===1?'':4}));
  const M=C.buildDiagnosticModel(state(rows));assert.equal(M.box[0].lo,1);assert.equal(M.box[0].hi,4);assert.deepEqual([...M.box[0].out],[100]);assert.equal(M.box[0].boards,5);
  assert.equal(M.missingFactor,2);assert.equal(M.factors.length,3);assert.equal(M.factorComparable,false);
  const D=C.buildDiagnosticModel(state(rows),{boxBy:'stroke'});assert.equal(D.missingStroke,1);assert.equal(D.box[0].n,4);
});
test('製程因素按板、群組、實際值聚合，不把同板不同設定混為一點',()=>{
  const rows=[row({volume:80}),row({volume:120}),row({pressure:5,volume:60}),row({board:'B2'}),row({group:'H'})];
  const M=C.buildDiagnosticModel(state(rows));assert.equal(M.factors.length,4);assert.equal(M.factors[0].y,100);assert.equal(M.factors[0].n,2);assert.equal(M.factorComparable,true);
});
test('來源 ID、量測、板與實體可解析；模糊焊墊與無歸屬問題保留回合',()=>{
  const st=state([row(),row({figure:'2',board:'B2'}),row({pad:'UNIQUE',comp:'U2'})]);
  const s=C.diagnosticSource(st,{id:4,go:{metric:'height'},ents:['p:UNIQUE','b:B1']});assert.equal(s.issue,4);assert.equal(s.metric,'height');assert.equal(s.parts.length,1);assert.deepEqual([...s.boards],['B1']);
  const vague=C.diagnosticSource(st,{id:5,ents:['p:P1']});assert.equal(vague.parts.length,0);assert.ok(st.rows.every(r=>C.diagnosticMatch(r,{source:vague})));
  const drift=C.diagnosticSource(st,{id:6,ents:['drift:B2']});assert.deepEqual([...drift.boards],['B2']);
});
test('診斷互動：雙向分頁、來源焦點、完整板序、界限不變及換回合重設',async()=>{
  const {JSDOM,VirtualConsole}=require('jsdom'),errors=[],configs=new Map(),vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
  const dom=new JSDOM(readFileSync(HTML,'utf8').replace(/<script src=[^>]+><\/script>/g,''),{runScripts:'dangerously',url:'https://example.test',virtualConsole:vc,beforeParse(w){
    withIdb(w);w.SPI_TEST_HOOK={bootSample:true};w.matchMedia=()=>({matches:false,addEventListener(){}});w.ResizeObserver=class{observe(){}};w.scrollTo=()=>{};w.Element.prototype.scrollIntoView=()=>{};
    w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:(t,k)=>k==='measureText'?()=>({width:1}):t[k]??(()=>{}),set:(t,k,v)=>(t[k]=v,true)});
    Object.defineProperty(w.HTMLElement.prototype,'offsetParent',{get(){return w.document.body}});
    w.Chart=class{constructor(c,cfg){this.data=cfg.data;configs.set(c.id,cfg)}destroy(){}static register(){}};
  }});
  try{
    const w=dom.window,d=w.document,H=w.SPI_TEST_HOOK,until=async f=>{const end=Date.now()+10000;while(!f()){if(Date.now()>end)throw Error('UI ready timeout: '+errors.join(';'));await new Promise(r=>setTimeout(r,10))}};
    await until(()=>H.S?.F&&!H.S.F.pending);const S=H.S,originalRows=S.rows;
    const button=d.querySelector('[data-diag-issue]');assert.ok(button);const issue=S.F.find(x=>String(x.id)===button.dataset.diagIssue);
    const before={metric:S.metric,chart:S.chart,board:S.board,pad:S.pad,group:S.group,comp:S.comp,F:S.F,A:S.A};
    button.click();assert.equal(w.location.hash,'#issues/diagnostic');assert.equal(H.DIAG.source.issue,issue.id);
    const limits=JSON.stringify(configs.get('diagControl').data.datasets.slice(1).map(x=>x.data));
    d.querySelector('#diagMatrix [data-dboard]').focus();d.activeElement.click();assert.ok(d.activeElement.dataset.dboard!=null,'選取後保留矩陣鍵盤焦點');assert.equal(JSON.stringify(configs.get('diagControl').data.datasets.slice(1).map(x=>x.data)),limits);
    for(const [k,v]of Object.entries(before))assert.equal(S[k],v,`不修改 S.${k}`);
    d.querySelector('#diagBack').click();assert.equal(d.activeElement.dataset.diagIssue,String(issue.id));
    d.querySelector('[data-subnav-issues=diagnostic]').click();assert.equal(H.DIAG.source,null);
    S.chart='ewma';H.renderDiagnostic();
    assert.equal(configs.get('diagControl').data.datasets[0].label,'EWMA','手動診斷沿用目前管制圖');
    H.openDiagnostic({...issue,go:{...issue.go,tab:'control',chart:'cusum'}});
    const cusum=configs.get('diagControl').data;
    assert.deepEqual(Array.from(cusum.datasets,d=>d.label),['C+','C−','+h','−h']);
    assert.match(d.querySelector('#diagControlData').textContent,/C−/);
    assert.equal(S.chart,'ewma','來源問題圖種不改寫主管制圖');
    const decisions=JSON.stringify(cusum.datasets.slice(2).map(d=>d.data));
    d.querySelector('#diagMatrix [data-dboard]').click();
    assert.equal(JSON.stringify(configs.get('diagControl').data.datasets.slice(2).map(d=>d.data)),decisions);
    S.chart=before.chart;
    d.querySelector('[data-subnav-issues=diagnostic]').click();
    S.rows=Array.from({length:41},(_,b)=>Array.from({length:26},(_,c)=>row({board:'B'+b,comp:'U'+c,pad:'P'+c,volume:100+b%3+c%2}))).flat();H.renderDiagnostic();
    assert.match(d.querySelector('#diagEntityPages').textContent,/1 \/ 2/);assert.match(d.querySelector('#diagBoardPages').textContent,/1 \/ 2/);
    d.querySelector('[data-diag-page=page][data-step="1"]').click();d.querySelector('[data-diag-page=boardPage][data-step="1"]').click();
    assert.match(d.querySelector('#diagMatrix').textContent,/U25/);assert.match(d.querySelector('#diagMatrix').textContent,/B40/);
    d.querySelector('[data-diag-page=page][data-step="-1"]').click();d.querySelector('[data-diag-page=boardPage][data-step="-1"]').click();
    assert.equal(H.DIAG.page,0);assert.equal(H.DIAG.boardPage,0);assert.equal(configs.get('diagControl').data.labels.length,41);
    d.querySelector('#diagMatrix [data-dboard]').click();assert.notEqual(H.DIAG.board,null);d.querySelector('#diagClear').click();assert.equal(H.DIAG.board,null);
    H.selectDiagnostic('B0',H.diagnosticModel().entities[0].key);S.rows=[...S.rows];H.renderDiagnostic();assert.equal(H.DIAG.entity,null,'重新匯入（新 rows）清除選取');
    S.rows=originalRows;H.switchRun(S.runs[1].id);H.renderDiagnostic();assert.equal(H.DIAG.board,null);assert.equal(H.DIAG.source,null);assert.equal(H.DIAG.back,null);
    assert.deepEqual(errors,[]);
  }finally{dom.window.close()}
});
