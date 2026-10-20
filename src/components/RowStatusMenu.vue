<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from "vue";
import { ClipboardCopy, ClipboardPaste } from "lucide-vue-next";

const props = defineProps({
  x: { type: Number, required: true },
  y: { type: Number, required: true },
  canPaste: Boolean,
});
const emit = defineEmits(["copy", "paste", "close"]);
const menu = ref(), left = ref(props.x), top = ref(props.y);
const items = () => [...menu.value.querySelectorAll("button:not(:disabled)")];
function keydown(event) {
  const buttons = items(), index = buttons.indexOf(document.activeElement);
  let next;
  if (event.key === "ArrowDown") next = (index + 1) % buttons.length;
  else if (event.key === "ArrowUp") next = (index - 1 + buttons.length) % buttons.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = buttons.length - 1;
  else if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    emit("close", true);
  } else if (event.key === "Tab") emit("close", true);
  if (next !== undefined) {
    event.preventDefault();
    buttons[next].focus();
  }
}
function outside(event) {
  if (!menu.value.contains(event.target)) emit("close", false);
}
function dismiss() { emit("close", false); }
onMounted(async () => {
  const rect = menu.value.getBoundingClientRect();
  left.value = Math.max(8, Math.min(props.x, document.documentElement.clientWidth - rect.width - 8));
  top.value = Math.max(8, Math.min(props.y, document.documentElement.clientHeight - rect.height - 8));
  await nextTick();
  if (!menu.value) return;
  items()[0]?.focus();
  document.addEventListener("pointerdown", outside, true);
  document.addEventListener("scroll", dismiss, true);
  window.addEventListener("resize", dismiss);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", outside, true);
  document.removeEventListener("scroll", dismiss, true);
  window.removeEventListener("resize", dismiss);
});
</script>

<template>
  <div
    ref="menu"
    class="row-status-menu"
    role="menu"
    aria-label="行の状態"
    :style="{ left: `${left}px`, top: `${top}px` }"
    @keydown="keydown"
    @contextmenu.prevent
  >
    <button type="button" role="menuitem" @click="emit('copy')">
      <ClipboardCopy :size="16" />コピー
    </button>
    <button type="button" role="menuitem" :disabled="!canPaste" @click="emit('paste')">
      <ClipboardPaste :size="16" />貼り付け
    </button>
  </div>
</template>
