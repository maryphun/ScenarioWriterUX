import test from "node:test";
import assert from "node:assert/strict";
import { buildCommand } from "../src/lib/commands.js";
import {
  DEFAULT_CHARACTER_TRANSITION,
  transitionDuration,
} from "../src/lib/transitions.js";

test("character show and hide default to a 0.5 second fade", () => {
  assert.deepEqual(
    { ...DEFAULT_CHARACTER_TRANSITION },
    { mode: "fade", time: 0.5 },
  );
  const duration = transitionDuration(DEFAULT_CHARACTER_TRANSITION);
  assert.equal(
    buildCommand("char:show", {
      id: "momoka",
      asset: "Ch_Momoka_Default",
      x: 0.5,
      duration,
      flip: "false",
    }),
    "[char:show:momoka:Ch_Momoka_Default:0.5:0.5:false]",
  );
  assert.equal(
    buildCommand("char:hide", { id: "momoka", duration }),
    "[char:hide:momoka:0.5]",
  );
});

test("instant character transitions emit the instant argument", () => {
  assert.equal(transitionDuration({ mode: "instant", time: 0.5 }), "instant");
});
