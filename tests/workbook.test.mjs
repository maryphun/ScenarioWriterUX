import test from "node:test";
import assert from "node:assert/strict";
import {
  importTab,
  sceneLines,
  serialiseTab,
  makeRow,
  makeInstructionRow,
  isInstructionRow,
  instructionText,
  emptyWorkbook,
  validateNodeName,
  findNode,
  exportYarn,
  choiceGroup,
  pendingChanges,
  removeScriptRow,
} from "../src/lib/workbook.js";
import { parseCommands } from "../src/lib/commands.js";

function fixtureWorkbook() {
  return {
    title: "脚本",
    speakers: [],
    tabs: [
      importTab({
        id: 1,
        name: "チュートリアル",
        revision: "fixture",
        rows: [
          [
            "Tutorial_Start",
            "",
            "",
            "はじめまして！",
            "",
            "",
            "[background:BG_City_Day:instant]",
            "",
          ],
          [
            "Tutorial_Start",
            "",
            "白崎桃香",
            "こんにちは",
            "",
            "",
            "",
            "",
          ],
          [
            "Tutorial_Start",
            "",
            "",
            "",
            "Aにする",
            "Tutorial_A",
            "",
            "",
          ],
          [
            "Tutorial_Start",
            "",
            "",
            "",
            "Bにする",
            "Tutorial_B",
            "",
            "",
          ],
          ["Tutorial_A", "", "白崎桃香", "Aを選んだね"],
          ["Tutorial_B", "", "奥殿テトラ", "Bを選んだね"],
        ],
      }),
    ],
  };
}

test("a new editor session contains no sample workbook", () => {
  const workbook = emptyWorkbook();
  assert.deepEqual(workbook.tabs, []);
  assert.deepEqual(workbook.speakers, []);
});

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
test("instruction rows remain in their scene but never become nodes or Yarn", () => {
  const tab = importTab({
    id: 1,
    name: "Story",
    rows: [
      ["Start", "", "A", "Before"],
      ["[ここで戦闘を挿入]", "", "", "", "", "", "", ""],
      ["", "", "A", "After"],
    ],
  });
  const instruction = tab.rows[1];
  assert.equal(isInstructionRow(instruction), true);
  assert.equal(instructionText(instruction), "ここで戦闘を挿入");
  assert.equal(sceneLines(tab, "Start").length, 3);
  assert.equal(serialiseTab(tab)[1][0], "[ここで戦闘を挿入]");
  const yarn = exportYarn(
    { tabs: [tab], speakers: [] },
    parseCommands,
  );
  assert.match(yarn, /Before/);
  assert.match(yarn, /After/);
  assert.doesNotMatch(yarn, /戦闘を挿入/);

  const created = makeInstructionRow("[背景資料を確認]");
  assert.equal(created.node, "[背景資料を確認]");
  assert.equal(created.lineId, "");
  assert.equal(isInstructionRow(created), true);
});
test("choice rows form groups; existing and new node names are checked", () => {
  const w = fixtureWorkbook(),
    lines = sceneLines(w.tabs[0], "Tutorial_Start");
  assert.equal(choiceGroup(lines, 2).length, 2);
  assert.equal(choiceGroup(lines, 3).length, 2);
  assert.ok(validateNodeName("Tutorial_A", w));
  assert.ok(validateNodeName("bad node", w));
  assert.equal(validateNodeName("朝会話_2", w), "");
  assert.equal(findNode(w, "Tutorial_A").name, "Tutorial_A");
});
test("legacy starred names are preserved but not emitted as invalid Yarn", () => {
  const w = fixtureWorkbook();
  w.tabs[0].rows[0].node = "*Test";
  assert.equal(findNode(w, "Test").name, "*Test");
  assert.throws(() => exportYarn(w, parseCommands), /記号/);
  assert.equal(serialiseTab(w.tabs[0])[0][0], "*Test");
});
test("Yarn export follows commands -> dialogue -> choices and jump mapping", () => {
  const w = fixtureWorkbook();
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
test("Yarn export keeps Toka face commands profile-driven", () => {
  const w = fixtureWorkbook();
  w.tabs[0].rows[0].command =
    "[char:show:toka:Ch_Toka_Face_default:0.5:0.5:false]";
  const yarn = exportYarn(w, parseCommands);

  assert.match(
    yarn,
    /<<char "show" "toka" "Ch_Toka_Face_default" 0.5 0.5 false>>/,
  );
  assert.doesNotMatch(yarn, /Ch_Toka_Body_Casual/);
});
test("change review counts implicit node assignments explicitly", () => {
  const rows = [
    ["Start", "", "", "Hello"],
    ["", "", "", "World"],
  ];
  const tab = importTab({ id: 1, name: "a", rows });
  assert.equal(pendingChanges(tab, { rows }).assignedNodes, 1);
});
test("dialogue deletion removes the final row and preserves legacy continuation ownership", () => {
  const tab = importTab({
    id: 1,
    name: "Story",
    rows: [
      ["Scene_A", "", "", "first"],
      ["", "", "", "second"],
      ["Scene_B", "", "", "third"],
    ],
  });
  const first = sceneLines(tab, "Scene_A")[0].row;
  const selection = removeScriptRow(tab, first.key);
  assert.equal(selection.scene, "Scene_A");
  assert.equal(sceneLines(tab, "Scene_A").length, 1);
  assert.equal(sceneLines(tab, "Scene_A")[0].row.node, "Scene_A");
  removeScriptRow(tab, sceneLines(tab, "Scene_A")[0].row.key);
  assert.equal(sceneLines(tab, "Scene_A").length, 0);
  assert.deepEqual(
    sceneLines(tab, "Scene_B").map((entry) => entry.row.text),
    ["third"],
  );
});
