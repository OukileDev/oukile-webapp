import { defineEventHandler } from 'h3'

export default defineEventHandler(async (event) => {
  try {
    return "something"
  } catch (error) {
    console.error('Error fetching bus lines:', error)
    throw createError({ statusCode: 500, message: 'Failed to fetch bus lines' })
  }
})