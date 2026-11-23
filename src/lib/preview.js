import {
  isTokaCharacter,
  CHARACTER_POSITION_MIN,
  CHARACTER_POSITION_MAX,
} from "./commands.js";

export const DEFAULT_PREVIEW_OPTIONS = Object.freeze({
  characterHeight: 1.3,
  bottomOffset: -600,
});

export const PREVIEW_STAGE_WIDTH = 1920;
export const CHARACTER_HORIZONTAL_OVERSCAN = 250;
export const NON_SPEAKER_FILTER = "grayscale(40%) brightness(72%)";

export const isPreviewBackground = ({ canonical }) =>
  canonical === "background" || canonical === "background:clear";
export const isPreviewRemoval = ({ canonical }) =>
  canonical === "char:hide" || canonical === "char:clear";

// Match the export's sequencing boundaries for successive backgrounds and
// characters that appear and are then removed within the same line.
export function groupPreviewCommands(commands) {
  const groups = [];
  let group = [], hasBackground = false;
  const shown = new Set();
  for (const command of commands) {
    const key = command.canonical;
    const background = isPreviewBackground(command);
    const id = command.values.id?.toLowerCase();
    if (background && hasBackground ||
        key === "char:hide" && shown.has(id) ||
        key === "char:clear" && shown.size) {
      groups.push(group);
      group = [];
      hasBackground = false;
      shown.clear();
    }
    group.push(command);
    if (background) hasBackground = true;
    if (key === "char:show") shown.add(id);
  }
  if (group.length) groups.push(group);
  return groups;
}

function characterPositionBounds(characterWidth, stageWidth) {
  const fits = characterWidth <= stageWidth;
  return {
    left:
      (fits ? characterWidth / 2 : 0) - CHARACTER_HORIZONTAL_OVERSCAN,
    right:
      (fits ? stageWidth - characterWidth / 2 : stageWidth) +
      CHARACTER_HORIZONTAL_OVERSCAN,
  };
}

export function characterCenterX(
  position,
  characterWidth,
  stageWidth = PREVIEW_STAGE_WIDTH,
) {
  const { left, right } = characterPositionBounds(characterWidth, stageWidth);
  return left + (right - left) * Math.max(
    CHARACTER_POSITION_MIN,
    Math.min(CHARACTER_POSITION_MAX, position),
  );
}

export function characterPositionFromCenter(
  center,
  characterWidth,
  stageWidth = PREVIEW_STAGE_WIDTH,
) {
  const { left, right } = characterPositionBounds(characterWidth, stageWidth);
  return Math.max(
    CHARACTER_POSITION_MIN,
    Math.min(CHARACTER_POSITION_MAX, (center - left) / (right - left)),
  );
}

export function isNonSpeakingCharacter(characterId, speakerName) {
  const speaker = String(speakerName || "").trim().toLowerCase();
  if (!speaker) return false;
  const character = String(characterId || "").trim().toLowerCase();
  if (character === speaker) return false;
  return !(isTokaCharacter(character) && isTokaCharacter(speaker));
}
