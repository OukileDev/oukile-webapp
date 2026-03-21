/**
 * Gère le panneau d'arrêt : sélection d'un arrêt, chargement des départs,
 * et navigation vers la vue "liste des arrêts d'une ligne".
 */

export type Departure = {
  theoretical_time: string | null
  estimated_time: string | null
  delay_seconds: number | null
  route: string
  headsign: string
  route_color: string | null
  vehicle: string | null
  localizable: boolean
  trip_id?: string
}

export function useStopPanel() {
  const selectedStopId = useState<string | null>('stopPanel:stopId', () => null)
  const selectedStopName = useState<string | null>('stopPanel:stopName', () => null)
  const departures = useState<Departure[]>('stopPanel:departures', () => [])
  const isLoading = useState<boolean>('stopPanel:loading', () => false)
  const panelView = useState<'departures' | 'line-stops'>('stopPanel:view', () => 'departures')
  const selectedDeparture = useState<Departure | null>('stopPanel:departure', () => null)

  const isOpen = computed(() => selectedStopId.value !== null)
  // Signal consommé par HomeMap pour déclencher un fitBounds stop+bus au premier fix
  const fitBoundsRequested = useState<boolean>('stopPanel:fitBounds', () => false)

  async function selectStop(id: string, name: string) {
    selectedStopId.value = id
    selectedStopName.value = name
    departures.value = []
    isLoading.value = true
    panelView.value = 'departures'
    selectedDeparture.value = null
    try {
      const data = await $fetch<Departure[]>(`/api/stops/${encodeURIComponent(id)}/departures`)
      departures.value = data
    } catch (e) {
      console.error('[oukile] failed to fetch departures', e)
      departures.value = []
    } finally {
      isLoading.value = false
    }
  }

  function clearStop() {
    selectedStopId.value = null
    selectedStopName.value = null
    departures.value = []
    panelView.value = 'departures'
    selectedDeparture.value = null
  }

  function openLineStops(dep: Departure) {
    selectedDeparture.value = dep
    panelView.value = 'line-stops'
    if (dep.localizable) fitBoundsRequested.value = true
  }

  function backToDepartures() {
    panelView.value = 'departures'
    selectedDeparture.value = null
  }

  return {
    selectedStopId,
    selectedStopName,
    departures,
    isLoading,
    panelView,
    selectedDeparture,
    isOpen,
    fitBoundsRequested,
    selectStop,
    clearStop,
    openLineStops,
    backToDepartures,
  }
}
