<script lang="ts" setup>
import type { Departure } from '~/composables/useStopPanel'

const {
  selectedStopId,
  selectedStopName,
  departures,
  isLoading,
  panelView,
  selectedDeparture,
  isOpen,
  clearStop,
  openLineStops,
  backToDepartures,
} = useStopPanel()

const {
  lineStopsData,
  lineColor,
  displayLineOnly,
  resetFollow,
} = useLineFollow()

const { followBus } = useSocket()

// ── Chargement de la ligne quand on entre dans la vue "arrêts" ────────────
const loadingLine = ref(false)

async function handleDepartureClick(dep: Departure) {
  loadingLine.value = true
  openLineStops(dep) // positionne fitBoundsRequested si localizable
  try {
    await displayLineOnly(dep.route, dep.headsign)
    // Auto-localisation immédiate si données temps réel disponibles
    if (dep.localizable && dep.vehicle) {
      followBus(dep.vehicle)
    }
  } catch (e) {
    console.error('[oukile] failed to load line shape from stop panel', e)
  } finally {
    loadingLine.value = false
  }
}

// ── Liste des arrêts pour la vue "line-stops" ─────────────────────────────
const lineStops = computed(() => {
  if (!lineStopsData.value || !selectedDeparture.value) return []
  const dep = selectedDeparture.value
  const d = lineStopsData.value
  // On cherche la direction dont le nom correspond au headsign du départ
  const useDir1 =
    !d.direction_name_2 ||
    d.direction_name_1 === dep.headsign ||
    (d.direction_name_2 !== dep.headsign)

  // Si aucun nom ne correspond exactement, on essaie une correspondance partielle
  let stops = useDir1 ? d.stops_1 : d.stops_2
  if (
    d.direction_name_2 &&
    d.direction_name_2 === dep.headsign
  ) {
    stops = d.stops_2
  } else if (d.direction_name_1 === dep.headsign) {
    stops = d.stops_1
  }
  return stops
})

const currentStopIndex = computed(() => {
  if (!selectedStopId.value) return -1
  return lineStops.value.findIndex((s) => s.stop_id === selectedStopId.value)
})

// ── Fermeture du panneau ──────────────────────────────────────────────────
function close() {
  if (panelView.value === 'line-stops') {
    resetFollow()
  }
  clearStop()
}

// ── Arrêts précédents collapsibles ───────────────────────────────────────
const showPrevious = ref(false)
watch(selectedDeparture, () => { showPrevious.value = false })

const visibleLineStops = computed(() => {
  if (!lineStops.value.length) return []
  const startIdx = !showPrevious.value && currentStopIndex.value > 0
    ? currentStopIndex.value
    : 0
  return lineStops.value.slice(startIdx).map((stop, loopIdx) => ({
    ...stop,
    absoluteIdx: startIdx + loopIdx,
    loopIdx,
  }))
})

const previousCount = computed(() =>
  showPrevious.value ? 0 : Math.max(0, currentStopIndex.value)
)

// ── Offset navbar ────────────────────────────────────────────────────────
const navbarBottom = ref('60px')

function updateNavbarBottom() {
  if (typeof window === 'undefined') return
  const nav = document.querySelector('.navbar') as HTMLElement | null
  if (nav) {
    const dist = Math.max(0, window.innerHeight - nav.getBoundingClientRect().top)
    navbarBottom.value = `${Math.ceil(dist)}px`
  } else {
    navbarBottom.value = '60px'
  }
}

if (import.meta.client) {
  onMounted(() => {
    updateNavbarBottom()
    window.addEventListener('resize', updateNavbarBottom)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('resize', updateNavbarBottom)
  })
}

// ── Filtre par ligne ─────────────────────────────────────────────────────
const activeRoutes = ref<Set<string>>(new Set())

// Réinitialise le filtre quand on change d'arrêt
watch(selectedStopId, () => { activeRoutes.value = new Set() })

const uniqueRoutes = computed(() => {
  const seen = new Map<string, { route: string; color: string | null }>()
  for (const dep of departures.value) {
    if (!seen.has(dep.route)) seen.set(dep.route, { route: dep.route, color: dep.route_color })
  }
  return [...seen.values()].sort((a, b) => {
    const na = parseInt(a.route), nb = parseInt(b.route)
    if (!isNaN(na) && !isNaN(nb)) return na - nb
    if (!isNaN(na)) return -1
    if (!isNaN(nb)) return 1
    return a.route.localeCompare(b.route)
  })
})

const filteredDepartures = computed(() =>
  activeRoutes.value.size === 0
    ? departures.value
    : departures.value.filter(d => activeRoutes.value.has(d.route))
)

function toggleRoute(route: string) {
  const s = new Set(activeRoutes.value)
  if (s.has(route)) s.delete(route)
  else s.add(route)
  activeRoutes.value = s
}

// ── Helpers d'affichage ───────────────────────────────────────────────────
function formatDelay(seconds: number | null): { label: string; color: string } | null {
  if (seconds === null) return null
  if (Math.abs(seconds) <= 30) return { label: 'À l\'heure', color: 'text-green-600 dark:text-green-400' }
  const abs = Math.abs(seconds)
  const min = Math.floor(abs / 60)
  const sec = abs % 60
  const duration = min > 0 ? `${min} min${sec > 0 ? ` ${sec}s` : ''}` : `${sec}s`
  if (seconds > 0) return { label: `+${duration}`, color: 'text-red-500' }
  return { label: `-${duration}`, color: 'text-green-600 dark:text-green-400' }
}

function routeBadgeStyle(color: string | null) {
  if (!color) return {}
  const c = /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : `#${color}`
  return { backgroundColor: c, color: '#fff' }
}
</script>

<template>
  <Transition
    enter-active-class="transition-transform duration-300 ease-out"
    enter-from-class="translate-y-full"
    enter-to-class="translate-y-0"
    leave-active-class="transition-transform duration-200 ease-in"
    leave-from-class="translate-y-0"
    leave-to-class="translate-y-full"
  >
    <div
      v-if="isOpen"
      class="fixed left-0 right-0 z-10050 flex flex-col"
      :style="{ bottom: navbarBottom, maxHeight: '32vh' }"
    >
      <!-- Bottom sheet -->
      <div class="mx-2 mb-2 overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
           style="display: flex; flex-direction: column; max-height: 100%;">

        <!-- Header -->
        <div class="flex shrink-0 items-center gap-2 border-b border-gray-100 px-4 py-3 dark:border-slate-700">
          <!-- Bouton retour (vue line-stops) -->
          <button
            v-if="panelView === 'line-stops'"
            class="mr-1 rounded-full p-1 hover:bg-gray-100 dark:hover:bg-slate-700"
            aria-label="Retour aux départs"
            @click="() => { backToDepartures(); resetFollow() }"
          >
            <Icon name="mi:arrow-left" class="h-5 w-5" />
          </button>

          <!-- Titre -->
          <div class="flex min-w-0 flex-1 flex-col">
            <template v-if="panelView === 'departures'">
              <span class="truncate text-sm font-bold text-gray-900 dark:text-white">
                {{ selectedStopName }}
              </span>
              <span class="text-xs text-gray-500 dark:text-gray-400">Prochains départs</span>
            </template>
            <template v-else-if="selectedDeparture">
              <div class="flex items-center gap-2">
                <span
                  class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold"
                  :style="routeBadgeStyle(selectedDeparture.route_color)"
                >
                  {{ selectedDeparture.route }}
                </span>
                <span class="truncate text-sm font-bold text-gray-900 dark:text-white">
                  {{ selectedDeparture.headsign }}
                </span>
              </div>
              <span class="text-xs text-gray-500 dark:text-gray-400">
                Arrêts — depuis {{ selectedStopName }}
              </span>
            </template>
          </div>

          <!-- Fermer -->
          <button
            class="rounded-full p-1 hover:bg-gray-100 dark:hover:bg-slate-700"
            aria-label="Fermer"
            @click="close"
          >
            <Icon name="mi:close" class="h-5 w-5" />
          </button>
        </div>

        <!-- Body scrollable -->
        <div class="flex-1 overflow-y-auto overscroll-contain">

          <!-- ── Filtre lignes (vue départs) ── -->
          <div
            v-if="panelView === 'departures' && !isLoading && uniqueRoutes.length > 1"
            class="flex shrink-0 gap-1.5 overflow-x-auto border-b border-gray-100 px-3 py-2 dark:border-slate-700"
            style="scrollbar-width: none;"
          >
            <button
              v-if="activeRoutes.size > 0"
              class="flex h-7 shrink-0 items-center gap-1 rounded-lg border border-gray-300 px-2.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:border-slate-600 dark:text-gray-300 dark:hover:bg-slate-700"
              @click="activeRoutes = new Set()"
            >
              <Icon name="mi:close" class="h-3 w-3" />
              Tout afficher
            </button>
            <button
              v-for="r in uniqueRoutes"
              :key="r.route"
              class="flex h-7 shrink-0 items-center justify-center rounded-lg px-2.5 text-xs font-bold transition-opacity"
              :style="routeBadgeStyle(r.color)"
              :class="[
                r.color ? '' : 'bg-gray-200 text-gray-700 dark:bg-slate-700 dark:text-gray-200',
                activeRoutes.size > 0 && !activeRoutes.has(r.route) ? 'opacity-30' : 'opacity-100'
              ]"
              @click="toggleRoute(r.route)"
            >
              {{ r.route }}
            </button>
          </div>

          <!-- ── Vue départs ── -->
          <template v-if="panelView === 'departures'">
            <!-- Loading -->
            <div v-if="isLoading" class="flex items-center justify-center py-10">
              <svg class="h-6 w-6 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4z"/>
              </svg>
            </div>

            <!-- Empty -->
            <div v-else-if="!filteredDepartures.length" class="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              Aucun départ à venir aujourd'hui
            </div>

            <!-- Liste -->
            <div v-else>
              <!-- Bandeau "Demain" si tous les départs sont du lendemain -->
              <div
                v-if="filteredDepartures[0]?.next_day"
                class="flex items-center gap-2 bg-amber-50 px-4 py-2 dark:bg-amber-950/30"
              >
                <Icon name="mi:clock" class="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                <span class="text-xs font-medium text-amber-700 dark:text-amber-400">Premiers départs demain</span>
              </div>
              <button
                v-for="(dep, i) in filteredDepartures"
                :key="i"
                class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 active:bg-gray-100 dark:hover:bg-slate-800 dark:active:bg-slate-700"
                :class="{ 'border-t border-gray-100 dark:border-slate-800': i > 0 }"
                @click="handleDepartureClick(dep)"
              >
                <!-- Badge ligne -->
                <span
                  class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold shadow-sm"
                  :style="routeBadgeStyle(dep.route_color)"
                  :class="dep.route_color ? '' : 'bg-gray-200 text-gray-700 dark:bg-slate-700 dark:text-gray-200'"
                >
                  {{ dep.route }}
                </span>

                <!-- Headsign + heure -->
                <div class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate text-sm font-semibold text-gray-900 dark:text-white">
                    {{ dep.headsign }}
                  </span>
                  <div class="flex items-center gap-1.5 text-xs">
                    <!-- Heure théorique -->
                    <span
                      class="text-gray-600 dark:text-gray-300"
                      :class="{ 'line-through text-gray-400': dep.estimated_time && dep.estimated_time !== dep.theoretical_time }"
                    >
                      {{ dep.theoretical_time }}
                    </span>
                    <!-- Heure estimée (si différente) -->
                    <span
                      v-if="dep.estimated_time && dep.estimated_time !== dep.theoretical_time"
                      class="font-medium"
                      :class="(dep.delay_seconds ?? 0) > 0 ? 'text-red-500' : 'text-green-600 dark:text-green-400'"
                    >
                      {{ dep.estimated_time }}
                    </span>
                    <!-- Badge retard/avance -->
                    <span
                      v-if="formatDelay(dep.delay_seconds)"
                      class="ml-0.5 text-[10px] font-medium"
                      :class="formatDelay(dep.delay_seconds)!.color"
                    >
                      ({{ formatDelay(dep.delay_seconds)!.label }})
                    </span>
                  </div>
                </div>

                <!-- Indicateur RT + flèche -->
                <div class="flex shrink-0 flex-col items-center gap-1">
                  <span
                    v-if="dep.localizable"
                    class="h-2 w-2 rounded-full bg-green-400"
                    title="Position en temps réel disponible"
                  />
                  <Icon name="mi:chevron-right" class="h-4 w-4 text-gray-400" />
                </div>
              </button>
            </div>
          </template>

          <!-- ── Vue arrêts de la ligne ── -->
          <template v-else-if="panelView === 'line-stops'">
            <div v-if="loadingLine" class="flex items-center justify-center py-10">
              <svg class="h-6 w-6 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4z"/>
              </svg>
            </div>

            <div v-else-if="!lineStops.length" class="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              Liste des arrêts non disponible
            </div>

            <div v-else class="px-4 py-3">
              <!-- Bouton "arrêts précédents" -->
              <button
                v-if="previousCount > 0"
                class="mb-1 flex items-center gap-2 py-1 text-xs text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200"
                @click="showPrevious = true"
              >
                <!-- Ligne pointillée + flèche -->
                <div class="flex w-5 shrink-0 flex-col items-center gap-0.5">
                  <div class="h-1 w-0.5 rounded bg-gray-300 dark:bg-slate-600" />
                  <div class="h-1 w-0.5 rounded bg-gray-300 dark:bg-slate-600" />
                  <div class="h-1 w-0.5 rounded bg-gray-300 dark:bg-slate-600" />
                </div>
                <span>{{ previousCount }} arrêt{{ previousCount > 1 ? 's' : '' }} précédent{{ previousCount > 1 ? 's' : '' }}</span>
                <Icon name="mi:chevron-up" class="h-3 w-3" />
              </button>

              <div
                v-for="stop in visibleLineStops"
                :key="stop.stop_id"
                class="flex items-start gap-3"
              >
                <!-- Ligne verticale + point -->
                <div class="flex w-5 shrink-0 flex-col items-center">
                  <!-- Segment haut -->
                  <div
                    class="w-0.5 flex-1"
                    :class="stop.loopIdx === 0 ? 'invisible' : stop.absoluteIdx <= currentStopIndex ? 'bg-gray-300 dark:bg-slate-600' : ''"
                    :style="stop.absoluteIdx > currentStopIndex && stop.loopIdx !== 0 ? { backgroundColor: lineColor } : {}"
                    style="min-height: 12px;"
                  />
                  <!-- Point -->
                  <div
                    class="z-10 rounded-full border-2"
                    :class="[
                      stop.absoluteIdx === currentStopIndex
                        ? 'h-4 w-4 shadow-md'
                        : stop.absoluteIdx < currentStopIndex
                          ? 'h-2.5 w-2.5 border-gray-300 bg-gray-300 dark:border-slate-600 dark:bg-slate-600'
                          : 'h-3 w-3'
                    ]"
                    :style="stop.absoluteIdx >= currentStopIndex
                      ? { backgroundColor: lineColor, borderColor: stop.absoluteIdx === currentStopIndex ? lineColor : 'white' }
                      : {}"
                  />
                  <!-- Segment bas -->
                  <div
                    class="w-0.5 flex-1"
                    :class="stop.loopIdx === visibleLineStops.length - 1 ? 'invisible' : stop.absoluteIdx < currentStopIndex ? 'bg-gray-300 dark:bg-slate-600' : ''"
                    :style="stop.absoluteIdx >= currentStopIndex && stop.loopIdx !== visibleLineStops.length - 1 ? { backgroundColor: lineColor } : {}"
                    style="min-height: 12px;"
                  />
                </div>

                <!-- Nom de l'arrêt -->
                <div class="flex flex-1 items-center gap-2 py-0.5">
                  <span
                    class="text-sm leading-5"
                    :class="[
                      stop.absoluteIdx === currentStopIndex
                        ? 'font-bold text-gray-900 dark:text-white'
                        : stop.absoluteIdx < currentStopIndex
                          ? 'text-gray-400 dark:text-slate-500'
                          : 'text-gray-700 dark:text-gray-200'
                    ]"
                  >
                    {{ stop.stop_name }}
                  </span>
                  <span
                    v-if="stop.absoluteIdx === currentStopIndex"
                    class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white"
                    :style="{ backgroundColor: lineColor }"
                  >
                    Vous êtes ici
                  </span>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Transition>
</template>
