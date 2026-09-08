import { isTokaCharacter } from "./commands.js";

export const DEFAULT_PREVIEW_OPTIONS = Object.freeze({
  characterHeight: 1.1,
  bottomOffset: -175,
});

export const NON_SPEAKER_FILTER = "grayscale(40%) brightness(72%)";

export function isNonSpeakingCharacter(characterId, speakerName) {
  const speaker = String(speakerName || "").trim().toLowerCase();
  if (!speaker) return false;
  const character = String(characterId || "").trim().toLowerCase();
  if (character === speaker) return false;
  return !(isTokaCharacter(character) && isTokaCharacter(speaker));
}
