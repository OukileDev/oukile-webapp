import { z } from 'zod'
import { prisma } from '../../../utils/prisma'
import { getRedisClient } from '../../../utils/redis'

const paramsSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]+$/).max(100),
})

interface RtTrip {
  vehicle: string
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

  const rows = await prisma.$queryRaw<Array<{
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
      AND st.crossing_time_seconds > ${secondsFromMidnight}
    ORDER BY st.crossing_time_seconds ASC
    LIMIT 20
  `

  const rtRaw = await getRedisClient().get(`gtfsrt:stop:${stopId}`).catch(() => null)
  const rtEntries: RtTrip[] = rtRaw ? JSON.parse(rtRaw) : []

  // Index par route|headsign → premier match
  const rtIndex = new Map<string, RtTrip>()
  for (const rt of rtEntries) {
    const key = `${rt.route}|${rt.headsign}`
    if (!rtIndex.has(key)) rtIndex.set(key, rt)
  }

  return rows.map((row) => {
    const rt = rtIndex.get(`${row.route_short_name}|${row.trip_headsign}`)
    const delaySec = rt?.delay ?? null

    let estimatedTime: string | null = null
    if (delaySec !== null) {
      const estSec = row.crossing_time_seconds + delaySec
      const h = Math.floor(estSec / 3600) % 24
      const m = Math.floor((estSec % 3600) / 60)
      estimatedTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    }

    return {
      theoretical_time: row.crossing_time_text?.slice(0, 5) ?? null,
      estimated_time: estimatedTime,
      delay_seconds: delaySec,
      route: row.route_short_name ?? '',
      headsign: row.trip_headsign ?? '',
      route_color: row.route_color ? `#${row.route_color}` : null,
      vehicle: rt?.vehicle ?? null,
      localizable: !!rt?.vehicle,
    }
  })
})
