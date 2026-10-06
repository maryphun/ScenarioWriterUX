import test from "node:test";
import assert from "node:assert/strict";
import { buildCommand, parseCommands, stateAt, rgba } from "../src/lib/commands.js";
import { createCharacterEffects } from "../src/lib/character-effects.js";

const command = (raw) => parseCommands(raw)[0];
function harness() {
  const tasks = [];
  const effects = createCharacterEffects({
    random: () => 1,
    changed() {},
    tween(duration, token, update, options) {
      return new Promise((resolve) => tasks.push({ duration, token, update, options, resolve }));
    },
  });
  return { tasks, effects };
}
const actor = () => ({ id: "Toka", x: 0.4, tint: "#80503099" });

test("temporary character commands validate RGB hex and strengths from 1 to 10", () => {
  assert.equal(buildCommand("char:flash", { id: "白崎桃香", color: "#FF2040" }), "[char:flash:白崎桃香:#FF2040]");
  assert.throws(() => buildCommand("char:flash", { id: "Toka", color: "red" }));
  assert.throws(() => buildCommand("char:flash", { id: "Toka", color: "#ff000080" }));
  assert.equal(buildCommand("char:shake", { id: "Toka", strength: 10 }), "[char:shake:Toka:10]");
  for (const strength of [0, 11, 1.5, "NaN"])
    assert.throws(() => buildCommand("char:shake", { id: "Toka", strength }));
});

test("seeking across temporary effects preserves authored tint, position and Toka layers", () => {
  const rows = [
    { command: "[char:show:toka:Ch_Toka_Face_default:0.4:instant] [char:tint:toka:#805030]" },
    { command: "[char:flash:toka:#ff2040] [char:shake:toka:10]" },
  ];
  const expected = stateAt(rows, 0);
  assert.deepEqual(stateAt(rows, 1), expected);
  rows.push({ command: "[char:tint:toka:blue] [char:move:toka:0.8:instant]" });
  assert.equal(stateAt(rows, 2).characters[0].tint, "blue");
  assert.equal(stateAt(rows, 2).characters[0].x, 0.8);
});

test("flash is immediate and both effects start together with separate fixed durations", async () => {
  const { tasks, effects } = harness(), character = actor();
  const flash = effects.start(command("[char:flash:toka:#ff0000]"), 1);
  const shake = effects.start(command("[char:shake:toka:10]"), 1);
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].duration, 0.5);
  assert.equal(tasks[1].duration, 0.7);
  assert.equal(tasks[0].options.spatial, false);
  assert.equal(tasks[1].options.spatial, true);
  assert.equal(effects.colorFor(character), "#ff000099");
  tasks[0].update(0.5);
  assert.equal(effects.colorFor(character), "#c0281899");
  tasks[1].update(0.2);
  assert.equal(effects.offsetFor(character), 50);
  assert.equal(character.x, 0.4);
  assert.equal(character.tint, "#80503099");
  tasks[0].update(1); tasks[0].resolve(true); await flash;
  assert.equal(effects.colorFor(character), character.tint);
  assert.equal(effects.offsetFor(character), 50);
  tasks[1].update(1); tasks[1].resolve(true); await shake;
  assert.equal(effects.offsetFor(character), 0);
});

test("flash follows the expected authored color when it changes during the effect", async () => {
  const { tasks, effects } = harness(), character = actor();
  const flash = effects.start(command("[char:flash:toka:#ff0000]"), 1);
  character.tint = "#0000ff66";
  tasks[0].update(0.5);
  assert.deepEqual(rgba(effects.colorFor(character)), rgba("#80008066"));
  tasks[0].resolve(true); await flash;
  assert.equal(effects.colorFor(character), "#0000ff66");
});

test("cancellation and replacement do not let an old effect clear a newer one", async () => {
  const { tasks, effects } = harness(), character = actor();
  const oldFlash = effects.start(command("[char:flash:toka:#ff0000]"), 1);
  const oldShake = effects.start(command("[char:shake:toka:10]"), 1);
  tasks[1].update(0.1);
  effects.clear();
  assert.equal(effects.offsetFor(character), 0);
  assert.equal(effects.colorFor(character), character.tint);
  const newFlash = effects.start(command("[char:flash:toka:#00ff00]"), 2);
  const newShake = effects.start(command("[char:shake:toka:1]"), 2);
  tasks[3].update(0.1);
  tasks[0].resolve(false); tasks[1].resolve(false);
  await Promise.all([oldFlash, oldShake]);
  assert.equal(effects.colorFor(character), "#00ff0099");
  assert.equal(effects.offsetFor(character), 5);
  tasks[2].resolve(true); tasks[3].resolve(true);
  await Promise.all([newFlash, newShake]);
  assert.equal(effects.colorFor(character), character.tint);
  assert.equal(effects.offsetFor(character), 0);
});

test("reduced motion's completed spatial tween leaves no character displacement", async () => {
  const { tasks, effects } = harness(), character = actor();
  const shake = effects.start(command("[char:shake:toka:10]"), 1);
  tasks[0].update(1);
  assert.equal(effects.offsetFor(character), 0);
  tasks[0].resolve(true); await shake;
});
