<script lang="ts" setup>
/**
 * TheMap — Composant Leaflet complet.
 * Gère : cluster d'arrêts, couche de ligne, couche véhicules, tracé GeoJSON.
 * Les données réactives (ligne, filtre stops, couleur…) proviennent des composables.
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
} = useLineFollow()

const { followedBus, followBus, stopFollowing, unsubscribeAllBuses } = useSocket()
const { locations, loadStops } = useStops()

const onMapReady = async (maybeMap?: any) => {
  // @ts-ignore
  const L = window.L
  
  if (!L) {
    console.error('[oukile] window.L not available')
    return
  }

  // Import dynamique de leaflet.markercluster — étend L avec L.markerClusterGroup
  try {
    await import('leaflet.markercluster')
  } catch (e) {
    console.error('[oukile] Failed to load leaflet.markercluster:', e)
    return
  }

  const BOURGES_BOUNDS = L.latLngBounds(
    L.latLng(46.88, 2.0),
    L.latLng(47.28, 2.8)
  )

  // Récupère l'instance Leaflet réelle
  let leafletMap: any = null
  if (maybeMap && typeof maybeMap.getZoom === 'function') {
    leafletMap = maybeMap
  } else if (maybeMap && (maybeMap.mapObject || maybeMap._map || maybeMap.map)) {
    leafletMap = maybeMap.mapObject || maybeMap._map || maybeMap.map
  } else {
    const mc = mapRef.value
    leafletMap = mc?.mapObject || mc?._map || mc?.map
  }

  if (!leafletMap) {
    console.warn('[oukile] Leaflet instance not found on map ref')
    return
  }

  // Limites et zoom
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
  const cluster = (L as any).markerClusterGroup({
    maxClusterRadius: 36,
    spiderfyOnMaxZoom: true,
    disableClusteringAtZoom: 14,
    chunkedLoading: true,
    showCoverageOnHover: false,
  })
  if (!cluster) { console.error('[oukile] markerClusterGroup not available'); return }

  const lineLayer = L.layerGroup()
  const vehicleLayer = L.layerGroup()
  const busMarkers = new Map<string, any>()

  // Helpers sûrs pour retirer un marker d'un layer : certains markers
  // n'ont pas encore leur élément DOM (_icon) et Leaflet plante si on
  // tente d'opérer dessus. On vérifie la présence d'un élément avant.
  function safeRemoveFromCluster(marker: any) {
    if (!marker) return
    try {
      const el = marker._icon ?? (marker.getElement ? marker.getElement() : null)
      if (!el && typeof marker._radius === 'undefined') return
      cluster.removeLayer(marker)
    } catch {}
  }

  function safeRemoveFromLineLayer(marker: any) {
    if (!marker) return
    try {
      const el = marker._icon ?? (marker.getElement ? marker.getElement() : null)
      // circleMarker n'expose pas forcément _icon mais a _radius / _renderer
      if (!el && typeof marker._radius === 'undefined') return
      lineLayer.removeLayer(marker)
    } catch {}
  }

  // ── Helpers markers bus ───────────────────────────────────────────────────
  function addOrUpdateBusMarker(busID: string, lat: number, lng: number, popup: string) {
    if (typeof lat !== 'number' || typeof lng !== 'number') return
    const existing = busMarkers.get(busID)
    if (existing) {
      try {
        existing.setLatLng([lat, lng])
        existing.getPopup()?.setContent(popup)
      } catch (e) { console.error('[oukile] update marker error', e) }
    } else {
      try {
        const m = L.marker([lat, lng], { riseOnHover: true })
        m.bindPopup(popup)
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
        try { safeRemoveFromCluster(marker) } catch {}
        try { marker.remove() } catch {}
        busMarkers.delete(id)
      }
    }
  }

  // ── Virtualization des arrêts ─────────────────────────────────────────────
  const markerPool = new Map<string, any>()
  const added = new Set<string>()
  const addedLine = new Set<string>()

  function createMarkerFor(loc: { id: string; name: string; lat: number; lng: number }, isLine = false) {
    const m = isLine
      ? (L as any).circleMarker([loc.lat, loc.lng], {
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

  function updateVisibleMarkers() {
    try {
      if (!leafletMap) return;
      const bounds = leafletMap.getBounds();
      const extended = bounds.pad(PRELOAD_PAD);
      const lineFilter = lineStopIds.value;

      for (const loc of locations.value) {
        if (typeof loc.lat !== 'number' || typeof loc.lng !== 'number') continue;
        const key = loc.id;
        const latlng = L.latLng(loc.lat, loc.lng);

        if (!BOURGES_BOUNDS.contains(latlng)) {
          if (added.has(key)) {
            try {
              const marker = markerPool.get(key);
              if (marker) safeRemoveFromCluster(marker);
            } catch {}
            added.delete(key);
          }
          if (addedLine.has(key)) {
            try {
              const marker = markerPool.get(key);
              if (marker) safeRemoveFromLineLayer(marker);
            } catch {}
            addedLine.delete(key);
          }
          continue;
        }

        // Mode ligne : stops filtrés → lineLayer (sans cluster)
        if (lineFilter !== null) {
          if (added.has(key)) {
            try {
              const marker = markerPool.get(key);
              if (marker) safeRemoveFromCluster(marker);
            } catch {}
            added.delete(key);
          }

          // CORRECTION : lineFilter est maintenant un Array, on utilise .includes()
          if (lineFilter.includes(key)) {
            if (!addedLine.has(key)) {
              if (markerPool.has(key)) {
                try {
                  const marker = markerPool.get(key);
                  if (marker) safeRemoveFromCluster(marker);
                } catch {}
                markerPool.delete(key);
              }
              lineLayer.addLayer(createMarkerFor(loc, true))
              addedLine.add(key)
            }
          } else {
            if (addedLine.has(key)) {
              try {
                const marker = markerPool.get(key);
                if (marker) safeRemoveFromLineLayer(marker);
              } catch {}
              addedLine.delete(key);
            }
          }
          continue
        }

        // Mode normal : cluster virtualisé par viewport
        if (addedLine.has(key)) {
          try {
            const marker = markerPool.get(key);
            if (marker) safeRemoveFromLineLayer(marker);
          } catch {}
          addedLine.delete(key)
          markerPool.delete(key)
        }

        if (extended.contains(latlng)) {
          if (!added.has(key)) {
            let marker = markerPool.get(key);
            if (!marker) marker = createMarkerFor(loc);
            if (marker) {
              cluster.addLayer(marker)
              added.add(key)
            }
          }
        } else {
          if (added.has(key)) {
            try {
              const marker = markerPool.get(key);
              if (marker) safeRemoveFromCluster(marker);
            } catch {}
            added.delete(key)
          }
        }
      }
    } catch (e) {
      console.error('[oukile] updateVisibleMarkers error', e)
    }
  }

  updateVisibleMarkers()
  leafletMap.on('moveend zoomend', updateVisibleMarkers)
  onRefreshMarkers.value = updateVisibleMarkers

  leafletMap.addLayer(cluster)
  leafletMap.addLayer(vehicleLayer)

  // ── Tracé GeoJSON ─────────────────────────────────────────────────────────
  let geojsonLayer: any = null

  function redrawGeojson() {
    if (geojsonLayer) { try { leafletMap.removeLayer(geojsonLayer) } catch {}; geojsonLayer = null }
    try { leafletMap.removeLayer(lineLayer) } catch {}

    const gj = filteredGeojson.value
    if (!gj) { leafletMap.addLayer(lineLayer); return }

    geojsonLayer = (L as any).geoJSON(gj, {
      style: { color: lineColor.value, weight: 4, opacity: 0.85 },
    })
    geojsonLayer.addTo(leafletMap)
    leafletMap.addLayer(lineLayer)
  }

  watch([filteredGeojson, lineColor], () => {
    for (const key of addedLine) {
      const m = markerPool.get(key)
      if (m && typeof m.setStyle === 'function') m.setStyle({ fillColor: lineColor.value })
    }
    redrawGeojson()
  }, { immediate: true })

  // ── Événements de position bus ────────────────────────────────────────────
  function onBusLocationEvent(e: Event) {
    try {
      const { busID, lat, lng, ts } = (e as CustomEvent).detail ?? {}
      if (!busID) return

      // Si aucune shape affichée, ne maintenir que le bus explicitement suivi
      if (!geojsonData.value) {
        clearBusMarkersNotIn(followedBus.value ? [followedBus.value] : [])
        if (followedBus.value !== busID) return
      }

      // Filtrer aux bus de la ligne sélectionnée
      if (selectedLine.value) {
        const list = attributions.value?.[selectedLine.value] ?? []
        if (!list.includes(busID)) return
      }

      addOrUpdateBusMarker(busID, Number(lat), Number(lng), `<strong>${busID}</strong><br/>${ts ?? ''}`)

      if (followedBus.value === busID) {
        try { leafletMap.panTo([Number(lat), Number(lng)]) } catch {}
      }
    } catch (err) {
      console.error('[oukile] onBusLocationEvent error', err)
    }
  }

  window.addEventListener('oukile:bus-location', onBusLocationEvent)

  // Nettoyage markers quand la ligne change
  watch(selectedLine, (newLine) => {
    const allowed = newLine ? (attributions.value?.[newLine] ?? []) : []
    clearBusMarkersNotIn(allowed)
  })

  // Désinscription + suppression markers quand les shapes disparaissent
  watch(geojsonData, (val) => {
    if (!val) {
      try { unsubscribeAllBuses() } catch {}
      clearBusMarkersNotIn(followedBus.value ? [followedBus.value] : [])
    }
  })

  // Désinscription quand le suivi actif ou la ligne est effacé
  watch([selectedLine, () => geojsonData.value !== null], ([line, hasGeojson]) => {
    if (!line || !hasGeojson) {
      try { unsubscribeAllBuses() } catch {}
    }
  })

  // ── Cleanup ───────────────────────────────────────────────────────────────
  onBeforeUnmount(() => {
    try { leafletMap.off('moveend zoomend', updateVisibleMarkers) } catch {}
    try { leafletMap.removeLayer(cluster) } catch {}
    try { leafletMap.removeLayer(lineLayer) } catch {}
    try { leafletMap.removeLayer(vehicleLayer) } catch {}
    if (geojsonLayer) try { leafletMap.removeLayer(geojsonLayer) } catch {}
    window.removeEventListener('oukile:bus-location', onBusLocationEvent)
    onRefreshMarkers.value = null
  })
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