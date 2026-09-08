export const SHEET_ID = "1nyJ6dGCOI1a9f9Nujc7XhxoHXj7qh1cmeDPvAFdLLx4";
export const HEADERS = [
  "Node",
  "LineID",
  "Speaker",
  "Text_JP",
  "ChoiceText_JP",
  "NextNode",
  "Command",
  "Comment",
];
export const KEYS = [
  "node",
  "lineId",
  "speaker",
  "text",
  "choice",
  "nextNode",
  "command",
  "comment",
];
export const uid = () => globalThis.crypto.randomUUID().replaceAll("-", "");
export function makeRow(node = "", speaker = "") {
  return {
    key: uid(),
    sourceRow: null,
    node,
    lineId: uid(),
    speaker,
    text: "",
    choice: "",
    nextNode: "",
    command: "",
    comment: "",
  };
}
export function formatInstruction(text = "") {
  let value = String(text);
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]"))
    value = trimmed.slice(1, -1);
  return `[${value}]`;
}
export function makeInstructionRow(text = "") {
  const row = makeRow();
  row.node = formatInstruction(text);
  row.lineId = "";
  return row;
}
export function isInstructionRow(row) {
  const value = String(row?.node || "").trim();
  return (
    value.startsWith("[") &&
    value.endsWith("]") &&
    KEYS.slice(1).every((key) => !String(row?.[key] || "").trim())
  );
}
export function instructionText(row) {
  if (!isInstructionRow(row)) return "";
  const value = String(row.node).trim();
  return value.slice(1, -1);
}
export function importTab(tab) {
  return {
    id: tab.id,
    name: tab.name,
    revision: tab.revision,
    rows: (tab.rows || []).map((values, i) => ({
      key: uid(),
      sourceRow: i + 2,
      ...Object.fromEntries(
        KEYS.map((key, j) => [key, String(values[j] ?? "")]),
      ),
    })),
  };
}
export const populated = (row) =>
  KEYS.some((key) => key !== "lineId" && String(row[key] || "").trim());
export function sceneEntries(tab) {
  let scene = "";
  return (tab?.rows || []).map((row, index) => {
    if (!isInstructionRow(row) && row.node.trim()) scene = row.node.trim();
    return { row, index, scene };
  });
}
export function sceneNames(tab) {
  return [
    ...new Set(
      sceneEntries(tab)
        .filter((e) => populated(e.row) && !isInstructionRow(e.row))
        .map((e) => e.scene),
    ),
  ];
}
export function sceneLines(tab, node) {
  return sceneEntries(tab).filter((e) => e.scene === node && populated(e.row));
}
export function removeScriptRow(tab, key) {
  const entries = sceneEntries(tab),
    at = entries.findIndex((entry) => entry.row.key === key);
  if (at < 0) return null;
  const scene = entries[at].scene,
    previousScenes = sceneNames(tab),
    lineIndex = sceneLines(tab, scene).findIndex(
      (entry) => entry.row.key === key,
    ),
    successor = entries
      .slice(at + 1)
      .find((entry) => populated(entry.row) && !isInstructionRow(entry.row));
  if (
    !isInstructionRow(entries[at].row) &&
    entries[at].row.node.trim() &&
    successor?.scene === scene &&
    !successor.row.node.trim()
  )
    successor.row.node = scene;
  tab.rows.splice(at, 1);
  const remaining = sceneLines(tab, scene);
  if (remaining.length)
    return {
      scene,
      key: remaining[Math.min(Math.max(lineIndex, 0), remaining.length - 1)].row
        .key,
    };
  const names = sceneNames(tab),
    previousIndex = Math.max(0, previousScenes.indexOf(scene));
  return {
    scene: names[Math.min(previousIndex, Math.max(0, names.length - 1))] || "",
    key: "",
  };
}
export function serialiseTab(tab) {
  return sceneEntries(tab).map(({ row, scene }) =>
    KEYS.map((key) =>
      key === "node" && populated(row) && !isInstructionRow(row)
        ? scene
        : String(row[key] || ""),
    ),
  );
}
export const allNodes = (workbook) =>
  workbook.tabs
    .flatMap((tab) => sceneNames(tab).map((name) => ({ tabId: tab.id, name })))
    .filter((n) => n.name);
export function validateNodeName(name, workbook, except = "") {
  if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(name))
    return "ノード名は文字または _ で始め、空白・記号を含めないでください。";
  if (name !== except && allNodes(workbook).some((n) => n.name === name))
    return "このノード名は既に使用されています。";
  return "";
}
export function findNode(workbook, name) {
  const exact = allNodes(workbook).filter((n) => n.name === name);
  // Resolve legacy asterisk labels for preview only. Never silently rename the source.
  const matches = exact.length
    ? exact
    : allNodes(workbook).filter((n) => n.name.replace(/^\*/, "") === name);
  return matches.length === 1 ? matches[0] : null;
}
export function renameNode(workbook, tabId, oldName, newName) {
  const issue = validateNodeName(newName, workbook, oldName);
  if (issue) throw new Error(issue);
  const tab = workbook.tabs.find((t) => t.id === tabId);
  const entries = sceneEntries(tab).filter(
    (e) =>
      e.scene === oldName && populated(e.row) && !isInstructionRow(e.row),
  );
  if (!entries.length) throw new Error("変更するシーンが見つかりません。");
  const targets = new Set([oldName]);
  if (
    oldName.startsWith("*") &&
    findNode(workbook, oldName.slice(1))?.name === oldName
  )
    targets.add(oldName.slice(1));
  for (const e of entries) e.row.node = newName;
  for (const t of workbook.tabs)
    for (const row of t.rows)
      if (row.nextNode && targets.has(row.nextNode)) row.nextNode = newName;
}
export function pendingChanges(tab, baseline) {
  const rows = serialiseTab(tab),
    oldRows = baseline?.rows || [];
  let cells = 0,
    assignedNodes = 0;
  rows.forEach((row, i) =>
    row.forEach((value, c) => {
      if (value !== String(oldRows[i]?.[c] ?? "")) {
        cells++;
        if (!c && value && !oldRows[i]?.[c] && !isInstructionRow(tab.rows[i]))
          assignedNodes++;
      }
    }),
  );
  for (let i = rows.length; i < oldRows.length; i++)
    cells += oldRows[i].filter(Boolean).length;
  return {
    cells,
    assignedNodes,
    rows: rows.length,
    previousRows: oldRows.length,
  };
}
export function choiceGroup(lines, index) {
  if (!lines[index]?.row.choice) return [];
  let start = index,
    end = index;
  while (start > 0 && lines[start - 1].row.choice) start--;
  while (end + 1 < lines.length && lines[end + 1].row.choice) end++;
  return lines.slice(start, end + 1);
}
export function workbookIssues(workbook) {
  const result = [];
  for (const tab of workbook.tabs)
    for (const { row, scene } of sceneEntries(tab)) {
      if (!populated(row)) continue;
      if (isInstructionRow(row)) continue;
      if (!scene) result.push(`${tab.name}: ノード未設定の行があります。`);
      if (scene && !/^[\p{L}_][\p{L}\p{N}_]*$/u.test(scene))
        result.push(
          `${tab.name}: ノード「${scene}」に使用できない記号があります。`,
        );
      if (
        row.nextNode &&
        !allNodes(workbook).some((n) => n.name === row.nextNode)
      )
        result.push(`${tab.name}: 移動先「${row.nextNode}」が見つかりません。`);
    }
  return [...new Set(result)];
}
export function sampleWorkbook() {
  const tab = {
    id: "local-tutorial",
    name: "チュートリアル",
    revision: "",
    rows: [
      [
        "Tutorial_Start",
        "",
        "",
        "はじめまして！",
        "",
        "",
        "[background:BG_City_Day:instant]",
        "",
      ],
      ["Tutorial_Start", "", "白崎桃香", "こんにちは", "", "", "", ""],
      ["Tutorial_Start", "", "", "", "Aにする", "Tutorial_A", "", ""],
      ["Tutorial_Start", "", "", "", "Bにする", "Tutorial_B", "", ""],
      ["Tutorial_A", "", "白崎桃香", "Aを選んだね", "", "", "", ""],
      ["Tutorial_B", "", "奥殿テトラ", "Bを選んだね", "", "", "", ""],
    ],
  };
  return {
    title: "脚本",
    spreadsheetId: SHEET_ID,
    demo: true,
    speakers: [
      { name: "白崎桃香", color: "#F8D7E7" },
      { name: "ピュアプリピーチ", color: "#ffb6fe" },
      { name: "奥殿テトラ", color: "#E4D7F5" },
      { name: "あなた", color: "#D6E5FA" },
      { name: "ピュアルン", color: "#D2F0F3" },
      { name: "宮森楓", color: "#FFF1B8" },
    ],
    tabs: [importTab(tab)],
  };
}

function yarnCommand(command) {
  const value = command.trim();
  if (value.startsWith("<<") && value.endsWith(">>")) return value;
  const parts = value
    .replace(/^\[|\]$/g, "")
    .split(/[:\s]+/)
    .filter(Boolean);
  return `<<${parts.map((part, i) => (!i || /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(part) || /^(true|false)$/.test(part) ? part : JSON.stringify(part))).join(" ")}>>`;
}
export function exportYarn(workbook, parseCommands) {
  const issues = workbookIssues(workbook);
  if (issues.length) throw new Error(issues.join("\n"));
  const nodeCounts = new Map();
  for (const n of allNodes(workbook))
    nodeCounts.set(n.name, (nodeCounts.get(n.name) || 0) + 1);
  if ([...nodeCounts.values()].some((n) => n > 1))
    throw new Error("異なるシートに同名のノードがあります。");
  return workbook.tabs
    .map(
      (tab) =>
        `// Sheet: ${tab.name}\n\n` +
        sceneNames(tab)
          .map((name) => {
            const output = [`title: ${name}`, "---"];
            for (const { row } of sceneLines(tab, name)) {
              if (isInstructionRow(row)) continue;
              for (const command of parseCommands(row.command))
                output.push(yarnCommand(command.raw));
              const tag = row.lineId ? ` #line:${row.lineId}` : "";
              if (row.text)
                output.push(
                  `${row.speaker ? row.speaker + ": " : ""}${row.text}${tag}`,
                );
              if (row.choice) {
                output.push(`-> ${row.choice}${tag}`);
                if (row.nextNode) output.push(`    <<jump ${row.nextNode}>>`);
              }
            }
            return output.concat("===", "").join("\n");
          })
          .join("\n"),
    )
    .join("\n");
}
