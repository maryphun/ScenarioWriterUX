import test from "node:test";
import assert from "node:assert/strict";
import { scanGraphicFolder } from "../src/lib/graphic-folder.js";

const file = (webkitRelativePath) => ({
  name: webkitRelativePath.split("/").at(-1),
  webkitRelativePath,
});
const validFiles = [
  file("Graphic/Characters/Peach.PNG"),
  file("Graphic/CG/Chapter 1/CG_arrival.jpg"),
  file("Graphic/Backgrounds/Station.png"),
];

test("indexes only project images in the three requested subfolders", () => {
  const result = scanGraphicFolder([
    ...validFiles,
    file("Graphic/Characters/Peach.PNG.meta"),
    file("Graphic/Icons/Ignore.png"),
    file("Graphic/Other/Characters/Ignore.png"),
  ]);
  assert.deepEqual(result.counts, { Characters: 1, CG: 1, Backgrounds: 1 });
  assert.deepEqual(result.records.map(({ name, kind }) => [name, kind]), [
    ["CG_arrival", "cg"],
    ["Peach", "sprite"],
    ["Station", "background"],
  ]);
  assert.equal(result.records.find(({ name }) => name === "Peach").file, validFiles[0]);
});

test("rejects the parent directory and selections missing required artwork", () => {
  assert.throws(
    () => scanGraphicFolder(validFiles.map((item) => file("Assets/" + item.webkitRelativePath))),
    /Assets\/Graphic/,
  );
  assert.throws(() => scanGraphicFolder([validFiles[0], validFiles[2]]), /CG/);
});

test("rejects ambiguous asset names before replacing the active library", () => {
  assert.throws(
    () => scanGraphicFolder([...validFiles, file("Graphic/Characters/variants/peach.jpg")]),
    /同じ素材名/,
  );
});
