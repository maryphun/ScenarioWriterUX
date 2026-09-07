export const DEFAULT_CHARACTER_TRANSITION = Object.freeze({
  mode: "fade",
  time: 0.5,
});

export function transitionDuration(transition) {
  return transition.mode === "instant" ? "instant" : String(transition.time);
}
