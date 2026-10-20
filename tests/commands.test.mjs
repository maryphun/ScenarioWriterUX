import test from "node:test";
import assert from "node:assert/strict";
import {
  COMMANDS,
  parseCommands,
  buildCommand,
  validateValues,
  stateAt,
  emptyStage,
  orderedCharacters,
  TOKA_DEFAULT_BODY_ASSET,
  PEACH_DEFAULT_BODY_ASSET,
  characterBodyPreset,
} from "../src/lib/commands.js";

test("all supplied command families round-trip, including aliases and optional defaults", () => {
  for (const spec of COMMANDS) {
    const values = Object.fromEntries(
      spec.fields.map((f) => [
        f.key,
        f.type === "asset"
          ? "Asset_Name"
          : f.key === "id"
            ? "test_actor"
            : f.default,
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
test("character command IDs start blank", () => {
  for (const spec of COMMANDS.filter((item) =>
    item.fields.some((field) => field.key === "id"),
  )) {
    assert.equal(spec.fields.find((field) => field.key === "id").default, "");
  }
});
test("character display order is optional on show and can be changed later", () => {
  assert.equal(
    buildCommand("char:show", {
      id: "front",
      asset: "Front",
      x: 0.5,
      duration: "instant",
      flip: "false",
    }),
    "[char:show:front:Front:0.5:instant:false]",
  );
  assert.equal(
    buildCommand("char:show", {
      id: "back",
      asset: "Back",
      x: 0.5,
      duration: "instant",
      flip: "false",
      order: 1,
    }),
    "[char:show:back:Back:0.5:instant:false:1]",
  );
  assert.equal(buildCommand("char:order", { id: "front", order: 2 }), "[char:order:front:2]");
  assert.throws(() => buildCommand("char:order", { id: "front", order: -1 }));
  assert.throws(() => buildCommand("char:order", { id: "front", order: 1.5 }));

  const state = stateAt(
    [
      {
        command:
          "[char:show:front:Front:0.5:instant:false:0] [char:show:back:Back:0.5:instant:false:1]",
      },
      { command: "[char:order:front:2]" },
    ],
    1,
  );
  assert.deepEqual(
    orderedCharacters(state.characters).map((character) => character.id),
    ["front", "back"],
  );
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
test("character show and move retain extended positions through parsing and stage state", () => {
  for (const x of [-0.5, -0.25, 1.1, 1.5]) {
    const show = buildCommand("char:show", { id: "a", asset: "Sprite", x });
    assert.equal(Number(parseCommands(show)[0].values.x), x);
    assert.equal(stateAt([{ command: show }], 0).characters[0].x, x);
    const move = buildCommand("char:move", { id: "a", x });
    assert.equal(stateAt([
      { command: "[char:show:a:Sprite:0.5:instant:false]" },
      { command: move },
    ], 1).characters[0].x, x);
  }
});

test("parameter validation rejects malformed positions, volume, duration and asset names", () => {
  assert.throws(() => buildCommand("background", { asset: "Bad:Name" }));
  assert.throws(() => buildCommand("char:move", { id: "a", x: 1.51 }));
  assert.throws(() => buildCommand("char:move", { id: "a", x: -0.51 }));
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
test("Toka face assets use the default body while explicit sprites stay single-layered", () => {
  const rows = [
    {
      command:
        "[char:show:toka:Ch_Toka_Face_default:0.5:instant:false]",
    },
    { command: "[char:face:toka:Ch_Toka_Face_angry:instant]" },
  ];

  const layered = stateAt(rows, 1).characters[0];
  assert.equal(layered.layered, true);
  assert.equal(layered.bodyAsset, TOKA_DEFAULT_BODY_ASSET);
  assert.equal(layered.faceAsset, "Ch_Toka_Face_angry");
  assert.equal(layered.asset, "Ch_Toka_Face_angry");

  rows.push({ command: "[char:face:toka:Ch_Toka_TF_angry:instant]" });
  const explicit = stateAt(rows, 2).characters[0];
  assert.equal(explicit.layered, false);
  assert.equal(explicit.bodyAsset, "");
  assert.equal(explicit.faceAsset, "");
  assert.equal(explicit.asset, "Ch_Toka_TF_angry");

  const unrelated = stateAt(
    [{ command: "[char:show:stand_in:Ch_Toka_Face_default]" }],
    0,
  ).characters[0];
  assert.equal(unrelated.layered, false);
});
test("Peach uses the transformed preset, swaps faces and keeps explicit sprite overrides", () => {
  const rows = [
    { command: "[char:show:ピュアプリピーチ:Ch_Toka_Face_default:-0.25:instant:true:2] [char:scale:ピュアプリピーチ:1.2:instant] [char:tint:ピュアプリピーチ:#888888:instant]" },
    { command: "[char:face:ピュアプリピーチ:Ch_Toka_Face_angry:0.2]" },
  ];
  const layered = stateAt(rows, 1).characters[0];
  assert.equal(layered.layered, true);
  assert.equal(layered.bodyAsset, PEACH_DEFAULT_BODY_ASSET);
  assert.equal(layered.faceAsset, "Ch_Toka_Face_angry");
  assert.equal(layered.asset, "Ch_Toka_Face_angry");
  assert.equal(layered.x, -0.25);
  assert.equal(layered.scale, 1.2);
  assert.equal(layered.flip, true);
  assert.equal(layered.order, 2);
  assert.equal(layered.tint, "#888888");

  rows.push({ command: "[char:face:ピュアプリピーチ:Ch_Toka_TF_angry:instant]" });
  const explicit = stateAt(rows, 2).characters[0];
  assert.equal(explicit.layered, false);
  assert.equal(explicit.bodyAsset, "");
  assert.equal(explicit.faceAsset, "");
  assert.equal(explicit.asset, "Ch_Toka_TF_angry");

  rows.push({ command: "[char:sprite:ピュアプリピーチ:Ch_Toka_Face_flatter:instant]" });
  const restored = stateAt(rows, 3).characters[0];
  assert.equal(restored.bodyAsset, PEACH_DEFAULT_BODY_ASSET);
  assert.equal(restored.faceAsset, "Ch_Toka_Face_flatter");
});

test("Toka and Peach presets stay distinct and other character IDs stay single-sprite", () => {
  const state = stateAt([{command: "[char:show:白崎桃香:Ch_Toka_Face_default] [char:show:ピュアプリピーチ:Ch_Toka_Face_default] [char:show:other:Ch_Toka_Face_default]"}], 0);
  assert.deepEqual(state.characters.map(c => c.bodyAsset), [TOKA_DEFAULT_BODY_ASSET, PEACH_DEFAULT_BODY_ASSET, ""]);
  assert.deepEqual(state.characters.map(c => c.layered), [true, true, false]);
  assert.deepEqual(characterBodyPreset(" ピュアプリピーチ "), {label:"ピュアプリピーチ",bodyAsset:"Ch_Toka_Body_TF"});
  for (const id of ["toka", "Toka", "momoka", "白崎桃香"])
    assert.equal(characterBodyPreset(id).bodyAsset, TOKA_DEFAULT_BODY_ASSET);
  assert.equal(characterBodyPreset("other"), null);
  assert.equal(characterBodyPreset(""), null);
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
