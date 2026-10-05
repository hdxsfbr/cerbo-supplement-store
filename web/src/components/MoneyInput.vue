<script setup lang="ts">
// A cents-safe dollar input: displays/edits dollars, emits integer cents only (constitution I).
import { ref, watch } from 'vue';
import { formatCents, parseCentsInput } from '../money';

const model = defineModel<number | null>();
const emit = defineEmits<{ (e: 'validity', valid: boolean): void }>();

const props = withDefaults(
  defineProps<{
    disabled?: boolean;
    placeholder?: string;
    id?: string;
    ariaLabel?: string;
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
const focused = ref(false);

// Keep the local text in sync when the model changes from outside this component — but never
// while the user is typing, or "3" would be rewritten to "3.00" under their cursor.
watch(
  () => model.value,
  (next) => {
    if (focused.value) return;
    raw.value = toDisplay(next);
    invalid.value = false;
  },
);

function onFocus(): void {
  focused.value = true;
}

function onInput(event: Event): void {
  const text = (event.target as HTMLInputElement).value;
  raw.value = text;

  if (text.trim() === '') {
    // A price is required: an empty field is reported invalid (HDX-85) but the last valid
    // model value is left alone so nothing is silently substituted.
    invalid.value = true;
    emit('validity', false);
    return;
  }

  const parsed = parseCentsInput(text);
  if (parsed === null) {
    invalid.value = true;
    emit('validity', false);
    return;
  }
  invalid.value = false;
  emit('validity', true);
  model.value = parsed;
}

function onBlur(): void {
  focused.value = false;
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
      :class="{ 'cerbo-money-input__field--invalid': invalid }"
      type="text"
      inputmode="decimal"
      :placeholder="props.placeholder"
      :disabled="props.disabled"
      :aria-invalid="invalid"
      :aria-label="props.ariaLabel"
      :value="raw"
      @input="onInput"
      @focus="onFocus"
      @blur="onBlur"
    />
  </span>
</template>

<style scoped>
.cerbo-money-input__field--invalid {
  border-color: var(--cerbo-charge) !important;
  background: #fff5f5;
}
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
