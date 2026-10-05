<script setup lang="ts">
// A single Cerbo chart "block": colored title bar, white body, tiny gray footer line.
// See web/src/styles/cerbo.css and docs/cerbo-ui-reference/DESIGN-NOTES.md.

export type CerboPanelColor =
  'green' | 'maroon' | 'navy' | 'black' | 'purple' | 'orange' | 'amber' | 'gray';

withDefaults(
  defineProps<{
    title: string;
    color?: CerboPanelColor;
    footer?: string;
  }>(),
  {
    color: 'navy',
  },
);
</script>

<template>
  <section class="cerbo-panel">
    <header class="cerbo-panel__header" :class="`cerbo-panel__header--${color}`">
      <span class="cerbo-panel__title">{{ title }}</span>
      <div v-if="$slots.actions" class="cerbo-panel__actions">
        <slot name="actions" />
      </div>
    </header>
    <div class="cerbo-panel__body">
      <slot />
    </div>
    <footer v-if="$slots.footer || footer" class="cerbo-panel__footer">
      <slot name="footer">{{ footer }}</slot>
    </footer>
  </section>
</template>

<style scoped>
.cerbo-panel__title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cerbo-panel__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
</style>
