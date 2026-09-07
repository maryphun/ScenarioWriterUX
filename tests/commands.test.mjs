import test from "node:test";
import assert from "node:assert/strict";
import {
  COMMANDS,
  parseCommands,
  buildCommand,
  validateValues,
  stateAt,
  emptyStage,
} from "../src/lib/commands.js";

test("all supplied command families round-trip, including aliases and optional defaults", () => {
  for (const spec of COMMANDS) {
    const values = Object.fromEntries(
      spec.fields.map((f) => [
        f.key,
        f.type === "asset" ? "Asset_Name" : f.default,
      ]),
    );
    for (const key of [spec.key, ...spec.aliases]) {
      const raw = buildCommand(key, values),
        c = parseCommands(raw)[0];
      assert.equal(c.canonical, spec.key);
      assert.deepEqual(
        c.values,
        Object.fromEntries(
          Object.entries(values).map(([k, v]) => [k, String(v)]),
        ),
      );
    }
  }
});
test("multiple bracket commands preserve their order and unknown/incomplete commands", () => {
  const raw =
    "[background:BG_City_Day:0.5:black] [bgm:play:CityTheme:1.0] [char:show:momoka:Ch_Momoka_TF_default:0.25:0.3:false] [custom:keep] [broken";
  const result = parseCommands(raw);
  assert.equal(result.length, 5);
  assert.equal(result[4].raw, "[broken");
  assert.equal(result[4].definition, undefined);
  assert.equal(result[3].raw, "[custom:keep]");
});
test("background defaults are instant and black, valid alpha colors supported", () => {
  const c = parseCommands("[bg:Room]")[0];
  assert.equal(c.values.duration, "instant");
  assert.equal(c.values.color, "black");
  assert.match(
    buildCommand("background", {
      asset: "Room",
      duration: ".6",
      color: "#000000AA",
    }),
    /\.6:#000000AA/,
  );
});
test("parameter validation rejects malformed positions, volume, duration and asset names", () => {
  assert.throws(() => buildCommand("background", { asset: "Bad:Name" }));
  assert.throws(() => buildCommand("char:move", { id: "a", x: 1.1 }));
  assert.throws(() => buildCommand("bgm:volume", { volume: -1 }));
  assert.throws(() => buildCommand("fade:out", { duration: "NaN" }));
  assert.throws(() =>
    buildCommand("background", { asset: "Room", color: "url(x)" }),
  );
});
test("state carries forward, reconstructs previous lines, and imposes no character cap", () => {
  const rows = [{ command: "[background:Room:instant]" }];
  for (let i = 0; i < 100; i++)
    rows.push({
      command: `[char:show:actor_${i}:Sprite:${i / 100}:instant:false]`,
    });
  rows.push({
    command:
      "[char:move:actor_0:0.8:0.5] [char:scale:actor_0:1.2:0.2] [char:flip:actor_0:left] [char:tint:actor_0:#888888]",
  });
  rows.push({ command: "[char:hide:actor_1]" });
  const last = stateAt(rows, rows.length - 1);
  assert.equal(last.characters.length, 99);
  assert.equal(last.background, "Room");
  assert.equal(last.characters.find((c) => c.id === "actor_0").x, 0.8);
  assert.equal(last.characters[0].flip, true);
  assert.equal(last.characters[0].scale, 1.2);
  assert.equal(stateAt(rows, 100).characters.length, 100);
  assert.equal(stateAt(rows, 0).characters.length, 0);
});
test("show updates an existing character and clear removes all", () => {
  const rows = [
    { command: "[char:show:a:First] [char:show:b:Second] [char:show:a:Third]" },
  ];
  assert.deepEqual(
    stateAt(rows, 0).characters.map((c) => c.asset),
    ["Second", "Third"],
  );
  rows.push({ command: "[char:clear:.5]" });
  assert.equal(stateAt(rows, 1).characters.length, 0);
});
test("fade, dialogue and audio states persist through branches without mutating initial state", () => {
  const initial = emptyStage();
  initial.background = "Room";
  const result = stateAt(
    [
      {
        command:
          "[fade:to:red:0.4:0.3] [dialogue:hide] [bgm:play:CityTheme] [bgm:volume:0.4] [se:volume:0.6]",
      },
    ],
    0,
    new Proxy(initial, {}),
  );
  assert.equal(result.fade.opacity, 0.4);
  assert.equal(result.dialogue, false);
  assert.equal(result.bgm.asset, "CityTheme");
  assert.equal(result.bgm.volume, 0.4);
  assert.equal(result.seVolume, 0.6);
  assert.equal(initial.fade.opacity, 0);
  assert.equal(initial.bgm.asset, "");
});
