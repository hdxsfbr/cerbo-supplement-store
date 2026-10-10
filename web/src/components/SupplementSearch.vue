<script setup lang="ts">
// Typeahead over the practice catalog — the same interaction as the chart's "+ Add Supplement"
// picker: type to filter by name or SKU, arrow keys / hover to highlight, Enter or click to pick.
// The highlighted item shows price, COGS and margin at default (provider surface only).
import { computed, ref, watch } from 'vue';
import { formatBps, formatCents, marginPercentBps } from '../money';
import type { Supplement } from '../types';

const props = defineProps<{
  supplements: Supplement[];
  /** Ids already on the order; shown with a tag so the user knows a pick will bump quantity. */
  onOrder?: number[];
  disabled?: boolean;
}>();
const emit = defineEmits<{ pick: [supplement: Supplement] }>();

const query = ref('');
const open = ref(false);
const picked = ref(0);
const input = ref<HTMLInputElement | null>(null);

const matches = computed(() => {
  const q = query.value.trim().toLowerCase();
  const all = props.supplements;
  return q
    ? all.filter((s) => s.name.toLowerCase().includes(q) || (s.sku ?? '').toLowerCase().includes(q))
    : all;
});
watch(query, () => (picked.value = 0));
const highlighted = computed<Supplement | null>(() => matches.value[picked.value] ?? null);

function marginAtDefault(s: Supplement): string {
  const bps = marginPercentBps(s.default_price_cents, s.default_price_cents - s.unit_cogs_cents);
  return bps === null ? '—' : formatBps(bps);
}
function choose(s: Supplement): void {
  emit('pick', s);
  query.value = '';
  open.value = false;
  input.value?.focus();
}
function onBlur(): void {
  // let a click on a row land before the list closes
  setTimeout(() => (open.value = false), 150);
}
</script>

<template>
  <div class="ss" :class="{ 'ss--open': open && !disabled }">
    <input
      ref="input"
      v-model="query"
      class="cerbo-input ss__input"
      type="text"
      placeholder="Add a supplement — type to search"
      aria-label="Add a supplement"
      autocomplete="off"
      :disabled="disabled"
      @focus="open = true"
      @click="open = true"
      @input="open = true"
      @blur="onBlur"
      @keydown.down.prevent="picked = Math.min(picked + 1, matches.length - 1)"
      @keydown.up.prevent="picked = Math.max(picked - 1, 0)"
      @keydown.enter.prevent="highlighted && choose(highlighted)"
      @keydown.esc="open = false"
    />
    <div v-if="open && !disabled" class="ss__pop">
      <div class="ss__list" role="listbox">
        <div v-if="matches.length === 0" class="ss__empty">No matches in the practice catalog.</div>
        <div
          v-for="(s, i) in matches"
          :key="s.id"
          class="ss__row"
          :class="{ 'ss__row--on': i === picked }"
          role="option"
          :aria-selected="i === picked"
          @mouseenter="picked = i"
          @mousedown.prevent="choose(s)"
        >
          <span>{{ s.name }}</span>
          <span v-if="onOrder?.includes(s.id)" class="ss__tag">on order</span>
        </div>
      </div>
      <div v-if="highlighted" class="ss__card">
        <b class="ss__title">{{ highlighted.name }}</b>
        <div><b>SKU:</b> {{ highlighted.sku ?? '—' }}</div>
        <div><b>Default price:</b> {{ formatCents(highlighted.default_price_cents) }}</div>
        <div><b>Your cost (COGS):</b> {{ formatCents(highlighted.unit_cogs_cents) }}</div>
        <div><b>Margin at default:</b> {{ marginAtDefault(highlighted) }} before platform fee</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ss {
  position: relative;
  flex: 1;
  min-width: 280px;
}
.ss__input {
  width: 100%;
  box-sizing: border-box;
}
.ss__pop {
  position: absolute;
  z-index: 20;
  left: 0;
  right: 0;
  top: calc(100% + 2px);
  display: grid;
  grid-template-columns: minmax(260px, 1fr) 300px;
  gap: 8px;
  align-items: start;
}
.ss__list {
  background: #fff;
  border: 1px solid #999;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
  max-height: 300px;
  overflow-y: auto;
}
.ss__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 7px 10px;
  font-size: 13px;
  color: #013365;
  border-bottom: 1px solid #eee;
  cursor: pointer;
}
.ss__row--on {
  background: #336601;
  color: #fff;
}
.ss__tag {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  padding: 1px 5px;
  border: 1px solid currentColor;
  border-radius: 2px;
  opacity: 0.85;
}
.ss__empty {
  padding: 10px;
  font-size: 13px;
  color: #666;
}
.ss__card {
  background: #f4f1e8;
  border: 1px solid #cfc8b2;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.6;
  color: #333;
}
.ss__title {
  display: block;
  color: #013365;
  margin-bottom: 4px;
}
@media (max-width: 900px) {
  .ss__pop {
    grid-template-columns: 1fr;
  }
  .ss__card {
    display: none;
  }
}
</style>
