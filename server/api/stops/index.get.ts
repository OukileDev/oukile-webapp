export default defineEventHandler(async () => {
  try {
    return await prisma.stops.findMany()
  } catch (e) {
    console.error('[oukile] failed to fetch stops', e)
    throw createError({ statusCode: 500, message: 'Failed to fetch bus stops' })
  }
})
