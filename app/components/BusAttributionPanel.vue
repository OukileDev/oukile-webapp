<script lang="ts" setup>
defineProps<{
  busList: string[]
  followedBus: string | null
}>()

const emit = defineEmits<{
  followBus: [busID: string]
  stopFollowing: []
}>()
</script>

<template>
  <div class="mt-2 bg-white/90 dark:bg-slate-800 rounded-xl shadow p-3">
    <div class="text-xs font-medium mb-2">Bus attribués à la ligne</div>

    <div class="flex gap-2 flex-wrap">
      <template v-if="busList.length">
        <button
          v-for="bus in busList"
          :key="bus"
          class="px-2 py-1 bg-blue-600 text-white rounded text-xs"
          @click.prevent="emit('followBus', bus)"
        >
          {{ bus }}
        </button>
      </template>
      <span v-else class="text-xs text-gray-500">Aucun bus attribué</span>
    </div>

    <div v-if="followedBus" class="mt-2">
      <button
        class="px-3 py-1 bg-red-600 text-white rounded text-xs"
        @click.prevent="emit('stopFollowing')"
      >
        Arrêter le suivi ({{ followedBus }})
      </button>
    </div>
  </div>
</template>
