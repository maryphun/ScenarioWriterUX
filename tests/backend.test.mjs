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
        values: Array.from({ length: 8 }, (_, index) =>
          index === 3
            ? {
                userEnteredValue: { stringValue: "Original" },
                userEnteredFormat: { textFormat: { bold: true } },
                note: "Keep this note",
                dataValidation: { strict: true },
              }
            : {},
        ),
      },
    ],
  };
  c.snapshot_ = () => previous;
  c.readSpeakers_ = () => [];
  const conditionalRules = [plain(c.instructionRule_(7))];
  c.Sheets.Spreadsheets.get = () => ({
    sheets: [{ properties: { sheetId: 7 }, conditionalFormats: conditionalRules }],
  });
  return {
    ...instance,
    sheet,
    previous,
    conditionalRules,
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
  assert.equal(c.doGet().version, 8);
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
test("saving backs up first and writes only changed cells with source metadata", () => {
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
    startColumnIndex: 3,
    endColumnIndex: 4,
  });
  assert.equal(
    update.rows[0].values[0].userEnteredValue.stringValue,
    body.rows[0][3],
  );
  const changed = update.rows[0].values[0];
  assert.equal(changed.note, "Keep this note");
  assert.equal(changed.userEnteredFormat.textFormat.bold, true);
  assert.equal(changed.dataValidation.strict, true);
});
test("inserting a local row shifts only A:H and writes only the new row", () => {
  const { context: c, body, previous, backups, batches } = writableBackend();
  const first = ["Scene", "line-a", "", "最初", "", "", "", ""],
    second = ["Scene", "line-b", "", "最後", "", "", "", ""],
    inserted = ["Scene", "line-new", "", "追加", "", "", "", ""];
  previous.rows = [plain(first), plain(second)];
  previous.cells = [
    { values: Array.from({ length: 8 }, () => ({})) },
    { values: Array.from({ length: 8 }, () => ({})) },
  ];
  body.rows = [plain(first), plain(inserted), plain(second)];
  body.sourceRows = [2, null, 3];

  c.saveTab_(body);

  assert.equal(backups.length, 1);
  assert.equal(batches.length, 1);
  const requests = batches[0][0].requests;
  assert.deepEqual(requests[0].insertRange, {
    range: {
      sheetId: 7,
      startRowIndex: 2,
      endRowIndex: 3,
      startColumnIndex: 0,
      endColumnIndex: 8,
    },
    shiftDimension: "ROWS",
  });
  assert.deepEqual(requests[1].updateCells.range, {
    sheetId: 7,
    startRowIndex: 2,
    endRowIndex: 3,
    startColumnIndex: 0,
    endColumnIndex: 8,
  });
  assert.equal(requests.length, 3);
  assert.equal(requests[2].updateConditionalFormatRule.index, 0);
});
test("deleting a local row shifts only A:H without rewriting survivors", () => {
  const { context: c, body, previous, backups, batches } = writableBackend();
  const first = ["Scene", "line-a", "", "残す", "", "", "", ""],
    second = ["Scene", "line-b", "", "削除", "", "", "", ""];
  previous.rows = [plain(first), plain(second)];
  previous.cells = [
    { values: Array.from({ length: 8 }, () => ({})) },
    { values: Array.from({ length: 8 }, () => ({})) },
  ];
  body.rows = [plain(first)];
  body.sourceRows = [2];

  c.saveTab_(body);

  assert.equal(backups.length, 1);
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0][0].requests.slice(0, 1), [
    {
      deleteRange: {
        range: {
          sheetId: 7,
          startRowIndex: 2,
          endRowIndex: 3,
          startColumnIndex: 0,
          endColumnIndex: 8,
        },
        shiftDimension: "ROWS",
      },
    },
  ]);
  assert.equal(batches[0][0].requests[1].updateConditionalFormatRule.index, 0);
});
test("stale saves merge non-overlapping cells and omit the other writer's cells", () => {
  const { context: c, body, previous, backups, batches } = writableBackend();
  const baseRows = plain(previous.rows);
  previous.revision = "remote-revision";
  previous.rows[0][7] = "他の担当者のメモ";
  body.revision = "base-revision";
  body.baseRows = baseRows;

  const result = c.saveTab_(body);

  assert.equal(result.merged, true);
  assert.equal(backups.length, 1);
  assert.equal(batches.length, 1);
  const updates = batches[0][0].requests.map((request) => request.updateCells);
  assert.deepEqual(updates[0].range, {
    sheetId: 7,
    startRowIndex: 1,
    endRowIndex: 2,
    startColumnIndex: 3,
    endColumnIndex: 4,
  });
  assert.equal(updates[0].rows[0].values[0].userEnteredValue.stringValue, body.rows[0][3]);
});
test("stale saves report the exact overlapping cell without writing", () => {
  const { context: c, body, previous, backups, batches } = writableBackend();
  const baseRows = plain(previous.rows);
  previous.revision = "remote-revision";
  previous.rows[0][3] = "他の担当者の本文";
  body.revision = "base-revision";
  body.baseRows = baseRows;

  assert.throws(
    () => c.saveTab_(body),
    (error) =>
      error.apiCode === "CONFLICT" && error.message.includes("Text_JP2"),
  );
  assert.equal(backups.length, 0);
  assert.equal(batches.length, 0);
});
test("stale saves preserve a row added remotely while applying a local cell edit", () => {
  const { context: c, body, previous, backups, batches } = writableBackend();
  const baseRows = plain(previous.rows);
  previous.revision = "remote-revision";
  previous.rows.push(["Other", "new_remote_line", "", "追加された行", "", "", "", ""]);
  body.revision = "base-revision";
  body.baseRows = baseRows;

  const result = c.saveTab_(body);

  assert.equal(result.merged, true);
  assert.equal(backups.length, 1);
  assert.equal(batches.length, 1);
  assert.equal(batches[0][0].requests.length, 1);
  assert.deepEqual(batches[0][0].requests[0].updateCells.range, {
    sheetId: 7,
    startRowIndex: 1,
    endRowIndex: 2,
    startColumnIndex: 3,
    endColumnIndex: 4,
  });
});
test("stale saves keep a remote deletion and edit a surviving row matched by LineID", () => {
  const { context: c, body, previous, backups, batches } = writableBackend();
  const first = ["Scene", "line-a", "", "削除される行", "", "", "", ""];
  const second = ["", "line-b", "", "残る行", "", "", "", ""];
  const baseRows = [first, second];
  previous.revision = "remote-revision";
  previous.rows = [plain(second)];
  previous.cells = [{ values: Array.from({ length: 8 }, () => ({})) }];
  body.revision = "base-revision";
  body.baseRows = plain(baseRows);
  body.rawRows = [plain(first), plain(second)];
  body.rows = [
    plain(first),
    ["Scene", "line-b", "", "この画面で変更", "", "", "", ""],
  ];
  body.sourceRows = [2, 3];

  const result = c.saveTab_(body);

  assert.equal(result.merged, true);
  assert.equal(backups.length, 1);
  assert.equal(batches.length, 1);
  const updates = batches[0][0].requests.map((request) => request.updateCells);
  assert.deepEqual(
    updates.map((update) => update.range),
    [
      {
        sheetId: 7,
        startRowIndex: 1,
        endRowIndex: 2,
        startColumnIndex: 0,
        endColumnIndex: 1,
      },
      {
        sheetId: 7,
        startRowIndex: 1,
        endRowIndex: 2,
        startColumnIndex: 3,
        endColumnIndex: 4,
      },
    ],
  );
  assert.equal(updates[1].rows[0].values[0].userEnteredValue.stringValue, "この画面で変更");
});
test("stale saves stop if the locally edited row was deleted remotely", () => {
  const { context: c, body, previous, backups, batches } = writableBackend();
  const first = ["Scene", "line-a", "", "削除される行", "", "", "", ""];
  const second = ["", "line-b", "", "残る行", "", "", "", ""];
  previous.revision = "remote-revision";
  previous.rows = [plain(second)];
  previous.cells = [{ values: Array.from({ length: 8 }, () => ({})) }];
  body.revision = "base-revision";
  body.baseRows = [plain(first), plain(second)];
  body.rawRows = [
    ["Scene", "line-a", "", "この画面でも変更", "", "", "", ""],
    plain(second),
  ];
  body.rows = plain(body.rawRows);
  body.sourceRows = [2, 3];

  assert.throws(
    () => c.saveTab_(body),
    (error) =>
      error.apiCode === "CONFLICT" && error.message.includes("削除された行 2"),
  );
  assert.equal(backups.length, 0);
  assert.equal(batches.length, 0);
});
test("stale saves stop when this screen also changed row structure", () => {
  const { context: c, body, previous, backups, batches } = writableBackend();
  body.revision = "base-revision";
  body.baseRows = plain(previous.rows);
  previous.revision = "remote-revision";
  body.rows.push(["Scene", "local-line", "", "追加", "", "", "", ""]);
  body.sourceRows.push(null);

  assert.throws(
    () => c.saveTab_(body),
    (error) => error.apiCode === "CONFLICT" && error.message.includes("行"),
  );
  assert.equal(backups.length, 0);
  assert.equal(batches.length, 0);
});
test("instruction rows are black across A:H with bold white text", () => {
  const { context: c, body, batches } = writableBackend();
  body.rows = [["[ここで戦闘を挿入]", "", "", "", "", "", "", ""]];
  body.sourceRows = [null];
  c.saveTab_(body);
  const cells = batches[0][0].requests.find((request) => request.updateCells)
    .updateCells.rows[0].values;
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
test("a value-identical save repairs instruction formatting without rewriting content or metadata", () => {
  const { context: c, body, previous, backups, batches } = writableBackend();
  previous.rows = [["[ここで戦闘を挿入]", "", "", "", "", "", "", ""]];
  previous.cells = [{ values: Array.from({ length: 8 }, () => ({
    userEnteredFormat: {
      backgroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } },
      textFormat: { bold: true, foregroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } } },
      wrapStrategy: "WRAP",
    },
    note: "Keep instruction note",
    dataValidation: { strict: true },
  })) }];
  body.rows = plain(previous.rows);

  c.saveTab_(body);

  assert.equal(backups.length, 1);
  assert.equal(batches.length, 1);
  const requests = batches[0][0].requests;
  assert.equal(requests.length, 1);
  const repair = requests[0].repeatCell;
  assert.deepEqual(repair.range, {
    sheetId: 7, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 8,
  });
  assert.deepEqual(repair.cell.userEnteredFormat, {
    backgroundColor: { red: 0, green: 0, blue: 0 },
    textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
  });
  assert.equal(Object.hasOwn(repair.cell, "userEnteredValue"), false);
  assert.equal(/userEnteredValue|note|dataValidation|wrapStrategy/.test(repair.fields), false);
  assert.match(repair.fields, /backgroundColorStyle/);
  assert.match(repair.fields, /foregroundColorStyle/);
});
test("editing instruction text also repairs black formatting on untouched B:H cells", () => {
  const { context: c, body, previous, batches } = writableBackend();
  previous.rows = [["[以前の指示]", "", "", "", "", "", "", ""]];
  previous.cells = [{ values: Array.from({ length: 8 }, (_, index) => ({
    userEnteredFormat: {
      backgroundColor: index === 0 ? {} : { red: 1, green: 1, blue: 1 },
      textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
    },
  })) }];
  body.rows = [["[変更した指示]", "", "", "", "", "", "", ""]];

  c.saveTab_(body);

  const requests = batches[0][0].requests;
  assert.equal(requests.length, 2);
  assert.equal(requests[0].updateCells.range.startColumnIndex, 0);
  assert.equal(requests[0].updateCells.range.endColumnIndex, 1);
  assert.equal(requests[0].updateCells.rows[0].values[0].userEnteredValue.stringValue, "[変更した指示]");
  assert.equal(requests[1].repeatCell.range.startColumnIndex, 0);
  assert.equal(requests[1].repeatCell.range.endColumnIndex, 8);
});
test("instruction formatting repairs follow their destination row after local insertion or deletion", () => {
  for (const insert of [true, false]) {
    const { context: c, body, previous, batches } = writableBackend();
    const dialogue = ["Scene", "line-a", "", "会話", "", "", "", ""],
      instruction = ["[ここで戦闘を挿入]", "", "", "", "", "", "", ""];
    previous.rows = insert ? [plain(instruction)] : [plain(dialogue), plain(instruction)];
    previous.cells = previous.rows.map(() => ({ values: Array.from({ length: 8 }, () => ({})) }));
    body.rows = insert ? [plain(dialogue), plain(instruction)] : [plain(instruction)];
    body.sourceRows = insert ? [null, 2] : [3];

    c.saveTab_(body);

    const requests = batches[0][0].requests;
    assert.ok(insert ? requests[0].insertRange : requests[0].deleteRange);
    const repair = requests.find((request) => request.repeatCell).repeatCell;
    assert.equal(repair.range.startRowIndex, insert ? 2 : 1);
    assert.equal(repair.range.endRowIndex, insert ? 3 : 2);
    assert.equal(requests.filter((request) => request.repeatCell).length, 1);
  }
});
test("a stale merge repairs a retained instruction at its remote position while preserving other edits", () => {
  const { context: c, body, previous, batches } = writableBackend();
  const instruction = ["[ここで戦闘を挿入]", "", "", "", "", "", "", ""],
    dialogue = ["Scene", "line-a", "", "会話", "", "", "", ""];
  body.revision = "base-revision";
  body.baseRows = [plain(dialogue), plain(instruction)];
  body.rows = [plain(dialogue), plain(instruction)];
  body.rows[0][3] = "ローカルの本文";
  body.sourceRows = [2, 3];
  previous.revision = "remote-revision";
  previous.rows = [plain(instruction), plain(dialogue)];
  previous.rows[1][7] = "リモートのメモ";
  previous.cells = previous.rows.map(() => ({ values: Array.from({ length: 8 }, () => ({})) }));

  const result = c.saveTab_(body);

  assert.equal(result.merged, true);
  const requests = batches[0][0].requests;
  assert.equal(requests[0].updateCells.range.startRowIndex, 2);
  assert.equal(requests[0].updateCells.range.startColumnIndex, 3);
  assert.equal(requests[0].updateCells.range.endColumnIndex, 4);
  assert.equal(requests[1].repeatCell.range.startRowIndex, 1);
  assert.equal(requests[1].repeatCell.range.endRowIndex, 2);
});
test("correct instruction formatting does not create a repair or needless backup", () => {
  for (const useColorStyle of [false, true]) {
    const { context: c, body, previous, backups, batches } = writableBackend();
    previous.rows = [["[ここで戦闘を挿入]", "", "", "", "", "", "", ""]];
    previous.cells = [{ values: Array.from({ length: 8 }, () => ({
      userEnteredFormat: useColorStyle ? {
        backgroundColorStyle: { rgbColor: {} },
        textFormat: { bold: true, foregroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } } },
      } : {
        backgroundColor: {},
        textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
      },
    })) }];
    body.rows = plain(previous.rows);

    c.saveTab_(body);

    assert.equal(backups.length, 0);
    assert.equal(batches.length, 0);
  }
});
test("saving installs a first-priority instruction rule without replacing speaker rules", () => {
  const { context: c, body, conditionalRules, batches } = writableBackend();
  const speakerRule = {
    ranges: [{ sheetId: 7, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 8 }],
    booleanRule: {
      condition: { type: "CUSTOM_FORMULA", values: [{ userEnteredValue: '=$C2="白崎桃香"' }] },
      format: { backgroundColor: { red: 1, green: 0.5, blue: 0.5 } },
    },
  };
  conditionalRules.splice(0, 1, plain(speakerRule));

  c.saveTab_(body);

  const requests = batches[0][0].requests;
  const added = requests.find((request) => request.addConditionalFormatRule).addConditionalFormatRule;
  assert.equal(added.index, 0);
  assert.deepEqual(added.rule.ranges, [
    { sheetId: 7, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 8 },
  ]);
  assert.equal(added.rule.booleanRule.condition.values[0].userEnteredValue,
    '=AND(LEFT(TRIM($A2),1)="[",RIGHT(TRIM($A2),1)="]",LEN(TRIM($B2&$C2&$D2&$E2&$F2&$G2&$H2))=0)');
  assert.deepEqual(conditionalRules, [speakerRule]);
  assert.equal(requests.some((request) => request.deleteConditionalFormatRule), false);
  assert.equal(requests.some((request) => request.updateConditionalFormatRule), false);
});
test("saving reuses an existing instruction rule and moves it ahead of speaker rules", () => {
  const { context: c, body, conditionalRules, batches } = writableBackend();
  const instructionRule = plain(conditionalRules[0]);
  // Sheets normalizes zero RGB channels and may return the ColorStyle form.
  instructionRule.booleanRule.format = {
    backgroundColorStyle: { rgbColor: {} },
    textFormat: { bold: true, foregroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } } },
  };
  const speakerRule = { booleanRule: { condition: { type: "TEXT_EQ", values: [{ userEnteredValue: "other" }] } } };
  conditionalRules.splice(0, 1, speakerRule, instructionRule);

  c.saveTab_(body);

  const requests = batches[0][0].requests;
  assert.equal(requests.some((request) => request.addConditionalFormatRule), false);
  const ruleUpdates = requests.filter((request) => request.updateConditionalFormatRule);
  assert.deepEqual(ruleUpdates, [
    { updateConditionalFormatRule: { sheetId: 7, index: 1, newIndex: 0 } },
  ]);
});
test("saving repairs a damaged instruction rule range and format instead of duplicating it", () => {
  const { context: c, body, conditionalRules, batches } = writableBackend();
  conditionalRules[0].ranges[0].endRowIndex = 3;
  conditionalRules[0].booleanRule.format.backgroundColor = { red: 1, green: 1, blue: 1 };

  c.saveTab_(body);

  const requests = batches[0][0].requests;
  assert.equal(requests.some((request) => request.addConditionalFormatRule), false);
  const updated = requests.find((request) => request.updateConditionalFormatRule).updateConditionalFormatRule;
  assert.equal(updated.index, 0);
  assert.equal(Object.hasOwn(updated.rule.ranges[0], "endRowIndex"), false);
  assert.deepEqual(updated.rule.booleanRule.format.backgroundColor, { red: 0, green: 0, blue: 0 });
});
test("an instruction rule normalized to the current grid extent remains idempotent", () => {
  const { context: c, body, previous, conditionalRules, backups, batches } = writableBackend();
  conditionalRules[0].ranges[0].endRowIndex = 20;
  body.rows = plain(previous.rows);

  c.saveTab_(body);

  assert.equal(backups.length, 0);
  assert.equal(batches.length, 0);
});
test("a normalized instruction rule on sheet zero does not needlessly rewrite omitted sheetId fields", () => {
  const { context: c, sheet, body, previous, conditionalRules, backups, batches } = writableBackend();
  sheet.getSheetId = () => 0;
  body.tabId = 0;
  previous.id = 0;
  body.rows = plain(previous.rows);
  delete conditionalRules[0].ranges[0].sheetId;
  conditionalRules[0].ranges[0].endRowIndex = 20;
  c.Sheets.Spreadsheets.get = () => ({
    sheets: [{ properties: {}, conditionalFormats: conditionalRules }],
  });

  c.saveTab_(body);

  assert.equal(backups.length, 0);
  assert.equal(batches.length, 0);
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
