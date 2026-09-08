import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const source = readFileSync(
  new URL("../apps-script/Code.gs", import.meta.url),
  "utf8",
);
const plain = (value) => JSON.parse(JSON.stringify(value));
function backend() {
  const props = {
    EDITOR_ACCESS_KEY: "test-key-".repeat(8),
    BACKUP_FOLDER_ID: "backups",
  };
  const backups = [],
    batches = [];
  const context = vm.createContext({
    console,
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (name) => props[name] }),
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" },
      Charset: { UTF_8: "utf8" },
      getUuid: () => "diagnostic-id-0000",
      computeDigest: (_, value) => [
        ...createHash("sha256").update(value).digest(),
      ],
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (text) => ({ setMimeType: () => JSON.parse(text) }),
    },
    MimeType: { PLAIN_TEXT: "text/plain" },
    DriveApp: {
      getFolderById: () => ({ createFile: (...args) => backups.push(args) }),
    },
    SpreadsheetApp: { flush() {} },
    Sheets: {
      Spreadsheets: { batchUpdate: (...args) => batches.push(plain(args)) },
    },
  });
  vm.runInContext(source, context);
  return { context, backups, batches, props };
}
function writableBackend() {
  const instance = backend(),
    c = instance.context;
  const sheet = { getSheetId: () => 7, getMaxRows: () => 20 };
  c.spreadsheet_ = () => ({
    getSheets: () => [sheet],
    getId: () => "fixed-workbook",
  });
  c.isScriptSheet_ = () => true;
  const previous = {
    id: 7,
    name: "Story",
    revision: "current",
    rows: [["Scene", "", "", "Original", "", "", "", ""]],
    cells: [
      {
        values: [
          {
            userEnteredValue: { stringValue: "Scene" },
            userEnteredFormat: { textFormat: { bold: true } },
            note: "Keep this note",
            dataValidation: { strict: true },
          },
        ],
      },
    ],
  };
  c.snapshot_ = () => previous;
  c.readSpeakers_ = () => [];
  return {
    ...instance,
    previous,
    body: {
      tabId: 7,
      revision: "current",
      rows: [["Scene", "", "", '=IMPORTXML("private")', "", "", "", ""]],
      sourceRows: [2],
    },
  };
}
test("all data actions require the key before reading a workbook or Drive", () => {
  const { context: c } = backend();
  for (const action of [
    "read",
    "saveTab",
    "getAsset",
    "listAssets",
    "uploadAsset",
    "deleteAsset",
  ]) {
    const result = c.doPost({
      postData: { contents: JSON.stringify({ action, key: "wrong" }) },
    });
  assert.equal(result.ok, false);
    assert.equal(result.error.code, "UNAUTHORIZED");
  }
  assert.equal(c.doGet().ok, true);
  assert.equal(c.doGet().version, 4);
});
test("revision serialization ignores object property insertion order", () => {
  const { context: c } = backend();
  const first = {
    rows: [["Scene"]],
    cells: [{ values: [{ userEnteredFormat: { bold: true, fontSize: 12 } }] }],
  };
  const second = {
    cells: [{ values: [{ userEnteredFormat: { fontSize: 12, bold: true } }] }],
    rows: [["Scene"]],
  };
  assert.equal(c.stableStringify_(first), c.stableStringify_(second));
  assert.equal(
    c.digest_(c.stableStringify_(first)),
    c.digest_(c.stableStringify_(second)),
  );
});
test("stale revisions and non-script tabs never create backups or write cells", () => {
  const { context: c, body, backups, batches } = writableBackend();
  assert.throws(
    () => c.saveTab_({ ...body, revision: "stale" }),
    (e) => e.apiCode === "CONFLICT",
  );
  c.isScriptSheet_ = () => false;
  assert.throws(
    () => c.saveTab_(body),
    (e) => e.apiCode === "INVALID_TAB",
  );
  assert.equal(backups.length, 0);
  assert.equal(batches.length, 0);
});
test("saving backs up first, writes literal strings, and preserves source metadata within A2:H", () => {
  const { context: c, body, backups, batches } = writableBackend();
  c.saveTab_(body);
  assert.equal(backups.length, 1);
  assert.equal(batches.length, 1);
  const update = batches[0][0].requests[0].updateCells;
  assert.equal(batches[0][1], "fixed-workbook");
  assert.deepEqual(update.range, {
    sheetId: 7,
    startRowIndex: 1,
    endRowIndex: 2,
    startColumnIndex: 0,
    endColumnIndex: 8,
  });
  assert.equal(
    update.rows[0].values[3].userEnteredValue.stringValue,
    body.rows[0][3],
  );
  const first = update.rows[0].values[0];
  assert.equal(first.note, "Keep this note");
  assert.equal(first.userEnteredFormat.textFormat.bold, true);
  assert.equal(first.dataValidation.strict, true);
});
test("instruction rows are black across A:H with bold white text", () => {
  const { context: c, body, batches } = writableBackend();
  body.rows = [["[ここで戦闘を挿入]", "", "", "", "", "", "", ""]];
  body.sourceRows = [null];
  c.saveTab_(body);
  const cells = batches[0][0].requests[0].updateCells.rows[0].values;
  assert.equal(cells[0].userEnteredValue.stringValue, "[ここで戦闘を挿入]");
  for (const cell of cells) {
    assert.deepEqual(cell.userEnteredFormat.backgroundColor, {
      red: 0,
      green: 0,
      blue: 0,
    });
    assert.equal(cell.userEnteredFormat.textFormat.bold, true);
    assert.deepEqual(cell.userEnteredFormat.textFormat.foregroundColor, {
      red: 1,
      green: 1,
      blue: 1,
    });
  }
});
test("formulas and forged or duplicate source references are rejected without writes", () => {
  const { context: c, body, previous, batches } = writableBackend();
  previous.cells[0].values[0].userEnteredValue = { formulaValue: "=1+1" };
  assert.throws(
    () => c.saveTab_(body),
    (e) => e.apiCode === "FORMULA_PRESENT",
  );
  assert.throws(
    () => c.validateRows_([body.rows[0]], [900], 1),
    (e) => e.apiCode === "BAD_REQUEST",
  );
  assert.throws(
    () => c.validateRows_([body.rows[0], body.rows[0]], [2, 2], 1),
    (e) => e.apiCode === "BAD_REQUEST",
  );
  assert.equal(batches.length, 0);
});
test("script locks release on errors, and arbitrary Drive files cannot be requested", () => {
  const { context: c } = backend();
  let released = false;
  c.LockService = {
    getScriptLock: () => ({
      tryLock: () => true,
      releaseLock: () => {
        released = true;
      },
    }),
  };
  assert.throws(() =>
    c.locked_(() => {
      throw new Error("failure");
    }),
  );
  assert.equal(released, true);
  c.assetIndex_ = () => ({});
  assert.throws(
    () => c.getAsset_("unrelated-file"),
    (e) => e.apiCode === "NOT_FOUND",
  );
});
test("shared asset deletion removes its index entry and trashes only its indexed Drive file", () => {
  const { context: c } = backend();
  const id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const index = {
    [id]: { id, fileId: "indexed-drive-file", name: "BG_Test" },
  };
  let trashed = "",
    saved;
  c.assetIndex_ = () => index;
  c.saveAssetIndex_ = (next) => {
    saved = plain(next);
  };
  c.DriveApp.getFileById = (fileId) => ({
    setTrashed(value) {
      assert.equal(value, true);
      trashed = fileId;
    },
  });
  assert.deepEqual(plain(c.deleteAsset_(id)), { id });
  assert.equal(trashed, "indexed-drive-file");
  assert.deepEqual(saved, {});
  assert.throws(
    () => c.deleteAsset_("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
    (error) => error.apiCode === "NOT_FOUND",
  );
});
