import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PREVIEW_OPTIONS } from "../src/lib/preview.js";

test("character preview uses the requested framing by default", () => {
  assert.deepEqual(
    { ...DEFAULT_PREVIEW_OPTIONS },
    {
      characterHeight: 1.1,
      bottomOffset: -175,
    },
  );
});
