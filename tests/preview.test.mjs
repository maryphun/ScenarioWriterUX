import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PREVIEW_OPTIONS,
  CHARACTER_HORIZONTAL_OVERSCAN,
  NON_SPEAKER_FILTER,
  characterCenterX,
  characterPositionFromCenter,
  isNonSpeakingCharacter,
} from "../src/lib/preview.js";

test("character preview uses the requested framing by default", () => {
  assert.deepEqual(
    { ...DEFAULT_PREVIEW_OPTIONS },
    {
      characterHeight: 1.3,
      bottomOffset: -600,
    },
  );
});

test("character position extends 250 pixels beyond both stage edges", () => {
  const characterWidth = 600;
  assert.equal(CHARACTER_HORIZONTAL_OVERSCAN, 250);
  assert.equal(characterCenterX(0, characterWidth) - characterWidth / 2, -250);
  assert.equal(characterCenterX(0.5, characterWidth), 960);
  assert.equal(characterCenterX(1, characterWidth) + characterWidth / 2, 2170);
  assert.equal(characterPositionFromCenter(50, characterWidth), 0);
  assert.equal(characterPositionFromCenter(960, characterWidth), 0.5);
  assert.equal(characterPositionFromCenter(1870, characterWidth), 1);
});

test("extended positions preserve old placements and drag coordinates round-trip", () => {
  assert.equal(characterCenterX(-0.5, 600), -860);
  assert.equal(characterCenterX(1.5, 600), 2780);
  assert.equal(characterCenterX(-2, 600), -860);
  assert.equal(characterCenterX(3, 600), 2780);
  for (const width of [600, 3000]) {
    for (const position of [-0.5, -0.25, 0, 0.25, 0.5, 0.75, 1, 1.25, 1.5]) {
      const center = characterCenterX(position, width);
      assert.ok(Math.abs(characterPositionFromCenter(center, width) - position) < 1e-10);
    }
    assert.equal(characterPositionFromCenter(-10000, width), -0.5);
    assert.equal(characterPositionFromCenter(10000, width), 1.5);
  }
});

test("named dialogue dims every visible character except the matching ID", () => {
  assert.equal(isNonSpeakingCharacter("白崎桃香", "白崎桃香"), false);
  assert.equal(isNonSpeakingCharacter("奥殿テトラ", "白崎桃香"), true);
  assert.equal(isNonSpeakingCharacter("momoka", "MOMOKA"), false);
  assert.equal(isNonSpeakingCharacter("momoka", "白崎桃香"), false);
  assert.equal(isNonSpeakingCharacter("toka", "白崎桃香"), false);
  assert.equal(isNonSpeakingCharacter("ピュアプリピーチ", "ピュアプリピーチ"), false);
  assert.equal(isNonSpeakingCharacter("白崎桃香", "ピュアプリピーチ"), true);
  assert.equal(isNonSpeakingCharacter("ピュアプリピーチ", "白崎桃香"), true);
  assert.equal(isNonSpeakingCharacter("momoka", ""), false);
  assert.match(NON_SPEAKER_FILTER, /grayscale/);
});
