import { getRedisClient } from '../../utils/redis'

export default defineEventHandler(async () => {
  const raw = await getRedisClient().get('gtfs:lines:all').catch((e) => {
    console.error('[oukile] Redis error on lines:', e)
    throw createError({ statusCode: 500, message: 'Failed to fetch bus lines' })
  })
  if (!raw) throw createError({ statusCode: 503, message: 'GTFS data not loaded yet' })
  return JSON.parse(raw)
})
