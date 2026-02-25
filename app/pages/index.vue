<script lang="ts" setup>
import { ref } from 'vue';
// socket.io client import lazy-loaded in client-only code

const map = ref(null) as any;

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const geojsonData = ref<GeoJSON.GeoJsonObject | null>(null)

// état de suivi / sens
const selectedLine = ref<string | null>(null)
const followActive = ref(false)
const directionKeys = ref<string[]>([])
const directionMap = ref<Record<string, GeoJSON.Feature[]>>({})
const currentDirection = ref<string | null>(null)
const lineColor = ref<string>('#2563eb')

// stops de la ligne sélectionnée par direction (chargés depuis /api/stops/line/[id])
type LineStop = { stop_id: string; stop_name: string; stop_lat: number; stop_lon: number }
const lineStopsData = ref<{ direction_name_1: string | null; stops_1: LineStop[]; direction_name_2: string | null; stops_2: LineStop[] } | null>(null)

// IDs des arrêts de la ligne/direction sélectionnée (null = pas de filtre, tous les arrêts)
const lineStopIds = ref<Set<string> | null>(null)

// Attributions (lues depuis l'API /api/attributions)
const attributions = ref<Record<string, string[]>>({})
// socket instance (single per page)
let socket: any = null
const followedBus = ref<string | null>(null)
// rooms currently joined (bus IDs)
const joinedRooms = new Set<string>()

// callback exposé pour que onMapReady puisse déclencher un refresh depuis l'extérieur
let _refreshMarkers: (() => void) | null = null

// met à jour lineStopIds selon la direction courante
function applyLineStopFilter() {
  if (!lineStopsData.value || !currentDirection.value) {
    lineStopIds.value = null
    _refreshMarkers?.()
    return
  }
  const d = lineStopsData.value
  // direction_id 0 → direction_name_1 / stops_1
  // direction_id 1 → direction_name_2 / stops_2
  // On compare la clé courante (direction_id en string) à l'index dans directionKeys
  const idx = directionKeys.value.indexOf(currentDirection.value)
  let ids: Set<string>
  if (idx === 0) {
    ids = new Set(d.stops_1.map(s => s.stop_id))
  } else if (idx === 1) {
    ids = new Set(d.stops_2.map(s => s.stop_id))
  } else {
    // fallback : tous les stops des deux directions
    ids = new Set([...d.stops_1, ...d.stops_2].map(s => s.stop_id))
  }
  lineStopIds.value = ids
  _refreshMarkers?.()
}

// charge et regroupe les features par "sens"
async function loadLineShape(lineName: string) {
  try {
    // Charger le GeoJSON et la couleur en parallèle
    const [data, lineData] = await Promise.all([
      $fetch<GeoJSON.GeoJsonObject>(
        `https://oukile.b-cdn.net/shapes/${lineName}.geojson`,
        { responseType: 'json' }
      ),
      $fetch(`/api/lines/${lineName}`).catch(() => null) as Promise<any>
    ])

  // Appliquer la couleur AVANT d'exposer le GeoJSON au template
  lineColor.value = lineData?.route_color ? `#${lineData.route_color}` : '#2563eb'
  lineStopsData.value = lineData

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

    applyLineStopFilter()
    // Charger les attributions pour cette ligne uniquement
    try {
      const attrib = await $fetch(`/api/attributions/${encodeURIComponent(lineName)}`)
      attributions.value = { [lineName]: (attrib as any) || [] }
      console.log('[oukile] attributions for line', lineName, attributions.value)
      // unsubscribe previous buses then join the new ones
      unsubscribeAllBuses()
      await subscribeBusesForLine(lineName)
    } catch (e) {
      console.error('Failed to load attributions for line', lineName, e)
    }
  } catch (e) {
    console.error('Impossible de charger le tracé GeoJSON :', e)
    geojsonData.value = null
    selectedLine.value = null
    followActive.value = false
    directionKeys.value = []
    directionMap.value = {}
    currentDirection.value = null
    lineStopsData.value = null
    lineStopIds.value = null
    lineColor.value = '#2563eb'
    _refreshMarkers?.()
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
      lineStopsData.value = null
      lineStopIds.value = null
        // unsubscribe from any bus rooms when the user leaves the line view
        try { unsubscribeAllBuses() } catch (e) {}
        _refreshMarkers?.()
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
  applyLineStopFilter()
}

function stopFollow() {
  geojsonData.value = null
  selectedLine.value = null
  followActive.value = false
  currentDirection.value = null
  lineStopsData.value = null
  lineStopIds.value = null
  lineColor.value = '#2563eb'
  _refreshMarkers?.()
  // unsubscribe from all bus rooms
  try { unsubscribeAllBuses() } catch (e) {}
  // fully disconnect socket to avoid residual connections / automatic reconnection
  try {
    if (socket) {
      try { socket.disconnect() } catch (e) {}
      socket = null
    }
  } catch (e) {}
}

const displayDirectionLabel = computed(() => {
  if (!currentDirection.value) return ''
  // Priorité : noms de direction issus de la table network (direction_name_1 / direction_name_2)
  if (lineStopsData.value) {
    const idx = directionKeys.value.indexOf(currentDirection.value)
    if (idx === 0 && lineStopsData.value.direction_name_1) return lineStopsData.value.direction_name_1
    if (idx === 1 && lineStopsData.value.direction_name_2) return lineStopsData.value.direction_name_2
  }
  // Fallback : headsign depuis la première feature GeoJSON
  const feats = directionMap.value[currentDirection.value] ?? []
  if (feats.length > 0) {
    const p: any = (feats[0] as any).properties || {}
    return (p.trip_headsign ?? p.headsign ?? currentDirection.value).toString()
  }
  return currentDirection.value
})

// stops
const stops = ref<Array<{ stop_id: string; stop_name: string; stop_lat: number; stop_lon: number }>>([])
async function loadStops() {
  try {
    const data = await $fetch('/api/stops')
    stops.value = (data as any) || []
  } catch (e) {
    console.error('Failed to load stops', e)
    stops.value = []
  }
}

// locations array (for marker helpers) and location map (by stop_id)
const locations = computed(() =>
  stops.value.map((s) => ({
    id: s.stop_id,
    name: s.stop_name,
    lat: s.stop_lat,
    // accept both stop_lon and stop_long if present
    lng: (s as any).stop_lon ?? (s as any).stop_long ?? 0
  }))
)

const location = computed(() => {
  const m = new Map<string, { name: string; lat: number; lng: number }>()
  for (const s of stops.value) {
    m.set(s.stop_id, { name: s.stop_name, lat: s.stop_lat, lng: (s as any).stop_lon ?? (s as any).stop_long ?? 0 })
  }
  return m
})

// how much to expand the current viewport when deciding to preload markers
// 1.0 = 100% (one screen extra in each direction). Increase to reduce "pop" when panning.
const PRELOAD_PAD = 1.5

const onMapReady = async (maybeMap?: any) => {
  // Import Leaflet dynamically to avoid SSR issues (window is not defined server-side)
  const L = await import('leaflet').then(m => m.default ?? m)

  // Bounding box for Bourges area (built client-side only)
  const BOURGES_BOUNDS = L.latLngBounds(
    L.latLng(46.88, 2.0), // southwest (lat, lng)
    L.latLng(47.28, 2.8)  // northeast (lat, lng)
  )

  // try to obtain the actual Leaflet map instance from the event arg or the component ref
  let leafletMap: any = null
  if (maybeMap && typeof maybeMap.getZoom === 'function') {
    leafletMap = maybeMap
  } else if (maybeMap && (maybeMap.mapObject || maybeMap._map || maybeMap.map)) {
    leafletMap = maybeMap.mapObject || maybeMap._map || maybeMap.map
  } else {
    const mapComponent = map.value
    leafletMap = mapComponent?.mapObject || mapComponent?._map || mapComponent?.map
  }

  if (!leafletMap) {
    console.warn('Leaflet instance not found on map ref')
    return
  }

  // enforce max bounds so users can't pan too far from Bourges
  try {
    // setMaxBounds will limit the view; also set a padded maxBoundsViscosity for smoother edge behavior
    if (typeof leafletMap.setMaxBounds === 'function') {
      leafletMap.setMaxBounds(BOURGES_BOUNDS)
      // a viscosity value closer to 1 will make the bounds 'sticky'
      leafletMap.options.maxBoundsViscosity = 0.9
    }
  } catch (e) {
    console.warn('Failed to apply max bounds to map', e)
  }

  // Prevent huge zoom-outs (giga dezooms) and limit zoom range
  try {
    if (typeof leafletMap.setMinZoom === 'function') leafletMap.setMinZoom(10)
    if (typeof leafletMap.setMaxZoom === 'function') leafletMap.setMaxZoom(18)
  } catch (e) {
    console.warn('Failed to apply zoom limits', e)
  }

  try {
    // dynamic import to avoid SSR issues
    // @ts-ignore: leaflet.markercluster has no types in this repo
    await import('leaflet.markercluster')
  } catch (e) {
    console.error('Failed to import leaflet.markercluster', e)
    return
  }

  // ensure stops are loaded before creating markers
  try {
    await loadStops()
  } catch (e) {
    // loadStops handles its own errors
  }

  // create cluster group with less aggressive clustering
  const clusterOptions = {
    maxClusterRadius: 36,
    spiderfyOnMaxZoom: true,
    disableClusteringAtZoom: 14,
    chunkedLoading: true,
    showCoverageOnHover: false
  }

  const cluster = (L as any).markerClusterGroup ? (L as any).markerClusterGroup(clusterOptions) : (window as any).L?.markerClusterGroup?.(clusterOptions)
  if (!cluster) {
    console.error('markerClusterGroup not available')
    return
  }

  // Layer group dédié aux stops de ligne (pas de clustering, toujours visible)
  // Ne pas l'ajouter à la carte tout de suite : il sera (ré)ajouté après le tracé GeoJSON
  const lineLayer = L.layerGroup()

  // Layer dédié aux véhicules (marqueurs qui bougent)
  const vehicleLayer = L.layerGroup()
  // map of busID -> marker
  const busMarkers = new Map<string, any>()

  function addOrUpdateBusMarker(busID: string, lat: number, lng: number, info: any = {}) {
    if (typeof lat !== 'number' || typeof lng !== 'number') return
    const key = busID
    const existing = busMarkers.get(key)
    if (existing) {
      try {
        existing.setLatLng([lat, lng])
        if (info && info.popup) existing.getPopup().setContent(info.popup)
      } catch (e) {
        console.error('Failed to update marker', e)
      }
    } else {
      try {
        const m = L.marker([lat, lng], { riseOnHover: true })
        const popupContent = info.popup || `<strong>${busID}</strong>`
        m.bindPopup(popupContent)
        vehicleLayer.addLayer(m)
        busMarkers.set(key, m)
      } catch (e) {
        console.error('Failed to create marker', e)
      }
    }
  }

  function clearBusMarkersNotIn(allowed: string[] = []) {
    const keep = new Set(allowed)
    for (const [id, marker] of busMarkers.entries()) {
      if (!keep.has(id)) {
        try { vehicleLayer.removeLayer(marker) } catch (e) {}
        try { marker.remove() } catch (e) {}
        busMarkers.delete(id)
      }
    }
  }


  // virtualization: create markers lazily and only add to cluster when inside extended bounds
  const markerPool = new Map<string, any>()
  const added = new Set<string>()        // dans cluster
  const addedLine = new Set<string>()   // dans lineLayer

  function createMarkerFor(loc: { id: string; name: string; lat: number; lng: number }, isLine = false) {
    let m: any
    if (isLine) {
      m = (L as any).circleMarker([loc.lat, loc.lng], {
        radius: 6,
        color: '#ffffff',
        weight: 2,
        fillColor: lineColor.value,
        fillOpacity: 1
      })
    } else {
      m = L.marker([loc.lat, loc.lng])
    }
    m.bindPopup(`<strong>${loc.name}</strong>`)
    markerPool.set(loc.id, m)
    return m
  }

  function updateVisibleMarkers() {
    try {
      const bounds = leafletMap.getBounds()
      // expand bounds by PRELOAD_PAD (e.g. 1.2 = preload one full screen + 20%) to reduce marker pop
      const extended = bounds.pad(PRELOAD_PAD)

      // If the map has maxBounds set, ensure we refuse to load markers far outside Bourges
      // We'll compute a conservative check against BOURGES_BOUNDS to avoid adding markers outside
      const allowedBounds = BOURGES_BOUNDS

      // When a line is selected, only show its stops (no clustering, ignore viewport virtualization)
      const lineFilter = lineStopIds.value

      for (const loc of locations.value) {
        if (typeof loc.lat !== 'number' || typeof loc.lng !== 'number') continue
        const key = loc.id
        const latlng = L.latLng(loc.lat, loc.lng)

        // if this location is outside the allowed (Bourges) bounds, skip it entirely
        if (!allowedBounds.contains(latlng)) {
          if (added.has(key)) {
            const m = markerPool.get(key)
            try { cluster.removeLayer(m) } catch (e) {}
            added.delete(key)
          }
          if (addedLine.has(key)) {
            const m = markerPool.get(key)
            try { lineLayer.removeLayer(m) } catch (e) {}
            addedLine.delete(key)
          }
          continue
        }

        // When a line is active: stops de la ligne → lineLayer (sans cluster)
        if (lineFilter !== null) {
          const shouldShow = lineFilter.has(key)

          // retirer du cluster si présent
          if (added.has(key)) {
            const m = markerPool.get(key)
            try { cluster.removeLayer(m) } catch (e) {}
            added.delete(key)
          }

          if (shouldShow) {
            if (!addedLine.has(key)) {
              // Supprimer l'éventuel marqueur standard du pool pour recréer un circleMarker
              if (markerPool.has(key)) {
                const old = markerPool.get(key)
                try { cluster.removeLayer(old) } catch (e) {}
                markerPool.delete(key)
              }
              const m = createMarkerFor(loc, true)
              lineLayer.addLayer(m)
              addedLine.add(key)
            }
          } else {
            if (addedLine.has(key)) {
              const m = markerPool.get(key)
              try { lineLayer.removeLayer(m) } catch (e) {}
              addedLine.delete(key)
            }
          }
          continue
        }

        // Mode normal : vider lineLayer, virtualisation par viewport dans le cluster
        if (addedLine.has(key)) {
          const m = markerPool.get(key)
          try { lineLayer.removeLayer(m) } catch (e) {}
          addedLine.delete(key)
          // Supprimer du pool : c'est un circleMarker, il faut un marker standard pour le cluster
          markerPool.delete(key)
        }

        const inView = extended.contains(latlng)
        if (inView) {
          if (!added.has(key)) {
            const m = markerPool.get(key) ?? createMarkerFor(loc)
            cluster.addLayer(m)
            added.add(key)
          }
        } else {
          if (added.has(key)) {
            const m = markerPool.get(key)
            try { cluster.removeLayer(m) } catch (e) {}
            added.delete(key)
          }
        }
      }
    } catch (e) {
      console.error('updateVisibleMarkers error', e)
    }
  }

  // initial fill and listeners
  updateVisibleMarkers()
  leafletMap.on('moveend zoomend', updateVisibleMarkers)

  // expose so that loadLineShape / stopFollow can trigger a refresh
  _refreshMarkers = updateVisibleMarkers

  // attach cluster to map
  leafletMap.addLayer(cluster)
  // add vehicle layer above cluster so vehicles are always visible
  leafletMap.addLayer(vehicleLayer)

  // --- Tracé GeoJSON géré nativement (LGeoJson ignore les changements d'options) ---
  let geojsonLayer: any = null

  function redrawGeojson() {
    if (geojsonLayer) {
      try { leafletMap.removeLayer(geojsonLayer) } catch (e) {}
      geojsonLayer = null
    }
    // Retirer temporairement lineLayer pour le remettre au-dessus du tracé
    try { leafletMap.removeLayer(lineLayer) } catch (e) {}

    const gj = filteredGeojson.value
    if (!gj) {
      // Pas de tracé : remettre lineLayer quand même (peut être vide)
      leafletMap.addLayer(lineLayer)
      return
    }
    geojsonLayer = (L as any).geoJSON(gj, {
      style: { color: lineColor.value, weight: 4, opacity: 0.85 }
    })
    geojsonLayer.addTo(leafletMap)
    // lineLayer par-dessus le tracé
    leafletMap.addLayer(lineLayer)
  }

  // Réagir aux changements de GeoJSON filtré ou de couleur
  watch([filteredGeojson, lineColor], () => {
    // Mettre à jour la couleur des circleMarkers existants dans la lineLayer
    for (const key of addedLine) {
      const m = markerPool.get(key)
      if (m && typeof m.setStyle === 'function') {
        m.setStyle({ fillColor: lineColor.value })
      }
    }
    redrawGeojson()
  }, { immediate: true })

  // Listen to bus location events dispatched by socket handler
  function onBusLocationEvent(e: Event) {
    try {
      const payload = (e as CustomEvent).detail
      if (!payload) return
      const { busID, lat, lng, ts } = payload

      // If no shapes are displayed, don't show all buses.
      // Only accept updates if the user explicitly follows a bus (followedBus)
      if (!geojsonData.value) {
        // keep only the explicitly followed bus (if any), otherwise clear all
        const keep = followedBus.value ? [followedBus.value] : []
        try { clearBusMarkersNotIn(keep) } catch (e) {}
        if (!followedBus.value || followedBus.value !== busID) return
      }

      // only show buses that belong to the currently selected line (if any)
      if (selectedLine.value) {
        const list = attributions.value?.[selectedLine.value] ?? []
        if (!list || !list.includes(busID)) return
      }
      // update/create marker
      addOrUpdateBusMarker(busID, Number(lat), Number(lng), { popup: `<strong>${busID}</strong><br/>${ts ?? ''}` })
      // If user follows this bus, center map on it
      if (followedBus.value === busID) {
        try { leafletMap.panTo([Number(lat), Number(lng)]) } catch (e) {}
      }
    } catch (err) {
      console.error('onBusLocationEvent error', err)
    }
  }

  window.addEventListener('oukile:bus-location', onBusLocationEvent)

  // When selectedLine changes, cleanup markers not belonging to that line
  watch(selectedLine, (newLine) => {
    const allowed = newLine ? (attributions.value?.[newLine] ?? []) : []
    clearBusMarkersNotIn(allowed)
  })

  // Global watcher: whenever we stop displaying a line (either selectedLine cleared or follow disabled),
  // ensure we unsubscribe from all WS rooms to avoid residual subscriptions.
  watch([selectedLine, followActive], ([newSelected, newFollow]) => {
    if (!newSelected || !newFollow) {
      try { unsubscribeAllBuses() } catch (e) {}
    }
  })

  // If the GeoJSON shapes are removed (geojsonData falsy), ensure we unsubscribe as well.
  watch(geojsonData, (val) => {
    if (!val) {
      try { unsubscribeAllBuses() } catch (e) {}
      // also clear any vehicle markers that are not explicitly followed
      try { clearBusMarkersNotIn(followedBus.value ? [followedBus.value] : []) } catch (e) {}
    }
  })

  // cleanup on unmount
  onBeforeUnmount(() => {
    try { leafletMap.off('moveend zoomend', updateVisibleMarkers) } catch (e) {}
    try { leafletMap.removeLayer(cluster) } catch (e) {}
    try { leafletMap.removeLayer(lineLayer) } catch (e) {}
    if (geojsonLayer) try { leafletMap.removeLayer(geojsonLayer) } catch (e) {}
    try { window.removeEventListener('oukile:bus-location', onBusLocationEvent) } catch (e) {}
    try { leafletMap.removeLayer(vehicleLayer) } catch (e) {}
    _refreshMarkers = null
  })
}

// bottom dynamique en fonction de la hauteur réelle de la navbar
const followBottom = ref<string>(`calc(env(safe-area-inset-bottom) + 76px)`)

function updateFollowBottom() {
  try {
    const nav = document.querySelector('.navbar') as HTMLElement | null
    const extra = 16
    if (nav) {
      const rect = nav.getBoundingClientRect()
      const distanceFromBottom = Math.max(0, window.innerHeight - rect.top)
      let px = Math.ceil(distanceFromBottom + extra)
      const maxPx = Math.round(window.innerHeight * 0.4)
      const minPx = 12
      if (px < minPx) px = minPx
      if (px > maxPx) px = maxPx
      followBottom.value = `${px}px`
    } else {
      followBottom.value = `calc(env(safe-area-inset-bottom) + 76px)`
    }
  } catch (e) {
    followBottom.value = `calc(env(safe-area-inset-bottom) + 76px)`
  }
}

  if (process.client || typeof window !== 'undefined') {
    onMounted(() => {
      // attributions are loaded per-line in loadLineShape

      updateFollowBottom()
      window.addEventListener('resize', updateFollowBottom)

      const nav = document.querySelector('.navbar') as HTMLElement | null
      if (nav && typeof MutationObserver !== 'undefined') {
        const mo = new MutationObserver(() => updateFollowBottom())
        mo.observe(nav, { attributes: true, childList: true, subtree: true })
        ; (nav as any).__followMo = mo
      }
    })

    onBeforeUnmount(() => {
      window.removeEventListener('resize', updateFollowBottom)
      const nav = document.querySelector('.navbar') as HTMLElement | null
      if (nav && (nav as any).__followMo) {
        try { (nav as any).__followMo.disconnect() } catch (e) { }
        ; (nav as any).__followMo = null
      }
      try { unsubscribeAllBuses() } catch (e) {}
    })
  }

// --- Socket / follow helpers (client-side only) ---
async function ensureSocket() {
  if (socket) return socket
  // lazy import to avoid SSR errors
  const { io } = await import('socket.io-client')
  const base = (runtimeConfig?.public?.LOCATE_WS_URL as string) || (process.env.NUXT_PUBLIC_LOCATE_WS_URL as string) || (process.env.NUXT_ENV_LOCATE_WS_URL as string) || ''
  if (!base) {
    console.warn('[oukile] NUXT_PUBLIC_LOCATE_WS_URL not set — socket will not connect')
    return null
  }
  // warn if user provided ws://localhost without a port — that will default to current page port
  try {
    const u = new URL(base)
    if ((u.protocol === 'ws:' || u.protocol === 'wss:') && !u.port) {
      console.error(`[oukile] WS URL '${base}' has no explicit port — refusing to connect to avoid hitting the Nuxt server (likely :3000). Please set NUXT_PUBLIC_LOCATE_WS_URL to a full URL including port, e.g. 'ws://localhost:4000' or 'https://server.tld'`)
      return null
    }
  } catch (e) {
    console.warn('[oukile] invalid NUXT_PUBLIC_LOCATE_WS_URL', base)
  }
  socket = io(base, { transports: ['websocket'] })
  socket.on('connect_error', (err: any) => console.error('Socket connect error', err))
  socket.on('connect', () => console.log('Socket connected', socket.id))
  socket.on('disconnect', (reason: any) => console.log('Socket disconnected', reason))
  // attach generic handlers once to forward any incoming position updates
  if (!(socket as any).__oukile_listener_attached) {
    const forwardPayload = (payload: any) => {
      try {
        if (!payload) return
        // normalize common fields
        const busID = payload.busID ?? payload.id ?? payload.bus ?? payload.bus_id ?? payload.vehicle
        const lat = payload.lat ?? payload.latitude ?? payload.Lat ?? payload.Latitude
        const lng = payload.lng ?? payload.lon ?? payload.longitude ?? payload.Lon
        const ts = payload.ts ?? payload.time ?? payload.timestamp
        const normalized = { busID, lat: Number(lat), lng: Number(lng), ts, raw: payload }
        // simple debug log
        try { console.log(`[oukile] position reçue pour ${busID}`, normalized) } catch (e) {}
        // dispatch to window so map handler can pick it up
        window.dispatchEvent(new CustomEvent('oukile:bus-location', { detail: normalized }))
      } catch (e) {
        console.error('Failed to forward socket payload', e)
      }
    }
    const events = ['location', 'busUpdate', 'position', 'update', 'bus_location']
    for (const ev of events) {
      socket.on(ev, forwardPayload)
    }
    ;(socket as any).__oukile_listener_attached = true
  }
  return socket
}

async function followBus(busID: string) {
  try {
    const s = await ensureSocket()
    if (s) {
      // if we haven't joined this bus room yet, join it
      if (!joinedRooms.has(busID)) {
        try {
          // emit several possible event names to match different server implementations
          s.emit('join', `bus:${busID}`)
          s.emit('join_bus', busID)
          s.emit('subscribe', `bus:${busID}`)
          s.emit('subscribe_bus', busID)
          joinedRooms.add(busID)
          console.log('[oukile] joined rooms for bus', busID)
        } catch (e) {
          console.error('Failed to emit join for bus', busID, e)
        }
      }
    }
    followedBus.value = busID

    // note: we use a global socket handler (attached in ensureSocket) which forwards all
    // position messages as 'oukile:bus-location' events. Do not override it here.
  } catch (e) {
    console.error('Failed to follow bus', e)
  }
}

function stopFollowing() {
  if (socket && followedBus.value) {
    try { socket.emit('leave', `bus:${followedBus.value}`) } catch (e) {}
    joinedRooms.delete(followedBus.value)
  }
  followedBus.value = null
}

// subscribe to all bus rooms for a given line
async function subscribeBusesForLine(lineName: string) {
  const list: string[] = attributions.value?.[lineName] ?? []
  if (!list || list.length === 0) return
  const s = await ensureSocket()
  if (!s) return
  for (const bus of list) {
    if (!joinedRooms.has(bus)) {
      try {
        // emit multiple join variants for compatibility with different servers
        s.emit('join', `bus:${bus}`)
        s.emit('join_bus', bus)
        s.emit('subscribe', `bus:${bus}`)
        s.emit('subscribe_bus', bus)
        joinedRooms.add(bus)
        console.log('[oukile] subscribed to bus', bus)
      } catch (e) {
        console.error('Failed to join bus room', bus, e)
      }
    }
  }
}

// leave all joined bus rooms
function unsubscribeAllBuses() {
  if (!socket) {
    joinedRooms.clear()
    return
  }
  for (const bus of Array.from(joinedRooms)) {
    try {
      // emit several leave variants to match server implementation
      socket.emit('leave', `bus:${bus}`)
      socket.emit('leave_bus', bus)
      socket.emit('unsubscribe', `bus:${bus}`)
      socket.emit('unsubscribe_bus', bus)
      socket.emit('leaveRoom', `bus:${bus}`)
    } catch (e) {}
    joinedRooms.delete(bus)
  }
  // ensure set is empty
  joinedRooms.clear()
}
</script>

<template>
  <div class="h-full">
    <LMap ref="map" style="height: 100%" :zoom="12" :center="[47.083328, 2.4]" :use-global-leaflet="true"
      @ready="onMapReady">
      <LTileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&amp;copy; <a href=&quot;https://www.openstreetmap.org/&quot;>OpenStreetMap</a> contributors"
        layer-type="base" name="OpenStreetMap" />

      <!-- Les marqueurs sont fournis au MarkerCluster dans onMapReady -->
      <!-- Le tracé GeoJSON est géré nativement dans onMapReady via L.geoJSON() -->
    </LMap>
  </div>

  <!-- Barre de suivi en bas -->
    <div style="position: fixed; right: 1rem; top: 4rem; z-index:12000; background: rgba(255,255,255,0.95); padding:8px; border-radius:6px; max-width:320px; box-shadow:0 6px 18px rgba(0,0,0,0.08);">
      <div style="font-weight:600; margin-bottom:6px;">Attributions (debug)</div>
      <pre style="font-size:11px; max-height:300px; overflow:auto; margin:0;">{{ JSON.stringify(attributions, null, 2) }}</pre>
    </div>
  <div v-if="followActive && selectedLine && currentDirection"
    class="fixed left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-md"
    :style="{ bottom: followBottom, zIndex: 10050, pointerEvents: 'auto' }">

    <div class="bg-white/90 dark:bg-slate-800 rounded-xl shadow p-3 flex items-center justify-between"
      style="position:relative; z-index:10051;">
      <div class="flex flex-col">
        <div class="text-sm font-semibold">Suivi de la ligne {{ selectedLine }}</div>
        <div class="text-xs text-gray-600 dark:text-gray-300">Direction {{ displayDirectionLabel }}</div>
      </div>

      <div class="flex items-center gap-4 pt-1">
        <button @click="reverseDirection">
          <Icon name="mi:switch" class="h-6 w-6" />
        </button>
        <button @click="stopFollow" class="">
          <Icon name="mi:close" class="h-6 w-6" />
        </button>
      </div>
    </div>

    <div class="mt-2 bg-white/90 dark:bg-slate-800 rounded-xl shadow p-3" style="position:relative; z-index:10051;">
      <div class="text-xs font-medium mb-2">Bus attribués à la ligne</div>
      <div class="flex gap-2 flex-wrap">
        <template v-if="selectedLine">
          <template v-for="bus in (attributions[selectedLine] || [])" :key="bus">
            <button class="px-2 py-1 bg-blue-600 text-white rounded text-xs" @click.prevent="followBus(bus)">{{ bus }}</button>
          </template>
          <div v-if="!( (attributions[selectedLine] || []).length )" class="text-xs text-gray-500">Aucun bus attribué</div>
        </template>
        <div v-else class="text-xs text-gray-500">Sélectionne une ligne pour voir les bus</div>
      </div>
      <div class="mt-2">
        <button v-if="followedBus" class="px-3 py-1 bg-red-600 text-white rounded text-xs" @click.prevent="stopFollowing">Arrêter le suivi ({{ followedBus }})</button>
      </div>
    </div>

  </div>
</template>