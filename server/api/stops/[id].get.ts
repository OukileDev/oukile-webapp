export default defineEventHandler(async (event) => {
  const stopId = event.context.params?.id
  if (!stopId) throw createError({ statusCode: 400, message: 'Stop ID is required' })

  try {
    const stop = await prisma.stops.findUnique({ where: { stop_id: stopId } })
    if (!stop) throw createError({ statusCode: 404, message: 'Stop not found' })
    return stop
  } catch (e) {
    console.error('[oukile] failed to fetch stop', e)
    throw createError({ statusCode: 500, message: 'Failed to fetch bus stop' })
  }
})
