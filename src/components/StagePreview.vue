<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import {
  applyCommand,
  orderedCharacters,
  parseCommands,
  buildCommand,
  cssColor,
  seconds,
  validateValues,
  rgba,
} from "../lib/commands.js";
import {
  DEFAULT_PREVIEW_OPTIONS,
  NON_SPEAKER_FILTER,
  characterCenterX,
  characterPositionFromCenter,
  groupPreviewCommands,
  isPreviewBackground,
  isNonSpeakingCharacter,
  isPreviewRemoval,
} from "../lib/preview.js";
import { createCharacterEffects, isCharacterEffect } from "../lib/character-effects.js";
const props = defineProps({
  before: Object,
  after: Object,
  row: Object,
  instruction: Boolean,
  choices: Array,
  assets: Array,
  speakers: Array,
  options: Object,
});
const emit = defineEmits([
  "choice",
  "move-character",
  "select-character",
  "message",
  "playing",
]);
const canvas = ref(),
  stage = ref(),
  display = ref(props.after),
  backgroundFade = ref({ opacity: 0, color: "black" }),
  busy = ref(false);
const images = new Map(),
  tints = new Map(),
  audio = new Set();
let generation = 0,
  bgm = null,
  resizeObserver;
const characterEffects = createCharacterEffects({ tween, changed: draw });
const speaker = computed(() =>
  props.speakers.find((s) => s.name === props.row?.speaker),
);
const missing = computed(() =>
  [
    display.value.background,
    ...display.value.characters.flatMap((c) =>
      c.layered ? [c.bodyAsset, c.faceAsset] : [c.asset],
    ),
  ].filter(
    (name) =>
      name &&
      !props.assets.some((a) => a.name.toLowerCase() === name.toLowerCase()),
  ),
);
const clone = (s) => JSON.parse(JSON.stringify(s));
const findAsset = (name) =>
  props.assets.find((a) => a.name.toLowerCase() === String(name).toLowerCase());
function imageForAsset(name) {
  const asset = findAsset(name);
  if (!asset?.url) return;
  let img = images.get(asset.url);
  if (!img) {
    img = new Image();
    images.set(asset.url, img);
    img.onload = () => {
      if (images.get(asset.url) === img) draw();
    };
    img.src = asset.url;
  }
  return img.complete && img.naturalWidth ? img : undefined;
}
function characterImages(character) {
  if (character.layered) {
    const body = imageForAsset(character.bodyAsset);
    const face = imageForAsset(character.faceAsset);
    return { body, face, reference: body || face };
  }

  const sprite = imageForAsset(character.asset);
  return { sprite, reference: sprite };
}
function tinted(image, color) {
  if (!color || color === "white" || color.toLowerCase() === "#ffffff")
    return image;
  const rgb = rgba(color)
      .slice(0, 3)
      .map((c) => Math.round(c * 255)),
    key = image.src + "|" + rgb.join(",");
  if (tints.has(key)) return tints.get(key);
  const c = document.createElement("canvas");
  c.width = image.width;
  c.height = image.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(image, 0, 0);
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = `rgb(${rgb.join(",")})`;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(image, 0, 0);
  tints.set(key, c);
  if (tints.size > 24) {
    const oldest = tints.keys().next().value;
    tints.delete(oldest);
  }
  return c;
}
function characterRect(c) {
  const characterImage = characterImages(c),
    img = characterImage.reference,
    h =
      1080 *
      (props.options?.characterHeight ??
        DEFAULT_PREVIEW_OPTIONS.characterHeight) *
      c.scale,
    w = img ? (img.width / img.height) * h : h * 0.45;
  const x = characterCenterX(c.x, w);
  return {
    x: x - w / 2 + characterEffects.offsetFor(c),
    y:
      1080 -
      h -
      (props.options?.bottomOffset ?? DEFAULT_PREVIEW_OPTIONS.bottomOffset),
    w,
    h,
    img,
    ...characterImage,
  };
}
function draw() {
  if (!canvas.value || !display.value) return;
  const ctx = canvas.value.getContext("2d");
  ctx.clearRect(0, 0, 1920, 1080);
  ctx.fillStyle = "#1c2635";
  ctx.fillRect(0, 0, 1920, 1080);
  const background = imageForAsset(display.value.background);
  if (background) ctx.drawImage(background, 0, 0, 1920, 1080);
  else {
    ctx.fillStyle = "#9cacc1";
    ctx.font = "28px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      display.value.background || "背景を追加してプレビュー",
      960,
      85,
    );
  }
  if (backgroundFade.value.opacity) {
    ctx.save();
    ctx.globalAlpha = backgroundFade.value.opacity;
    ctx.fillStyle = cssColor(backgroundFade.value.color);
    ctx.fillRect(0, 0, 1920, 1080);
    ctx.restore();
  }
  for (const c of orderedCharacters(display.value.characters)) {
    const r = characterRect(c);
    const tint = characterEffects.colorFor(c);
    ctx.save();
    ctx.globalAlpha = (c.opacity ?? 1) * rgba(tint)[3];
    ctx.filter = isNonSpeakingCharacter(c.id, props.row?.speaker)
      ? NON_SPEAKER_FILTER
      : "none";
    if (r.img) {
      ctx.translate(r.x + (c.flip ? r.w : 0), r.y);
      ctx.scale(c.flip ? -1 : 1, 1);
      if (c.layered) {
        if (r.body)
          ctx.drawImage(tinted(r.body, tint), 0, 0, r.w, r.h);
        if (r.face)
          ctx.drawImage(tinted(r.face, tint), 0, 0, r.w, r.h);
      } else {
        ctx.drawImage(tinted(r.sprite, tint), 0, 0, r.w, r.h);
      }
    } else {
      ctx.strokeStyle = "#b9a1b6";
      const placeholder = rgba("#5a4a61"), color = rgba(tint);
      ctx.fillStyle = `rgb(${placeholder.slice(0, 3).map((channel, i) => Math.round(channel * color[i] * 255)).join(",")})`;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.textAlign = "center";
      ctx.fillStyle = "#fff";
      ctx.font = "32px sans-serif";
      ctx.fillText(c.id, r.x + r.w / 2, r.y + r.h * 0.4);
      ctx.font = "22px sans-serif";
      ctx.fillText(c.asset, r.x + r.w / 2, r.y + r.h * 0.45);
    }
    ctx.restore();
  }
}
function refreshImages() {
  const activeUrls = new Set(props.assets.map((asset) => asset.url));
  for (const url of images.keys()) {
    if (!activeUrls.has(url)) images.delete(url);
  }
  tints.clear();
  draw();
}
function stop(reset = true) {
  generation++;
  characterEffects.clear();
  busy.value = false;
  emit("playing", false);
  for (const item of audio.values()) item.pause();
  bgm = null;
  audio.clear();
  stage.value?.getAnimations().forEach((a) => a.cancel());
  if (reset) {
    display.value = clone(props.after);
    backgroundFade.value.opacity = 0;
    draw();
  }
}
function seek() {
  stop();
  display.value = clone(props.after);
  backgroundFade.value.opacity = 0;
  draw();
  previewCharacterEffects();
}
function previewCharacterEffects() {
  if (props.instruction) return;
  const token = generation;
  for (const command of parseCommands(props.row?.command))
    if (isCharacterEffect(command)) characterEffects.start(command, token);
}
watch(() => [props.after, props.row?.key], seek, { deep: true });
watch(() => props.row?.speaker, draw);
watch(() => props.assets, refreshImages);
watch(() => props.options, draw, { deep: true });
function tween(duration, token, update, { spatial = true } = {}) {
  if (spatial && matchMedia("(prefers-reduced-motion: reduce)").matches) duration = 0;
  return new Promise((resolve) => {
    const start = performance.now();
    function frame(now) {
      if (token !== generation) {
        resolve(false);
        return;
      }
      const p = duration ? Math.min(1, (now - start) / (duration * 1000)) : 1;
      update(p);
      draw();
      if (p < 1) requestAnimationFrame(frame);
      else resolve(true);
    }
    requestAnimationFrame(frame);
  });
}
function lerp(a, b, p) {
  return a + (b - a) * p;
}
async function playAudio(command, state, token, { paused = false } = {}) {
  const v = command.values,
    key = command.canonical;
  if (key === "bgm:volume" && bgm) bgm.volume = Number(v.volume);
  if (key === "bgm:pause" && bgm) bgm.pause();
  if (key === "bgm:resume" && bgm) await startAudio(bgm, token);
  if (key === "bgm:stop" && bgm) {
    const old = bgm;
    await tween(seconds(v.duration), token, (p) => {
      old.volume = state.bgm.volume * (1 - p);
    }, { spatial: false });
    old.pause();
    audio.delete(old);
    if (bgm === old) bgm = null;
  }
  if (["bgm:play", "bgm:crossfade", "se:play"].includes(key)) {
    const a = findAsset(v.asset);
    if (!a?.url) return;
    const sound = new Audio(a.url);
    audio.add(sound);
    sound.loop = key !== "se:play";
    const targetVolume = sound.loop ? state.bgm.volume : Number(v.volume) * state.seVolume;
    const duration = seconds(v.duration);
    sound.volume = duration ? 0 : targetVolume;
    const old = bgm;
    if (paused) {
      bgm = sound;
      return;
    }
    if (!await startAudio(sound, token)) {
      audio.delete(sound);
      return;
    }
    if (!sound.loop) {
      await waitForSound(sound);
      audio.delete(sound);
      return;
    }
    bgm = sound;
    if (key === "bgm:play") old?.pause();
    if (duration) {
      const outgoing = old?.volume ?? 0;
      await tween(duration, token, (p) => {
        sound.volume = targetVolume * p;
        if (key === "bgm:crossfade" && old) old.volume = outgoing * (1 - p);
      }, { spatial: false });
    }
    if (old) {
      old.pause();
      audio.delete(old);
    }
  }
}
async function startAudio(sound, token) {
  try {
    await sound.play();
    return token === generation;
  } catch {
    if (token === generation)
      emit("message", "音声を再生できません。ファイル形式を確認してください。");
    return false;
  }
}
function waitForSound(sound) {
  if (sound.paused || sound.ended) return;
  return new Promise((resolve) => {
    const events = ["ended", "pause", "error"];
    function finished() {
      for (const event of events) sound.removeEventListener(event, finished);
      resolve();
    }
    for (const event of events) sound.addEventListener(event, finished);
  });
}
function playScreenShake({ duration, strength }) {
  const time = seconds(duration);
  if (!time || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const pixels = (Number(strength) * stage.value.clientWidth) / 1920;
  return stage.value.animate(
    [
      { transform: "translateX(0)" },
      { transform: `translateX(-${pixels}px)` },
      { transform: `translateX(${pixels}px)` },
      { transform: "translateX(0)" },
    ],
    { duration: time * 1000 },
  ).finished.catch(() => {});
}
async function play() {
  if (props.instruction) return;
  stop(false);
  const token = generation;
  busy.value = true;
  emit("playing", true);
  let state = clone(props.before);
  display.value = clone(state);
  draw();
  const commands = parseCommands(props.row?.command).filter((command) =>
    command.definition && !validateValues(command.definition, command.values).length,
  );
  const soundEffects = [];
  try {
    if (state.bgm.asset)
      await playAudio(
        parseCommands(buildCommand("bgm:play", { asset: state.bgm.asset }))[0],
        state,
        token,
        { paused: !state.bgm.playing },
      );
    for (const group of groupPreviewCommands(commands)) {
      if (token !== generation) return;
      state = await playGroup(group, state, token, soundEffects);
    }
    await Promise.all(soundEffects);
  } catch {
    if (token === generation) {
      emit("message", "プレビューを再生できませんでした。");
      stop();
    }
  } finally {
    if (token === generation) {
      display.value = clone(props.after);
      draw();
      busy.value = Boolean(bgm && !bgm.paused);
      emit("playing", busy.value);
    }
  }
}
async function playGroup(commands, initial, token, soundEffects) {
  let state = initial;
  const effects = [], pending = [];
  const visible = (id) => state.characters.some((character) =>
    character.id.toLowerCase() === id,
  );
  const startEffect = (command) => effects.push(characterEffects.start(command, token));
  for (const command of commands) {
    if (isCharacterEffect(command)) {
      if (visible(command.values.id.toLowerCase())) startEffect(command);
      else pending.push(command);
    } else if (command.canonical === "shake") {
      effects.push(playScreenShake(command.values));
    } else if (command.canonical.startsWith("se:")) {
      soundEffects.push(playAudio(command, state, token));
      state = applyCommand(state, command);
    }
  }

  async function run(commandsToPlay) {
    for (const command of commandsToPlay) {
      if (token !== generation) return;
      if (command.canonical === "char:show" && !visible(command.values.id.toLowerCase())) {
        for (const effect of pending)
          if (effect.values.id.toLowerCase() === command.values.id.toLowerCase())
            startEffect(effect);
      }
      state = await playCommand(command, state, token);
    }
  }
  const music = commands.filter((command) => command.canonical.startsWith("bgm:"));
  async function playMusic(musicState) {
    for (const command of music) {
      if (token !== generation) return;
      await playAudio(command, musicState, token);
      musicState = applyCommand(musicState, command);
    }
  }
  const background = commands.find(isPreviewBackground);
  const backgroundTime = seconds(background?.values.duration);
  const removals = commands.filter(isPreviewRemoval);
  const isMidpointRemoval = (command) => backgroundTime > 0 && !seconds(command.values.duration);
  if (!background) effects.push(playMusic(state));
  await run(removals.filter((command) => !isMidpointRemoval(command)));
  if (token !== generation) return state;
  if (backgroundTime) {
    backgroundFade.value.color = background.values.color || "black";
    await tween(backgroundTime / 2, token, (t) => {
      backgroundFade.value.opacity = t;
    }, { spatial: false });
    if (token !== generation) return state;
    effects.push(playMusic(state));
    await run(removals.filter(isMidpointRemoval));
  }

  const characters = commands.filter((command) =>
    command.canonical.startsWith("char:") && !isPreviewRemoval(command) && !isCharacterEffect(command),
  );
  const newIds = new Set(characters
    .filter((command) => command.canonical === "char:show" && !visible(command.values.id.toLowerCase()))
    .map((command) => command.values.id.toLowerCase()));
  const isNewCharacter = (command) => newIds.has(command.values.id.toLowerCase());
  await run(characters.filter((command) => !isNewCharacter(command)));
  if (token !== generation) return state;
  if (background) {
    if (!backgroundTime) effects.push(playMusic(state));
    await run([background]);
    if (backgroundTime)
      await tween(backgroundTime / 2, token, (t) => {
        backgroundFade.value.opacity = 1 - t;
      }, { spatial: false });
  }
  await run(characters.filter(isNewCharacter));
  await run(commands.filter((command) =>
    command.canonical.startsWith("fade:") || command.canonical.startsWith("dialogue:"),
  ));
  await Promise.all(effects);
  return music.reduce(applyCommand, state);
}
async function playCommand(c, state, token) {
  const next = applyCommand(state, c),
    v = c.values,
    moved = ["char:move", "char:show"].includes(c.canonical)
      && state.characters.some((ch) =>
        ch.id.toLowerCase() === v.id.toLowerCase() && ch.x !== Number(v.x),
      ),
    d = c.canonical === "char:move" ? (moved ? 0.25 : 0) : seconds(v.duration);
  if (c.canonical === "char:face" && d) {
    const old = state.characters.find(
      (x) => x.id.toLowerCase() === v.id.toLowerCase(),
    );
    if (old) {
      await tween(d / 2, token, (p) => {
        const s = clone(state);
        s.characters.find(
          (x) => x.id.toLowerCase() === v.id.toLowerCase(),
        ).opacity = 1 - p;
        display.value = s;
      }, { spatial: false });
      await tween(d / 2, token, (p) => {
        const s = clone(next);
        s.characters.find(
          (x) => x.id.toLowerCase() === v.id.toLowerCase(),
        ).opacity = p;
        display.value = s;
      }, { spatial: false });
    }
  } else if ((d || moved) && c.canonical.startsWith("char:")) {
    const totalTime = Math.max(d, moved ? 0.25 : 0);
    await tween(totalTime, token, (p) => {
      const s = clone(next);
      const moveProgress = Math.min(1, (p * totalTime) / 0.25);
      const easedMove = moveProgress * moveProgress * (3 - 2 * moveProgress);
      for (const ch of s.characters) {
        const old = state.characters.find(
          (x) => x.id.toLowerCase() === ch.id.toLowerCase(),
        );
        if (old) {
          ch.x = lerp(old.x, ch.x, moved ? easedMove : p);
          if (c.canonical === "char:scale") ch.scale = lerp(old.scale, ch.scale, p);
          if (c.canonical === "char:tint") {
            const a = rgba(old.tint),
              b = rgba(ch.tint);
            ch.tint =
              "#" +
              a
                .map((v, i) =>
                  Math.round(lerp(v, b[i], p) * 255)
                    .toString(16)
                    .padStart(2, "0"),
                )
                .join("");
          }
        } else ch.opacity = p;
      }
      for (const old of state.characters.filter(
        (x) =>
          !s.characters.some(
            (y) => y.id.toLowerCase() === x.id.toLowerCase(),
          ),
      ))
        s.characters.push({ ...old, opacity: 1 - p });
      display.value = s;
    }, { spatial: moved || c.canonical === "char:scale" });
  } else if (d && c.canonical.startsWith("fade:")) {
    const startOpacity =
      c.canonical === "fade:in" && state.fade.opacity <= 0.001
        ? rgba(v.color)[3]
        : state.fade.opacity;
    await tween(d, token, (p) => {
      display.value = {
        ...clone(next),
        fade: {
          color: next.fade.color,
          opacity: lerp(startOpacity, next.fade.opacity, p),
        },
      };
    }, { spatial: false });
  } else if (d && c.canonical.startsWith("dialogue:")) {
    await tween(d, token, (p) => {
      display.value = {
        ...clone(next),
        dialogue: true,
        dialogueAlpha: lerp(state.dialogue ? 1 : 0, next.dialogue ? 1 : 0, p),
      };
    }, { spatial: false });
  }
  if (token === generation) {
    display.value = clone(next);
    draw();
  }
  return next;
}
let dragging = null;
function pointerDown(event) {
  if (busy.value) return;
  const r = canvas.value.getBoundingClientRect(),
    x = ((event.clientX - r.left) * 1920) / r.width,
    y = ((event.clientY - r.top) * 1080) / r.height;
  const hit = orderedCharacters(display.value.characters).reverse().find((c) => {
    const b = characterRect(c);
    return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
  });
  if (hit) {
    dragging = { id: hit.id, startX: hit.x };
    canvas.value.setPointerCapture(event.pointerId);
    emit("select-character", hit.id);
  }
}
function pointerMove(event) {
  if (!dragging) return;
  const c = display.value.characters.find((x) => x.id === dragging.id),
    r = canvas.value.getBoundingClientRect(),
    w = characterRect(c).w,
    x = ((event.clientX - r.left) * 1920) / r.width;
  c.x = characterPositionFromCenter(x, w);
  draw();
}
function pointerUp() {
  if (!dragging) return;
  const c = display.value.characters.find((x) => x.id === dragging.id);
  const id = dragging.id;
  dragging = null;
  emit("move-character", { id, x: Number(c.x.toFixed(3)) });
}
onMounted(() => {
  draw();
  resizeObserver = new ResizeObserver(draw);
  resizeObserver.observe(stage.value);
  previewCharacterEffects();
});
onBeforeUnmount(() => {
  stop();
  resizeObserver?.disconnect();
  images.clear();
  tints.clear();
});
defineExpose({ play, stop });
</script>
<template>
  <div class="game-view" ref="stage" aria-label="シーンのプレビュー">
    <canvas
      ref="canvas"
      width="1920"
      height="1080"
      @pointerdown="pointerDown"
      @pointermove="pointerMove"
      @pointerup="pointerUp"
      @pointercancel="dragging = null"
      aria-label="背景とキャラクター。立ち絵をドラッグして移動できます。"
    ></canvas>
    <div
      class="game-dialogue"
      v-show="display.dialogue && !instruction"
      :style="{
        '--speaker-color': speaker?.color || '#f0f0f0',
        opacity: display.dialogueAlpha ?? 1,
      }"
    >
      <div class="game-speaker" v-if="row?.speaker">{{ row.speaker }}</div>
      <div class="game-text">{{ row?.text || (!row?.choice ? "…" : "") }}</div>
      <div class="game-choices" v-if="choices?.length">
        <button
          v-for="entry in choices"
          :key="entry.row.key"
          @click="emit('choice', entry.row.nextNode)"
        >
          {{ entry.row.choice }} <span>›</span>
        </button>
      </div>
    </div>
    <div
      class="screen-fade"
      :style="{
        background: `rgb(${rgba(display.fade.color)
          .slice(0, 3)
          .map((x) => Math.round(x * 255))
          .join(',')})`,
        opacity: display.fade.opacity,
      }"
    ></div>
  </div>
  <div v-if="missing.length" class="missing-assets">
    画像未登録：{{ [...new Set(missing)].join("、") }}
  </div>
</template>
