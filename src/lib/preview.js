import { isTokaCharacter } from "./commands.js";

export const DEFAULT_PREVIEW_OPTIONS = Object.freeze({
  characterHeight: 1.1,
  bottomOffset: -175,
});

export const PREVIEW_STAGE_WIDTH = 1920;
export const CHARACTER_HORIZONTAL_OVERSCAN = 250;
export const NON_SPEAKER_FILTER = "grayscale(40%) brightness(72%)";

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
  return left + (right - left) * Math.max(0, Math.min(1, position));
}

export function characterPositionFromCenter(
  center,
  characterWidth,
  stageWidth = PREVIEW_STAGE_WIDTH,
) {
  const { left, right } = characterPositionBounds(characterWidth, stageWidth);
  return Math.max(0, Math.min(1, (center - left) / (right - left)));
}

export function isNonSpeakingCharacter(characterId, speakerName) {
  const speaker = String(speakerName || "").trim().toLowerCase();
  if (!speaker) return false;
  const character = String(characterId || "").trim().toLowerCase();
  if (character === speaker) return false;
  return !(isTokaCharacter(character) && isTokaCharacter(speaker));
}
