import { getRedisClient } from '../../utils/redis'

export default defineEventHandler(async (event) => {
  const id = event.context.params?.id
  if (!id) throw createError({ statusCode: 400, message: 'ID required' })

  const headsign = getQuery(event).headsign as string | undefined
  const redisKey = headsign ? `attributions:${id}:${headsign}` : `attributions:${id}`

  try {
    const raw = await getRedisClient().get(redisKey)
    if (!raw) return []
    try {
      return JSON.parse(raw)
    } catch {
      return raw.split(',').map((s) => s.trim()).filter(Boolean)
    }
  } catch (e) {
    console.error('[oukile] failed to read attribution', e)
    throw createError({ statusCode: 500, message: 'Failed to read attribution' })
  }
})
