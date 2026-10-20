import { buildCommand } from "./commands.js";

// Copy only the persistent setup requested by the writer. In particular, do not
// carry authored tint, temporary effects, dialogue visibility or screen fades.
export function copySceneStatus(state) {
  return {
    background: state.background,
    characters: state.characters.map((character) => ({
      id: character.id,
      asset: character.asset,
      x: character.x,
      scale: character.scale,
      flip: character.flip,
      order: character.order,
    })),
    bgm: { ...state.bgm },
  };
}

export function sceneStatusCommands(status) {
  const commands = [
    buildCommand("char:clear", { duration: "instant" }),
    status.background
      ? buildCommand("background", { asset: status.background, duration: "instant" })
      : buildCommand("background:clear", { duration: "instant" }),
  ];
  for (const character of status.characters) {
    commands.push(
      buildCommand("char:show", {
        id: character.id,
        asset: character.asset,
        x: character.x,
        duration: "instant",
        flip: String(character.flip),
        order: character.order,
      }),
      buildCommand("char:scale", {
        id: character.id,
        scale: character.scale,
        duration: "instant",
      }),
    );
  }
  commands.push(buildCommand("bgm:volume", { volume: status.bgm.volume }));
  if (status.bgm.asset) {
    commands.push(buildCommand("bgm:play", { asset: status.bgm.asset, duration: "instant" }));
    if (!status.bgm.playing) commands.push(buildCommand("bgm:pause"));
  } else commands.push(buildCommand("bgm:stop", { duration: "instant" }));
  return commands.join(" ");
}
