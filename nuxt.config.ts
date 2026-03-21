import { defineNuxtConfig } from 'nuxt/config'

// En production, s'assurer que l'essentiel est défini
if (process.env.NODE_ENV === 'production') {
  if (!process.env.DATABASE_URL) console.warn('[oukile] DATABASE_URL is missing!')
  if (!process.env.REDIS_URL) console.warn('[oukile] REDIS_URL is missing!')
}

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxt/ui', '@nuxtjs/leaflet', '@nuxt/icon'],

  // Configuration CSS
  css: [
    'leaflet/dist/leaflet.css',
    'leaflet.markercluster/dist/MarkerCluster.css',
    'leaflet.markercluster/dist/MarkerCluster.Default.css',
    '~/assets/css/main.css'
  ],

  // Configuration de la vue d'ensemble
  runtimeConfig: {
    public: {
      LOCATE_WS_URL: process.env.NUXT_PUBLIC_LOCATE_WS_URL || '',
      SHAPES_CDN_URL: process.env.NUXT_PUBLIC_SHAPES_CDN_URL || 'https://oukile.b-cdn.net/shapes'
    }
  },
  routeRules: {
    '/api/**': { cors: true }
  },
  app: {
    head: {
      viewport: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover',
      meta: [
        { charset: 'utf-8' },
        { name: 'theme-color', content: '#2563eb' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
        { name: 'apple-mobile-web-app-title', content: 'Oukile' }
      ],
      link: [
        { rel: 'manifest', href: '/manifest.json' },
        { rel: 'apple-touch-icon', href: '/icon-192.png' }
      ]
    }
  }
})