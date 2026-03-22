<script lang="ts" setup>
/**
 * HomeMap — Composant Leaflet complet.
 * Gère : cluster d'arrêts, couche de ligne, couche véhicules, tracé GeoJSON.
 * Les données réactives (ligne, filtre stops, couleur…) proviennent des composables.
 *
 * Prérequis : le plugin markercluster.client.ts a garanti window.L.markerClusterGroup
 * avant le montage de ce composant.
 */

const PRELOAD_PAD = 1.5

const mapRef = ref<any>(null)

// ── Géolocalisation ────────────────────────────────────────────────────────
const geoActive = ref(false)
const userOutsideBourges = ref(false)
const showOutsideMessage = ref(false)
let _userLocationLayer: any = null
let _geoWatchId: number | null = null
let _userLat: number | null = null
let _userLng: number | null = null

function isInBourges(lat: number, lng: number) {
  return lat >= 46.88 && lat <= 47.28 && lng >= 2.0 && lng <= 2.8
}

function showOutsideBourgesMessage() {
  showOutsideMessage.value = true
  setTimeout(() => { showOutsideMessage.value = false }, 3000)
}

function panToUser() {
  if (_leafletMap && _userLat !== null && _userLng !== null) {
    try { _leafletMap.setView([_userLat, _userLng], 16, { animate: true, duration: 0.5 }) } catch {}
  }
}

function onGeoButtonClick() {
  if (!geoActive.value) {
    startGeolocation()
  } else if (userOutsideBourges.value) {
    showOutsideBourgesMessage()
  } else {
    panToUser()
  }
}

function updateUserMarker(lat: number, lng: number) {
  if (!_userLocationLayer) return
  const L = window.L as any
  _userLocationLayer.clearLayers()
  if (isInBourges(lat, lng)) {
    L.marker([lat, lng], {
      icon: L.divIcon({
        html: `<div style="position:relative;width:20px;height:20px">
          <div style="position:absolute;inset:-8px;border-radius:50%;background:rgba(37,99,235,0.2);animation:oukile-pulse 1.5s ease-out infinite"></div>
          <div style="position:absolute;inset:0;border-radius:50%;background:#2563eb;border:3px solid white;box-shadow:0 2px 10px rgba(37,99,235,0.7)"></div>
        </div>`,
        className: '',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      }),
      zIndexOffset: -500,
    }).addTo(_userLocationLayer)
  }
}

function startGeolocation() {
  if (!import.meta.client || !navigator.geolocation) return
  _geoWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude
      const lng = pos.coords.longitude
      _userLat = lat
      _userLng = lng
      const wasOutside = userOutsideBourges.value
      userOutsideBourges.value = !isInBourges(lat, lng)

      if (!geoActive.value) {
        geoActive.value = true
        if (userOutsideBourges.value) {
          showOutsideBourgesMessage()
        } else {
          panToUser()
        }
      } else if (!wasOutside && userOutsideBourges.value) {
        // L'user vient de sortir de Bourges
        showOutsideBourgesMessage()
      }

      updateUserMarker(lat, lng)
    },
    (err) => {
      console.warn('[oukile] geolocation error', err)
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
  )
}

const {
  geojsonData,
  selectedLine,
  filteredGeojson,
  lineColor,
  lineStopIds,
  attributions,
  onRefreshMarkers,
  stopFollow,
} = useLineFollow()

const { followedBus, stopFollowing, unsubscribeAllBuses } = useSocket()
const { selectStop, clearStop, isOpen: stopPanelOpen, selectedStopId, fitBoundsRequested } = useStopPanel()
const { resetFollow } = useLineFollow()

// ── Garde contre le double appel de onMapReady ────────────────────────────
let mapInitialized = false

// ── Références Leaflet accessibles pour le cleanup ────────────────────────
let _leafletMap: any = null
let _cluster: any = null
let _lineLayer: any = null
let _vehicleLayer: any = null
let _geojsonLayer: any = null
let _selectedStopLayer: any = null
let _updateVisibleMarkers: (() => void) | null = null
let _onBusLocationEvent: ((e: Event) => void) | null = null
let _cleanupBusAnimations: (() => void) | null = null
// Stop-handles des watchers créés dans onMapReady après un await.
// En Vue 3, watch() après un await n'est pas scopé au composant : il faut
// les arrêter manuellement pour éviter qu'ils s'exécutent sur une carte détruite.
const _watchers: (() => void)[] = []

function leafletCleanup() {
  _watchers.forEach(stop => stop())
  _watchers.length = 0
  try { _leafletMap?.off('moveend zoomend', _updateVisibleMarkers) } catch {}
  try { _leafletMap?.removeLayer(_cluster) } catch {}
  try { _leafletMap?.removeLayer(_lineLayer) } catch {}
  try { _leafletMap?.removeLayer(_vehicleLayer) } catch {}
  try { if (_geojsonLayer) _leafletMap?.removeLayer(_geojsonLayer) } catch {}
  try { if (_selectedStopLayer) _leafletMap?.removeLayer(_selectedStopLayer) } catch {}
  try { if (_userLocationLayer) _leafletMap?.removeLayer(_userLocationLayer) } catch {}
  if (_onBusLocationEvent) window.removeEventListener('oukile:bus-location', _onBusLocationEvent)
  if (_cleanupBusAnimations) { _cleanupBusAnimations(); _cleanupBusAnimations = null }
  if (_geoWatchId !== null) { try { navigator.geolocation.clearWatch(_geoWatchId) } catch {}; _geoWatchId = null }
  onRefreshMarkers.value = null
  _leafletMap = _cluster = _lineLayer = _vehicleLayer = _geojsonLayer = _selectedStopLayer = _userLocationLayer = null
  _updateVisibleMarkers = _onBusLocationEvent = null
  geoActive.value = false
  userOutsideBourges.value = false
  _userLat = _userLng = null
  mapInitialized = false
}

function fullStop() {
  try { stopFollow() } catch {}
  try { stopFollowing() } catch {}
}

onMounted(() => {
  const nav = document.querySelector('.navbar')
  nav?.addEventListener('click', fullStop)
})

onBeforeUnmount(() => {
  fullStop()
  leafletCleanup()
  const nav = document.querySelector('.navbar')
  nav?.removeEventListener('click', fullStop)
})

const { locations, loadStops } = useStops()

const onMapReady = async (maybeMap?: any) => {
  if (mapInitialized) return
  mapInitialized = true

  // window.L est garanti par le plugin markercluster.client.ts
  const L = window.L as any

  if (!L?.markerClusterGroup) {
    console.error('[oukile] markerClusterGroup not available — plugin did not run correctly')
    mapInitialized = false
    return
  }

  const BOURGES_BOUNDS = L.latLngBounds(
    L.latLng(46.88, 2.0),
    L.latLng(47.28, 2.8)
  )

  // Récupère l'instance Leaflet réelle
  if (maybeMap && typeof maybeMap.getZoom === 'function') {
    _leafletMap = maybeMap
  } else {
    const mc = mapRef.value
    _leafletMap = mc?.mapObject || mc?._map || mc?.map
  }

  if (!_leafletMap) {
    console.warn('[oukile] Leaflet instance not found on map ref')
    mapInitialized = false
    return
  }

  const leafletMap = _leafletMap

  try {
    leafletMap.setMaxBounds(BOURGES_BOUNDS)
    leafletMap.options.maxBoundsViscosity = 0.9
    leafletMap.setMinZoom(10)
    leafletMap.setMaxZoom(18)
  } catch (e) {
    console.warn('[oukile] failed to apply map bounds/zoom limits', e)
  }

  await loadStops()

  // ── Couches ──────────────────────────────────────────────────────────────
  _cluster = L.markerClusterGroup({
    maxClusterRadius: 36,
    spiderfyOnMaxZoom: true,
    disableClusteringAtZoom: 14,
    chunkedLoading: true,
    showCoverageOnHover: false,
  })
  const cluster = _cluster

  _lineLayer = L.layerGroup()
  const lineLayer = _lineLayer
  _vehicleLayer = L.layerGroup()
  const vehicleLayer = _vehicleLayer
  const busMarkers = new Map<string, any>()

  // ── Animation bus ─────────────────────────────────────────────────────────
  type LatLng2 = [number, number] // [lat, lng]
  const busAnimRafs = new Map<string, number>()   // busID → rafId en cours
  const busRenderedPos = new Map<string, LatLng2>() // busID → position rendue

  _cleanupBusAnimations = () => {
    for (const id of busAnimRafs.values()) cancelAnimationFrame(id)
    busAnimRafs.clear()
    busRenderedPos.clear()
  }

  /** Extrait les coordonnées [lat, lng] du GeoJSON de tracé actif. */
  function getShapeCoords(): LatLng2[] {
    const gj = filteredGeojson.value as any
    if (!gj) return []
    const out: LatLng2[] = []
    const features = gj.type === 'FeatureCollection' ? gj.features : [gj]
    for (const f of features) {
      const g = f.geometry ?? f
      if (g.type === 'LineString') {
        for (const c of g.coordinates) out.push([c[1], c[0]])
      } else if (g.type === 'MultiLineString') {
        for (const line of g.coordinates)
          for (const c of line) out.push([c[1], c[0]])
      }
    }
    return out
  }

  /** Projette [lat, lng] sur le polyline, retourne { idx, t } du segment le plus proche. */
  function projectOnLine(lat: number, lng: number, coords: LatLng2[]): { idx: number; t: number } {
    let best = { idx: 0, t: 0, dist: Infinity }
    for (let i = 0; i < coords.length - 1; i++) {
      const [lat1, lng1] = coords[i]!, [lat2, lng2] = coords[i + 1]!
      const dlat = lat2 - lat1, dlng = lng2 - lng1
      const len2 = dlat * dlat + dlng * dlng
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((lat - lat1) * dlat + (lng - lng1) * dlng) / len2)) : 0
      const dist = (lat - lat1 - t * dlat) ** 2 + (lng - lng1 - t * dlng) ** 2
      if (dist < best.dist) best = { idx: i, t, dist }
    }
    return best
  }

  /** Interpole le long du polyline entre deux projections à la progression p ∈ [0,1]. */
  function walkLine(
    from: { idx: number; t: number },
    to: { idx: number; t: number },
    coords: LatLng2[],
    p: number,
  ): LatLng2 {
    const pts: LatLng2[] = []
    const f1 = coords[from.idx]!, f2 = coords[from.idx + 1]!
    pts.push([f1[0] + from.t * (f2[0] - f1[0]), f1[1] + from.t * (f2[1] - f1[1])])
    for (let i = from.idx + 1; i <= to.idx; i++) pts.push(coords[i]!)
    const s1 = coords[to.idx]!, s2 = coords[to.idx + 1]!
    pts.push([s1[0] + to.t * (s2[0] - s1[0]), s1[1] + to.t * (s2[1] - s1[1])])

    const lens: number[] = []
    let total = 0
    for (let i = 0; i < pts.length - 1; i++) {
      const d = Math.hypot(pts[i + 1]![0] - pts[i]![0], pts[i + 1]![1] - pts[i]![1])
      lens.push(d); total += d
    }
    if (total === 0) return pts[pts.length - 1]!

    let target = p * total, walked = 0
    for (let i = 0; i < lens.length; i++) {
      if (walked + lens[i]! >= target) {
        const r = lens[i]! > 0 ? (target - walked) / lens[i]! : 0
        return [pts[i]![0] + r * (pts[i + 1]![0] - pts[i]![0]), pts[i]![1] + r * (pts[i + 1]![1] - pts[i]![1])]
      }
      walked += lens[i]!
    }
    return pts[pts.length - 1]!
  }

  const ANIM_MS = 4000

  function animateMarker(
    busID: string, marker: any,
    fromLat: number, fromLng: number,
    toLat: number, toLng: number,
  ) {
    const prev = busAnimRafs.get(busID)
    if (prev) cancelAnimationFrame(prev)

    const shape = getShapeCoords()
    let fromProj: { idx: number; t: number } | null = null
    let toProj: { idx: number; t: number } | null = null

    if (shape.length > 1) {
      const fp = projectOnLine(fromLat, fromLng, shape)
      const tp = projectOnLine(toLat, toLng, shape)
      // Utilise le tracé seulement si le bus avance dans le bon sens
      if (fp.idx + fp.t <= tp.idx + tp.t) { fromProj = fp; toProj = tp }
    }

    const start = performance.now()
    function step(now: number) {
      const raw = Math.min((now - start) / ANIM_MS, 1)
      const p = raw < 0.5 ? 2 * raw * raw : -1 + (4 - 2 * raw) * raw // ease-in-out

      let lat: number, lng: number
      if (fromProj && toProj) {
        ;[lat, lng] = walkLine(fromProj, toProj, shape, p)
      } else {
        lat = fromLat + p * (toLat - fromLat)
        lng = fromLng + p * (toLng - fromLng)
      }

      try { marker.setLatLng([lat, lng]) } catch {}
      busRenderedPos.set(busID, [lat, lng])

      if (raw < 1) {
        busAnimRafs.set(busID, requestAnimationFrame(step))
      } else {
        busAnimRafs.delete(busID)
      }
    }
    busAnimRafs.set(busID, requestAnimationFrame(step))
  }

  // Helpers sûrs pour retirer un marker : certains markers n'ont pas encore
  // leur élément DOM (_icon) et Leaflet plante si on tente d'opérer dessus.
  function safeRemoveFromCluster(marker: any) {
    if (!marker) return
    try { cluster.removeLayer(marker) } catch {}
  }

  function safeRemoveFromLineLayer(marker: any) {
    if (!marker) return
    try { lineLayer.removeLayer(marker) } catch {}
  }

  // ── Helpers markers bus ───────────────────────────────────────────────────

  function createBusIcon(color: string) {
    const bg = /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : '#3b82f6'
    return L.divIcon({
      html: `<div style="width:26px;height:26px;background:${bg};border:2.5px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.3)">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="white">
          <path d="M17 20H7v1a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-1H3V4c0-1.11.89-2 2-2h14c1.11 0 2 .89 2 2v16h-1v1a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1M5 6v6h14V6H5m2.5 9A1.5 1.5 0 0 1 9 16.5 1.5 1.5 0 0 1 7.5 18 1.5 1.5 0 0 1 6 16.5 1.5 1.5 0 0 1 7.5 15m9 0a1.5 1.5 0 0 1 1.5 1.5 1.5 1.5 0 0 1-1.5 1.5 1.5 1.5 0 0 1-1.5-1.5A1.5 1.5 0 0 1 16.5 15Z"/>
        </svg>
      </div>`,
      className: '',
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    })
  }

  function addOrUpdateBusMarker(busID: string, lat: number, lng: number, color: string) {
    if (typeof lat !== 'number' || typeof lng !== 'number') return
    const existing = busMarkers.get(busID)
    if (existing) {
      const [fromLat, fromLng] = busRenderedPos.get(busID) ?? [lat, lng]
      animateMarker(busID, existing, fromLat, fromLng, lat, lng)
    } else {
      try {
        const m = L.marker([lat, lng], { icon: createBusIcon(color), riseOnHover: true, zIndexOffset: 1000 })
        vehicleLayer.addLayer(m)
        busMarkers.set(busID, m)
        busRenderedPos.set(busID, [lat, lng])
      } catch (e) { console.error('[oukile] create marker error', e) }
    }
  }

  function clearBusMarkersNotIn(allowed: string[] = []) {
    const keep = new Set(allowed)
    for (const [id, marker] of busMarkers.entries()) {
      if (!keep.has(id)) {
        const rafId = busAnimRafs.get(id)
        if (rafId) { cancelAnimationFrame(rafId); busAnimRafs.delete(id) }
        busRenderedPos.delete(id)
        try { vehicleLayer.removeLayer(marker) } catch {}
        try { marker.remove() } catch {}
        busMarkers.delete(id)
      }
    }
  }

  // ── Virtualization des arrêts par viewport ────────────────────────────────
  const markerPool = new Map<string, any>()
  const added = new Set<string>()
  const addedLine = new Set<string>()

  // ── Overlay "arrêt sélectionné" ───────────────────────────────────────────
  // Un layer dédié au-dessus de tout : toujours un divIcon animé,
  // quel que soit le type de marker sous-jacent (cluster ou circleMarker).
  if (!document.getElementById('oukile-pulse')) {
    const s = document.createElement('style')
    s.id = 'oukile-pulse'
    s.textContent = '@keyframes oukile-pulse{0%{transform:scale(0.9);opacity:0.8}100%{transform:scale(2.8);opacity:0}}'
    document.head.appendChild(s)
  }

  _selectedStopLayer = L.layerGroup()
  const selectedStopLayer = _selectedStopLayer
  leafletMap.addLayer(selectedStopLayer)

  // ── Layer position utilisateur ────────────────────────────────────────────
  _userLocationLayer = L.layerGroup()
  leafletMap.addLayer(_userLocationLayer)

  function createSelectedIcon() {
    return L.divIcon({
      html: `<div style="position:relative;width:32px;height:32px">
        <div style="position:absolute;inset:0;border-radius:50%;background:rgba(37,99,235,0.3);animation:oukile-pulse 1.5s ease-out infinite"></div>
        <div style="position:absolute;inset:7px;border-radius:50%;background:#2563eb;border:2.5px solid white;box-shadow:0 2px 8px rgba(37,99,235,0.6)"></div>
      </div>`,
      className: '',
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    })
  }

  function updateSelectedStopOverlay(stopId: string | null) {
    selectedStopLayer.clearLayers()
    if (!stopId) return
    const loc = locations.value.find(l => l.id === stopId)
    if (!loc) return
    try {
      L.marker([loc.lat, loc.lng], { icon: createSelectedIcon(), zIndexOffset: 2000 })
        .addTo(selectedStopLayer)
    } catch {}
  }

  const BUS_SVG_PATH = 'M17 20H7v1a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-1H3V4c0-1.11.89-2 2-2h14c1.11 0 2 .89 2 2v16h-1v1a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1M5 6v6h14V6H5m2.5 9A1.5 1.5 0 0 1 9 16.5 1.5 1.5 0 0 1 7.5 18 1.5 1.5 0 0 1 6 16.5 1.5 1.5 0 0 1 7.5 15m9 0a1.5 1.5 0 0 1 1.5 1.5 1.5 1.5 0 0 1-1.5 1.5 1.5 1.5 0 0 1-1.5-1.5A1.5 1.5 0 0 1 16.5 15Z'

  function createBusStopIconBase(bg: string, shadow: string) {
    return L.divIcon({
      html: `<div style="position:relative;width:28px;height:34px;display:flex;flex-direction:column;align-items:center">
        <div style="width:28px;height:28px;background:${bg};border-radius:8px;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px ${shadow}">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="15" height="15" fill="white">
            <path d="${BUS_SVG_PATH}"/>
          </svg>
        </div>
        <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:6px solid ${bg}"></div>
      </div>`,
      className: '',
      iconSize: [28, 34],
      iconAnchor: [14, 34],
    })
  }

  function createBusStopIcon() {
    return createBusStopIconBase('#1d4ed8', 'rgba(29,78,216,0.45)')
  }

  function createBusStopIconSelected() {
    return createBusStopIconBase('#dc2626', 'rgba(220,38,38,0.45)')
  }

  function createMarkerFor(loc: { id: string; name: string; lat: number; lng: number }, isLine = false) {
    const isSelected = selectedStopId.value === loc.id
    const m = isLine
      ? L.circleMarker([loc.lat, loc.lng], {
          radius: 7,
          color: '#ffffff',
          weight: 2.5,
          fillColor: isSelected ? '#dc2626' : lineColor.value,
          fillOpacity: 1,
        })
      : L.marker([loc.lat, loc.lng], { icon: isSelected ? createBusStopIconSelected() : createBusStopIcon() })
    m.on('click', (e: any) => {
      L.DomEvent.stopPropagation(e)
      selectStop(loc.id, loc.name)
    })
    markerPool.set(loc.id, m)
    return m
  }

  // Ferme le panneau et nettoie le tracé si on clique sur la carte
  leafletMap.on('click', () => {
    clearStop()
    resetFollow()
    navigateTo({ path: '/', query: {} }, { replace: true })
  })

  function panToStopAbovePanel(lat: number, lng: number) {
    try {
      const navEl = document.querySelector('.navbar') as HTMLElement | null
      const navbarH = navEl
        ? Math.max(0, window.innerHeight - navEl.getBoundingClientRect().top)
        : 60
      const mapSize = leafletMap.getSize()
      const panelH = mapSize.y * 0.32
      const visibleCenterY = (mapSize.y - navbarH - panelH) / 2
      const currentY = leafletMap.latLngToContainerPoint([lat, lng]).y
      leafletMap.panBy([0, currentY - visibleCenterY], { animate: true, duration: 0.3 })
    } catch {}
  }

  let _prevSelectedId: string | null = null

  _watchers.push(watch(selectedStopId, (id) => {
    // Restore previous marker to default color
    if (_prevSelectedId) {
      const prev = markerPool.get(_prevSelectedId)
      if (prev) {
        try {
          if (typeof prev.setStyle === 'function') prev.setStyle({ fillColor: lineColor.value })
          else if (typeof prev.setIcon === 'function') prev.setIcon(createBusStopIcon())
        } catch {}
      }
    }
    _prevSelectedId = id ?? null

    if (!id) return

    // Mark new selected marker as red
    const marker = markerPool.get(id)
    if (marker) {
      try {
        if (typeof marker.setStyle === 'function') marker.setStyle({ fillColor: '#dc2626' })
        else if (typeof marker.setIcon === 'function') marker.setIcon(createBusStopIconSelected())
      } catch {}
    }

    const loc = locations.value.find(l => l.id === id)
    if (loc) panToStopAbovePanel(loc.lat, loc.lng)
  }))

  function clearLineMarkers() {
    for (const key of Array.from(addedLine)) {
      try { lineLayer.removeLayer(markerPool.get(key)) } catch {}
      markerPool.delete(key)
    }
    addedLine.clear()
    try { lineLayer.clearLayers() } catch {}
  }

  function updateVisibleMarkers() {
    try {
      if (!leafletMap) return
      const bounds = leafletMap.getBounds()
      const extended = bounds.pad(PRELOAD_PAD)
      const lineFilter = lineStopIds.value
      const lineFilterSet = lineFilter !== null ? new Set(lineFilter) : null

      if (lineFilter === null && addedLine.size > 0) {
        clearLineMarkers()
      }

      for (const loc of locations.value) {
        if (typeof loc.lat !== 'number' || typeof loc.lng !== 'number') continue
        const key = loc.id
        const latlng = L.latLng(loc.lat, loc.lng)

        if (!BOURGES_BOUNDS.contains(latlng)) {
          if (added.has(key)) { safeRemoveFromCluster(markerPool.get(key)); added.delete(key) }
          if (addedLine.has(key)) { safeRemoveFromLineLayer(markerPool.get(key)); addedLine.delete(key) }
          continue
        }

        // Mode ligne : stops filtrés → lineLayer (sans cluster)
        if (lineFilterSet !== null) {
          if (added.has(key)) { safeRemoveFromCluster(markerPool.get(key)); added.delete(key) }

          if (lineFilterSet.has(key)) {
            if (!addedLine.has(key)) {
              if (markerPool.has(key)) { safeRemoveFromCluster(markerPool.get(key)); markerPool.delete(key) }
              lineLayer.addLayer(createMarkerFor(loc, true))
              addedLine.add(key)
            }
          } else {
            if (addedLine.has(key)) { safeRemoveFromLineLayer(markerPool.get(key)); markerPool.delete(key); addedLine.delete(key) }
          }
          continue
        }

        // Mode normal : cluster virtualisé par viewport
        if (addedLine.has(key)) {
          safeRemoveFromLineLayer(markerPool.get(key))
          addedLine.delete(key)
          markerPool.delete(key)
        }

        if (extended.contains(latlng)) {
          if (!added.has(key)) {
            const marker = markerPool.get(key) ?? createMarkerFor(loc)
            cluster.addLayer(marker)
            added.add(key)
          }
        } else {
          if (added.has(key)) { safeRemoveFromCluster(markerPool.get(key)); added.delete(key) }
        }
      }
    } catch (e) {
      console.error('[oukile] updateVisibleMarkers error', e)
    }
  }

  _updateVisibleMarkers = updateVisibleMarkers
  updateVisibleMarkers()
  leafletMap.on('moveend zoomend', updateVisibleMarkers)
  onRefreshMarkers.value = updateVisibleMarkers

  leafletMap.addLayer(cluster)
  leafletMap.addLayer(vehicleLayer)

  // ── Tracé GeoJSON ─────────────────────────────────────────────────────────
  function redrawGeojson() {
    if (!_leafletMap) return
    if (_geojsonLayer) { try { leafletMap.removeLayer(_geojsonLayer) } catch {}; _geojsonLayer = null }
    try { leafletMap.removeLayer(lineLayer) } catch {}

    const gj = filteredGeojson.value
    if (!gj) { leafletMap.addLayer(lineLayer); return }

    _geojsonLayer = L.geoJSON(gj, {
      style: { color: lineColor.value, weight: 4, opacity: 0.85 },
    })
    _geojsonLayer.addTo(leafletMap)
    leafletMap.addLayer(lineLayer)
  }

  _watchers.push(watch([filteredGeojson, lineColor], () => {
    if (!_leafletMap) return
    for (const key of addedLine) {
      const m = markerPool.get(key)
      if (m && typeof m.setStyle === 'function') m.setStyle({ fillColor: lineColor.value })
    }
    redrawGeojson()
    if (!filteredGeojson.value) updateVisibleMarkers()
  }))

  redrawGeojson()
  if (selectedLine.value) updateVisibleMarkers()

  // ── Événements de position bus ────────────────────────────────────────────
  function onBusLocationEvent(e: Event) {
    try {
      const { busID, lat, lng } = (e as CustomEvent).detail ?? {}
      if (!busID) return

      if (!geojsonData.value) {
        clearBusMarkersNotIn(followedBus.value ? [followedBus.value] : [])
        if (followedBus.value !== busID) return
      }

      // Si ce bus est le bus explicitement suivi (depuis panneau arrêt),
      // on l'affiche toujours — attributions peut être vide dans ce mode.
      if (selectedLine.value && followedBus.value !== busID) {
        const list = attributions.value?.[selectedLine.value] ?? []
        if (!list.includes(busID)) return
      }

      addOrUpdateBusMarker(busID, Number(lat), Number(lng), lineColor.value)

      if (followedBus.value === busID) {
        if (stopPanelOpen.value && fitBoundsRequested.value) {
          // Premier fix : ajuster la vue pour voir à la fois l'arrêt et le bus
          fitBoundsRequested.value = false
          const stopLoc = locations.value.find(l => l.id === selectedStopId.value)
          if (stopLoc) {
            try {
              leafletMap.fitBounds(
                [[Number(lat), Number(lng)], [stopLoc.lat, stopLoc.lng]],
                { padding: [50, 50], maxZoom: 16 }
              )
            } catch {}
          }
        } else if (!stopPanelOpen.value) {
          try { leafletMap.panTo([Number(lat), Number(lng)]) } catch {}
        }
      }
    } catch (err) {
      console.error('[oukile] onBusLocationEvent error', err)
    }
  }

  _onBusLocationEvent = onBusLocationEvent
  window.addEventListener('oukile:bus-location', onBusLocationEvent)

  _watchers.push(watch(selectedLine, (newLine) => {
    if (!_leafletMap) return
    const allowed = newLine ? (attributions.value?.[newLine] ?? []) : []
    clearBusMarkersNotIn(allowed)
  }))

  // Quand la liste de bus change (ex. changement de direction), on supprime
  // les marqueurs qui ne font plus partie de la nouvelle liste.
  _watchers.push(watch(
    () => selectedLine.value ? (attributions.value?.[selectedLine.value] ?? []) : [],
    (newList) => {
      if (!_leafletMap) return
      clearBusMarkersNotIn(newList)
    }
  ))


  _watchers.push(watch(geojsonData, (val) => {
    if (!_leafletMap) return
    if (!val) {
      try { unsubscribeAllBuses() } catch {}
      clearBusMarkersNotIn(followedBus.value ? [followedBus.value] : [])
    }
  }))

  _watchers.push(watch([selectedLine, () => geojsonData.value !== null], ([line, hasGeojson]) => {
    if (!_leafletMap) return
    if (!line || !hasGeojson) {
      try { unsubscribeAllBuses() } catch {}
    }
  }))
}
</script>

<template>
  <div style="height: 100%; position: relative;">
    <LMap
      ref="mapRef"
      style="height: 100%"
      :zoom="12"
      :center="[47.083328, 2.4]"
      :use-global-leaflet="true"
      @ready="onMapReady"
    >
      <LTileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&amp;copy; <a href=&quot;https://www.openstreetmap.org/&quot;>OpenStreetMap</a> contributors"
        layer-type="base"
        name="OpenStreetMap"
      />
    </LMap>

    <!-- Bouton de géolocalisation -->
    <button
      :title="geoActive ? (userOutsideBourges ? 'Vous êtes hors de Bourges' : 'Centrer sur ma position') : 'Me localiser'"
      class="geo-btn bg-white dark:bg-gray-900 shadow-md"
      :class="{
        'text-blue-600 dark:text-blue-400': geoActive && !userOutsideBourges,
        'text-gray-400 dark:text-gray-500': geoActive && userOutsideBourges,
        'text-gray-700 dark:text-gray-200': !geoActive,
      }"
      @click="onGeoButtonClick"
    >
      <Icon name="material-symbols:my-location" class="w-5 h-5" />
    </button>

    <!-- Message hors Bourges -->
    <Transition name="geo-toast">
      <div
        v-if="showOutsideMessage"
        style="
          position: absolute;
          bottom: 90px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 1000;
          background: rgba(30,30,30,0.88);
          color: white;
          padding: 8px 16px;
          border-radius: 20px;
          font-size: 13px;
          white-space: nowrap;
          pointer-events: none;
        "
      >
        Vous êtes en dehors de Bourges
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.geo-btn {
  position: absolute;
  bottom: calc(env(safe-area-inset-bottom) + 90px);
  right: 16px;
  z-index: 1000;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: color 0.15s, box-shadow 0.15s;
  -webkit-tap-highlight-color: transparent;
}
.geo-btn:active {
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.18);
}

.geo-toast-enter-active,
.geo-toast-leave-active {
  transition: opacity 0.3s, transform 0.3s;
}
.geo-toast-enter-from,
.geo-toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>
