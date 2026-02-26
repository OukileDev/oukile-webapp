/**
 * Chargement et mise en cache des arrêts de bus.
 */

export type Stop = {
  stop_id: string
  stop_name: string
  stop_lat: number
  stop_lon: number
}

export function useStops() {
  const stops = useState<Stop[]>('stops', () => [])

  const locations = computed(() =>
    stops.value.map((s) => ({
      id: s.stop_id,
      name: s.stop_name,
      lat: s.stop_lat,
      lng: (s as any).stop_lon ?? (s as any).stop_long ?? 0
    }))
  )

  async function loadStops() {
    if (stops.value.length > 0) return // déjà chargés
    try {
      const data = await $fetch<Stop[]>('/api/stops')
      stops.value = data || []
    } catch (e) {
      console.error('[oukile] failed to load stops', e)
      stops.value = []
    }
  }

  return { stops, locations, loadStops }
}
