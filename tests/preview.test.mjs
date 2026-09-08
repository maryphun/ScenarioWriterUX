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
      characterHeight: 1.1,
      bottomOffset: -175,
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

test("named dialogue dims every visible character except the matching ID", () => {
  assert.equal(isNonSpeakingCharacter("白崎桃香", "白崎桃香"), false);
  assert.equal(isNonSpeakingCharacter("奥殿テトラ", "白崎桃香"), true);
  assert.equal(isNonSpeakingCharacter("momoka", "MOMOKA"), false);
  assert.equal(isNonSpeakingCharacter("momoka", "白崎桃香"), false);
  assert.equal(isNonSpeakingCharacter("toka", "白崎桃香"), false);
  assert.equal(isNonSpeakingCharacter("momoka", ""), false);
  assert.match(NON_SPEAKER_FILTER, /grayscale/);
});
