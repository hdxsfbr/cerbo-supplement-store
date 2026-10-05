<script setup lang="ts">
// Ledger-style rendering of a money split (total / COGS / platform fee / provider margin) in the
// Cerbo billing idiom. Display only — the authoritative split comes from the server
// (server/src/money/split.ts) and the database trigger; this never computes money itself.
import { computed } from 'vue';
import { formatCents, formatBps, marginPercentBps } from '../money';

const props = withDefaults(
  defineProps<{
    totalCents: number;
    cogsCents: number;
    feeCents: number;
    marginCents: number;
    feeBps?: number;
    feeMemo?: string;
    title?: string;
    compact?: boolean;
  }>(),
  {
    feeBps: 75,
    title: 'Money split',
    compact: false,
  },
);

const marginNegative = computed(() => props.marginCents < 0);

const marginBps = computed(() => marginPercentBps(props.totalCents, props.marginCents));

const invariantHolds = computed(
  () => props.cogsCents + props.marginCents + props.feeCents === props.totalCents,
);
</script>

<template>
  <div class="cerbo-split-preview" :class="{ 'cerbo-split-preview--compact': compact }">
    <div class="cerbo-split-preview__title cerbo-muted">{{ title }}</div>
    <table class="cerbo-table">
      <thead>
        <tr>
          <th>Line</th>
          <th class="cerbo-table__num">Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Order total</td>
          <td class="cerbo-table__num">
            <span class="cerbo-money">{{ formatCents(totalCents) }}</span>
          </td>
        </tr>
        <tr>
          <td>COGS</td>
          <td class="cerbo-table__num">
            <span class="cerbo-money cerbo-money--charge">-{{ formatCents(cogsCents) }}</span>
          </td>
        </tr>
        <tr>
          <td>Platform fee ({{ feeBps }} bps)</td>
          <td class="cerbo-table__num">
            <span class="cerbo-money cerbo-money--charge">-{{ formatCents(feeCents) }}</span>
          </td>
        </tr>
        <tr>
          <td><strong>Provider margin</strong></td>
          <td class="cerbo-table__num">
            <span
              class="cerbo-money"
              :class="{ 'cerbo-money--charge': marginNegative }"
              style="font-weight: 700"
            >
              {{ formatCents(marginCents) }}
            </span>
            <span v-if="marginNegative" class="cerbo-chip--warn">below cost</span>
          </td>
        </tr>
      </tbody>
    </table>

    <p v-if="feeMemo" class="cerbo-muted cerbo-split-preview__memo">{{ feeMemo }}</p>

    <div class="cerbo-balance">
      MARGIN: {{ formatCents(marginCents) }}
      <span v-if="marginBps !== null">({{ formatBps(marginBps) }})</span>
    </div>

    <p class="cerbo-muted cerbo-split-preview__invariant">
      COGS + margin + fee = total {{ invariantHolds ? '✓' : '✗' }}
    </p>
  </div>
</template>

<style scoped>
.cerbo-split-preview__title {
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.cerbo-split-preview__memo {
  margin: 4px 0 0;
}

.cerbo-split-preview__invariant {
  margin: 2px 0 0;
  text-align: center;
}

.cerbo-split-preview--compact .cerbo-table td,
.cerbo-split-preview--compact .cerbo-table th {
  padding: 2px 6px;
}
</style>
