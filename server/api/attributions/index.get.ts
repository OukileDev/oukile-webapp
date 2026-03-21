import { getRedisClient, scanKeys } from '../../utils/redis'

export default defineEventHandler(async () => {
  try {
    const redis = getRedisClient()
    const keys = await scanKeys('gtfsrt:attributions:*')
    const result: Record<string, string[]> = {}
    if (!keys.length) return result

    const pipeline = redis.pipeline()
    for (const k of keys) pipeline.get(k)
    const replies = await pipeline.exec()

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!
      const raw = replies?.[i]?.[1]
      let parsed: string[] = []
      try {
        if (raw && typeof raw === 'string') parsed = JSON.parse(raw)
      } catch {
        if (typeof raw === 'string') parsed = raw.split(',').map((s) => s.trim()).filter(Boolean)
      }
      const line = key.split(':')[2] ?? key
      result[line] = parsed
    }

    return result
  } catch (e) {
    console.error('[oukile] failed to read attributions from Redis', e)
    throw createError({ statusCode: 500, message: 'Failed to read attributions' })
  }
})
