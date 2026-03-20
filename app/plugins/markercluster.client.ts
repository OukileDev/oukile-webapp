/**
 * Charge leaflet.markercluster côté client AVANT le montage des composants.
 *
 * Problème Vite/prod : bundlé en ESM, leaflet.markercluster étend la copie
 * interne du module Leaflet — pas window.L. En fixant window.L = L après
 * l'extension, on garantit que window.L.markerClusterGroup est disponible
 * quand LMap (use-global-leaflet) et onMapReady s'exécutent.
 */
export default defineNuxtPlugin(async () => {
  const L = (await import('leaflet')).default
  await import('leaflet.markercluster')
  window.L = L as any
})
