/**
 * Gestion du suivi d'une ligne de bus :
 * chargement du GeoJSON, regroupement par direction, filtre d'arrêts, attributions.
 */

export type LineStop = {
  stop_id: string
  stop_name: string
  stop_lat: number
  stop_lon: number
}

export type LineData = {
  direction_name_1: string | null
  direction_name_2: string | null
  stops_1: LineStop[]
  stops_2: LineStop[]
  route_color?: string | null
}

export function useLineFollow() {
  const { subscribeBusesForLine, unsubscribeAllBuses } = useSocket()

  const geojsonData = useState<GeoJSON.GeoJsonObject | null>('geojsonData', () => null)
  const selectedLine = useState<string | null>('selectedLine', () => null)
  const followActive = useState<boolean>('followActive', () => false)
  const directionKeys = useState<string[]>('directionKeys', () => [])
  const directionMap = useState<Record<string, GeoJSON.Feature[]>>('directionMap', () => ({}))
  const currentDirection = useState<string | null>('currentDirection', () => null)
  const lineColor = useState<string>('lineColor', () => '#2563eb')
  const lineStopsData = useState<LineData | null>('lineStopsData', () => null)
  
  // CORRECTION : On utilise un Array au lieu d'un Set pour éviter les soucis de sérialisation Nuxt
  const lineStopIds = useState<string[] | null>('lineStopIds', () => null)
  
  const attributions = useState<Record<string, string[]>>('attributions', () => ({}))

  // Callback pour déclencher un refresh des marqueurs depuis onMapReady
  const onRefreshMarkers = useState<(() => void) | null>('onRefreshMarkers', () => null)

  // Headsign GTFS du sens courant.
  // Priorité : propriétés GeoJSON → direction_name de la DB (network table).
  // Les shapes GeoJSON n'incluent généralement pas trip_headsign, d'où le fallback DB.
  const currentHeadsign = computed<string | null>(() => {
    if (!currentDirection.value) return null
    // 1. Propriétés GeoJSON (si le fichier les inclut)
    const feats = directionMap.value[currentDirection.value] ?? []
    if (feats.length) {
      const p: any = (feats[0] as any).properties || {}
      const h = p.trip_headsign ?? p.headsign ?? null
      if (h) return h
    }
    // 2. Fallback : direction_name depuis la DB (même valeur que trip_headsign dans GTFS)
    if (lineStopsData.value) {
      const idx = directionKeys.value.indexOf(currentDirection.value)
      if (idx === 0) return lineStopsData.value.direction_name_1 ?? null
      if (idx === 1) return lineStopsData.value.direction_name_2 ?? null
    }
    return null
  })

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

  const displayDirectionLabel = computed(() => {
    if (!currentDirection.value) return ''
    if (lineStopsData.value) {
      const idx = directionKeys.value.indexOf(currentDirection.value)
      if (idx === 0 && lineStopsData.value.direction_name_1) return lineStopsData.value.direction_name_1
      if (idx === 1 && lineStopsData.value.direction_name_2) return lineStopsData.value.direction_name_2
    }
    const feats = directionMap.value[currentDirection.value] ?? []
    if (feats.length > 0) {
      const p: any = (feats[0] as any).properties || {}
      return (p.trip_headsign ?? p.headsign ?? currentDirection.value).toString()
    }
    return currentDirection.value
  })

  function applyLineStopFilter() {
    if (!lineStopsData.value || !currentDirection.value) {
      lineStopIds.value = null
      onRefreshMarkers.value?.()
      return
    }
    const d = lineStopsData.value
    const idx = directionKeys.value.indexOf(currentDirection.value)
    let ids: Set<string>
    if (idx === 0) {
      ids = new Set(d.stops_1.map((s) => s.stop_id))
    } else if (idx === 1) {
      ids = new Set(d.stops_2.map((s) => s.stop_id))
    } else {
      ids = new Set([...d.stops_1, ...d.stops_2].map((s) => s.stop_id))
    }
    
    // CORRECTION : On transforme le Set en tableau avant de l'assigner au state
    lineStopIds.value = Array.from(ids)

    try {
      onRefreshMarkers.value?.()
    } catch (e) {
      console.error('[oukile] Error refreshing markers in applyLineStopFilter', e)
    }
  }

  async function fetchAndSubscribeAttributions(lineName: string, headsign?: string | null) {
    const url = headsign
      ? `/api/attributions/${encodeURIComponent(lineName)}?headsign=${encodeURIComponent(headsign)}`
      : `/api/attributions/${encodeURIComponent(lineName)}`
    const buses = (await $fetch<string[]>(url)) || []
    attributions.value = { [lineName]: buses }
    unsubscribeAllBuses()
    await subscribeBusesForLine(buses)
  }

  async function loadLineShape(lineName: string) {
    try {
      const [data, lineData] = await Promise.all([
        $fetch<GeoJSON.GeoJsonObject>(
          `https://oukile.b-cdn.net/shapes/${lineName}.geojson`,
          { responseType: 'json' }
        ),
        $fetch<LineData>(`/api/lines/${lineName}`).catch(() => null)
      ])

      lineColor.value = lineData?.route_color ? `#${lineData.route_color}` : '#2563eb'
      lineStopsData.value = lineData ?? null
      geojsonData.value = data
      selectedLine.value = lineName
      followActive.value = true

      // Regroupe les features par sens
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
        map['default'] = [data as unknown as GeoJSON.Feature]
      }

      directionMap.value = map
      directionKeys.value = Object.keys(map)
      currentDirection.value = directionKeys.value[0] ?? null
      applyLineStopFilter()

      // Attributions et abonnement socket (filtrés par direction dès le départ)
      try {
        await fetchAndSubscribeAttributions(lineName, currentHeadsign.value)
      } catch (e) {
        console.error('[oukile] failed to load attributions for line', lineName, e)
      }
    } catch (e) {
      console.error('[oukile] impossible de charger le tracé GeoJSON :', e)
      resetFollow()
    }
  }

  async function reverseDirection() {
    if (directionKeys.value.length < 2) return
    const idx = directionKeys.value.indexOf(currentDirection.value ?? '')
    const next = directionKeys.value[(idx + 1) % directionKeys.value.length] ?? directionKeys.value[0]
    currentDirection.value = next ?? null
    applyLineStopFilter()
    if (selectedLine.value) {
      try {
        await fetchAndSubscribeAttributions(selectedLine.value, currentHeadsign.value)
      } catch (e) {
        console.error('[oukile] failed to update attributions on direction change', e)
      }
    }
  }

  function resetFollow() {
    geojsonData.value = null
    selectedLine.value = null
    followActive.value = false
    directionKeys.value = []
    directionMap.value = {}
    currentDirection.value = null
    lineStopsData.value = null
    lineStopIds.value = null
    lineColor.value = '#2563eb'
    onRefreshMarkers.value?.()
  }

  function stopFollow() {
    resetFollow()
    unsubscribeAllBuses()
  }

  return {
    // état
    geojsonData,
    selectedLine,
    followActive,
    directionKeys,
    currentDirection,
    lineColor,
    lineStopsData,
    lineStopIds,
    attributions,
    onRefreshMarkers,
    // computed
    filteredGeojson,
    displayDirectionLabel,
    currentHeadsign,
    // actions
    loadLineShape,
    reverseDirection,
    stopFollow,
    applyLineStopFilter,
  }
}