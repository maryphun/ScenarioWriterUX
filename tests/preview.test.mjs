import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PREVIEW_OPTIONS,
  NON_SPEAKER_FILTER,
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

test("named dialogue dims every visible character except the matching ID", () => {
  assert.equal(isNonSpeakingCharacter("白崎桃香", "白崎桃香"), false);
  assert.equal(isNonSpeakingCharacter("奥殿テトラ", "白崎桃香"), true);
  assert.equal(isNonSpeakingCharacter("momoka", "MOMOKA"), false);
  assert.equal(isNonSpeakingCharacter("momoka", ""), false);
  assert.match(NON_SPEAKER_FILTER, /grayscale/);
});
