<script lang="ts" setup>
const route = useRoute()

const {
  selectedLine,
  followActive,
  currentDirection,
  displayDirectionLabel,
  attributions,
  loadLineShape,
  reverseDirection,
  stopFollow,
} = useLineFollow()

// ── Chargement initial depuis la query ────────────────────────────────────
const initialLine = route.query.line as string | undefined
if (initialLine) {
  await loadLineShape(initialLine)
}

watch(
  () => route.query.line,
  (newLine) => {
    if (newLine) loadLineShape(newLine as string)
    else stopFollow()
  }
)

// ── Position de la barre de suivi (au-dessus de la navbar) ────────────────
const followBottom = ref(`calc(env(safe-area-inset-bottom) + 76px)`)

function updateFollowBottom() {
  try {
    const nav = document.querySelector('.navbar') as HTMLElement | null
    if (nav) {
      const dist = Math.max(0, window.innerHeight - nav.getBoundingClientRect().top)
      const px = Math.min(Math.max(Math.ceil(dist + 16), 12), Math.round(window.innerHeight * 0.4))
      followBottom.value = `${px}px`
    } else {
      followBottom.value = `calc(env(safe-area-inset-bottom) + 76px)`
    }
  } catch {
    followBottom.value = `calc(env(safe-area-inset-bottom) + 76px)`
  }
}

if (import.meta.client) {
  onMounted(() => {
    updateFollowBottom()
    window.addEventListener('resize', updateFollowBottom)

    const nav = document.querySelector('.navbar') as HTMLElement | null
    if (nav && typeof MutationObserver !== 'undefined') {
      const mo = new MutationObserver(updateFollowBottom)
      mo.observe(nav, { attributes: true, childList: true, subtree: true })
      ;(nav as any).__followMo = mo
    }
  })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', updateFollowBottom)
    const nav = document.querySelector('.navbar') as HTMLElement | null
    if (nav && (nav as any).__followMo) {
      try { (nav as any).__followMo.disconnect() } catch {}
      ;(nav as any).__followMo = null
    }
  })
}
</script>

<template>
  <div class="h-full">
    <HomeMap />
  </div>

  <LineFollowBar
    v-if="followActive && selectedLine && currentDirection"
    :selected-line="selectedLine"
    :direction-label="displayDirectionLabel"
    :follow-bottom="followBottom"
    @reverse="reverseDirection"
    @stop="stopFollow"
  >
    <BusAttributionPanel
      :bus-list="attributions[selectedLine] ?? []"
    />
  </LineFollowBar>
</template>
