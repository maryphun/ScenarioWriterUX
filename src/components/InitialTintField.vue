<script setup>
import { computed, useId } from "vue";
import { rgba } from "../lib/commands.js";

const tint = defineModel({ type: String, default: "" });
const id = useId();
const swatch = computed(() => {
  const rgb = rgba(tint.value || "white").slice(0, 3);
  if (!rgb.every(Number.isFinite)) return "#ffffff";
  return "#" + rgb.map((channel) => Math.round(channel * 255).toString(16).padStart(2, "0")).join("");
});
</script>

<template>
  <div class="initial-tint-field">
    <label :for="id">初期色（任意）</label>
    <div class="color-control">
      <input type="color" :value="swatch" aria-label="初期色を選ぶ" @input="tint = $event.target.value" />
      <input :id="id" v-model.trim="tint" placeholder="現在の色を引き継ぐ" spellcheck="false" />
      <button type="button" class="button" @click="tint = 'black'">黒</button>
    </div>
  </div>
</template>
