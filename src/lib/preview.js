export const DEFAULT_PREVIEW_OPTIONS = Object.freeze({
  characterHeight: 1.1,
  bottomOffset: -175,
});

export const NON_SPEAKER_FILTER = "grayscale(40%) brightness(72%)";

export function isNonSpeakingCharacter(characterId, speakerName) {
  const speaker = String(speakerName || "").trim().toLowerCase();
  if (!speaker) return false;
  return String(characterId || "").trim().toLowerCase() !== speaker;
}
