import { rgba, validateValues } from "./commands.js";

export const CHARACTER_FLASH_SECONDS = 0.5;
export const CHARACTER_SHAKE_SECONDS = 0.7;
export const CHARACTER_SHAKE_PIXELS_PER_STRENGTH = 5;
export const isCharacterEffect = (command) =>
  ["char:flash", "char:shake"].includes(command?.canonical);

// Temporary channels never overwrite the authored tint or normalized position.
export function createCharacterEffects({ tween, changed, random = Math.random }) {
  const flashes = new Map(), shakes = new Map();
  const idFor = (id) => String(id).toLowerCase();
  return {
    clear() {
      flashes.clear();
      shakes.clear();
      changed();
    },
    colorFor(character) {
      const effect = flashes.get(idFor(character.id));
      if (!effect) return character.tint;
      const expected = rgba(character.tint), start = rgba(effect.color);
      return "#" + expected.map((value, index) => {
        const channel = index === 3 ? value : start[index] + (value - start[index]) * effect.progress;
        return Math.round(channel * 255).toString(16).padStart(2, "0");
      }).join("");
    },
    offsetFor(character) {
      return shakes.get(idFor(character.id))?.offset ?? 0;
    },
    async start(command, token) {
      if (!isCharacterEffect(command) || validateValues(command.definition, command.values).length) return;
      const id = idFor(command.values.id);
      if (command.canonical === "char:flash") {
        const effect = { color: command.values.color, progress: 0 };
        flashes.set(id, effect);
        changed();
        try {
          await tween(CHARACTER_FLASH_SECONDS, token, (progress) => {
            if (flashes.get(id) !== effect) return;
            effect.progress = progress;
          }, { spatial: false });
        } finally {
          if (flashes.get(id) === effect) flashes.delete(id);
          changed();
        }
      } else {
        const effect = { offset: 0 };
        shakes.set(id, effect);
        try {
          await tween(CHARACTER_SHAKE_SECONDS, token, (progress) => {
            if (shakes.get(id) !== effect) return;
            effect.offset = progress >= 1 ? 0 : (random() * 2 - 1) * Number(command.values.strength) * CHARACTER_SHAKE_PIXELS_PER_STRENGTH;
          }, { spatial: true });
        } finally {
          if (shakes.get(id) === effect) shakes.delete(id);
          changed();
        }
      }
    },
  };
}
