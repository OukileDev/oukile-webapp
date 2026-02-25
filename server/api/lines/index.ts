export default defineEventHandler(async (event) => {
  try {
    const lines = await prisma.routes.findMany()
    return lines
  } catch (error) {
    console.error('Error fetching bus lines:', error)
    throw createError({ statusCode: 500, message: 'Failed to fetch bus lines' })
  }
})