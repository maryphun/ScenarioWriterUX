// Author commands stay unchanged in the sheet. Literal command blocks are
// coordinated by the game's dialogue_stage handler using its visible characters.
function tokensFor(command) {
  if (!command.startsWith("<<") || !command.endsWith(">>")) return null;
  const tokens = command.slice(2, -2).match(/"(?:\\.|[^"\\])*"|\S+/g) || [];
  if (tokens.some((token) => !token.startsWith('"') && /[$(){}]/.test(token)))
    return null;
  return tokens.length ? tokens : null;
}

function valueOf(token) {
  return token?.startsWith('"') && token.endsWith('"')
    ? token.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\")
    : token || "";
}

function initialTransform(tokens, action) {
  if (action === "flip") {
    const value = tokens[3] || "true";
    return /^(true|false|flip|flipped|left|right|normal|none)$/i.test(valueOf(value))
      ? [6, value]
      : null;
  }
  if (!tokens[3] || !["move", "position", "scale", "size"].includes(action))
    return null;
  const duration = valueOf(tokens[4] || '"instant"');
  const value = valueOf(tokens[3]);
  if (!value.trim() || !Number.isFinite(Number(value))) return null;
  if (!/^(instant|none)$/i.test(duration)
    && !(duration.trim() && Number.isFinite(Number(duration)) && Number(duration) <= 0))
    return null;
  return [["move", "position"].includes(action) ? 4 : 8, tokens[3]];
}

const effectKinds = ["background", "bg", "bgm", "se", "shake", "fade", "dialogue", "wait"];

function prepareInitialSetup(commands, coordinateStage = false) {
  const output = [], outputTokens = [], shows = new Map();
  for (const command of commands) {
    const parsed = tokensFor(command);
    const tokens = parsed?.[0] === "char" && parsed.length >= 3 ? parsed : null;
    const action = tokens ? valueOf(tokens[1]).toLowerCase() : "";
    const id = tokens ? valueOf(tokens[2]).toLowerCase() : "";
    if (["show", "add"].includes(action) && tokens.length >= 4) {
      shows.set(id, output.length);
      output.push(command);
      outputTokens.push(tokens);
      continue;
    }
    const transform = tokens && initialTransform(tokens, action);
    if (transform) {
      if (shows.has(id)) {
        const showIndex = shows.get(id), show = outputTokens[showIndex];
        const defaults = ["0.5", '"instant"', "false", '"keep"', '"keep"'];
        while (show.length < 9) show.push(defaults[show.length - 4]);
        show[transform[0]] = transform[1];
        if (transform[0] === 4) show[9] = '"instant"';
        output[showIndex] = `<<${show.join(" ")}>>`;
      } else {
        output.push(command);
        outputTokens.push(tokens);
      }
      continue;
    }
    if (!coordinateStage || !effectKinds.includes(parsed?.[0])) shows.clear();
    output.push(command);
    outputTokens.push(tokens);
  }
  return output;
}

function prepareStage(commands) {
  const output = [], original = [], stage = [], shownIds = new Set();
  let hasBackground = false;
  function flush() {
    const prepared = prepareInitialSetup(original, true);
    stage.length = 0;
    for (const command of prepared) {
      const tokens = tokensFor(command);
      stage.push({ kind: tokens[0], args: tokens.slice(1).map(valueOf) });
    }
    if (stage.length > 1) {
      // Encode UTF-8 JSON because Yarn treats bare JSON braces as expressions.
      const bytes = new TextEncoder().encode(JSON.stringify({ commands: stage }));
      const payload = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
      output.push(`<<dialogue_stage "${payload}">>`);
    } else output.push(...prepared);
    original.length = stage.length = 0;
    shownIds.clear();
    hasBackground = false;
  }
  const actions = ["show", "add", "hide", "remove", "move", "position", "face", "sprite", "variation", "flip", "tint", "color", "scale", "size", "order"];
  for (const command of commands) {
    const tokens = tokensFor(command), kind = tokens?.[0] || "";
    const background = ["background", "bg"].includes(kind);
    const action = valueOf(tokens?.[1]).toLowerCase();
    const clear = ["clear", "hide_all", "remove_all"].includes(action);
    const hide = ["hide", "remove"].includes(action);
    const show = ["show", "add"].includes(action);
    const supported = effectKinds.includes(kind) && (kind === "shake" || tokens.length > 1)
      || kind === "char" && (clear || tokens.length > 2 && actions.includes(action));
    if (!supported) {
      flush();
      output.push(command);
      continue;
    }
    const id = kind === "char" ? valueOf(tokens[2]).toLowerCase() : "";
    // A temporary appearance must finish before its own removal. A second
    // background starts a separate transition with its own midpoint.
    if (background && hasBackground || kind === "char" && (hide && shownIds.has(id) || clear && shownIds.size))
      flush();
    original.push(command);
    if (background) hasBackground = true;
    if (kind === "char" && show) shownIds.add(id);
  }
  flush();
  return output;
}

export function prepareYarnStageText(text) {
  const output = [], commands = [];
  let indent = "";
  function flush() {
    output.push(...prepareStage(prepareInitialSetup(commands)).map((command) => indent + command));
    commands.length = 0;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trimStart(), currentIndent = line.slice(0, line.length - trimmed.length);
    if (trimmed.startsWith("<<") && trimmed.endsWith(">>")) {
      if (commands.length && currentIndent !== indent) flush();
      if (!commands.length) indent = currentIndent;
      commands.push(trimmed);
    } else {
      flush();
      output.push(line);
    }
  }
  flush();
  return output.join("\n");
}
