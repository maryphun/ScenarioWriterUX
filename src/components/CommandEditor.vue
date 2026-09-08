<script setup>
import { computed, ref, watch } from "vue";
import {
  COMMANDS,
  findSpec,
  parseCommands,
  buildCommand,
  validateValues,
  COLOR_NAMES,
} from "../lib/commands.js";
const props = defineProps({
  initial: { type: String, default: "" },
  preset: { type: String, default: "background" },
  assets: { type: Array, default: () => [] },
  characterIds: { type: Array, default: () => [] },
});
const emit = defineEmits(["save", "cancel"]);
const selected = ref(props.preset),
  values = ref({}),
  message = ref("");
const definition = computed(() => findSpec(selected.value));
const groups = [...new Set(COMMANDS.map((c) => c.group))];
function reset() {
  values.value = Object.fromEntries(
    definition.value.fields.map((f) => [f.key, f.default]),
  );
  message.value = "";
}
watch(selected, reset, { immediate: true, flush: "sync" });
watch(
  () => props.initial,
  (raw) => {
    if (raw) {
      const c = parseCommands(raw)[0];
      if (c?.definition) {
        selected.value = c.key;
        values.value = { ...c.values };
      }
    }
  },
  { immediate: true },
);
const errors = computed(() => validateValues(definition.value, values.value));
const preview = computed(() => {
  try {
    return buildCommand(selected.value, values.value);
  } catch {
    return "";
  }
});
function submit() {
  if (errors.value.length) {
    message.value = errors.value.join(" ");
    return;
  }
  emit("save", preview.value);
}
const optionsFor = (f) => props.assets.filter((a) => a.kind === f.kind);
</script>
<template>
  <form class="command-form" @submit.prevent="submit">
    <label
      >演出<select v-model="selected">
        <optgroup v-for="group in groups" :key="group" :label="group">
          <template
            v-for="c in COMMANDS.filter((c) => c.group === group)"
            :key="c.key"
            ><option :value="c.key">{{ c.label }}</option>
            <option v-for="alias in c.aliases" :key="alias" :value="alias">
              {{ c.label }} · {{ alias }}
            </option></template
          >
        </optgroup>
      </select></label
    >
    <template v-for="f in definition.fields" :key="selected + f.key">
      <fieldset v-if="f.type === 'duration'" class="transition-fields">
        <legend>
          {{ definition.key === "background" ? "背景の切り替え" : f.label }}
        </legend>
        <div class="segmented">
          <button
            type="button"
            :class="{ active: values[f.key] === 'instant' }"
            @click="values[f.key] = 'instant'"
          >
            即時</button
          ><button
            type="button"
            :class="{ active: values[f.key] !== 'instant' }"
            @click="values[f.key] === 'instant' && (values[f.key] = '0.5')"
          >
            {{ definition.key === "background" ? "フェード" : "時間を指定" }}
          </button>
        </div>
        <label v-if="values[f.key] !== 'instant'"
          >{{
            definition.key === "background"
              ? "フェード時間（秒）"
              : "時間（秒）"
          }}<input
            v-model="values[f.key]"
            type="number"
            min="0"
            step="0.1"
            required
        /></label>
      </fieldset>
      <label v-else-if="f.type === 'color'"
        >{{ definition.key === "background" ? "フェード色" : f.label }}
        <div class="color-control">
          <input
            :value="
              /^#[\da-f]{6}$/i.test(values[f.key]) ? values[f.key] : '#000000'
            "
            type="color"
            aria-label="色を選ぶ"
            @input="values[f.key] = $event.target.value"
          /><input v-model="values[f.key]" list="command-colors" required />
        </div>
        <small v-if="definition.key === 'background'"
          >既定：black（黒）</small
        ></label
      >
      <label v-else-if="f.type === 'select'"
        >{{ f.label
        }}<select v-model="values[f.key]">
          <option v-for="opt in f.options" :key="opt" :value="opt">
            {{ opt === "true" ? "反転" : opt === "false" ? "通常" : opt }}
          </option>
        </select></label
      >
      <label v-else-if="f.type === 'number'"
        >{{ f.label }}
        <div class="number-control">
          <input
            v-if="f.max === 1"
            v-model="values[f.key]"
            type="range"
            :min="f.min"
            :max="f.max"
            :step="f.step"
            :aria-label="f.label"
          /><input
            v-model="values[f.key]"
            type="number"
            :min="f.min"
            :max="f.max"
            :step="f.step"
            required
          />
        </div>
        <small v-if="f.key === 'x'"
          >0：左端より250px外 / 0.5：中央 / 1：右端より250px外</small
        ></label
      >
      <label v-else
        >{{ f.label
        }}<input
          v-model="values[f.key]"
          :required="f.required"
          :list="'command-' + f.key"
          autocomplete="off"
        /><datalist :id="'command-' + f.key">
          <option
            v-for="a in f.type === 'asset'
              ? optionsFor(f)
              : characterIds.map((id) => ({ name: id }))"
            :key="a.id || a.name"
            :value="a.name"
          >
            {{ a.description }}
          </option>
        </datalist></label
      >
    </template>
    <datalist id="command-colors">
      <option v-for="color in COLOR_NAMES" :key="color" :value="color" />
    </datalist>
    <details v-if="preview" class="raw-details">
      <summary>コマンドを確認</summary>
      <code>{{ preview }}</code>
    </details>
    <p v-if="message" class="error" role="alert">{{ message }}</p>
    <div class="dialog-actions">
      <button type="button" class="button" @click="emit('cancel')">
        キャンセル</button
      ><button class="button primary" type="submit">この行に設定</button>
    </div>
  </form>
</template>
