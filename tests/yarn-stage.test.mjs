import test from "node:test";
import assert from "node:assert/strict";
import { prepareYarnStageText } from "../src/lib/yarn-stage.js";
import { exportYarn, importTab } from "../src/lib/workbook.js";
import { parseCommands } from "../src/lib/commands.js";

function groups(text) {
  return text.split("\n").filter((line) => line.trimStart().startsWith("<<dialogue_stage "))
    .map((line) => JSON.parse(Buffer.from(JSON.parse(line.trim().slice("<<dialogue_stage ".length, -2)), "base64").toString("utf8")).commands);
}

test("new appearances and retained moves form one runtime stage regardless of author order", () => {
  const text = '<<char "show" "新人" "Sprite" 0.5 0.5 false>>\n<<char "move" "残る人" 0.8 "instant">>\n<<char "hide" "去る人" 0.5>>\n残る人: 台詞 #line:stable';
  const prepared = prepareYarnStageText(text);
  assert.deepEqual(groups(prepared)[0], [
    { kind: "char", args: ["show", "新人", "Sprite", "0.5", "0.5", "false"] },
    { kind: "char", args: ["move", "残る人", "0.8", "instant"] },
    { kind: "char", args: ["hide", "去る人", "0.5"] },
  ]);
  assert.ok(prepared.endsWith("残る人: 台詞 #line:stable"));
  assert.equal(prepareYarnStageText(prepared), prepared);
});

test("background midpoint removals and clear aliases travel with the background", () => {
  for (const removal of ['<<char hide A instant>>', '<<char remove A 0>>', '<<char clear instant>>', '<<char hide_all 0>>', '<<char remove_all instant>>']) {
    const prepared = prepareYarnStageText(`<<bg BG_Next 0.5 black>>\n${removal}`);
    assert.equal(groups(prepared).length, 1);
    assert.equal(groups(prepared)[0][0].kind, "bg");
    assert.equal(groups(prepared)[0][1].kind, "char");
  }
});

test("new character initial pose is set before stage presentation, including across sheet rows", () => {
  const tab = importTab({ id: 1, name: "Story", rows: [
    ["Start", "", "", "", "", "", "[char:show:新人:Sprite:0.5:0.5:false]"],
    ["Start", "", "", "", "", "", "[char:move:新人:0.8:instant] [char:scale:新人:1.2:instant] [char:flip:新人:left] [char:move:残る人:0.2:instant]"],
    ["Start", "stable", "残る人", "こんにちは"],
  ] });
  const prepared = exportYarn({ tabs: [tab], speakers: [] }, parseCommands);
  assert.deepEqual(groups(prepared)[0][0].args, ["show", "新人", "Sprite", "0.8", "0.5", "left", "keep", "1.2", "instant"]);
  assert.deepEqual(groups(prepared)[0][1].args, ["move", "残る人", "0.2", "instant"]);
  assert.match(prepared, /残る人: こんにちは #line:stable/);
});

test("expressions, dialogue, branches and node boundaries retain sequencing", () => {
  const show = '<<char show A Sprite 0.5 0.5 false>>', move = '<<char move B 0.8 instant>>';
  for (const boundary of ['<<char move B $position instant>>', '<<bgm play $theme>>', '<<custom instruction>>', 'A: 台詞', '-> Choice', '===\ntitle: Next\n---']) {
    const text = `${show}\n${boundary}\n${move}`;
    assert.equal(prepareYarnStageText(text), text);
  }
  assert.equal(prepareYarnStageText(`${show}\n    ${move}`), `${show}\n    ${move}`);
  assert.equal(prepareYarnStageText(show), show);
});

test("mixed effect families cannot split character priority or initial setup", () => {
  const families = ['<<bgm crossfade Theme 1>>', '<<se play Bell>>', '<<shake>>', '<<fade out black 0.5>>', '<<dialogue hide 0.2>>', '<<wait 1>>', '<<background BG_Next 0.5 black>>'];
  for (const effect of families) {
    const prepared = prepareYarnStageText(`<<char show A Sprite 0.5 0.5 false>>\n${effect}\n<<char move A 0.8 instant>>\n<<char move B 0.2 instant>>`);
    const stage = groups(prepared);
    assert.equal(stage.length, 1);
    assert.deepEqual(stage[0][0].args, ["show", "A", "Sprite", "0.8", "0.5", "false", "keep", "keep", "instant"]);
    assert.equal(stage[0].length, 3);
    assert.deepEqual(stage[0][2].args, ["move", "B", "0.2", "instant"]);
  }
});

test("export groups audio, shake and post-animation commands from one spreadsheet line", () => {
  const tab = importTab({ id: 1, name: "Story", rows: [
    ["Start", "stable", "残る人", "台詞", "", "", "[char:show:新人:Sprite:0.5:0.5:false] [se:play:Bell] [bgm:crossfade:Theme:1] [shake:0.3:8] [wait:1] [dialogue:hide:0.2] [fade:out:black:0.5] [char:move:残る人:0.8:instant] [background:BG_Next:0.5:black] [char:hide:去る人:0.5]"],
  ] });
  const prepared = exportYarn({ tabs: [tab], speakers: [] }, parseCommands);
  assert.equal(groups(prepared).length, 1);
  assert.deepEqual(groups(prepared)[0].map((command) => command.kind), ["char", "se", "bgm", "shake", "wait", "dialogue", "fade", "char", "background", "char"]);
  assert.match(prepared, /残る人: 台詞 #line:stable/);
});

test("temporary show then hide and successive backgrounds remain separate transitions", () => {
  const show = '<<char show A Sprite 0.5 0.5 false>>';
  for (const removal of ['<<char hide a 0.5>>', '<<char remove A instant>>', '<<char clear 0.5>>']) {
    assert.equal(prepareYarnStageText(`${show}\n${removal}`), `${show}\n${removal}`);
  }
  const prepared = prepareYarnStageText(`<<background BG_One 0.5 black>>\n<<char hide A instant>>\n<<background BG_Two instant>>\n<<char add B Sprite 0.5 0.5 false>>`);
  assert.equal(groups(prepared).length, 2);
  assert.equal(groups(prepared)[0][0].args[0], "BG_One");
  assert.equal(groups(prepared)[1][0].args[0], "BG_Two");
});

test("JSON payload preserves Japanese names, order, quotes and backslashes", () => {
  const prepared = prepareYarnStageText('<<char show "白崎桃香" "Sprite\\\\folder\\\"quote" 0.5 0.5 false 0>>\n<<char order "白崎桃香" 1>>');
  assert.deepEqual(groups(prepared)[0][0].args, ["show", "白崎桃香", 'Sprite\\folder"quote', "0.5", "0.5", "false", "0"]);
  assert.deepEqual(groups(prepared)[0][1].args, ["order", "白崎桃香", "1"]);
});
