export default defineEventHandler(async () => {
  try {
    return await prisma.routes.findMany()
  } catch (e) {
    console.error('[oukile] failed to fetch bus lines', e)
    throw createError({ statusCode: 500, message: 'Failed to fetch bus lines' })
  }
})
