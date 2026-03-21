// server/utils/prisma.ts
// Désactivable via DISABLE_PRISMA=true (ex : quand Redis est la source de vérité)
import pg from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../app/generated/prisma/client.js'

export let prisma: PrismaClient | null = null

if (process.env.DISABLE_PRISMA !== 'true') {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl || databaseUrl === 'None') throw new Error('[oukile] DATABASE_URL is not set')
  const pool = new pg.Pool({ connectionString: databaseUrl })
  const adapter = new PrismaPg(pool)
  prisma = new PrismaClient({ adapter })
}
