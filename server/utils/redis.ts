import Redis from 'ioredis'

let client: Redis | null = null

export function getRedisClient(): Redis {
  if (client) return client
  const url = process.env.REDIS_URL || process.env.REDIS_URI
  if (!url) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[oukile] REDIS_URL is required in production')
    }
    console.warn('[oukile] REDIS_URL is not set, falling back to redis://127.0.0.1:6379')
  }
  client = new Redis(url || 'redis://127.0.0.1:6379')
  client.on('error', (err) => console.error('Redis error', err))
  return client
}

export async function scanKeys(pattern = '*'): Promise<string[]> {
  const c = getRedisClient()
  const keys: string[] = []
  let cursor = '0'
  do {
    // eslint-disable-next-line no-await-in-loop
    const res = await c.scan(cursor, 'MATCH', pattern, 'COUNT', '100')
    cursor = res[0]
    const ks = res[1] as string[]
    keys.push(...ks)
  } while (cursor !== '0')
  return keys
}
