import test from "node:test";
import assert from "node:assert/strict";
import { copySceneStatus, sceneStatusCommands } from "../src/lib/scene-status.js";
import { stateAt, emptyStage, parseCommands, validateValues, orderedCharacters } from "../src/lib/commands.js";
import { importTab, serialiseTab, exportYarn } from "../src/lib/workbook.js";

const run = (raw, initial = emptyStage()) => stateAt([{ command: raw }], 0, initial);
function source() {
  const initial = run("[background:BG_Entry:instant] [char:show:Guest:Ch_Guest:0.4:instant:false] [bgm:play:Theme:instant] [bgm:volume:0.4]");
  return stateAt([
    { text: "Not copied", comment: "Not copied", command: "[background:BG_Room:0.5:black] [char:show:白崎桃香:Ch_Toka_Face_default:-0.3:0.5:true:2] [char:scale:白崎桃香:1.2:instant]" },
    { text: "Source line", command: "[char:face:白崎桃香:Ch_Toka_Face_angry:0.2] [char:move:Guest:1.4:instant] [char:tint:Guest:red:instant] [char:flash:Guest:#ff0000] [char:shake:Guest:10] [se:play:Bell:0.7] [se:volume:0.3] [fade:out:blue:0.5] [dialogue:hide]" },
  ], 1, initial);
}

test("copy captures the selected line's inherited appearance/layout and music, with no other effects or text", () => {
  const state = source(), status = copySceneStatus(state);
  assert.deepEqual(Object.keys(status), ["background", "characters", "bgm"]);
  assert.equal(status.background, "BG_Room");
  assert.deepEqual(status.bgm, { asset: "Theme", playing: true, volume: 0.4 });
  assert.deepEqual(status.characters, [
    { id: "Guest", asset: "Ch_Guest", x: 1.4, scale: 1, flip: false, order: 0 },
    { id: "白崎桃香", asset: "Ch_Toka_Face_angry", x: -0.3, scale: 1.2, flip: true, order: 2 },
  ]);
  status.characters[0].x = 0;
  status.bgm.asset = "Changed";
  assert.equal(state.characters[0].x, 1.4);
  assert.equal(state.bgm.asset, "Theme");
});

test("pasted commands replace all destination characters instantly and reconstruct the copied layout", () => {
  const state = source(), status = copySceneStatus(state), commands = sceneStatusCommands(status);
  const destination = run("[char:show:Extra:Old:0.5:instant:false] [char:show:Guest:Old:0.2:instant:true:5] [char:scale:Guest:2:instant] [char:tint:Guest:blue:instant] [background:BG_Old:instant] [bgm:play:OldTheme:instant] [se:volume:0.8] [fade:to:red:0.3:instant] [dialogue:hide]");
  const result = run(commands, destination);
  assert.deepEqual(copySceneStatus(result), status);
  assert.equal(result.characters[0].tint, "white");
  assert.equal(result.characters[1].bodyAsset, "Ch_Toka_Body_Casual");
  assert.equal(result.characters[1].faceAsset, "Ch_Toka_Face_angry");
  assert.deepEqual(result.fade, destination.fade);
  assert.equal(result.dialogue, destination.dialogue);
  assert.equal(result.seVolume, 0.8);
  for (const command of parseCommands(commands)) {
    assert.deepEqual(validateValues(command.definition, command.values), []);
    if (command.values.duration !== undefined) assert.equal(command.values.duration, "instant");
    assert.ok(!["char:tint", "char:flash", "char:shake", "se:play", "se:volume"].includes(command.canonical));
  }
});

test("empty setup clears the destination background and characters and stops its BGM", () => {
  const destination = source(), before = structuredClone(destination);
  const raw = sceneStatusCommands(copySceneStatus(emptyStage()));
  assert.match(raw, /\[background:clear:instant\]/);
  assert.deepEqual(copySceneStatus(run(raw, destination)), copySceneStatus(emptyStage()));
  assert.deepEqual(destination, before);
  for (const command of ["[background:clear]", "[bg:clear:instant]", "[BACKGROUND:CLEAR:0.5]"]) {
    const parsed = parseCommands(command)[0];
    assert.equal(parsed.canonical, "background:clear");
    assert.equal(run(command, destination).background, "");
  }
  assert.equal(run("[background:BG_Clear:instant]").background, "BG_Clear");
});

test("copy keeps paused BGM, equal-order layering, Peach's face preset and full-sprite overrides", () => {
  const state = run("[char:show:ピュアプリピーチ:Ch_Toka_Face_angry:0.1:instant:false:0] [char:show:白崎桃香:Ch_Toka_TF_angry:0.9:instant:true:0] [bgm:play:Theme:instant] [bgm:pause]");
  const result = run(sceneStatusCommands(copySceneStatus(state)), source());
  assert.deepEqual(copySceneStatus(result), copySceneStatus(state));
  assert.deepEqual(orderedCharacters(result.characters).map((c) => c.id), ["ピュアプリピーチ", "白崎桃香"]);
  assert.equal(result.characters[0].bodyAsset, "Ch_Toka_Body_TF");
  assert.equal(result.characters[1].layered, false);
  assert.equal(result.bgm.playing, false);
});

test("pasted setup is saved in column G and exported as real Yarn commands without changing the destination content", () => {
  const tab = importTab({ id: "destination", name: "Other Sheet", rows: [
    ["Target", "stable", "白崎桃香", "Destination dialogue", "", "", "[se:play:OldEffect]", "Keep comment"],
    ["Target", "choice", "", "", "Keep choice", "Next", "", "Keep choice comment"],
    ["Next", "next", "", "Next dialogue"],
  ] });
  const original = { ...tab.rows[0] };
  tab.rows[0].command = sceneStatusCommands(copySceneStatus(source()));
  assert.deepEqual({ ...tab.rows[0], command: original.command }, original);
  assert.equal(serialiseTab(tab)[0][6], tab.rows[0].command);
  const yarn = exportYarn({ tabs: [tab], speakers: [] }, parseCommands);
  const stageLines = yarn.split("\n").filter((line) => line.startsWith("<<dialogue_stage "));
  const commands = stageLines.flatMap((line) => JSON.parse(Buffer.from(JSON.parse(line.slice("<<dialogue_stage ".length, -2)), "base64").toString("utf8")).commands);
  assert.ok(commands.some((c) => c.kind === "background" && c.args[0] === "BG_Room" && c.args[1] === "instant"));
  assert.ok(commands.some((c) => c.kind === "char" && c.args[0] === "show" && c.args[1] === "白崎桃香" && c.args[2] === "Ch_Toka_Face_angry" && c.args[7] === "1.2"));
  assert.ok(commands.some((c) => c.kind === "bgm" && c.args[0] === "play" && c.args[1] === "Theme"));
  assert.match(yarn, /白崎桃香: Destination dialogue #line:stable/);
  assert.match(yarn, /-> Keep choice #line:choice\n\s+<<jump Next>>/);
  assert.doesNotMatch(yarn, /OldEffect|Keep comment/);
  tab.rows[0].command = sceneStatusCommands(copySceneStatus(emptyStage()));
  const clearedYarn = exportYarn({ tabs: [tab], speakers: [] }, parseCommands);
  const clearedCommands = clearedYarn.split("\n").filter((line) => line.startsWith("<<dialogue_stage "))
    .flatMap((line) => JSON.parse(Buffer.from(JSON.parse(line.slice("<<dialogue_stage ".length, -2)), "base64").toString("utf8")).commands);
  assert.ok(clearedCommands.some((c) => c.kind === "background" && c.args[0] === "clear" && c.args[1] === "instant"));
});
