import test from "node:test";
import assert from "node:assert/strict";
import {
  importTab,
  sceneLines,
  serialiseTab,
  makeRow,
  sampleWorkbook,
  validateNodeName,
  findNode,
  exportYarn,
  choiceGroup,
  pendingChanges,
} from "../src/lib/workbook.js";
import { parseCommands } from "../src/lib/commands.js";

test("legacy blank node continuations are visible; blank separators and literal text are retained", () => {
  const rows = [
    ["Start", "", "A", "first"],
    [],
    ["", "", "A", '=HYPERLINK("x")', "", "", "", "note"],
    ["Other", "", "", "next"],
  ];
  const tab = importTab({ id: 1, name: "日本語", rows });
  assert.equal(sceneLines(tab, "Start").length, 2);
  const output = serialiseTab(tab);
  assert.equal(output.length, 4);
  assert.equal(output[2][0], "Start");
  assert.equal(output[2][3], '=HYPERLINK("x")');
  assert.equal(output[2][7], "note");
  assert.deepEqual(output[1], Array(8).fill(""));
  assert.equal(tab.rows[2].sourceRow, 4);
});
test("line creation uses distinct stable IDs and repeats its scene node", () => {
  const a = makeRow("Start"),
    b = makeRow("Start");
  assert.notEqual(a.lineId, b.lineId);
  assert.equal(a.node, "Start");
  assert.equal(a.sourceRow, null);
});
test("choice rows form groups; existing and new node names are checked", () => {
  const w = sampleWorkbook(),
    lines = sceneLines(w.tabs[0], "Tutorial_Start");
  assert.equal(choiceGroup(lines, 2).length, 2);
  assert.equal(choiceGroup(lines, 3).length, 2);
  assert.ok(validateNodeName("Tutorial_A", w));
  assert.ok(validateNodeName("bad node", w));
  assert.equal(validateNodeName("朝会話_2", w), "");
  assert.equal(findNode(w, "Tutorial_A").name, "Tutorial_A");
});
test("legacy starred names are preserved but not emitted as invalid Yarn", () => {
  const w = sampleWorkbook();
  w.tabs[0].rows[0].node = "*Test";
  assert.equal(findNode(w, "Test").name, "*Test");
  assert.throws(() => exportYarn(w, parseCommands), /記号/);
  assert.equal(serialiseTab(w.tabs[0])[0][0], "*Test");
});
test("Yarn export follows commands -> dialogue -> choices and jump mapping", () => {
  const w = sampleWorkbook();
  const yarn = exportYarn(w, parseCommands);
  assert.match(
    yarn,
    /title: Tutorial_Start\n---\n<<background "BG_City_Day" "instant">>\nはじめまして！/,
  );
  assert.match(yarn, /-> Aにする\n    <<jump Tutorial_A>>/);
  assert.match(yarn, /白崎桃香: こんにちは/);
  w.tabs[0].rows[2].nextNode = "Missing";
  assert.throws(() => exportYarn(w, parseCommands), /Missing/);
});
test("change review counts implicit node assignments explicitly", () => {
  const rows = [
    ["Start", "", "", "Hello"],
    ["", "", "", "World"],
  ];
  const tab = importTab({ id: 1, name: "a", rows });
  assert.equal(pendingChanges(tab, { rows }).assignedNodes, 1);
});
