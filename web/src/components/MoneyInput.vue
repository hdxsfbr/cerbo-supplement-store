<script setup lang="ts">
// A cents-safe dollar input: displays/edits dollars, emits integer cents only (constitution I).
import { ref, watch } from 'vue';
import { formatCents, parseCentsInput } from '../money';

const model = defineModel<number | null>();

const props = withDefaults(
  defineProps<{
    disabled?: boolean;
    placeholder?: string;
    id?: string;
  }>(),
  {
    disabled: false,
  },
);

function toDisplay(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return formatCents(cents, { sign: 'never' }).slice(1); // drop the leading "$"
}

const raw = ref(toDisplay(model.value));
const invalid = ref(false);

// Keep the local text in sync when the model changes from outside this component.
watch(
  () => model.value,
  (next) => {
    raw.value = toDisplay(next);
    invalid.value = false;
  },
);

function onInput(event: Event): void {
  const text = (event.target as HTMLInputElement).value;
  raw.value = text;

  if (text.trim() === '') {
    invalid.value = false;
    model.value = null;
    return;
  }

  const parsed = parseCentsInput(text);
  if (parsed === null) {
    invalid.value = true;
    return;
  }
  invalid.value = false;
  model.value = parsed;
}

function onBlur(): void {
  if (invalid.value) return;
  raw.value = toDisplay(model.value);
}
</script>

<template>
  <span class="cerbo-money-input">
    <span class="cerbo-money-input__prefix">$</span>
    <input
      :id="props.id"
      class="cerbo-input cerbo-money-input__field"
      type="text"
      inputmode="decimal"
      :placeholder="props.placeholder"
      :disabled="props.disabled"
      :aria-invalid="invalid"
      :value="raw"
      @input="onInput"
      @blur="onBlur"
    />
  </span>
</template>

<style scoped>
.cerbo-money-input {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.cerbo-money-input__prefix {
  color: var(--cerbo-muted);
}

.cerbo-money-input__field {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
