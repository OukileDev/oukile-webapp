import { getRedisClient } from '../../../server/utils/redis'

export default defineEventHandler(async (event) => {
  try {
    const id = event.context.params?.id as string | undefined
    if (!id) throw createError({ statusCode: 400, message: 'ID required' })

    const redis = getRedisClient()
    const key = `attributions:${id}`
    const raw = await redis.get(key)
    if (!raw) return []

    try {
      const parsed = JSON.parse(raw)
      return parsed
    } catch (e) {
      // fallback: comma-separated
      if (typeof raw === 'string') return raw.split(',').map(s => s.trim()).filter(Boolean)
      return []
    }
  } catch (e) {
    console.error('Failed to read attribution', e)
    throw createError({ statusCode: 500, message: 'Failed to read attribution' })
  }
})
