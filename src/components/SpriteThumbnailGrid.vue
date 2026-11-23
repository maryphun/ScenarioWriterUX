<script setup>
import { isTokaFaceAsset } from "../lib/commands.js";

defineProps({
  assets: { type: Array, required: true },
  selectedName: { type: String, default: "" },
});
defineEmits(["select"]);
</script>

<template>
  <div class="sprite-grid" role="group">
    <button
      v-for="asset in assets"
      :key="asset.id"
      type="button"
      class="sprite-option"
      :aria-pressed="asset.name === selectedName"
      @click="$emit('select', asset)"
    >
      <span class="sprite-option-image" :class="{ 'face-detail': isTokaFaceAsset(asset.name) }">
        <img :src="asset.url" alt="" loading="lazy" />
      </span>
      <span class="sprite-option-name">{{ asset.name }}</span>
    </button>
  </div>
</template>
