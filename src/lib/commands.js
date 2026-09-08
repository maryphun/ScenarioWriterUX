const field = (key, label, type = "text", value = "", extra = {}) => ({
  key,
  label,
  type,
  default: value,
  ...extra,
});
const asset = (label, kind) =>
  field("asset", label, "asset", "", { required: true, kind });
const id = () =>
  field("id", "キャラクター ID", "text", "momoka", { required: true });
const duration = (value = "instant") =>
  field("duration", "時間", "duration", value);
const color = (value = "black") => field("color", "色", "color", value);
const volume = () =>
  field("volume", "音量", "number", "1", { min: 0, max: 1, step: 0.05 });
const position = () =>
  field("x", "横位置", "number", "0.5", { min: 0, max: 1, step: 0.05 });
const spec = (key, label, group, fields, aliases = []) => ({
  key,
  label,
  group,
  fields,
  aliases,
});
export const COMMANDS = [
  spec(
    "background",
    "背景を変更",
    "背景",
    [asset("背景画像", "background"), duration(), color()],
    ["bg"],
  ),
  spec(
    "char:show",
    "立ち絵を表示",
    "キャラクター",
    [
      id(),
      asset("立ち絵", "sprite"),
      position(),
      duration(),
      field("flip", "左右反転", "select", "false", {
        options: ["false", "true"],
      }),
    ],
    ["char:add"],
  ),
  spec(
    "char:face",
    "表情を変更",
    "キャラクター",
    [id(), asset("立ち絵", "sprite"), duration()],
    ["char:sprite", "char:variation"],
  ),
  spec(
    "char:move",
    "立ち絵を移動",
    "キャラクター",
    [id(), position(), duration()],
    ["char:position"],
  ),
  spec("char:flip", "左右を反転", "キャラクター", [
    id(),
    field("flip", "向き", "select", "true", {
      options: [
        "true",
        "false",
        "flip",
        "flipped",
        "left",
        "normal",
        "none",
        "right",
      ],
    }),
  ]),
  spec(
    "char:tint",
    "立ち絵の色",
    "キャラクター",
    [id(), color("white"), duration()],
    ["char:color"],
  ),
  spec(
    "char:scale",
    "立ち絵のサイズ",
    "キャラクター",
    [
      id(),
      field("scale", "倍率", "number", "1", { min: 0.01, step: 0.1 }),
      duration(),
    ],
    ["char:size"],
  ),
  spec(
    "char:hide",
    "立ち絵を非表示",
    "キャラクター",
    [id(), duration()],
    ["char:remove"],
  ),
  spec(
    "char:clear",
    "立ち絵をすべて消す",
    "キャラクター",
    [duration()],
    ["char:hide_all", "char:remove_all"],
  ),
  spec("bgm:play", "BGM を再生", "音声", [asset("BGM", "bgm"), duration()]),
  spec(
    "bgm:crossfade",
    "BGM を切り替え",
    "音声",
    [asset("BGM", "bgm"), duration("1")],
    ["bgm:cross"],
  ),
  spec("bgm:stop", "BGM を停止", "音声", [duration()]),
  spec("bgm:pause", "BGM を一時停止", "音声", []),
  spec("bgm:resume", "BGM を再開", "音声", [], ["bgm:unpause"]),
  spec("bgm:volume", "BGM の音量", "音声", [volume()]),
  spec("se:play", "効果音を再生", "音声", [asset("効果音", "se"), volume()]),
  spec("se:volume", "効果音の音量", "音声", [volume()]),
  spec("fade:out", "画面を暗転", "画面", [color(), duration("0.5")]),
  spec("fade:in", "画面を明転", "画面", [color(), duration("0.5")]),
  spec("fade:to", "画面の色・透明度", "画面", [
    color(),
    field("opacity", "不透明度", "number", "0.5", {
      min: 0,
      max: 1,
      step: 0.05,
    }),
    duration("0.3"),
  ]),
  spec("fade:clear", "画面フェードを解除", "画面", [duration()]),
  spec("shake", "画面を揺らす", "画面", [
    duration("0.25"),
    field("strength", "強さ", "number", "8", { min: 0, step: 1 }),
  ]),
  spec("dialogue:show", "会話欄を表示", "会話欄", [duration()]),
  spec("dialogue:hide", "会話欄を非表示", "会話欄", [duration()]),
  spec("dialogue:toggle", "会話欄を切り替え", "会話欄", [duration()]),
];
export const COLOR_NAMES = [
  "black",
  "white",
  "red",
  "green",
  "blue",
  "yellow",
  "cyan",
  "magenta",
  "gray",
  "grey",
  "clear",
  "transparent",
];
export function findSpec(key) {
  return COMMANDS.find((s) => s.key === key || s.aliases.includes(key));
}
export function parseCommands(raw = "") {
  const source = String(raw),
    tokens = [];
  let cursor = 0;
  while (cursor < source.length) {
    if (/\s/.test(source[cursor])) {
      cursor++;
      continue;
    }
    let end;
    if (source[cursor] === "[") {
      end = source.indexOf("]", cursor + 1);
      end = end < 0 ? source.length : end + 1;
    } else if (source.slice(cursor, cursor + 2) === "<<") {
      end = source.indexOf(">>", cursor + 2);
      end = end < 0 ? source.length : end + 2;
    } else {
      end = cursor + 1;
      while (end < source.length && !/[\[\r\n]/.test(source[end])) end++;
    }
    tokens.push(source.slice(cursor, end));
    cursor = end;
  }
  return tokens
    .map((token) => {
      const raw = token.trim();
      if (!raw) return null;
      const parts = raw
        .replace(/^\[|\]$/g, "")
        .split(/[:\s]+/)
        .filter(Boolean);
      const family = parts[0]?.toLowerCase();
      const key = ["char", "bgm", "se", "fade", "dialogue"].includes(family)
        ? `${family}:${parts[1]?.toLowerCase()}`
        : family;
      const definition =
        raw.startsWith("<<") || (raw.startsWith("[") && !raw.endsWith("]"))
          ? undefined
          : findSpec(key);
      const args = parts.slice(key?.includes(":") ? 2 : 1);
      return {
        raw,
        key,
        canonical: definition?.key,
        args,
        definition,
        values: definition
          ? Object.fromEntries(
              definition.fields.map((f, i) => [f.key, args[i] ?? f.default]),
            )
          : {},
      };
    })
    .filter(Boolean);
}
export function validateValues(definition, values) {
  if (!definition) return ["未対応のコマンドです。"];
  const errors = [];
  for (const f of definition.fields) {
    const v = String(values[f.key] ?? f.default).trim();
    if (!v && f.required) errors.push(`${f.label}を入力してください。`);
    if (v && /[\s:\[\]<>]/.test(v))
      errors.push(`${f.label}に空白・コロン・括弧は使えません。`);
    if (
      f.type === "duration" &&
      v !== "instant" &&
      (!v || !Number.isFinite(Number(v)) || Number(v) < 0)
    )
      errors.push(`${f.label}は instant または 0 以上の秒数です。`);
    if (
      f.type === "number" &&
      (!v ||
        !Number.isFinite(Number(v)) ||
        Number(v) < (f.min ?? -Infinity) ||
        Number(v) > (f.max ?? Infinity))
    )
      errors.push(`${f.label}の値が範囲外です。`);
    if (
      f.type === "color" &&
      !COLOR_NAMES.includes(v.toLowerCase()) &&
      !/^#[\da-f]{6}([\da-f]{2})?$/i.test(v)
    )
      errors.push("色名または #RRGGBB / #RRGGBBAA を入力してください。");
    if (f.type === "select" && !f.options.includes(v))
      errors.push(`${f.label}を選択してください。`);
  }
  return errors;
}
export function buildCommand(key, values = {}) {
  const definition = findSpec(key);
  const errors = validateValues(definition, values);
  if (errors.length) throw new Error(errors.join("\n"));
  return `[${key}${definition.fields.length ? ":" : ""}${definition.fields.map((f) => String(values[f.key] ?? f.default).trim()).join(":")}]`;
}
export function commandLabel(command) {
  return command.definition
    ? `${command.definition.label}${command.values.asset ? " · " + command.values.asset : command.values.id ? " · " + command.values.id : ""}`
    : command.raw;
}
export function cssColor(value = "black") {
  return (
    {
      clear: "transparent",
      grey: "#808080",
      gray: "#808080",
      green: "#00ff00",
    }[value] || value
  );
}
export function rgba(value = "white") {
  const names = {
    black: "#000000",
    white: "#ffffff",
    red: "#ff0000",
    green: "#00ff00",
    blue: "#0000ff",
    yellow: "#ffff00",
    cyan: "#00ffff",
    magenta: "#ff00ff",
    gray: "#808080",
    grey: "#808080",
    clear: "#00000000",
    transparent: "#00000000",
  };
  const hex = names[value.toLowerCase()] || value;
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
    hex.length === 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1,
  ];
}
export const seconds = (v) =>
  v === "instant" || v == null ? 0 : Math.max(0, Number(v) || 0);

export const TOKA_DEFAULT_BODY_ASSET = "Ch_Toka_Body_Casual";

export function isTokaCharacter(characterId) {
  const id = String(characterId || "").trim().toLowerCase();
  return id === "toka" || id === "momoka" || id === "白崎桃香";
}

export function isTokaFaceAsset(assetName) {
  return String(assetName || "")
    .trim()
    .toLowerCase()
    .startsWith("ch_toka_face_");
}

export function usesTokaPresetBody(characterId, assetName) {
  return isTokaCharacter(characterId) && isTokaFaceAsset(assetName);
}

function setCharacterAsset(character, assetName) {
  character.asset = assetName;
  character.layered = usesTokaPresetBody(character.id, assetName);
  character.bodyAsset = character.layered ? TOKA_DEFAULT_BODY_ASSET : "";
  character.faceAsset = character.layered ? assetName : "";
  return character;
}

export function emptyStage() {
  return {
    background: "",
    characters: [],
    fade: { color: "black", opacity: 0 },
    dialogue: true,
    bgm: { asset: "", playing: false, volume: 1 },
    seVolume: 1,
  };
}
export function applyCommand(state, command) {
  const s = JSON.parse(JSON.stringify(state)),
    v = command.values,
    key = command.canonical;
  const sameId = (c) => c.id.toLowerCase() === String(v.id).toLowerCase();
  const get = () => s.characters.find(sameId);
  if (key === "background") s.background = v.asset;
  else if (key === "char:show") {
    const previous = get();
    const character = setCharacterAsset({
      id: v.id,
      x: Number(v.x),
      scale: previous?.scale ?? 1,
      flip: ["true", "left", "flip", "flipped"].includes(v.flip),
      tint: previous?.tint ?? "white",
    }, v.asset);
    s.characters = s.characters.filter((c) => !sameId(c));
    s.characters.push(character);
  } else if (key === "char:clear") s.characters = [];
  else if (key === "char:hide")
    s.characters = s.characters.filter((c) => !sameId(c));
  else if (key === "char:face" && get()) setCharacterAsset(get(), v.asset);
  else if (key === "char:move" && get()) get().x = Number(v.x);
  else if (key === "char:scale" && get()) get().scale = Number(v.scale);
  else if (key === "char:flip" && get())
    get().flip = ["true", "left", "flip", "flipped"].includes(v.flip);
  else if (key === "char:tint" && get()) get().tint = v.color;
  else if (key === "fade:out")
    s.fade = { color: v.color, opacity: rgba(v.color)[3] };
  else if (key === "fade:in" || key === "fade:clear")
    s.fade = { color: v.color || s.fade.color, opacity: 0 };
  else if (key === "fade:to")
    s.fade = { color: v.color, opacity: Number(v.opacity) };
  else if (key === "dialogue:hide") s.dialogue = false;
  else if (key === "dialogue:show") s.dialogue = true;
  else if (key === "dialogue:toggle") s.dialogue = !s.dialogue;
  else if (key === "bgm:play" || key === "bgm:crossfade")
    s.bgm = { ...s.bgm, asset: v.asset, playing: true };
  else if (key === "bgm:stop") s.bgm = { ...s.bgm, asset: "", playing: false };
  else if (key === "bgm:pause") s.bgm.playing = false;
  else if (key === "bgm:resume") s.bgm.playing = true;
  else if (key === "bgm:volume") s.bgm.volume = Number(v.volume);
  else if (key === "se:volume") s.seVolume = Number(v.volume);
  return s;
}
export function stateAt(lines, index, initial = emptyStage()) {
  let state = JSON.parse(JSON.stringify(initial));
  for (const line of lines.slice(0, index + 1))
    for (const command of parseCommands(line.command))
      if (
        command.definition &&
        !validateValues(command.definition, command.values).length
      )
        state = applyCommand(state, command);
  return state;
}
