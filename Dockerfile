# syntax=docker/dockerfile:1

# ── Étape 1 : Build Nuxt ──────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Copier les manifestes et installer TOUTES les dépendances (dev incluses)
# npm install plutôt que npm ci : évite les erreurs de désync du lockfile
# entre versions de npm (lockfileVersion)
COPY package.json package-lock.json ./
RUN npm install

    # Copier les sources et faire le postinstall + build
COPY . .
RUN npx prisma generate && npm run postinstall && npm run build# ── Étape 2 : Image de production ──────────────────────────────────────
FROM node:22-alpine

ENV NODE_ENV=production

WORKDIR /app

# Nuxt bundle tout dans .output — pas besoin de réinstaller les dépendances
COPY --from=builder /app/.output ./.output

# Exposer le port 3000 (Nuxt par défaut)
EXPOSE 3000

# Lancer le serveur Nuxt
CMD ["node", ".output/server/index.mjs"]
