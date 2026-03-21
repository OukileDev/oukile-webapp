import { getRedisClient } from '../../utils/redis'
import { z } from 'zod'

const paramsSchema = z.object({
  id: z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/, 'Invalid ID format')
})

const bodySchema = z.object({
  headsign: z.string().max(200).optional()
})

export default defineEventHandler(async (event) => {
  const validation = paramsSchema.safeParse({ id: event.context.params?.id })
  if (!validation.success) {
    throw createError({ statusCode: 400, message: 'Invalid ID format' })
  }
  const { id } = validation.data

  const body = await readBody(event).catch(() => ({}))
  const bodyValidation = bodySchema.safeParse(body || {})
  
  // Nettoyage basique (sans supprimer les points ou espaces qui sont valides comme St Doulchard par C. Commercial)
  let headsign = bodyValidation.success ? bodyValidation.data.headsign : undefined
  if (headsign) {
    headsign = headsign.replace(/[\r\n]/g, '').trim()
  }

  const redisKey = headsign ? `gtfsrt:attributions:${id}:${headsign}` : `gtfsrt:attributions:${id}`

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
