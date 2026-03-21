import { getRedisClient } from '../../utils/redis'
import { z } from 'zod'

const lineIdSchema = z.string().min(1).max(10).regex(/^[A-Za-z0-9_-]+$/, 'Invalid line ID format')

export default defineEventHandler(async (event) => {
  const validation = lineIdSchema.safeParse(event.context.params?.id)
  if (!validation.success) {
    throw createError({ statusCode: 400, message: 'Invalid Line ID format' })
  }
  const lineId = validation.data

  const raw = await getRedisClient().get(`gtfs:lines:${lineId}`).catch((e) => {
    console.error('[oukile] Redis error on line detail:', e)
    throw createError({ statusCode: 500, message: 'Failed to fetch line data' })
  })
  if (!raw) throw createError({ statusCode: 404, message: 'Line not found' })
  return JSON.parse(raw)
})
