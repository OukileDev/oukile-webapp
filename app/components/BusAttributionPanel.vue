<script lang="ts" setup>
defineProps<{
  busList: string[]
}>()
</script>

<template>
  <div class="mt-2 bg-white/90 dark:bg-slate-800 rounded-xl shadow p-3">
    <div class="text-xs font-medium mb-2">Bus attribués à la ligne (dans les deux sens)</div>
    <div class="flex gap-2 flex-wrap">
      <template v-if="busList.length">
        <span
          v-for="bus in busList"
          :key="bus"
          class="px-2 py-1 bg-blue-600 text-white rounded text-xs"
        >
          {{ bus }}
        </span>
      </template>
      <span v-else class="text-xs text-gray-500">Aucun bus attribué</span>
    </div>
  </div>
</template>