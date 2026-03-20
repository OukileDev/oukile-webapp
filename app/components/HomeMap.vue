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

// ── Garde contre le double appel de onMapReady ────────────────────────────
let mapInitialized = false

// ── Références Leaflet accessibles pour le cleanup ────────────────────────
let _leafletMap: any = null
let _cluster: any = null
let _lineLayer: any = null
let _vehicleLayer: any = null
let _geojsonLayer: any = null
let _updateVisibleMarkers: (() => void) | null = null
let _onBusLocationEvent: ((e: Event) => void) | null = null
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
  if (_onBusLocationEvent) window.removeEventListener('oukile:bus-location', _onBusLocationEvent)
  onRefreshMarkers.value = null
  _leafletMap = _cluster = _lineLayer = _vehicleLayer = _geojsonLayer = null
  _updateVisibleMarkers = _onBusLocationEvent = null
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
  function addOrUpdateBusMarker(busID: string, lat: number, lng: number) {
    if (typeof lat !== 'number' || typeof lng !== 'number') return
    const existing = busMarkers.get(busID)
    if (existing) {
      try {
        existing.setLatLng([lat, lng])
      } catch (e) { console.error('[oukile] update marker error', e) }
    } else {
      try {
        const m = L.marker([lat, lng], { riseOnHover: true })
        m.bindPopup(`<strong>${busID}</strong>`)
        m.on('click', async () => {
          try {
            const info = await $fetch<{ route: string | null; headsign: string | null; delay: number | null } | null>(
              `/api/vehicles/${encodeURIComponent(busID)}`
            )
            const headsignLine = info?.headsign ? `<br/>↗ ${info.headsign}` : ''
            let delayLine = ''
            if (info?.delay != null) {
              const absSec = Math.abs(info.delay)
              const min = Math.floor(absSec / 60)
              const sec = absSec % 60
              const duration = min > 0 ? `${min} min${sec > 0 ? ` ${sec} s` : ''}` : `${sec} s`
              if (info.delay > 10) delayLine = `<br/>🔴 En retard de ${duration}`
              else if (info.delay < -10) delayLine = `<br/>🟢 En avance de ${duration}`
              else delayLine = `<br/>🟢 À l'heure`
            }
            m.getPopup()?.setContent(`<strong>${busID}</strong>${headsignLine}${delayLine}`)
          } catch {}
        })
        vehicleLayer.addLayer(m)
        busMarkers.set(busID, m)
      } catch (e) { console.error('[oukile] create marker error', e) }
    }
  }

  function clearBusMarkersNotIn(allowed: string[] = []) {
    const keep = new Set(allowed)
    for (const [id, marker] of busMarkers.entries()) {
      if (!keep.has(id)) {
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

  function createMarkerFor(loc: { id: string; name: string; lat: number; lng: number }, isLine = false) {
    const m = isLine
      ? L.circleMarker([loc.lat, loc.lng], {
          radius: 6,
          color: '#ffffff',
          weight: 2,
          fillColor: lineColor.value,
          fillOpacity: 1,
        })
      : L.marker([loc.lat, loc.lng])
    m.bindPopup(`<strong>${loc.name}</strong>`)
    markerPool.set(loc.id, m)
    return m
  }

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
        if (lineFilter !== null) {
          if (added.has(key)) { safeRemoveFromCluster(markerPool.get(key)); added.delete(key) }

          if (lineFilter.includes(key)) {
            if (!addedLine.has(key)) {
              if (markerPool.has(key)) { safeRemoveFromCluster(markerPool.get(key)); markerPool.delete(key) }
              lineLayer.addLayer(createMarkerFor(loc, true))
              addedLine.add(key)
            }
          } else {
            if (addedLine.has(key)) { safeRemoveFromLineLayer(markerPool.get(key)); addedLine.delete(key) }
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

      if (selectedLine.value) {
        const list = attributions.value?.[selectedLine.value] ?? []
        if (!list.includes(busID)) return
      }

      addOrUpdateBusMarker(busID, Number(lat), Number(lng))

      if (followedBus.value === busID) {
        try { leafletMap.panTo([Number(lat), Number(lng)]) } catch {}
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
</template>
