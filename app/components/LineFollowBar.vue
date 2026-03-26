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

const { socketStatus } = useSocket()
</script>

<template>
  <div
    class="fixed left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-md"
    :style="{ bottom: followBottom, zIndex: 10050, pointerEvents: 'auto' }"
  >
    <div class="bg-white/90 dark:bg-slate-800 rounded-xl shadow overflow-hidden">
      <div class="flex items-center justify-between p-3">
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
      <!-- Statut connexion : section intégrée dans la carte -->
      <div
        v-if="socketStatus === 'reconnecting'"
        class="flex items-center gap-2 border-t border-amber-200 bg-amber-50 px-4 py-2 dark:border-amber-800/50 dark:bg-amber-950/40"
      >
        <svg class="h-3.5 w-3.5 shrink-0 animate-spin text-amber-600 dark:text-amber-400" viewBox="0 0 24 24" fill="none">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4z"/>
        </svg>
        <span class="text-xs font-medium text-amber-700 dark:text-amber-400">Reconnexion en cours…</span>
      </div>
      <div
        v-else-if="socketStatus === 'disconnected'"
        class="flex items-center gap-2 border-t border-red-200 bg-red-50 px-4 py-2 dark:border-red-800/50 dark:bg-red-950/40"
      >
        <span class="h-2 w-2 shrink-0 rounded-full bg-red-400" />
        <span class="text-xs font-medium text-red-600 dark:text-red-400">Position en temps réel indisponible</span>
      </div>
    </div>

    <slot />
  </div>
</template>
