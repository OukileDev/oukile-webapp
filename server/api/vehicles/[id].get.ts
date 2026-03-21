import { getRedisClient } from '../../utils/redis'

export default defineEventHandler(async (event) => {
  const id = event.context.params?.id
  if (!id) throw createError({ statusCode: 400, message: 'ID required' })

  try {
    const raw = await getRedisClient().get(`gtfsrt:vehicle:${id}`)
    if (!raw) return null
    return JSON.parse(raw) as { route: string | null; headsign: string | null; delay: number | null; trip_id: string | null }
  } catch (e) {
    console.error('[oukile] failed to read vehicle info', e)
    throw createError({ statusCode: 500, message: 'Failed to read vehicle info' })
  }
})
