// server/utils/prisma.ts
import pg from 'pg';
import { PrismaPg } from "@prisma/adapter-pg";

// Attention au chemin d'import selon ton réglage 'output' dans le schéma
import { PrismaClient } from "../../app/generated/prisma/client.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });