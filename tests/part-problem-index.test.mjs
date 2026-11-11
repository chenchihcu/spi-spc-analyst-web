import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../spi-spc.html",import.meta.url),"utf8");
const builder = source.slice(source.indexOf("function partMapKey"),source.indexOf("function pmapState"));
const build = runInNewContext('const PM_RANK={ng:0,warn:1,info:2};'+builder+";buildPartProblemIndex");
const row = (board,comp,pad,extra={}) => ({board,comp,pad,group:"0402",...extra});
const card = (id,t,extra={},ents=[]) => ({id,lv:"ng",sig:{t,...extra},ents});
const parts = (index,board) => [...index.boards.get(board).parts.values()];

test("only unambiguous component centers contribute to board bounds", () => {
  const index=build([
    row("B1","U1","A",{componentX:0,componentY:0}),
    row("B1","U2","B",{gridPos:true,x:5,y:5}),
    row("B1","U3","C",{componentX:30,componentY:10}),
    row("B1","U3","D",{componentX:30,componentY:11}),
    row("B2","U1","A",{componentX:0,componentY:10})
  ],[]);
  assert.deepEqual(Array.from(index.bounds),[0,0,0,10]);
  assert.equal(parts(index,"B1")[1].center,null);
  assert.equal(parts(index,"B1")[2].conflict,true);
  assert.equal(index.worstBoard,"B1");
  assert.equal(index.hasBoardHits,false);
});

test("identity, pad scope, aggregate levels and cross-board relations remain distinct", () => {
  const a=row("B1","U1","A",{figure:"1"}), b=row("B1","U1","A",{figure:"2"});
  const c=row("B1","U2","C"), d=row("B2","U2","C"), e=row("B3","U2","C");
  const f=row("B1","","U1",{figure:"1"});
  const findings=[
    card(1,"iso",{rows:[{r:a,lv:"warn"},{r:b,lv:"ng"}]}),
    card(2,"repeated",{padObjs:[{pad:"C",boards:["B2"]}]}),
    card(3,"mcd",{g:"0402",pads:["C"]}),
    card(4,"local",{g:"0402",b:"B3"}),
    card(5,"dfm",{g:"0402"}),
    card(6,"pad",{g:"0402",pads:["A"]})
  ];
  const rows=[a,b,c,d,e,f], before=JSON.stringify([rows,findings]);
  const index=build(rows,findings);
  const [first,second,third,fallback]=parts(index,"B1");
  assert.equal(index.parts.size,4);
  assert.notEqual(first.part.key,fallback.part.key);
  assert.equal(first.hits.get(1),"warn");
  assert.equal(second.hits.get(1),"ng");
  assert.equal(first.part.pads.get("A").cross.size,0);
  assert.ok(index.unresolved.has(6));
  assert.equal(third.hits.size,0);
  assert.equal(third.part.pads.get("C").hits.size,1);
  assert.equal(third.part.pads.get("C").hits.get("B2").get(2),"ng");
  assert.equal(third.part.pads.get("C").cross.get(3),"ng");
  assert.equal(third.part.pads.get("C").boards.size,3);
  assert.deepEqual([...third.part.hits],["B2","B3"]);
  assert.equal(parts(index,"B3")[0].groupHits.get(4),"ng");
  assert.equal(third.part.groups.get("0402").get(5),"ng");
  assert.equal(JSON.stringify([rows,findings]),before);
});

test("batch evidence respects scope and ties use input board order", () => {
  const rows=[row("Z","U1","A"),row("A","U1","A"),row("M","U1","A")];
  const index=build(rows,[
    card(1,"drift",{b:"A"},["drift:A"]),card(2,"align",{bs:["outside"]},["b:outside"]),
    card(3,"unit"),card(4,"unknown"),card(5,"drift",{b:"outside"},["drift:outside"])
  ]);
  assert.equal(index.worstBoard,"A");
  assert.equal(index.boards.get("Z").batch.size,0);
  assert.deepEqual([...index.boards.get("M").batch.keys()],[1]);
  assert.deepEqual([...index.globalBatch.keys()],[3]);
  assert.deepEqual([...index.unresolved],[4]);
  assert.equal(parts(index,"A")[0].hits.size,0);
});
