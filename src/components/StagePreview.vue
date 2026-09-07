<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import {
  applyCommand,
  parseCommands,
  buildCommand,
  cssColor,
  seconds,
  validateValues,
  rgba,
} from "../lib/commands.js";
const props = defineProps({
  before: Object,
  after: Object,
  row: Object,
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
  audio = new Map();
let generation = 0,
  bgm = null,
  resizeObserver;
const speaker = computed(() =>
  props.speakers.find((s) => s.name === props.row?.speaker),
);
const missing = computed(() =>
  [
    display.value.background,
    ...display.value.characters.map((c) => c.asset),
  ].filter(
    (name) =>
      name &&
      !props.assets.some((a) => a.name.toLowerCase() === name.toLowerCase()),
  ),
);
const clone = (s) => JSON.parse(JSON.stringify(s));
const findAsset = (name) =>
  props.assets.find((a) => a.name.toLowerCase() === String(name).toLowerCase());
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
  const img = images.get(findAsset(c.asset)?.id),
    h = 1080 * (props.options?.characterHeight ?? 0.9) * c.scale,
    w = img ? (img.width / img.height) * h : h * 0.45;
  const x = w <= 1920 ? w / 2 + (1920 - w) * c.x : 1920 * c.x;
  return {
    x: x - w / 2,
    y: 1080 - h - (props.options?.bottomOffset ?? 0),
    w,
    h,
    img,
  };
}
function draw() {
  if (!canvas.value || !display.value) return;
  const ctx = canvas.value.getContext("2d");
  ctx.clearRect(0, 0, 1920, 1080);
  ctx.fillStyle = "#1c2635";
  ctx.fillRect(0, 0, 1920, 1080);
  const background = images.get(findAsset(display.value.background)?.id);
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
  for (const c of display.value.characters) {
    const r = characterRect(c);
    ctx.save();
    ctx.globalAlpha = (c.opacity ?? 1) * rgba(c.tint)[3];
    if (r.img) {
      ctx.translate(r.x + (c.flip ? r.w : 0), r.y);
      ctx.scale(c.flip ? -1 : 1, 1);
      ctx.drawImage(tinted(r.img, c.tint), 0, 0, r.w, r.h);
    } else {
      ctx.strokeStyle = "#b9a1b6";
      ctx.fillStyle = "#5a4a61";
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
async function loadImages() {
  for (const a of props.assets.filter((a) =>
    ["background", "sprite"].includes(a.kind),
  )) {
    if (images.get(a.id)?.src === a.url) continue;
    const img = new Image();
    img.onload = () => {
      images.set(a.id, img);
      draw();
    };
    img.src = a.url;
  }
  draw();
}
function stop(reset = true) {
  generation++;
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
}
watch(() => [props.after, props.row?.key], seek, { deep: true });
watch(() => props.assets, loadImages, { deep: true });
watch(() => props.options, draw, { deep: true });
function tween(duration, token, update) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) duration = 0;
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
async function playAudio(command, state, token) {
  const v = command.values,
    key = command.canonical;
  if (key === "bgm:volume" && bgm) bgm.volume = Number(v.volume);
  if (key === "bgm:pause" && bgm) bgm.pause();
  if (key === "bgm:resume" && bgm) bgm.play().catch(() => {});
  if (key === "bgm:stop" && bgm) {
    const old = bgm;
    await tween(seconds(v.duration), token, (p) => {
      old.volume = state.bgm.volume * (1 - p);
    });
    old.pause();
    bgm = null;
  }
  if (["bgm:play", "bgm:crossfade", "se:play"].includes(key)) {
    const a = findAsset(v.asset);
    if (!a) return;
    const sound = new Audio(a.url);
    audio.set(crypto.randomUUID(), sound);
    sound.loop = key !== "se:play";
    sound.volume =
      key === "se:play" ? Number(v.volume) * state.seVolume : state.bgm.volume;
    const old = bgm;
    if (key !== "se:play") {
      bgm = sound;
      if (key === "bgm:play") old?.pause();
    }
    try {
      await sound.play();
    } catch {
      emit("message", "音声を再生できません。ファイル形式を確認してください。");
    }
    if (
      key === "bgm:crossfade" ||
      (key === "bgm:play" && seconds(v.duration))
    ) {
      const target = sound.volume;
      sound.volume = 0;
      await tween(seconds(v.duration), token, (p) => {
        sound.volume = target * p;
        if (old) old.volume = target * (1 - p);
      });
      old?.pause();
    }
  }
}
async function play() {
  stop(false);
  const token = generation;
  busy.value = true;
  emit("playing", true);
  let state = clone(props.before);
  display.value = clone(state);
  draw();
  if (state.bgm.playing && state.bgm.asset)
    await playAudio(
      parseCommands(buildCommand("bgm:play", { asset: state.bgm.asset }))[0],
      state,
      token,
    );
  for (const c of parseCommands(props.row?.command)) {
    if (token !== generation) break;
    if (!c.definition || validateValues(c.definition, c.values).length)
      continue;
    const next = applyCommand(state, c),
      v = c.values,
      d = seconds(v.duration);
    await playAudio(c, state, token);
    if (token !== generation) break;
    if (c.canonical === "background" && d) {
      backgroundFade.value.color = v.color;
      await tween(d / 2, token, (p) => {
        backgroundFade.value.opacity = p;
      });
      if (token !== generation) break;
      display.value = clone(next);
      await tween(d / 2, token, (p) => {
        backgroundFade.value.opacity = 1 - p;
      });
    } else if (c.canonical === "char:face" && d) {
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
        });
        await tween(d / 2, token, (p) => {
          const s = clone(next);
          s.characters.find(
            (x) => x.id.toLowerCase() === v.id.toLowerCase(),
          ).opacity = p;
          display.value = s;
        });
      }
    } else if (c.canonical === "shake") {
      const strength = (Number(v.strength) * stage.value.clientWidth) / 1920;
      const animation = stage.value.animate(
        [
          { transform: "translateX(0)" },
          { transform: `translateX(-${strength}px)` },
          { transform: `translateX(${strength}px)` },
          { transform: "translateX(0)" },
        ],
        { duration: d * 1000, iterations: 1 },
      );
      await animation.finished.catch(() => {});
    } else if (d && c.canonical.startsWith("char:")) {
      await tween(d, token, (p) => {
        const s = clone(next);
        for (const ch of s.characters) {
          const old = state.characters.find(
            (x) => x.id.toLowerCase() === ch.id.toLowerCase(),
          );
          if (old) {
            ch.x = lerp(old.x, ch.x, p);
            ch.scale = lerp(old.scale, ch.scale, p);
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
      });
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
      });
    } else if (d && c.canonical.startsWith("dialogue:")) {
      await tween(d, token, (p) => {
        display.value = {
          ...clone(next),
          dialogue: true,
          dialogueAlpha: lerp(state.dialogue ? 1 : 0, next.dialogue ? 1 : 0, p),
        };
      });
    }
    state = next;
    if (token === generation) {
      display.value = clone(state);
      draw();
    }
  }
  if (token === generation) {
    busy.value = Boolean(bgm && !bgm.paused);
    emit("playing", busy.value);
  }
}
let dragging = null;
function pointerDown(event) {
  if (busy.value) return;
  const r = canvas.value.getBoundingClientRect(),
    x = ((event.clientX - r.left) * 1920) / r.width,
    y = ((event.clientY - r.top) * 1080) / r.height;
  const hit = [...display.value.characters].reverse().find((c) => {
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
  c.x = Math.max(
    0,
    Math.min(1, w < 1920 ? (x - w / 2) / (1920 - w) : x / 1920),
  );
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
  loadImages();
  draw();
  resizeObserver = new ResizeObserver(draw);
  resizeObserver.observe(stage.value);
});
onBeforeUnmount(() => {
  stop();
  resizeObserver?.disconnect();
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
      v-show="display.dialogue"
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
