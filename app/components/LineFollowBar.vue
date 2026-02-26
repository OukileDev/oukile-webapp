<script lang="ts" setup>
defineProps<{
  selectedLine: string
  directionLabel: string
  followBottom: string
}>()

const emit = defineEmits<{
  reverse: []
  stop: []
}>()
</script>

<template>
  <div
    class="fixed left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-md"
    :style="{ bottom: followBottom, zIndex: 10050, pointerEvents: 'auto' }"
  >
    <div
      class="bg-white/90 dark:bg-slate-800 rounded-xl shadow p-3 flex items-center justify-between"
    >
      <div class="flex flex-col">
        <div class="text-sm font-semibold">Suivi de la ligne {{ selectedLine }}</div>
        <div class="text-xs text-gray-600 dark:text-gray-300">Direction {{ directionLabel }}</div>
      </div>

      <div class="flex items-center gap-4 pt-1">
        <button aria-label="Inverser le sens" @click="emit('reverse')">
          <Icon name="mi:switch" class="h-6 w-6" />
        </button>
        <button aria-label="Arrêter le suivi" @click="emit('stop')">
          <Icon name="mi:close" class="h-6 w-6" />
        </button>
      </div>
    </div>

    <slot />
  </div>
</template>
