<script lang="ts" setup>
  const route = useRoute()
  const geojsonData = ref<GeoJSON.GeoJsonObject | null>(null)

  // état de suivi / sens
  const selectedLine = ref<string | null>(null)
  const followActive = ref(false)
  const directionKeys = ref<string[]>([])
  const directionMap = ref<Record<string, GeoJSON.Feature[]>>({})
  const currentDirection = ref<string | null>(null)

  // charge et regroupe les features par "sens"
  async function loadLineShape(lineName: string) {
    try {
      const data = await $fetch<GeoJSON.GeoJsonObject>(
        `https://oukile.b-cdn.net/shapes/${lineName}.geojson`,
        { responseType: 'json' }
      )
      geojsonData.value = data
      selectedLine.value = lineName
      followActive.value = true

      // regroupe par clé trouvée dans properties
      const map: Record<string, GeoJSON.Feature[]> = {}
      if ((data as any)?.type === 'FeatureCollection' && (data as any).features) {
        for (const f of (data as any).features as GeoJSON.Feature[]) {
          const p: any = (f as any).properties || {}
          const key =
            p.direction_id ?? p.direction ?? p.dir ?? p.trip_headsign ?? p.headsign ?? p.name ?? 'default'
          if (!map[key]) map[key] = []
          map[key].push(f)
        }
      } else {
        // si ce n'est pas une FeatureCollection, tout dans un seul groupe
        map['default'] = [data as unknown as GeoJSON.Feature]
      }

      directionMap.value = map
      directionKeys.value = Object.keys(map)
      currentDirection.value = directionKeys.value[0] ?? null
    } catch (e) {
      console.error('Impossible de charger le tracé GeoJSON :', e)
      geojsonData.value = null
      selectedLine.value = null
      followActive.value = false
      directionKeys.value = []
      directionMap.value = {}
      currentDirection.value = null
    }
  }

  const initialLine = route.query.line as string | undefined
  if (initialLine) {
    await loadLineShape(initialLine)
  }

  watch(
    () => route.query.line,
    (newLine) => {
      if (newLine) loadLineShape(newLine as string)
      else {
        geojsonData.value = null
        selectedLine.value = null
        followActive.value = false
        directionKeys.value = []
        directionMap.value = {}
        currentDirection.value = null
      }
    }
  )

  // computed: GeoJSON filtré selon le sens courant
  const filteredGeojson = computed<GeoJSON.GeoJsonObject | null>(() => {
    if (!geojsonData.value) return null
    const data = geojsonData.value as any
    if (data.type === 'FeatureCollection') {
      const key = currentDirection.value
      if (!key) return null
      const feats = directionMap.value[key] ?? []
      return { ...data, features: feats }
    }
    return geojsonData.value
  })

  function reverseDirection() {
    if (directionKeys.value.length < 2) return
    const idx = directionKeys.value.indexOf(currentDirection.value ?? '')
    const next = (directionKeys.value[(idx + 1) % directionKeys.value.length] ?? directionKeys.value[0]) as string
    currentDirection.value = next
  }

  function stopFollow() {
    geojsonData.value = null
    selectedLine.value = null
    followActive.value = false
    currentDirection.value = null
  }

  const displayDirectionLabel = computed(() => {
    if (!currentDirection.value) return ''
    // tente d'extraire un headsign depuis la première feature
    const feats = directionMap.value[currentDirection.value] ?? []
    if (feats.length > 0) {
      const p: any = (feats[0] as any).properties || {}
      return (p.trip_headsign ?? p.headsign ?? currentDirection.value).toString()
    }
    return currentDirection.value
  })
</script>

<template>
  <div class="h-full">
    <LMap
      ref="map"
      style="height: 100%"
      :zoom="12"
      :center="[47.083328, 2.4]"
      :use-global-leaflet="false"
    >
      <LTileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&amp;copy; <a href=&quot;https://www.openstreetmap.org/&quot;>OpenStreetMap</a> contributors"
        layer-type="base"
        name="OpenStreetMap"
      />

      <!-- Tracé GeoJSON de la ligne sélectionnée (sens filtré) -->
      <LGeoJson
        v-if="filteredGeojson"
        :geojson="filteredGeojson"
        :options="{ style: { color: '#2563eb', weight: 4, opacity: 0.85 } }"
      />
    </LMap>
  </div>

  <!-- Barre de suivi en bas -->
  <div v-if="followActive && selectedLine && currentDirection" class="fixed left-4 right-4" style="bottom: calc(env(safe-area-inset-bottom) + 80px); z-index: 10050; pointer-events: auto;">
    <div class="bg-white/90 dark:bg-slate-800 rounded-xl shadow p-3 flex items-center justify-between" style="position:relative; z-index:10051;">
      <div class="flex flex-col">
        <div class="text-sm font-semibold">Suivi de la ligne {{ selectedLine }}</div>
        <div class="text-xs text-gray-600 dark:text-gray-300">Direction {{ displayDirectionLabel }}</div>
      </div>

      <div class="flex items-center gap-2">
        <button @click="reverseDirection" class="px-3 py-1 bg-blue-600 text-white rounded">Inverser</button>
        <button @click="stopFollow" class="px-3 py-1 border rounded">Arrêter</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
</style>