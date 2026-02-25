export default defineEventHandler(async (event) => {
  try {
    const lineId = event.context.params?.id
    if (!lineId) {
      throw createError({ statusCode: 400, message: 'Line ID is required' })
    }

    const network = await prisma.network.findUnique({
      where: { line_number: lineId }
    })

    if (!network) {
      throw createError({ statusCode: 404, message: 'Line not found' })
    }

    // Parse both stop lists (stored as JSON strings)
    const parseStopList = (raw: string | null): Array<{ stop_id: string; stop_name: string }> => {
      if (!raw) return []
      try {
        return JSON.parse(raw)
      } catch {
        return []
      }
    }

    const list1 = parseStopList(network.stop_list_1)
    const list2 = parseStopList(network.stop_list_2)

    // Collect all unique stop_ids across both directions
    const allIds = [...new Set([...list1, ...list2].map((s) => s.stop_id))]

    // Fetch coordinates from stops table
    const stopRows = await prisma.stops.findMany({
      where: { stop_id: { in: allIds } },
      select: { stop_id: true, stop_name: true, stop_lat: true, stop_lon: true }
    })

    const coordMap = new Map(stopRows.map((s) => [s.stop_id, s]))

    const enrichList = (list: Array<{ stop_id: string; stop_name: string }>) =>
      list
        .map((s) => {
          const row = coordMap.get(s.stop_id)
          if (!row) return null
          return {
            stop_id: row.stop_id,
            stop_name: row.stop_name,
            stop_lat: row.stop_lat,
            stop_lon: row.stop_lon
          }
        })
        .filter(Boolean)

    // Fetch route color from routes table (route_short_name matches line_number)
    const routeRow = await prisma.routes.findFirst({
      where: { route_short_name: lineId },
      select: { route_color: true }
    })

    return {
      direction_name_1: network.direction_name_1 ?? null,
      stops_1: enrichList(list1),
      direction_name_2: network.direction_name_2 ?? null,
      stops_2: enrichList(list2),
      route_color: routeRow?.route_color ?? null
    }
  } catch (error) {
    console.error('Error fetching stops for line:', error)
    throw createError({ statusCode: 500, message: 'Failed to fetch stops for line' })
  }
})
