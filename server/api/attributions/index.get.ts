import { getRedisClient } from '../../utils/redis'

export default defineEventHandler(async (event) => {
  try {
    const redis = getRedisClient()

    // On suppose que les clés sont de la forme attributions:<lineNumber>
    const keys = await redis.keys('attributions:*')
  const result: Record<string, string[]> = {}

    if (keys.length === 0) return result

    // pipeline pour lire plusieurs clés rapidement
    const pipeline = redis.pipeline()
    for (const k of keys) pipeline.get(k)
    const replies = await pipeline.exec()

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      const reply = replies?.[i]
      const raw = reply ? reply[1] : null
      let parsed: string[] = []
      try {
        if (raw && typeof raw === 'string') parsed = JSON.parse(raw)
      } catch (e) {
        if (typeof raw === 'string') parsed = raw.split(',').map((s) => s.trim()).filter(Boolean)
      }
      const parts = key ? key.split(':') : [key]
      const line = parts[1] ?? key ?? ''
      if (line) result[line] = parsed
    }

    return result
  } catch (e) {
    console.error('Failed to read attributions from Redis', e)
    throw createError({ statusCode: 500, message: 'Failed to read attributions' })
  }
})
