import { z } from 'zod'
import { prisma } from '../../../utils/prisma'
import { getRedisClient } from '../../../utils/redis'

const paramsSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]+$/).max(100),
})

interface RtTrip {
  trip_id: string
  vehicle: string | null
  route: string
  headsign: string
  delay: number | null
}

export default defineEventHandler(async (event) => {
  const params = await getValidatedRouterParams(event, paramsSchema.parse)
  const stopId = params.id

  if (!prisma) throw createError({ statusCode: 503, message: 'Database unavailable' })

  const now = new Date()
  const secondsFromMidnight = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()

  // Buffer de 30 min pour inclure les trips retardés dont l'heure théorique est passée
  const DELAY_BUFFER_S = 1800

  const rawRows = await prisma.$queryRaw<Array<{
    crossing_time_text: string
    crossing_time_seconds: number
    trip_id: string
    trip_headsign: string | null
    route_short_name: string | null
    route_color: string | null
  }>>`
    SELECT
      st.crossing_time_text,
      st.crossing_time_seconds,
      t.trip_id,
      t.trip_headsign,
      r.route_short_name,
      r.route_color
    FROM stop_times st
    JOIN trips t ON t.trip_id = st.trip_id
    JOIN routes r ON r.route_id = t.route_id
    JOIN calendar_dates cd ON cd.service_id = t.service_id
    WHERE st.stop_id = ${stopId}
      AND cd.date = CURRENT_DATE
      AND cd.exception_type = 1
      AND st.crossing_time_seconds > ${secondsFromMidnight - DELAY_BUFFER_S}
    ORDER BY st.crossing_time_seconds ASC
    LIMIT 25
  `

  const rtRaw = await getRedisClient().get(`gtfsrt:stop:${stopId}`).catch(() => null)
  const rtEntries: RtTrip[] = rtRaw ? JSON.parse(rtRaw) : []

  // Index par trip_id — matching exact, évite de confondre deux services différents
  // de la même ligne/direction sur des plages horaires distinctes.
  const rtIndex = new Map<string, RtTrip>()
  for (const rt of rtEntries) {
    if (rt.trip_id && !rtIndex.has(rt.trip_id)) rtIndex.set(rt.trip_id, rt)
  }

  // Post-filtre : ne garder que les trips dont l'heure estimée (théorique + retard) est encore à venir.
  // Cela évite de masquer un trip retardé dont l'heure théorique est légèrement passée.
  const rows = rawRows.filter(row => {
    const rt = rtIndex.get(row.trip_id)
    return row.crossing_time_seconds + (rt?.delay ?? 0) >= secondsFromMidnight
  })

  // Si aucun départ aujourd'hui, on charge les premiers trajets de demain
  let nextDayRows: typeof rows = []
  if (rows.length === 0) {
    nextDayRows = await prisma.$queryRaw<typeof rows>`
      SELECT
        st.crossing_time_text,
        st.crossing_time_seconds,
        t.trip_id,
        t.trip_headsign,
        r.route_short_name,
        r.route_color
      FROM stop_times st
      JOIN trips t ON t.trip_id = st.trip_id
      JOIN routes r ON r.route_id = t.route_id
      JOIN calendar_dates cd ON cd.service_id = t.service_id
      WHERE st.stop_id = ${stopId}
        AND cd.date = CURRENT_DATE + INTERVAL '1 day'
        AND cd.exception_type = 1
      ORDER BY st.crossing_time_seconds ASC
      LIMIT 10
    `
  }

  // Un véhicule ne doit apparaître que sur le voyage le plus proche où il est actif.
  const usedVehicles = new Set<string>()

  function mapRow(row: typeof rows[number], next_day: boolean) {
    const rt = rtIndex.get(row.trip_id)
    const delaySec = next_day ? null : (rt?.delay ?? null)

    let estimatedTime: string | null = null
    if (delaySec !== null) {
      const estSec = row.crossing_time_seconds + delaySec
      const h = Math.floor(estSec / 3600) % 24
      const m = Math.floor((estSec % 3600) / 60)
      estimatedTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    }

    let vehicle: string | null = null
    if (!next_day && rt?.vehicle && !usedVehicles.has(rt.vehicle)) {
      vehicle = rt.vehicle
      usedVehicles.add(rt.vehicle)
    }

    return {
      theoretical_time: row.crossing_time_text?.slice(0, 5) ?? null,
      estimated_time: estimatedTime,
      delay_seconds: delaySec,
      route: row.route_short_name ?? '',
      headsign: row.trip_headsign ?? '',
      route_color: row.route_color ? `#${row.route_color}` : null,
      vehicle,
      localizable: !!vehicle,
      next_day,
    }
  }

  if (rows.length > 0) return rows.map(row => mapRow(row, false))
  return nextDayRows.map(row => mapRow(row, true))
})
