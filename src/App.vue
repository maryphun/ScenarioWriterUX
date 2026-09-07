<script setup>
import {
  computed,
  ref,
  watch,
  nextTick,
  onMounted,
  onBeforeUnmount,
} from "vue";
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  Settings2,
  ImagePlus,
  Users,
  Music2,
  Clapperboard,
  Upload,
  Download,
  Undo2,
  Redo2,
  ChevronDown,
  X,
  GripVertical,
  GitBranch,
  Trash2,
  Cloud,
  Check,
  FileText,
  Maximize2,
} from "lucide-vue-next";
import StagePreview from "./components/StagePreview.vue";
import CommandEditor from "./components/CommandEditor.vue";
import {
  COMMANDS,
  parseCommands,
  buildCommand,
  commandLabel,
  stateAt,
  emptyStage,
  validateValues,
  COLOR_NAMES,
} from "./lib/commands.js";
import {
  SHEET_ID,
  KEYS,
  uid,
  makeRow,
  importTab,
  sceneLines,
  sceneNames,
  sceneEntries,
  removeScriptRow,
  serialiseTab,
  sampleWorkbook,
  allNodes,
  findNode,
  validateNodeName,
  choiceGroup,
  pendingChanges,
  workbookIssues,
  exportYarn,
  renameNode,
} from "./lib/workbook.js";
import {
  saveDraft,
  loadDraft,
  readAssets,
  putAsset,
  removeAsset as removeStoredAsset,
  download,
} from "./lib/storage.js";
import { request, DEFAULT_API_URL } from "./lib/api.js";
import { DEFAULT_PREVIEW_OPTIONS } from "./lib/preview.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const workbook = ref(sampleWorkbook()),
  tabId = ref(workbook.value.tabs[0].id),
  nodeName = ref("Tutorial_Start"),
  selectedKey = ref(workbook.value.tabs[0].rows[1].key);
const baseline = ref({}),
  baselineSignatures = ref({}),
  assets = ref([]),
  message = ref(""),
  error = ref(""),
  busy = ref(false),
  draftStatus = ref("読み込み中…");
const endpoint = ref(
    localStorage.getItem("scenario-api-url") ||
      import.meta.env.VITE_APPS_SCRIPT_URL ||
      DEFAULT_API_URL,
  ),
  accessKey = ref(sessionStorage.getItem("scenario-api-key") || "");
const panel = ref("background"),
  dialog = ref(),
  modal = ref(""),
  modalError = ref(""),
  textInput = ref(),
  fileInput = ref(),
  backupInput = ref(),
  uploadKind = ref("background");
const commandInitial = ref(""),
  commandPreset = ref("background"),
  editingCommand = ref(-1),
  selectedCharacter = ref(""),
  assetEditing = ref(null);
const nodeForm = ref({ mode: "scene", target: "new", name: "", text: "" }),
  navigation = ref([]),
  entryState = ref(emptyStage()),
  nodeOrigin = ref(emptyStage());
const undoStack = ref([]),
  redoStack = ref([]),
  previewOptions = ref({ ...DEFAULT_PREVIEW_OPTIONS }),
  theme = ref(localStorage.getItem("scenario-theme") || "dark");
const tab = computed(
  () =>
    workbook.value.tabs.find((t) => t.id === tabId.value) ||
    workbook.value.tabs[0],
);
const names = computed(() => sceneNames(tab.value)),
  lines = computed(() => sceneLines(tab.value, nodeName.value));
const index = computed(() =>
  Math.max(
    0,
    lines.value.findIndex((e) => e.row.key === selectedKey.value),
  ),
);
const current = computed(() => lines.value[index.value]?.row);
const isChoice = computed(() =>
  Boolean(current.value?.choice || current.value?.nextNode),
);
const commands = computed(() => parseCommands(current.value?.command || ""));
const before = computed(() =>
  stateAt(
    lines.value.map((e) => e.row),
    index.value - 1,
    entryState.value,
  ),
);
const after = computed(() =>
  stateAt(
    lines.value.map((e) => e.row),
    index.value,
    entryState.value,
  ),
);
const choices = computed(() => choiceGroup(lines.value, index.value));
const speakerColor = computed(
  () =>
    workbook.value.speakers.find((s) => s.name === current.value?.speaker)
      ?.color || "#98a9c4",
);
const signature = (t) =>
  JSON.stringify(t.rows.map((row) => KEYS.map((k) => row[k])));
const dirtyTabs = computed(() =>
  workbook.value.tabs.filter(
    (t) => signature(t) !== baselineSignatures.value[t.id],
  ),
);
const issues = computed(() => workbookIssues(workbook.value));
const backgroundForm = ref({
  asset: "",
  mode: "instant",
  time: 0.5,
  color: "black",
});
const bgAssets = computed(() =>
  assets.value.filter((a) => a.kind === "background"),
);
const spriteAssets = computed(() =>
  assets.value.filter((a) => a.kind === "sprite"),
);
const backgroundAsset = computed(() =>
  assets.value.find((a) => a.name === backgroundForm.value.asset),
);
const character = computed(() =>
  after.value.characters.find((c) => c.id === selectedCharacter.value),
);
const characterForm = ref({
  id: "momoka",
  asset: "",
  x: 0.5,
  duration: "instant",
  flip: "false",
});
const connected = computed(() => !workbook.value.demo);
let draftTimer,
  noticeTimer,
  composition = false,
  loadingDraft = true,
  focusCheckpoint = false;

function notify(text) {
  message.value = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (message.value = ""), 6000);
}
function captureBaselines() {
  for (const t of workbook.value.tabs) {
    baseline.value[t.id] = { rows: t.rows.map((r) => KEYS.map((k) => r[k])) };
    baselineSignatures.value[t.id] = signature(t);
  }
}
captureBaselines();
function checkpoint() {
  undoStack.value.push(
    clone({
      workbook: workbook.value,
      tabId: tabId.value,
      node: nodeName.value,
      key: selectedKey.value,
    }),
  );
  if (undoStack.value.length > 40) undoStack.value.shift();
  redoStack.value = [];
}
function restore(snapshot) {
  workbook.value = snapshot.workbook;
  tabId.value = snapshot.tabId;
  nodeName.value = snapshot.node;
  selectedKey.value = snapshot.key;
  navigation.value = [];
  entryState.value = emptyStage();
}
function undo() {
  const s = undoStack.value.pop();
  if (!s) return;
  redoStack.value.push(
    clone({
      workbook: workbook.value,
      tabId: tabId.value,
      node: nodeName.value,
      key: selectedKey.value,
    }),
  );
  restore(s);
}
function redo() {
  const s = redoStack.value.pop();
  if (!s) return;
  undoStack.value.push(
    clone({
      workbook: workbook.value,
      tabId: tabId.value,
      node: nodeName.value,
      key: selectedKey.value,
    }),
  );
  restore(s);
}
async function persist() {
  try {
    await saveDraft(workbook.value.demo ? "demo" : "sheet:" + SHEET_ID, {
      workbook: workbook.value,
      baseline: baseline.value,
      baselineSignatures: baselineSignatures.value,
      tabId: tabId.value,
      node: nodeName.value,
      key: selectedKey.value,
    });
    draftStatus.value = "下書き保存済み";
  } catch {
    draftStatus.value = "下書き保存に失敗";
    error.value =
      "ブラウザーへの保存に失敗しました。バックアップを書き出してください。";
  }
}
watch(
  workbook,
  () => {
    if (loadingDraft) return;
    draftStatus.value = "下書きを保存中…";
    clearTimeout(draftTimer);
    draftTimer = setTimeout(persist, 450);
  },
  { deep: true },
);
watch(
  theme,
  (value) => {
    document.documentElement.dataset.theme = value;
    localStorage.setItem("scenario-theme", value);
  },
  { immediate: true },
);
watch(modal, async (value) => {
  modalError.value = "";
  await nextTick();
  if (value && !dialog.value.open) dialog.value.showModal();
  else if (!value && dialog.value.open) dialog.value.close();
});
watch(
  () => [current.value?.key, current.value?.command],
  () => {
    const bg = commands.value.find((c) => c.canonical === "background");
    backgroundForm.value = {
      asset: bg?.values.asset || after.value.background,
      mode:
        bg?.values.duration && bg.values.duration !== "instant"
          ? "fade"
          : "instant",
      time:
        bg && bg.values.duration !== "instant"
          ? Number(bg.values.duration)
          : 0.5,
      color: bg?.values.color || "black",
    };
    if (!after.value.characters.some((c) => c.id === selectedCharacter.value))
      selectedCharacter.value = after.value.characters[0]?.id || "";
  },
  { immediate: true },
);
function changeTab() {
  nodeName.value = sceneNames(tab.value)[0] ?? "";
  selectScene();
}
function selectScene() {
  selectedKey.value = sceneLines(tab.value, nodeName.value)[0]?.row.key || "";
  navigation.value = [];
  entryState.value = emptyStage();
  nodeOrigin.value = emptyStage();
}
function selectLine(entry) {
  selectedKey.value = entry.row.key;
  focusCheckpoint = false;
}
function step(delta) {
  const entry = lines.value[index.value + delta];
  if (entry) selectLine(entry);
}
function insertLine() {
  if (!nodeName.value) {
    openNode("rename");
    return;
  }
  checkpoint();
  const row = makeRow(nodeName.value, current.value?.speaker || "");
  const at = current.value
    ? tab.value.rows.findIndex((r) => r.key === current.value.key) + 1
    : tab.value.rows.length;
  tab.value.rows.splice(at, 0, row);
  selectedKey.value = row.key;
  nextTick(() => textInput.value?.focus());
}
function editField(field, value) {
  if (!current.value) return;
  current.value[field] = value;
}
function textFocus() {
  if (!focusCheckpoint) {
    checkpoint();
    focusCheckpoint = true;
  }
}
function onEnter(event) {
  if (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing &&
    !composition &&
    event.keyCode !== 229
  ) {
    event.preventDefault();
    insertLine();
  }
}
function deleteLine(target = current.value) {
  if (!target?.key) return;
  const content = (
    target.choice ||
    target.text ||
    target.command ||
    "内容のない行"
  )
    .replace(/\s+/g, " ")
    .trim();
  const summary = content.length > 56 ? content.slice(0, 56) + "…" : content;
  if (!confirm(`このセリフを削除しますか？\n「${summary}」`)) return;
  const wasSelected = target.key === current.value?.key;
  checkpoint();
  const selection = removeScriptRow(tab.value, target.key);
  if (wasSelected && selection) {
    nodeName.value = selection.scene;
    selectedKey.value =
      selection.key || sceneLines(tab.value, selection.scene)[0]?.row.key || "";
    navigation.value = [];
    entryState.value = emptyStage();
  }
}
function reorderLine(event, target) {
  event.preventDefault();
  const key = event.dataTransfer.getData("application/x-scenario-line");
  if (!key || key === target.row.key) return;
  const from = tab.value.rows.findIndex((r) => r.key === key),
    to = tab.value.rows.findIndex((r) => r.key === target.row.key);
  if (from < 0 || to < 0) return;
  checkpoint();
  const [row] = tab.value.rows.splice(from, 1);
  row.node = nodeName.value;
  tab.value.rows.splice(to, 0, row);
}
function setCommand(raw, at = -1) {
  if (!current.value) return;
  checkpoint();
  const list = parseCommands(current.value.command).map((c) => c.raw);
  if (at >= 0) list[at] = raw;
  else list.push(raw);
  current.value.command = list.join(" ");
}
function openCommand(preset = "background", initial = "", at = -1) {
  if (!current.value) {
    notify("先にシーンを作成してください。");
    return;
  }
  commandPreset.value = preset;
  commandInitial.value = initial;
  editingCommand.value = at;
  modal.value = "command";
}
function saveCommand(raw) {
  setCommand(raw, editingCommand.value);
  modal.value = "";
}
function removeCommand(i) {
  checkpoint();
  const list = commands.value.map((c) => c.raw);
  list.splice(i, 1);
  current.value.command = list.join(" ");
}
function reorderCommand(event, i) {
  event.preventDefault();
  const source = event.dataTransfer.getData(
    "application/x-scenario-command-index",
  );
  if (source !== "") {
    checkpoint();
    const list = commands.value.map((c) => c.raw),
      from = Number(source);
    const [item] = list.splice(from, 1);
    list.splice(i, 0, item);
    current.value.command = list.join(" ");
  } else dropCommand(event);
}
function dropCommand(event) {
  event.preventDefault();
  const key = event.dataTransfer.getData("application/x-scenario-command");
  if (key) openCommand(key);
  const id = event.dataTransfer.getData("application/x-scenario-asset");
  if (id) {
    const asset = assets.value.find((a) => a.id === id);
    if (asset) useAsset(asset);
  }
}
function applyBackground() {
  try {
    const raw = buildCommand("background", {
      asset: backgroundForm.value.asset,
      duration:
        backgroundForm.value.mode === "instant"
          ? "instant"
          : String(backgroundForm.value.time),
      color: backgroundForm.value.color || "black",
    });
    setCommand(
      raw,
      commands.value.findIndex((c) => c.canonical === "background"),
    );
    notify("この行の背景を設定しました。");
  } catch (e) {
    error.value = e.message;
  }
}
function addCharacter() {
  try {
    setCommand(buildCommand("char:show", characterForm.value));
    selectedCharacter.value = characterForm.value.id;
    notify("立ち絵を追加しました。");
  } catch (e) {
    error.value = e.message;
  }
}
function moveCharacter({ id, x }) {
  setCommand(
    buildCommand("char:move", { id, x, duration: "instant" }),
    commands.value.findIndex(
      (c) => c.canonical === "char:move" && c.values.id === id,
    ),
  );
}
function openNode(mode = "scene") {
  nodeForm.value = {
    mode,
    target: "new",
    name: mode === "rename" ? nodeName.value.replace(/^\*/, "") : "",
    text: "",
  };
  modal.value = "node";
}
function submitNode() {
  const f = nodeForm.value,
    name = f.name.trim();
  if (f.mode === "rename") {
    try {
      const issue = validateNodeName(name, workbook.value, nodeName.value);
      if (issue) throw new Error(issue);
      checkpoint();
      renameNode(workbook.value, tabId.value, nodeName.value, name);
      nodeName.value = name;
      selectScene();
      modal.value = "";
    } catch (e) {
      modalError.value = e.message;
    }
    return;
  }
  let issue = "";
  if (f.target === "existing" && f.mode === "choice") {
    if (!allNodes(workbook.value).some((n) => n.name === name))
      issue = "入力した移動先ノードが見つかりません。";
  } else issue = validateNodeName(name, workbook.value);
  if (issue) {
    modalError.value = issue;
    return;
  }
  if (f.mode === "choice" && !f.text.trim()) {
    modalError.value = "選択肢の文章を入力してください。";
    return;
  }
  checkpoint();
  if (f.target === "new") tab.value.rows.push(makeRow(name));
  if (f.mode === "scene") {
    nodeName.value = name;
    selectScene();
  } else {
    const choice = makeRow(nodeName.value);
    choice.choice = f.text.trim();
    choice.nextNode = name;
    const at = tab.value.rows.findIndex((r) => r.key === current.value.key);
    tab.value.rows.splice(at + 1, 0, choice);
    selectedKey.value = choice.key;
  }
  modal.value = "";
}
function followChoice(name) {
  const found = findNode(workbook.value, name);
  if (!found) {
    error.value = `移動先「${name}」を一意に特定できません。`;
    return;
  }
  navigation.value.push({
    tabId: tabId.value,
    node: nodeName.value,
    key: selectedKey.value,
    initial: clone(entryState.value),
  });
  entryState.value = clone(after.value);
  tabId.value = found.tabId;
  nodeName.value = found.name;
  selectedKey.value = sceneLines(tab.value, nodeName.value)[0]?.row.key || "";
}
function returnNode() {
  const previous = navigation.value.pop();
  if (!previous) return;
  tabId.value = previous.tabId;
  nodeName.value = previous.node;
  selectedKey.value = previous.key;
  entryState.value = previous.initial;
}
async function connect() {
  busy.value = true;
  modalError.value = "";
  try {
    if (
      dirtyTabs.value.length &&
      !confirm(
        "シートから読み直すと未反映の変更を置き換えます。必要な変更は先にバックアップを書き出してください。読み込みますか？",
      )
    )
      return;
    await persist();
    const data = await request(endpoint.value.trim(), accessKey.value, "read");
    if (data.spreadsheetId !== SHEET_ID)
      throw new Error("指定のスプレッドシートと接続先が一致しません。");
    localStorage.setItem("scenario-api-url", endpoint.value.trim());
    sessionStorage.setItem("scenario-api-key", accessKey.value);
    workbook.value = { ...data, demo: false, tabs: data.tabs.map(importTab) };
    baseline.value = {};
    baselineSignatures.value = {};
    captureBaselines();
    tabId.value = workbook.value.tabs[0]?.id;
    changeTab();
    undoStack.value = [];
    redoStack.value = [];
    modal.value = "";
    notify("スプレッドシートを読み込みました。");
    await loadSharedAssets();
  } catch (e) {
    modalError.value = e.message;
  } finally {
    busy.value = false;
  }
}
async function sync() {
  busy.value = true;
  modalError.value = "";
  try {
    for (const t of [...dirtyTabs.value]) {
      const saved = await request(endpoint.value, accessKey.value, "saveTab", {
        tabId: t.id,
        revision: t.revision,
        rows: serialiseTab(t),
        sourceRows: t.rows.map((r) => r.sourceRow),
      });
      const imported = importTab(saved),
        at = workbook.value.tabs.findIndex((x) => x.id === t.id);
      workbook.value.tabs[at] = imported;
      baseline.value[t.id] = { rows: saved.rows };
      baselineSignatures.value[t.id] = signature(imported);
      if (t.id === tabId.value)
        selectedKey.value =
          sceneLines(imported, nodeName.value)[0]?.row.key || "";
      await persist();
    }
    modal.value = "";
    undoStack.value = [];
    redoStack.value = [];
    notify("変更をスプレッドシートに反映しました。");
  } catch (e) {
    modalError.value =
      e.code === "CONFLICT"
        ? "シートが他の場所で変更されています。下書きをバックアップして、接続設定から再読込してください。"
        : e.message;
  } finally {
    busy.value = false;
  }
}
function openSync() {
  if (!connected.value) {
    modal.value = "connect";
    return;
  }
  if (!dirtyTabs.value.length) {
    notify("未反映の変更はありません。");
    return;
  }
  modal.value = "sync";
}
function chooseFiles(kind) {
  uploadKind.value = kind;
  fileInput.value.accept = ["background", "sprite"].includes(kind)
    ? "image/png,image/jpeg,image/webp,image/gif"
    : "audio/*";
  fileInput.value.click();
}
async function importFiles(files, kind) {
  error.value = "";
  for (const file of files) {
    if (
      !file.type.startsWith(
        ["background", "sprite"].includes(kind) ? "image/" : "audio/",
      )
    ) {
      error.value = "画像または音声ファイルを選択してください。";
      continue;
    }
    if (file.size > 10 * 1024 * 1024) {
      error.value = "1 ファイル 10 MB 以下で登録してください。";
      continue;
    }
    const name = file.name.replace(/\.[^.]+$/, "").replace(/[\s:\[\]<>]/g, "_");
    if (assets.value.some((a) => a.name.toLowerCase() === name.toLowerCase())) {
      error.value = `「${name}」は登録済みです。別名のファイルを選んでください。`;
      continue;
    }
    const record = {
      id: uid(),
      kind,
      name,
      description: "",
      blob: file,
      sheetId: SHEET_ID,
    };
    try {
      await putAsset(record);
      const item = { ...record, url: URL.createObjectURL(file) };
      assets.value.push(item);
      if (kind === "background") backgroundForm.value.asset = name;
      if (kind === "sprite") characterForm.value.asset = name;
    } catch (e) {
      error.value = "素材の保存に失敗しました：" + e.message;
    }
  }
}
function dropFiles(e, kind) {
  e.preventDefault();
  importFiles([...e.dataTransfer.files], kind);
}
function useAsset(asset) {
  if (asset.kind === "background") {
    panel.value = "background";
    backgroundForm.value.asset = asset.name;
    applyBackground();
  } else if (asset.kind === "sprite") {
    panel.value = "characters";
    characterForm.value.asset = asset.name;
    characterForm.value.id =
      asset.characterId || "character_" + (after.value.characters.length + 1);
    openCommand("char:show", buildCommand("char:show", characterForm.value));
  } else
    openCommand(
      asset.kind === "bgm" ? "bgm:play" : "se:play",
      buildCommand(asset.kind === "bgm" ? "bgm:play" : "se:play", {
        asset: asset.name,
      }),
    );
}
function editAsset(asset) {
  assetEditing.value = { ...asset };
  modal.value = "asset";
}
function validateAsset() {
  const a = assetEditing.value;
  if (!a.name || /[\s:\[\]<>]/.test(a.name)) {
    modalError.value = "画像名に空白・コロン・括弧は使えません。";
    return false;
  }
  if (
    assets.value.some(
      (x) => x.id !== a.id && x.name.toLowerCase() === a.name.toLowerCase(),
    )
  ) {
    modalError.value = "同じ素材名が登録されています。";
    return false;
  }
  const original = assets.value.find((x) => x.id === a.id);
  if (
    original.name !== a.name &&
    workbook.value.tabs.some((t) =>
      t.rows.some((r) =>
        parseCommands(r.command).some((c) => c.values.asset === original.name),
      ),
    )
  ) {
    modalError.value =
      "この素材は演出で使用中です。先に演出の素材名を変更してください。";
    return false;
  }
  return true;
}
async function saveAsset() {
  if (!validateAsset()) return;
  const a = assetEditing.value;
  const record = { ...a };
  delete record.url;
  await putAsset(record);
  assets.value = assets.value.map((x) => (x.id === a.id ? { ...a } : x));
  modal.value = "";
}
const blobBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
async function shareAsset() {
  if (!validateAsset()) return;
  busy.value = true;
  modalError.value = "";
  try {
    const a = assetEditing.value;
    const data = await request(endpoint.value, accessKey.value, "uploadAsset", {
      asset: {
        id: a.id,
        name: a.name,
        kind: a.kind,
        description: a.description,
        characterId: a.characterId || "",
        mime: a.blob.type,
        base64: await blobBase64(a.blob),
      },
    });
    a.sharedId = data.fileId;
    await saveAsset();
    notify("素材を共有フォルダーに保存しました。");
  } catch (e) {
    modalError.value = e.message;
  } finally {
    busy.value = false;
  }
}
async function loadSharedAssets() {
  try {
    const list = await request(endpoint.value, accessKey.value, "listAssets");
    for (const meta of list) {
      if (
        assets.value.some(
          (a) =>
            a.id !== meta.id &&
            a.name.toLowerCase() === meta.name.toLowerCase(),
        )
      ) {
        notify(
          "同名のローカル素材があるため、共有素材「" +
            meta.name +
            "」は読み込みませんでした。",
        );
        continue;
      }
      if (
        assets.value.some(
          (a) => a.sharedId === meta.fileId && a.updatedAt === meta.updatedAt,
        )
      )
        continue;
      const data = await request(endpoint.value, accessKey.value, "getAsset", {
        fileId: meta.fileId,
      });
      const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0)),
        blob = new Blob([bytes], { type: meta.mime });
      const old = assets.value.find((a) => a.id === meta.id);
      if (old?.url) URL.revokeObjectURL(old.url);
      const record = {
        ...meta,
        blob,
        sharedId: meta.fileId,
        sheetId: SHEET_ID,
      };
      await putAsset(record);
      assets.value = assets.value.filter((a) => a.id !== meta.id);
      assets.value.push({ ...record, url: URL.createObjectURL(blob) });
    }
  } catch (e) {
    notify("シートは接続済みです。共有素材：" + e.message);
  }
}
function assetUsageCount(asset) {
  const name = asset.name.toLowerCase();
  return workbook.value.tabs.reduce(
    (count, itemTab) =>
      count +
      itemTab.rows.filter((row) =>
        parseCommands(row.command).some(
          (command) =>
            String(command.values?.asset || "").toLowerCase() === name,
        ),
      ).length,
    0,
  );
}
async function discardAsset(asset) {
  const usage = assetUsageCount(asset);
  const usageWarning = usage
    ? `\n\nこの素材は ${usage} 行の演出で使用中です。削除後は画像・音声が未登録として表示されます。`
    : "";
  const scopeMessage = asset.sharedId
    ? "共有素材から削除し、Google Drive のゴミ箱へ移動します。"
    : "このブラウザーの素材ライブラリーから削除します。";
  if (
    !confirm(
      `素材「${asset.name}」を削除しますか？\n${scopeMessage}${usageWarning}`,
    )
  )
    return;
  busy.value = true;
  error.value = "";
  try {
    if (asset.sharedId)
      await request(endpoint.value, accessKey.value, "deleteAsset", {
        assetId: asset.id,
      });
    await removeStoredAsset(asset.id);
    if (asset.url) URL.revokeObjectURL(asset.url);
    assets.value = assets.value.filter((item) => item.id !== asset.id);
    if (backgroundForm.value.asset === asset.name)
      backgroundForm.value.asset = "";
    if (characterForm.value.asset === asset.name)
      characterForm.value.asset = "";
    notify(
      asset.sharedId
        ? "共有素材を Google Drive のゴミ箱へ移動しました。"
        : "素材を削除しました。",
    );
  } catch (e) {
    error.value = "素材を削除できませんでした：" + e.message;
  } finally {
    busy.value = false;
  }
}
function exportBackup() {
  download(
    "scenario-backup.json",
    JSON.stringify({ version: 1, workbook: workbook.value }, null, 2),
    "application/json",
  );
  notify(
    "シナリオのバックアップを書き出しました。画像・音声は素材共有から保存できます。",
  );
}
async function importBackup(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.version !== 1 || !Array.isArray(data.workbook?.tabs))
      throw new Error("対応していないバックアップ形式です。");
    if (!confirm("現在のシナリオをバックアップの内容に置き換えますか？"))
      return;
    checkpoint();
    for (const t of data.workbook.tabs) {
      if (
        !Array.isArray(t.rows) ||
        !t.rows.every((r) => KEYS.every((k) => typeof r[k] === "string"))
      )
        throw new Error("バックアップの行データが不正です。");
    }
    workbook.value = {
      ...data.workbook,
      demo: true,
      tabs: data.workbook.tabs.map((t) => ({
        ...t,
        id: "local-" + uid(),
        revision: "",
      })),
    };
    tabId.value = workbook.value.tabs[0].id;
    changeTab();
    notify("バックアップをローカル下書きとして開きました。");
  } catch (e) {
    error.value = e.message;
  }
}
function generateYarn() {
  try {
    download(
      "GeneratedDialogue.yarn",
      exportYarn(workbook.value, parseCommands),
    );
    modal.value = "";
  } catch (e) {
    modalError.value = e.message;
  }
}
function shortcut(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    persist();
    notify("ブラウザーに下書きを保存しました。");
  }
}
function beforeUnload(e) {
  if (draftStatus.value === "下書きを保存中…") {
    e.preventDefault();
    e.returnValue = "";
  }
}
onMounted(async () => {
  try {
    const saved =
      (await loadDraft("sheet:" + SHEET_ID)) || (await loadDraft("demo"));
    if (saved) {
      workbook.value = saved.workbook;
      baseline.value = saved.baseline;
      baselineSignatures.value = saved.baselineSignatures;
      tabId.value = saved.tabId;
      nodeName.value = saved.node;
      selectedKey.value = saved.key;
    }
    assets.value = (await readAssets())
      .filter((a) => a.sheetId === SHEET_ID)
      .map((a) => ({ ...a, url: URL.createObjectURL(a.blob) }));
    draftStatus.value = "下書き保存済み";
  } catch {
    error.value = "このブラウザーでは下書きを保存できません。";
  } finally {
    loadingDraft = false;
  }
  window.addEventListener("keydown", shortcut);
  window.addEventListener("beforeunload", beforeUnload);
});
onBeforeUnmount(() => {
  clearTimeout(draftTimer);
  persist();
  assets.value.forEach((a) => URL.revokeObjectURL(a.url));
  window.removeEventListener("keydown", shortcut);
  window.removeEventListener("beforeunload", beforeUnload);
});
</script>

<template>
  <div class="workspace">
    <header class="topbar">
      <div class="project-path">
        <FileText :size="18" /><span>脚本</span
        ><span class="path-separator">/</span
        ><select v-model="tabId" @change="changeTab" aria-label="シート">
          <option v-for="t in workbook.tabs" :key="t.id" :value="t.id">
            {{ t.name }}
          </option>
        </select>
      </div>
      <div class="top-actions">
        <span class="connection-state" :class="{ connected }">{{
          connected ? "接続済み" : "接続前・サンプル"
        }}</span
        ><button
          class="icon-button"
          title="元に戻す"
          aria-label="元に戻す"
          :disabled="!undoStack.length"
          @click="undo"
        >
          <Undo2 :size="17" /></button
        ><button
          class="icon-button"
          title="やり直す"
          aria-label="やり直す"
          :disabled="!redoStack.length"
          @click="redo"
        >
          <Redo2 :size="17" /></button
        ><button class="button" @click="openNode('scene')">
          <Plus :size="16" />シーン</button
        ><button
          class="icon-button"
          aria-label="書き出し"
          title="書き出し"
          @click="modal = 'export'"
        >
          <Download :size="17" /></button
        ><button
          class="icon-button"
          aria-label="接続設定"
          title="接続設定"
          @click="modal = 'connect'"
        >
          <Settings2 :size="18" /></button
        ><button class="button primary" @click="openSync" :disabled="busy">
          <Cloud :size="16" />シートに反映<span
            v-if="dirtyTabs.length"
            class="count"
            >{{ dirtyTabs.length }}</span
          >
        </button>
      </div>
    </header>
    <div class="editor-layout">
      <aside class="script-panel">
        <div class="node-picker">
          <label
            >シーン<select v-model="nodeName" @change="selectScene">
              <option v-for="name in names" :key="name" :value="name">
                {{ name || "未整理の行" }}
              </option>
            </select></label
          >
          <div class="node-meta">
            <small>{{ lines.length }} 行</small
            ><button
              class="text-button"
              :disabled="!current"
              @click="openNode('rename')"
            >
              名前変更</button
            ><button
              class="text-button"
              :disabled="!navigation.length"
              @click="returnNode"
            >
              <ArrowLeft :size="13" />分岐元へ
            </button>
          </div>
        </div>
        <div class="script-lines">
          <div
            v-for="(entry, i) in lines"
            :key="entry.row.key"
            class="script-row"
            :class="{ selected: entry.row.key === current?.key }"
            @dragover.prevent
            @drop="reorderLine($event, entry)"
          >
            <button
              class="line-grip"
              draggable="true"
              aria-label="行をドラッグして移動"
              @dragstart="
                $event.dataTransfer.setData(
                  'application/x-scenario-line',
                  entry.row.key,
                )
              "
            >
              <GripVertical :size="14" /></button
            ><button class="line-select" @click="selectLine(entry)">
              <span class="line-number">{{
                String(i + 1).padStart(2, "0")
              }}</span>
              <div class="line-copy">
                <span
                  class="line-speaker"
                  :style="{
                    color: workbook.speakers.find(
                      (s) => s.name === entry.row.speaker,
                    )?.color,
                  }"
                  ><GitBranch v-if="entry.row.choice" :size="12" />{{
                    entry.row.choice
                      ? "選択肢"
                      : entry.row.speaker || "ナレーション"
                  }}</span
                ><span class="line-text">{{
                  entry.row.choice || entry.row.text || "…"
                }}</span
                ><span v-if="entry.row.command" class="line-command">{{
                  parseCommands(entry.row.command).map(commandLabel).join(" · ")
                }}</span
                ><span v-if="entry.row.nextNode" class="line-command"
                  >→ {{ entry.row.nextNode }}</span
                >
              </div>
            </button>
            <button
              class="line-delete"
              type="button"
              :aria-label="`${i + 1}行目を削除`"
              title="このセリフを削除"
              @click.stop="deleteLine(entry.row)"
            >
              <Trash2 :size="14" />
            </button>
          </div>
        </div>
        <div class="script-bottom">
          <button
            class="button full"
            @click="current ? insertLine() : openNode()"
          >
            <Plus :size="15" />セリフを追加
          </button>
        </div>
      </aside>

      <main class="preview-panel">
        <div class="panel-heading">
          <h1>プレビュー</h1>
          <span class="meta"
            >{{ nodeName || "シーン未選択" }} <span class="separator">·</span>
            {{ index + 1 }} / {{ lines.length }}</span
          >
        </div>
        <StagePreview
          v-if="current"
          :before="before"
          :after="after"
          :row="current"
          :choices="choices"
          :assets="assets"
          :speakers="workbook.speakers"
          :options="previewOptions"
          @choice="followChoice"
          @move-character="moveCharacter"
          @select-character="
            selectedCharacter = $event;
            panel = 'characters';
          "
          @message="notify"
        />
        <div v-else class="empty-preview">
          <Clapperboard :size="32" />
          <p>新しいシーンを作成して、書き始めましょう。</p>
          <button class="button primary" @click="openNode()">
            シーンを作成
          </button>
        </div>
        <div class="transport">
          <button
            class="button"
            @click="step(-1)"
            :disabled="index === 0 || !current"
          >
            <ArrowLeft :size="16" />前へ</button
          ><button
            class="button"
            @click="step(1)"
            :disabled="index >= lines.length - 1 || !current"
          >
            次へ<ArrowRight :size="16" />
          </button>
        </div>
        <section
          v-if="current"
          class="dialogue-editor"
          :style="{ '--line-color': speakerColor }"
        >
          <div class="dialogue-toolbar">
            <label class="speaker-picker"
              ><span class="speaker-dot"></span
              ><select
                :value="current.speaker"
                aria-label="話者"
                @focus="textFocus"
                @change="editField('speaker', $event.target.value)"
              >
                <option value="">ナレーション</option>
                <option
                  v-if="
                    current.speaker &&
                    !workbook.speakers.some((s) => s.name === current.speaker)
                  "
                  :value="current.speaker"
                >
                  {{ current.speaker }}
                </option>
                <option
                  v-for="s in workbook.speakers"
                  :key="s.name"
                  :value="s.name"
                >
                  {{ s.name }}
                </option>
              </select></label
            ><button
              class="icon-button"
              title="この行を削除"
              aria-label="この行を削除"
              @click="deleteLine(current)"
            >
              <Trash2 :size="14" />
            </button>
          </div>
          <textarea
            ref="textInput"
            :value="isChoice ? current.choice : current.text"
            :aria-label="isChoice ? '選択肢の文章' : 'セリフ'"
            :placeholder="isChoice ? '選択肢を入力…' : 'セリフを入力…'"
            @focus="textFocus"
            @blur="focusCheckpoint = false"
            @input="
              editField(isChoice ? 'choice' : 'text', $event.target.value)
            "
            @keydown="onEnter"
            @compositionstart="composition = true"
            @compositionend="composition = false"
          ></textarea>
          <label v-if="isChoice" class="choice-target"
            >移動先<input
              :value="current.nextNode"
              list="all-nodes"
              @focus="textFocus"
              @input="editField('nextNode', $event.target.value)"
            /><button class="button" @click="followChoice(current.nextNode)">
              移動
            </button></label
          >
          <div class="writing-hint">
            <span>Enter：次のセリフ <span>·</span> Shift＋Enter：改行</span
            ><span
              >{{
                (isChoice ? current.choice : current.text).length
              }}
              文字</span
            >
          </div>
        </section>
        <section v-if="current" class="line-direction">
          <div class="panel-heading">
            <h2>この行の演出</h2>
            <button class="text-button" @click="openNode('choice')">
              <GitBranch :size="15" />選択肢を追加
            </button>
          </div>
          <div class="command-drop" @dragover.prevent @drop="dropCommand">
            <div
              v-for="(c, i) in commands"
              :key="i"
              class="command-chip"
              draggable="true"
              @dragstart="
                $event.dataTransfer.setData(
                  'application/x-scenario-command-index',
                  String(i),
                )
              "
              @dragover.prevent
              @drop.stop="reorderCommand($event, i)"
            >
              <button
                @click="
                  c.definition
                    ? openCommand(c.key, c.raw, i)
                    : notify('下のコマンド欄から直接編集できます。')
                "
              >
                <GripVertical :size="13" />{{ commandLabel(c) }}</button
              ><button
                :aria-label="commandLabel(c) + 'を削除'"
                @click="removeCommand(i)"
              >
                <X :size="13" />
              </button>
            </div>
            <button class="add-command" @click="openCommand()">
              <Plus :size="15" />{{
                commands.length ? "追加" : "演出を追加・ここにドロップ"
              }}
            </button>
          </div>
          <details class="raw-details">
            <summary>コマンド・メモ</summary>
            <label
              >コマンド<textarea
                :value="current.command"
                @focus="textFocus"
                @input="editField('command', $event.target.value)"
                spellcheck="false"
              ></textarea>
            </label>
            <p
              v-for="c in commands.filter(
                (c) =>
                  !c.definition ||
                  validateValues(c.definition, c.values).length,
              )"
              :key="c.raw"
              class="warning"
            >
              {{ c.raw }} —
              {{
                c.definition
                  ? validateValues(c.definition, c.values).join(" ")
                  : "プレビュー未対応。入力は保持されます。"
              }}
            </p>
            <label
              >メモ<textarea
                :value="current.comment"
                @focus="textFocus"
                @input="editField('comment', $event.target.value)"
              ></textarea>
            </label>
          </details>
        </section>
      </main>

      <aside class="inspector">
        <nav class="inspector-tabs" aria-label="演出の種類">
          <button
            v-for="p in [
              { id: 'background', label: '背景', icon: ImagePlus },
              { id: 'characters', label: '立ち絵', icon: Users },
              { id: 'commands', label: '演出', icon: Clapperboard },
              { id: 'assets', label: '素材', icon: Upload },
            ]"
            :key="p.id"
            :class="{ active: panel === p.id }"
            @click="panel = p.id"
          >
            <component :is="p.icon" :size="17" /><span>{{ p.label }}</span>
          </button>
        </nav>
        <div class="inspector-body">
          <section v-if="panel === 'background'">
            <div class="panel-heading"><h2>背景</h2></div>
            <button
              class="asset-drop background-drop"
              @click="chooseFiles('background')"
              @dragover.prevent
              @drop="dropFiles($event, 'background')"
            >
              <img
                v-if="backgroundAsset"
                :src="backgroundAsset.url"
                alt="選択中の背景"
              /><template v-else
                ><ImagePlus :size="24" /><span>背景画像をドロップ</span
                ><small>またはクリックして選択</small></template
              >
            </button>
            <label
              >画像<select v-model="backgroundForm.asset">
                <option value="">選択してください</option>
                <option
                  v-if="
                    backgroundForm.asset &&
                    !bgAssets.some((a) => a.name === backgroundForm.asset)
                  "
                  :value="backgroundForm.asset"
                >
                  {{ backgroundForm.asset }}（未登録）
                </option>
                <option v-for="a in bgAssets" :key="a.id" :value="a.name">
                  {{ a.name }}
                </option>
              </select></label
            ><button
              v-if="backgroundAsset"
              class="text-button asset-meta-edit"
              @click="editAsset(backgroundAsset)"
            >
              素材名・説明を編集
            </button>
            <fieldset class="transition-fields">
              <legend>切り替え</legend>
              <div class="segmented">
                <button
                  :class="{ active: backgroundForm.mode === 'instant' }"
                  @click="backgroundForm.mode = 'instant'"
                >
                  即時</button
                ><button
                  :class="{ active: backgroundForm.mode === 'fade' }"
                  @click="backgroundForm.mode = 'fade'"
                >
                  フェード
                </button>
              </div>
            </fieldset>
            <label v-if="backgroundForm.mode === 'fade'"
              >フェード時間（秒）<input
                v-model.number="backgroundForm.time"
                type="number"
                min="0"
                step="0.1" /></label
            ><label
              >フェード色
              <div class="color-control">
                <input
                  type="color"
                  :value="
                    /^#[\da-f]{6}$/i.test(backgroundForm.color)
                      ? backgroundForm.color
                      : '#000000'
                  "
                  aria-label="フェード色を選択"
                  @input="backgroundForm.color = $event.target.value"
                /><input
                  v-model="backgroundForm.color"
                  list="background-colors"
                  placeholder="black"
                />
              </div>
              <small>既定：black（黒）</small></label
            ><datalist id="background-colors">
              <option v-for="c in COLOR_NAMES" :key="c" :value="c" /></datalist
            ><button
              class="button primary full"
              :disabled="!current || !backgroundForm.asset"
              @click="applyBackground"
            >
              <Check :size="15" />この行に設定
            </button>
          </section>
          <section v-else-if="panel === 'characters'">
            <div class="panel-heading">
              <h2>表示中の立ち絵</h2>
              <span class="meta">{{ after.characters.length }}</span>
            </div>
            <div class="character-list">
              <button
                v-for="c in after.characters"
                :key="c.id"
                class="character-item"
                :class="{ active: selectedCharacter === c.id }"
                @click="selectedCharacter = c.id"
              >
                <img
                  v-if="assets.find((a) => a.name === c.asset)"
                  :src="assets.find((a) => a.name === c.asset).url"
                  alt=""
                /><Users v-else :size="18" /><span
                  >{{ c.id }}<small>{{ c.asset }}</small></span
                >
              </button>
              <p v-if="!after.characters.length" class="meta">
                この行には立ち絵がありません。
              </p>
            </div>
            <div v-if="character" class="selected-character">
              <label
                >横位置
                <div class="number-control">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step=".01"
                    :value="character.x"
                    @change="
                      moveCharacter({
                        id: character.id,
                        x: Number($event.target.value),
                      })
                    "
                    aria-label="立ち絵の横位置"
                  /><span>{{ character.x.toFixed(2) }}</span>
                </div></label
              >
              <div class="two-buttons">
                <button
                  class="button"
                  @click="
                    openCommand(
                      'char:face',
                      buildCommand('char:face', {
                        id: character.id,
                        asset: character.asset,
                      }),
                    )
                  "
                >
                  表情</button
                ><button
                  class="button"
                  @click="
                    openCommand(
                      'char:scale',
                      buildCommand('char:scale', {
                        id: character.id,
                        scale: character.scale,
                      }),
                    )
                  "
                >
                  サイズ</button
                ><button
                  class="button"
                  @click="
                    setCommand(
                      buildCommand('char:flip', {
                        id: character.id,
                        flip: String(!character.flip),
                      }),
                    )
                  "
                >
                  左右反転</button
                ><button
                  class="button"
                  @click="
                    openCommand(
                      'char:tint',
                      buildCommand('char:tint', {
                        id: character.id,
                        color: character.tint,
                      }),
                    )
                  "
                >
                  色
                </button>
              </div>
              <button
                class="text-button danger"
                @click="
                  setCommand(buildCommand('char:hide', { id: character.id }))
                "
              >
                この行から非表示
              </button>
            </div>
            <h3 class="section-subtitle">立ち絵を追加</h3>
            <button
              class="asset-drop compact-drop"
              @click="chooseFiles('sprite')"
              @dragover.prevent
              @drop="dropFiles($event, 'sprite')"
            >
              <ImagePlus :size="20" /><span>画像をドロップ / 選択</span></button
            ><label
              >キャラクター ID<input
                v-model="characterForm.id"
                placeholder="momoka" /></label
            ><label
              >立ち絵<select v-model="characterForm.asset">
                <option value="">画像を選択</option>
                <option v-for="a in spriteAssets" :key="a.id" :value="a.name">
                  {{ a.name }}
                </option>
              </select></label
            ><label
              >横位置
              <div class="number-control">
                <input
                  v-model.number="characterForm.x"
                  type="range"
                  min="0"
                  max="1"
                  step=".05"
                  aria-label="追加する立ち絵の位置"
                /><input
                  v-model.number="characterForm.x"
                  type="number"
                  min="0"
                  max="1"
                  step=".05"
                /></div></label
            ><button
              class="button primary full"
              :disabled="!current || !characterForm.asset"
              @click="addCharacter"
            >
              <Plus :size="15" />この行に追加</button
            ><small class="inspector-note"
              >別の立ち絵は別の ID で追加します。同じ ID
              は表示を更新します。</small
            >
          </section>
          <section v-else-if="panel === 'commands'">
            <div class="panel-heading"><h2>演出コマンド</h2></div>
            <p class="meta">クリック、または行の演出欄へドラッグ</p>
            <div
              v-for="group in [...new Set(COMMANDS.map((c) => c.group))]"
              :key="group"
              class="command-group"
            >
              <h3>{{ group }}</h3>
              <div class="command-library">
                <button
                  v-for="c in COMMANDS.filter((c) => c.group === group)"
                  :key="c.key"
                  draggable="true"
                  @dragstart="
                    $event.dataTransfer.setData(
                      'application/x-scenario-command',
                      c.key,
                    )
                  "
                  @click="openCommand(c.key)"
                >
                  <GripVertical :size="13" />{{ c.label }}
                </button>
              </div>
            </div>
          </section>
          <section v-else>
            <div class="panel-heading"><h2>素材ライブラリー</h2></div>
            <div class="two-buttons">
              <button class="button" @click="chooseFiles('background')">
                ＋ 背景</button
              ><button class="button" @click="chooseFiles('sprite')">
                ＋ 立ち絵</button
              ><button class="button" @click="chooseFiles('bgm')">＋ BGM</button
              ><button class="button" @click="chooseFiles('se')">
                ＋ 効果音
              </button>
            </div>
            <button
              v-if="connected"
              class="text-button"
              @click="loadSharedAssets"
            >
              <Cloud :size="14" />共有素材を読み込む
            </button>
            <div class="asset-library">
              <article
                v-for="a in assets"
                :key="a.id"
                draggable="true"
                @dragstart="
                  $event.dataTransfer.setData(
                    'application/x-scenario-asset',
                    a.id,
                  )
                "
              >
                <button class="asset-thumbnail" @click="useAsset(a)">
                  <img
                    v-if="['background', 'sprite'].includes(a.kind)"
                    :src="a.url"
                    :alt="a.name"
                  /><Music2 v-else :size="24" /></button
                ><button class="asset-description" @click="editAsset(a)">
                  <strong>{{ a.name }}</strong
                  ><small
                    >{{ a.description || "説明を追加" }}
                    {{ a.sharedId ? "· 共有済み" : "" }}</small
                  >
                </button>
                <button
                  class="asset-delete"
                  type="button"
                  :disabled="busy"
                  :aria-label="a.name + 'を削除'"
                  :title="a.sharedId ? '共有素材を削除' : '素材を削除'"
                  @click.stop="discardAsset(a)"
                >
                  <Trash2 :size="15" />
                </button>
              </article>
              <p v-if="!assets.length" class="meta">
                画像・音声を追加すると、ここに並びます。
              </p>
            </div>
          </section>
        </div>
      </aside>
    </div>
    <footer class="statusbar">
      <span>{{ draftStatus }}</span
      ><span>{{
        dirtyTabs.length
          ? dirtyTabs.length + " シートに未反映の変更"
          : "未反映の変更なし"
      }}</span
      ><button @click="theme = theme === 'dark' ? 'light' : 'dark'">
        {{ theme === "dark" ? "ライト" : "ダーク" }}
      </button>
    </footer>
    <div v-if="message" class="toast" role="status">
      {{ message
      }}<button aria-label="閉じる" @click="message = ''">
        <X :size="15" />
      </button>
    </div>
    <div v-if="error" class="error-toast" role="alert">
      {{ error
      }}<button aria-label="閉じる" @click="error = ''">
        <X :size="15" />
      </button>
    </div>

    <dialog
      ref="dialog"
      class="app-dialog"
      @cancel.prevent="!busy && (modal = '')"
      @close="modal = ''"
    >
      <div class="dialog-heading">
        <h2>
          {{
            {
              connect: "スプレッドシート接続",
              command: "演出を設定",
              node:
                nodeForm.mode === "rename"
                  ? "シーン名を変更"
                  : nodeForm.mode === "scene"
                    ? "新しいシーン"
                    : "選択肢を追加",
              sync: "変更をシートに反映",
              asset: "素材の設定",
              export: "書き出し",
            }[modal]
          }}
        </h2>
        <button
          class="icon-button"
          aria-label="閉じる"
          :disabled="busy"
          @click="modal = ''"
        >
          <X :size="19" />
        </button>
      </div>
      <CommandEditor
        v-if="modal === 'command'"
        :key="commandPreset + commandInitial"
        :initial="commandInitial"
        :preset="commandPreset"
        :assets="assets"
        :character-ids="after.characters.map((c) => c.id)"
        @save="saveCommand"
        @cancel="modal = ''"
      />
      <form v-if="modal === 'connect'" @submit.prevent="connect">
        <p class="muted">
          Apps Script の Web
          アプリと接続すると、脚本の読み込み・保存と素材の共有ができます。
        </p>
        <label
          >Web アプリ URL<input
            v-model="endpoint"
            type="url"
            placeholder="https://script.google.com/macros/s/…/exec"
            required /></label
        ><label
          >アクセスキー<input
            v-model="accessKey"
            type="password"
            autocomplete="off"
            required /></label
        ><small>キーはこのタブのセッションにだけ保存します。</small>
        <div class="preview-settings">
          <label
            >立ち絵の高さ（画面比率）<input
              v-model.number="previewOptions.characterHeight"
              type="number"
              min=".1"
              max="1.5"
              step=".05" /></label
          ><label
            >立ち絵の下端オフセット（1080p）<input
              v-model.number="previewOptions.bottomOffset"
              type="number"
              step="1"
          /></label>
        </div>
        <div class="dialog-actions">
          <button class="button" type="button" @click="modal = ''">
            閉じる</button
          ><button class="button primary" :disabled="busy">
            {{ busy ? "接続中…" : "接続・再読込" }}
          </button>
        </div>
      </form>
      <form v-if="modal === 'node'" @submit.prevent="submitNode">
        <template v-if="nodeForm.mode === 'choice'"
          ><label
            >選択肢の文章<input
              v-model="nodeForm.text"
              required
              autofocus /></label
          ><label
            >移動先<select v-model="nodeForm.target">
              <option value="new">新しいノードを作成</option>
              <option value="existing">既存のノードへ移動</option>
            </select></label
          ></template
        ><label
          >ノード名<input
            v-model="nodeForm.name"
            :list="nodeForm.target === 'existing' ? 'all-nodes' : undefined"
            placeholder="例：Tutorial_Station"
            required
            autofocus /></label
        ><small>同じ名前を複数のシーンに使うことはできません。</small>
        <div class="dialog-actions">
          <button type="button" class="button" @click="modal = ''">
            キャンセル</button
          ><button class="button primary">
            {{ nodeForm.mode === "rename" ? "変更" : "作成" }}
          </button>
        </div>
      </form>
      <div v-if="modal === 'sync'">
        <p>次のシートの A〜H 列を更新します。</p>
        <div v-for="t in dirtyTabs" :key="t.id" class="sync-item">
          <strong>{{ t.name }}</strong
          ><span>{{ pendingChanges(t, baseline[t.id]).cells }} セルの変更</span
          ><small v-if="pendingChanges(t, baseline[t.id]).assignedNodes"
            >{{
              pendingChanges(t, baseline[t.id]).assignedNodes
            }}
            行にシーンのノード名を補います。</small
          >
        </div>
        <details v-if="issues.length" class="raw-details">
          <summary>脚本の確認事項（{{ issues.length }}）</summary>
          <p v-for="issue in issues" :key="issue" class="warning">
            {{ issue }}
          </p>
          <small
            >下書きとして保存できます。Yarn
            書き出し前に修正してください。</small
          >
        </details>
        <div class="dialog-actions">
          <button class="button" :disabled="busy" @click="modal = ''">
            キャンセル</button
          ><button class="button primary" :disabled="busy" @click="sync">
            {{ busy ? "保存中…" : "変更を反映" }}
          </button>
        </div>
      </div>
      <form
        v-if="modal === 'asset' && assetEditing"
        @submit.prevent="saveAsset"
      >
        <label>素材名<input v-model="assetEditing.name" required /></label
        ><label
          >説明<textarea
            v-model="assetEditing.description"
            placeholder="場面や表情、使用する状況など"
          ></textarea></label
        ><label v-if="assetEditing.kind === 'sprite'"
          >キャラクター ID<input
            v-model="assetEditing.characterId"
            placeholder="momoka" /></label
        ><small>{{
          assetEditing.sharedId
            ? "共有済みの素材"
            : "このブラウザーに保存されています。"
        }}</small>
        <div class="dialog-actions">
          <button
            v-if="connected"
            type="button"
            class="button"
            :disabled="busy"
            @click="shareAsset"
          >
            <Cloud :size="15" />{{ busy ? "共有中…" : "保存して共有" }}</button
          ><button class="button primary" :disabled="busy">保存</button>
        </div>
      </form>
      <div v-if="modal === 'export'">
        <div class="export-options">
          <button class="button" @click="exportBackup">
            <Download :size="17" />シナリオをバックアップ（JSON）</button
          ><button class="button" @click="backupInput.click()">
            <Upload :size="17" />バックアップを開く</button
          ><button class="button primary" @click="generateYarn">
            <FileText :size="17" />Yarn スクリプトを書き出す
          </button>
        </div>
        <p class="muted">
          画像・音声は JSON に含まれません。素材の設定から共有できます。
        </p>
      </div>
      <p v-if="modalError" class="error" role="alert">{{ modalError }}</p>
    </dialog>
    <datalist id="all-nodes">
      <option
        v-for="n in allNodes(workbook)"
        :key="n.tabId + n.name"
        :value="n.name"
      />
    </datalist>
    <input
      ref="fileInput"
      type="file"
      multiple
      hidden
      @change="
        importFiles([...$event.target.files], uploadKind);
        $event.target.value = '';
      "
    />
    <input
      ref="backupInput"
      type="file"
      accept="application/json"
      hidden
      @change="
        importBackup($event.target.files[0]);
        $event.target.value = '';
      "
    />
  </div>
</template>
