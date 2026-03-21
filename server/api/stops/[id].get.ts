import { getRedisClient } from '../../utils/redis'

export default defineEventHandler(async (event) => {
  const stopId = event.context.params?.id
  if (!stopId) throw createError({ statusCode: 400, message: 'Stop ID is required' })

  const raw = await getRedisClient().get(`gtfs:stops:${stopId}`).catch((e) => {
    console.error('[oukile] Redis error on stop:', e)
    throw createError({ statusCode: 500, message: 'Failed to fetch bus stop' })
  })
  if (!raw) throw createError({ statusCode: 404, message: 'Stop not found' })
  return JSON.parse(raw)
})
