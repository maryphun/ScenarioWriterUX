/** ScenarioWriterUX API. Deploy this standalone project as a Web App, executing as you. */
const DEFAULT_SPREADSHEET_ID = "1nyJ6dGCOI1a9f9Nujc7XhxoHXj7qh1cmeDPvAFdLLx4";
const SCRIPT_HEADERS = [
  "Node",
  "LineID",
  "Speaker",
  "Text_JP",
  "ChoiceText_JP",
  "NextNode",
  "Command",
  "Comment",
];
const MAX_ASSET_BYTES = 10 * 1024 * 1024;
const MAX_SCRIPT_ROWS = 20000;

/** Run once in the Apps Script editor. Find EDITOR_ACCESS_KEY in Project Settings > Script properties. */
function initializeEditor() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty("SPREADSHEET_ID"))
    props.setProperty("SPREADSHEET_ID", DEFAULT_SPREADSHEET_ID);
  if (!props.getProperty("EDITOR_ACCESS_KEY"))
    props.setProperty(
      "EDITOR_ACCESS_KEY",
      Utilities.getUuid().replace(/-/g, "") +
        Utilities.getUuid().replace(/-/g, ""),
    );
  if (!props.getProperty("ASSET_FOLDER_ID"))
    props.setProperty(
      "ASSET_FOLDER_ID",
      DriveApp.createFolder("ScenarioWriterUX Assets").getId(),
    );
  if (!props.getProperty("BACKUP_FOLDER_ID"))
    props.setProperty(
      "BACKUP_FOLDER_ID",
      DriveApp.createFolder("ScenarioWriterUX Backups").getId(),
    );
  SpreadsheetApp.openById(props.getProperty("SPREADSHEET_ID")).getName();
  // Do not log the access key or any spreadsheet content.
  console.log(
    "Initialized. Copy EDITOR_ACCESS_KEY from Project Settings > Script properties into the app.",
  );
}

function doGet() {
  return json_({ ok: true, service: "ScenarioWriterUX", version: 6 });
}
function doPost(e) {
  try {
    if (!e || !e.postData || e.postData.contents.length > MAX_ASSET_BYTES * 1.5)
      fail_("BAD_REQUEST", "リクエストが不正、または大きすぎます。");
    let body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch (_) {
      fail_("BAD_REQUEST", "JSON が不正です。");
    }
    authenticate_(body.key);
    let data;
    switch (body.action) {
      case "read":
        data = readWorkbook_();
        break;
      case "saveTab":
        data = locked_(() => saveTab_(body));
        break;
      case "listAssets":
        data = Object.values(assetIndex_()).map((a) => Object.assign({}, a));
        break;
      case "getAsset":
        data = getAsset_(body.fileId);
        break;
      case "uploadAsset":
        data = locked_(() => uploadAsset_(body.asset));
        break;
      case "deleteAsset":
        data = locked_(() => deleteAsset_(body.assetId));
        break;
      default:
        fail_("BAD_REQUEST", "未対応の操作です。");
    }
    return json_({ ok: true, data: data });
  } catch (error) {
    const diagnosticId = Utilities.getUuid().split("-")[0];
    if (!error.apiCode)
      console.error(
        "[" +
          diagnosticId +
          "] " +
          (error && error.stack ? error.stack : error),
      );
    return json_({
      ok: false,
      error: {
        code: error.apiCode || "SERVER_ERROR",
        message: error.apiCode
          ? error.message
          : "処理できませんでした。Apps Script の実行履歴を確認してください。診断 ID: " +
            diagnosticId,
      },
    });
  }
}
function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
function fail_(code, message) {
  const e = new Error(message);
  e.apiCode = code;
  throw e;
}
function digest_(value) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8,
  )
    .map((b) => ("0" + (b & 255).toString(16)).slice(-2))
    .join("");
}
// The Sheets API does not guarantee JSON object property order. Canonicalizing
// keys prevents an unchanged sheet from producing a different revision hash.
function stableStringify_(value) {
  return JSON.stringify(value, function (_, current) {
    if (!current || typeof current !== "object" || Array.isArray(current))
      return current;
    return Object.keys(current)
      .sort()
      .reduce(function (sorted, key) {
        sorted[key] = current[key];
        return sorted;
      }, {});
  });
}
function authenticate_(key) {
  const expected =
    PropertiesService.getScriptProperties().getProperty("EDITOR_ACCESS_KEY");
  if (!expected || expected.length < 32)
    fail_("NOT_CONFIGURED", "initializeEditor を実行してください。");
  if (typeof key !== "string" || key.length > 256)
    fail_("UNAUTHORIZED", "アクセスキーが正しくありません。");
  const a = digest_(key),
    b = digest_(expected);
  let different = 0;
  for (let i = 0; i < a.length; i++)
    different |= a.charCodeAt(i) ^ b.charCodeAt(i);
  if (different) fail_("UNAUTHORIZED", "アクセスキーが正しくありません。");
}
function locked_(operation) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000))
    fail_("BUSY", "他の保存処理が実行中です。少し待って再試行してください。");
  try {
    return operation();
  } finally {
    lock.releaseLock();
  }
}
function spreadsheet_() {
  const id =
    PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!id) fail_("NOT_CONFIGURED", "initializeEditor を実行してください。");
  return SpreadsheetApp.openById(id);
}
function isScriptSheet_(sheet) {
  return (
    sheet.getName().toLowerCase() !== "master" &&
    !sheet.isSheetHidden() &&
    JSON.stringify(sheet.getRange(1, 1, 1, 8).getDisplayValues()[0]) ===
      JSON.stringify(SCRIPT_HEADERS)
  );
}
function readSpeakers_(book) {
  const master = book.getSheetByName("Master");
  if (!master) fail_("MISSING_MASTER", "Master シートが見つかりません。");
  return master
    .getRange(2, 1, Math.max(1, master.getLastRow() - 1), 3)
    .getDisplayValues()
    .filter((r) => r[0])
    .map((r) => ({
      name: r[0],
      color: /^#[0-9a-f]{6}$/i.test(r[2]) ? r[2] : "#D6E5FA",
    }));
}
function snapshot_(book, sheet) {
  const count = Math.max(0, sheet.getLastRow() - 1);
  if (count > MAX_SCRIPT_ROWS)
    fail_("TOO_LARGE", "シートの行数が上限を超えています。");
  const rows = count ? sheet.getRange(2, 1, count, 8).getDisplayValues() : [];
  let cells = [];
  if (count) {
    const range =
      "'" + sheet.getName().replace(/'/g, "''") + "'!A2:H" + (count + 1);
    const response = Sheets.Spreadsheets.get(book.getId(), {
      ranges: [range],
      fields:
        "sheets(data(rowData(values(userEnteredValue,userEnteredFormat,dataValidation,note,textFormatRuns))))",
    });
    cells = (((response.sheets || [])[0] || {}).data || []).flatMap(
      (d) => d.rowData || [],
    );
  }
  return {
    id: sheet.getSheetId(),
    name: sheet.getName(),
    rows: rows,
    cells: cells,
    revision: digest_(stableStringify_({ rows: rows, cells: cells })),
  };
}
function publicTab_(snapshot) {
  return {
    id: snapshot.id,
    name: snapshot.name,
    rows: snapshot.rows,
    revision: snapshot.revision,
  };
}
function readWorkbook_() {
  const book = spreadsheet_();
  return {
    spreadsheetId: book.getId(),
    title: book.getName(),
    speakers: readSpeakers_(book),
    tabs: book
      .getSheets()
      .filter(isScriptSheet_)
      .map((sheet) => publicTab_(snapshot_(book, sheet))),
  };
}

/** Run from the Apps Script function dropdown to verify workbook access. */
function testConnection() {
  const result = readWorkbook_();
  console.log(
    "Connection OK. Script tabs: " +
      result.tabs.length +
      ", speakers: " +
      result.speakers.length,
  );
}
function validateRows_(rows, sourceRows, previousCount) {
  if (
    !Array.isArray(rows) ||
    rows.length > MAX_SCRIPT_ROWS ||
    !Array.isArray(sourceRows) ||
    sourceRows.length !== rows.length
  )
    fail_("BAD_REQUEST", "行データが不正です。");
  const seen = new Set();
  rows.forEach((row, i) => {
    if (
      !Array.isArray(row) ||
      row.length !== 8 ||
      row.some((v) => typeof v !== "string" || v.length > 49000)
    )
      fail_("BAD_REQUEST", "セルの値が不正です。");
    const source = sourceRows[i];
    if (source !== null) {
      if (
        !Number.isInteger(source) ||
        source < 2 ||
        source > previousCount + 1 ||
        seen.has(source)
      )
        fail_("BAD_REQUEST", "元の行の参照が不正です。");
      seen.add(source);
    }
  });
}
function hexColor_(hex) {
  return {
    red: parseInt(hex.slice(1, 3), 16) / 255,
    green: parseInt(hex.slice(3, 5), 16) / 255,
    blue: parseInt(hex.slice(5, 7), 16) / 255,
  };
}
function isInstructionRow_(row) {
  const value = String((row && row[0]) || "").trim();
  return (
    value.indexOf("[") === 0 &&
    value.lastIndexOf("]") === value.length - 1 &&
    row.slice(1).every(function (cell) {
      return !String(cell || "").trim();
    })
  );
}
function validateBaseRows_(rows) {
  if (!Array.isArray(rows) || rows.length > MAX_SCRIPT_ROWS)
    fail_("BAD_REQUEST", "同期元の行データが不正です。");
  rows.forEach(function (row) {
    if (
      !Array.isArray(row) ||
      row.length !== 8 ||
      row.some(function (value) {
        return typeof value !== "string" || value.length > 49000;
      })
    )
      fail_("BAD_REQUEST", "同期元のセル値が不正です。");
  });
  return rows;
}
function hasDirectSourceOrder_(sourceRows, count) {
  return (
    sourceRows.length === count &&
    sourceRows.every(function (source, index) {
      return source === index + 2;
    })
  );
}
function mergeConcurrentRows_(baseRows, localRows, remoteRows, localIntentRows) {
  if (baseRows.length !== localRows.length)
    fail_(
      "CONFLICT",
      "この画面でも行の追加・削除・並べ替えがあります。再同期してから行構成を編集してください。",
    );
  const baseToRemote = Array(baseRows.length).fill(-1),
    usedRemote = new Set(),
    baseLineIds = {},
    remoteLineIds = {};
  baseRows.forEach(function (row, index) {
    if (!row[1]) return;
    if (!baseLineIds[row[1]]) baseLineIds[row[1]] = [];
    baseLineIds[row[1]].push(index);
  });
  remoteRows.forEach(function (row, index) {
    if (!row[1]) return;
    if (!remoteLineIds[row[1]]) remoteLineIds[row[1]] = [];
    remoteLineIds[row[1]].push(index);
  });
  Object.keys(baseLineIds).forEach(function (lineId) {
    if (
      baseLineIds[lineId].length === 1 &&
      remoteLineIds[lineId] &&
      remoteLineIds[lineId].length === 1
    ) {
      const baseIndex = baseLineIds[lineId][0],
        remoteIndex = remoteLineIds[lineId][0];
      baseToRemote[baseIndex] = remoteIndex;
      usedRemote.add(remoteIndex);
    }
  });
  const remoteByValue = {};
  remoteRows.forEach(function (row, index) {
    if (usedRemote.has(index)) return;
    const key = JSON.stringify(row);
    if (!remoteByValue[key]) remoteByValue[key] = [];
    remoteByValue[key].push(index);
  });
  baseRows.forEach(function (row, baseIndex) {
    if (baseToRemote[baseIndex] >= 0) return;
    const matches = remoteByValue[JSON.stringify(row)] || [];
    while (matches.length && usedRemote.has(matches[0])) matches.shift();
    if (matches.length) {
      const remoteIndex = matches.shift();
      baseToRemote[baseIndex] = remoteIndex;
      usedRemote.add(remoteIndex);
    }
  });
  const unmatchedBase = [],
    unmatchedRemote = [];
  baseToRemote.forEach(function (remoteIndex, baseIndex) {
    if (remoteIndex < 0) unmatchedBase.push(baseIndex);
  });
  remoteRows.forEach(function (_, remoteIndex) {
    if (!usedRemote.has(remoteIndex)) unmatchedRemote.push(remoteIndex);
  });
  // With equal remaining counts, retain sheet order for legacy rows without a
  // LineID. Exact matches above already account for ordinary row reordering.
  if (unmatchedBase.length === unmatchedRemote.length)
    unmatchedBase.forEach(function (baseIndex, index) {
      const remoteIndex = unmatchedRemote[index];
      baseToRemote[baseIndex] = remoteIndex;
      usedRemote.add(remoteIndex);
    });
  const merged = remoteRows.map(function (row) {
      return row.slice();
    }),
    conflicts = [];
  for (let r = 0; r < baseRows.length; r++) {
    const remoteIndex = baseToRemote[r];
    if (remoteIndex < 0) {
      if (localIntentRows[r].some(function (value, column) {
        return value !== baseRows[r][column];
      }))
        conflicts.push("削除された行 " + (r + 2));
      continue;
    }
    for (let c = 0; c < 8; c++) {
      const base = baseRows[r][c],
        local = localRows[r][c],
        remote = remoteRows[remoteIndex][c];
      if (local === base) continue;
      if (remote !== base && remote !== local)
        conflicts.push(SCRIPT_HEADERS[c] + (remoteIndex + 2));
      else merged[remoteIndex][c] = local;
    }
  }
  if (conflicts.length)
    fail_(
      "CONFLICT",
      "同じセル、または削除された行がこの画面でも変更されています（" +
        conflicts.slice(0, 8).join("、") +
        (conflicts.length > 8 ? " ほか" : "") +
        "）。",
    );
  return {
    rows: merged,
    sourceRows: merged.map(function (_, index) {
      return index + 2;
    }),
  };
}
function saveTab_(body) {
  const book = spreadsheet_(),
    sheet = book.getSheets().find((s) => s.getSheetId() === body.tabId);
  if (!sheet || !isScriptSheet_(sheet))
    fail_("INVALID_TAB", "このシートは編集できません。");
  const previous = snapshot_(book, sheet),
    baseRows = validateBaseRows_(body.baseRows || []),
    localIntentRows = validateBaseRows_(body.rawRows || body.rows || []),
    stale =
      typeof body.revision !== "string" || body.revision !== previous.revision;
  validateRows_(
    body.rows,
    body.sourceRows,
    baseRows.length || previous.rows.length,
  );
  if (localIntentRows.length !== body.rows.length)
    fail_("BAD_REQUEST", "編集中の行データが一致しません。");
  let targetRows = body.rows,
    targetSourceRows = body.sourceRows,
    merged = false;
  if (stale) {
    if (
      !baseRows.length ||
      !hasDirectSourceOrder_(body.sourceRows, baseRows.length)
    )
      fail_(
        "CONFLICT",
        "同時編集中に行の追加・削除・並べ替えがあり、自動統合できませんでした。",
      );
    const mergeResult = mergeConcurrentRows_(
      baseRows,
      body.rows,
      previous.rows,
      localIntentRows,
    );
    targetRows = mergeResult.rows;
    targetSourceRows = mergeResult.sourceRows;
    merged = true;
  }
  if (
    previous.cells.some((row) =>
      (row.values || []).some(
        (c) => c.userEnteredValue && c.userEnteredValue.formulaValue,
      ),
    )
  )
    fail_(
      "FORMULA_PRESENT",
      "A〜H 列に数式があります。数式を保護するため、このシートは保存できません。",
    );
  const colors = Object.fromEntries(
    readSpeakers_(book).map((s) => [s.name, s.color]),
  );
  const rows = targetRows.map((row, i) => {
    const instruction = isInstructionRow_(row);
    return {
      values: row.map((value, c) => {
        const oldRow =
          targetSourceRows[i] === null
            ? null
            : previous.cells[targetSourceRows[i] - 2];
        const source = oldRow?.values?.[c];
        const template = source || previous.cells[0]?.values?.[c] || {};
        const cell = {
          userEnteredValue: { stringValue: value },
          userEnteredFormat: JSON.parse(
            JSON.stringify(template.userEnteredFormat || {}),
          ),
          textFormatRuns: [],
          note: source?.note || "",
        };
        if (template.dataValidation)
          cell.dataValidation = template.dataValidation;
        if (
          source?.userEnteredValue?.stringValue === value &&
          source.textFormatRuns
        )
          cell.textFormatRuns = source.textFormatRuns;
        if (instruction) {
          delete cell.userEnteredFormat.backgroundColorStyle;
          cell.userEnteredFormat.backgroundColor = {
            red: 0,
            green: 0,
            blue: 0,
          };
          cell.userEnteredFormat.textFormat = Object.assign(
            {},
            cell.userEnteredFormat.textFormat || {},
            {
              bold: true,
              foregroundColor: { red: 1, green: 1, blue: 1 },
            },
          );
          delete cell.userEnteredFormat.textFormat.foregroundColorStyle;
        } else if (colors[row[2]]) {
          delete cell.userEnteredFormat.backgroundColorStyle;
          cell.userEnteredFormat.backgroundColor = hexColor_(colors[row[2]]);
        } else if (!row[2]) {
          delete cell.userEnteredFormat.backgroundColorStyle;
          cell.userEnteredFormat.backgroundColor = {
            red: 1,
            green: 1,
            blue: 1,
          };
        }
        return cell;
      }),
    };
  });
  const requests = [];
  const required = Math.max(targetRows.length, previous.rows.length) + 1;
  if (required > sheet.getMaxRows())
    requests.push({
      appendDimension: {
        sheetId: sheet.getSheetId(),
        dimension: "ROWS",
        length: required - sheet.getMaxRows(),
      },
    });
  const directUpdate =
    targetRows.length === previous.rows.length &&
    hasDirectSourceOrder_(targetSourceRows, previous.rows.length);
  if (directUpdate) {
    targetRows.forEach(function (row, r) {
      let changed = [];
      for (let c = 0; c < 8; c++)
        if (row[c] !== previous.rows[r][c]) changed.push(c);
      if (
        changed.length &&
        (row[2] !== previous.rows[r][2] ||
          isInstructionRow_(row) !== isInstructionRow_(previous.rows[r]))
      )
        changed = [0, 1, 2, 3, 4, 5, 6, 7];
      if (!changed.length) return;
      const groups = [];
      changed.forEach(function (column) {
        const last = groups[groups.length - 1];
        if (last && last[last.length - 1] + 1 === column) last.push(column);
        else groups.push([column]);
      });
      groups.forEach(function (group) {
        const start = group[0],
          end = group[group.length - 1] + 1;
        requests.push({
          updateCells: {
            range: {
              sheetId: sheet.getSheetId(),
              startRowIndex: r + 1,
              endRowIndex: r + 2,
              startColumnIndex: start,
              endColumnIndex: end,
            },
            rows: [{ values: rows[r].values.slice(start, end) }],
            fields:
              "userEnteredValue,userEnteredFormat,dataValidation,note,textFormatRuns",
          },
        });
      });
    });
  } else if (required > 1)
    requests.push({
      updateCells: {
        range: {
          sheetId: sheet.getSheetId(),
          startRowIndex: 1,
          endRowIndex: required,
          startColumnIndex: 0,
          endColumnIndex: 8,
        },
        rows: rows,
        fields:
          "userEnteredValue,userEnteredFormat,dataValidation,note,textFormatRuns",
      },
    });
  if (requests.length) {
    const folderId =
      PropertiesService.getScriptProperties().getProperty("BACKUP_FOLDER_ID");
    if (!folderId)
      fail_("NOT_CONFIGURED", "initializeEditor を実行してください。");
    DriveApp.getFolderById(folderId).createFile(
      "sheet-" + sheet.getSheetId() + "-" + Date.now() + ".json",
      JSON.stringify(previous),
      MimeType.PLAIN_TEXT,
    );
    // One atomic Sheets batch. Unrelated concurrent cells are omitted.
    Sheets.Spreadsheets.batchUpdate({ requests: requests }, book.getId());
  }
  SpreadsheetApp.flush();
  const result = publicTab_(snapshot_(book, sheet));
  result.merged = merged;
  return result;
}

function assetFolder_() {
  const id =
    PropertiesService.getScriptProperties().getProperty("ASSET_FOLDER_ID");
  if (!id) fail_("NOT_CONFIGURED", "initializeEditor を実行してください。");
  return DriveApp.getFolderById(id);
}
function assetIndex_() {
  const id =
    PropertiesService.getScriptProperties().getProperty("ASSET_INDEX_ID");
  return id
    ? JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString())
    : {};
}
function saveAssetIndex_(index) {
  const props = PropertiesService.getScriptProperties(),
    id = props.getProperty("ASSET_INDEX_ID"),
    text = JSON.stringify(index);
  if (id) DriveApp.getFileById(id).setContent(text);
  else
    props.setProperty(
      "ASSET_INDEX_ID",
      assetFolder_()
        .createFile("assets-index.json", text, MimeType.PLAIN_TEXT)
        .getId(),
    );
}
function uploadAsset_(asset) {
  if (
    !asset ||
    !/^[a-f0-9]{32}$/.test(asset.id) ||
    !["background", "sprite", "bgm", "se"].includes(asset.kind) ||
    typeof asset.name !== "string" ||
    !asset.name ||
    asset.name.length > 180 ||
    /[\s:\[\]<>]/.test(asset.name) ||
    typeof asset.base64 !== "string" ||
    asset.base64.length > MAX_ASSET_BYTES * 1.4
  )
    fail_("BAD_ASSET", "素材の形式が正しくありません。");
  const image = /^image\/(png|jpeg|webp|gif)$/.test(asset.mime),
    sound = /^audio\/[a-z0-9.+-]+$/i.test(asset.mime);
  if (["background", "sprite"].includes(asset.kind) ? !image : !sound)
    fail_("BAD_ASSET", "対応していない画像・音声形式です。");
  if (typeof asset.description !== "string" || asset.description.length > 4000)
    fail_("BAD_ASSET", "説明が長すぎます。");
  const bytes = Utilities.base64Decode(asset.base64);
  if (bytes.length > MAX_ASSET_BYTES)
    fail_("TOO_LARGE", "1 ファイル 10 MB 以下で登録してください。");
  const index = assetIndex_();
  if (
    Object.values(index).some(
      (a) =>
        a.id !== asset.id && a.name.toLowerCase() === asset.name.toLowerCase(),
    )
  )
    fail_("DUPLICATE_ASSET", "同名の素材が共有済みです。");
  const file = assetFolder_().createFile(
    Utilities.newBlob(bytes, asset.mime, asset.name),
  );
  // Media are private. Replacements are immutable; previous files remain recoverable.
  index[asset.id] = {
    id: asset.id,
    fileId: file.getId(),
    name: asset.name,
    kind: asset.kind,
    mime: asset.mime,
    description: asset.description,
    characterId: String(asset.characterId || ""),
    updatedAt: new Date().toISOString(),
  };
  saveAssetIndex_(index);
  return index[asset.id];
}
function getAsset_(fileId) {
  const asset = Object.values(assetIndex_()).find((a) => a.fileId === fileId);
  if (!asset) fail_("NOT_FOUND", "共有素材が見つかりません。");
  const file = DriveApp.getFileById(fileId),
    parents = file.getParents(),
    folderId = assetFolder_().getId();
  let allowed = false;
  while (parents.hasNext())
    if (parents.next().getId() === folderId) allowed = true;
  if (!allowed)
    fail_("NOT_FOUND", "このファイルは共有素材フォルダーにありません。");
  if (file.getSize() > MAX_ASSET_BYTES)
    fail_("TOO_LARGE", "素材が大きすぎます。");
  return { base64: Utilities.base64Encode(file.getBlob().getBytes()) };
}
function deleteAsset_(assetId) {
  if (typeof assetId !== "string" || !/^[a-f0-9]{32}$/.test(assetId))
    fail_("BAD_ASSET", "素材 ID が正しくありません。");
  const index = assetIndex_(),
    asset = index[assetId];
  if (!asset) fail_("NOT_FOUND", "共有素材が見つかりません。");
  // Drive Trash is recoverable and avoids exposing a permanent-delete action.
  DriveApp.getFileById(asset.fileId).setTrashed(true);
  delete index[assetId];
  saveAssetIndex_(index);
  return { id: assetId };
}
