export default defineEventHandler(async (event) => {
  try {
    const stops = await prisma.stops.findMany()
    return stops
  } catch (error) {
    console.error('Error fetching bus stops:', error)
    throw createError({ statusCode: 500, message: 'Failed to fetch bus stops' })
  }
})