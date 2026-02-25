<template>
  <nav class="navbar fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 dark:bg-gray-900 dark:border-gray-800" style="z-index:10060;">
    <ul class="nav-list mx-auto max-w-xl flex justify-between px-4 py-2">
      <li v-for="(item, index) in items" :key="item.name" class="flex-1">
        <button
          class="w-full flex flex-col items-center text-xs text-gray-600 dark:text-gray-300 focus:outline-none"
          :class="{ 'text-primary-600': active === item.name }
          "
          @click="onClick(item)">
          <span class="icon mb-1"> <Icon :name="item.icon" class="h-6 w-6" /> </span>
          <span class="label">{{ item.label }}</span>
        </button>
      </li>
    </ul>
  </nav>
</template>

<script setup lang="ts">
const route = useRoute()
const router = useRouter()

const items = [
  { name: 'index', label: 'Carte', icon: `codicon:map-filled` },
  { name: 'lines', label: 'Lignes', icon: `fa7-solid:map-signs` },
  // { name: 'bus', label: 'Bus', icon: `fa7-solid:bus` },
  { name: 'alerts', label: 'Alertes', icon: `fa7-solid:warning` }
]

const active = computed(() => route.name as string)

function onClick(item: { name: string }) {
  router.push({ name: item.name })
}
</script>

<style scoped>
.navbar { box-shadow: 0 -1px 0 rgba(0,0,0,0.04); }
.nav-list .icon svg { width: 1.5rem; height: 1.5rem; }
.text-primary-600 { color: #2563eb !important; }

/* Desktop: position relative and centered nav */
@media (min-width: 768px) {
  .navbar { position: static; border-top: none; background: transparent; }
  .nav-list { justify-content: center; }
  .nav-list li { max-width: 160px; }
}
</style>
