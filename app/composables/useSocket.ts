/**
 * Gestion du socket Socket.IO (singleton par page).
 * Expose : ensureSocket, followBus, stopFollowing, subscribeBusesForLine, unsubscribeAllBuses
 */

import type { Socket } from 'socket.io-client'

let socket: Socket | null = null
const joinedRooms = new Set<string>()
// Compteur de génération : incrémenté à chaque unsubscribeAllBuses pour annuler
// les abonnements async en cours qui se résoudraient trop tard.
let subscribeGeneration = 0

export function useSocket() {
  const runtimeConfig = useRuntimeConfig()
  const followedBus = useState<string | null>('followedBus', () => null)

  async function ensureSocket(): Promise<Socket | null> {
    if (socket) return socket

    const { io } = await import('socket.io-client')
    const base =
      (runtimeConfig?.public?.LOCATE_WS_URL as string) ||
      (process.env.NUXT_PUBLIC_LOCATE_WS_URL as string) ||
      ''

    if (!base) {
      console.warn('[oukile] NUXT_PUBLIC_LOCATE_WS_URL not set — socket will not connect')
      return null
    }

    // Refuse de connecter si l'URL WS n'a pas de port explicite (évite de taper le serveur Nuxt)
    try {
      const u = new URL(base)
      if ((u.protocol === 'ws:' || u.protocol === 'wss:') && !u.port) {
        console.error(
          `[oukile] WS URL '${base}' has no explicit port — refusing. ` +
          `Set NUXT_PUBLIC_LOCATE_WS_URL to e.g. 'ws://localhost:4000'`
        )
        return null
      }
    } catch {
      console.warn('[oukile] invalid NUXT_PUBLIC_LOCATE_WS_URL', base)
    }

    socket = io(base, { transports: ['websocket'] })
    socket.on('connect_error', (err) => console.error('[oukile] socket connect error', err))
    socket.on('connect', () => console.log('[oukile] socket connected', socket?.id))
    socket.on('disconnect', (reason) => console.log('[oukile] socket disconnected', reason))

    // Handler générique : normalise et dispatche un CustomEvent window
    if (!(socket as any).__oukile_listener_attached) {
      const forwardPayload = (payload: any) => {
        try {
          if (!payload) return
          const busID = payload.busID ?? payload.id ?? payload.bus ?? payload.bus_id ?? payload.vehicle
          const lat = payload.lat ?? payload.latitude ?? payload.Lat ?? payload.Latitude
          const lng = payload.lng ?? payload.lon ?? payload.longitude ?? payload.Lon
          const ts = payload.ts ?? payload.time ?? payload.timestamp
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('oukile:bus-location', {
                detail: { busID, lat: Number(lat), lng: Number(lng), ts, raw: payload }
              })
            )
          }
        } catch (e) {
          console.error('[oukile] failed to forward socket payload', e)
        }
      }

      for (const ev of ['location', 'busUpdate', 'position', 'update', 'bus_location']) {
        socket.on(ev, forwardPayload)
      }
      ;(socket as any).__oukile_listener_attached = true
    }

    return socket
  }

  async function followBus(busID: string) {
    try {
      const s = await ensureSocket()
      if (s && !joinedRooms.has(busID)) {
        s.emit('join', `bus:${busID}`)
        s.emit('join_bus', busID)
        s.emit('subscribe', `bus:${busID}`)
        s.emit('subscribe_bus', busID)
        joinedRooms.add(busID)
        console.log('[oukile] subscribed to bus', busID)
      }
      followedBus.value = busID
    } catch (e) {
      console.error('[oukile] followBus error', e)
    }
  }

  function stopFollowing() {
    if (socket && followedBus.value) {
      try { socket.emit('leave_bus', followedBus.value) } catch {}
      joinedRooms.delete(followedBus.value)
    }
    followedBus.value = null
  }

  async function subscribeBusesForLine(busList: string[]) {
    if (!busList.length) return
    const gen = subscribeGeneration
    const s = await ensureSocket()
    // Si unsubscribeAllBuses a été appelé pendant l'await, on annule
    if (gen !== subscribeGeneration) return
    if (!s) return
    for (const bus of busList) {
      if (!joinedRooms.has(bus)) {
        s.emit('join', `bus:${bus}`)
        s.emit('join_bus', bus)
        s.emit('subscribe', `bus:${bus}`)
        s.emit('subscribe_bus', bus)
        joinedRooms.add(bus)
        console.log('[oukile] subscribed to bus', bus)
      }
    }
  }

  function unsubscribeAllBuses() {
    subscribeGeneration++ // invalide tous les subscribeBusesForLine en cours
    if (!socket) {
      joinedRooms.clear()
      return
    }
    for (const bus of Array.from(joinedRooms)) {
      try { socket.emit('leave_bus', bus) } catch {}
    }
    joinedRooms.clear()
    console.log('[oukile] unsubscribed all buses')
  }

  function disconnectSocket() {
    try { socket?.disconnect() } catch {}
    socket = null
  }

  return {
    followedBus,
    followBus,
    stopFollowing,
    subscribeBusesForLine,
    unsubscribeAllBuses,
    disconnectSocket,
  }
}
