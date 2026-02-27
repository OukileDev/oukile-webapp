# syntax=docker/dockerfile:1

# ── Étape 1 : Build Nuxt ──────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Copier les manifestes et installer TOUTES les dépendances (dev incluses)
COPY package.json package-lock.json ./
RUN npm ci

# Copier les sources et faire le postinstall + build
COPY . .
RUN npm run postinstall && npm run build

# ── Étape 2 : Image de production ──────────────────────────────────────
FROM node:22-alpine

ENV NODE_ENV=production

WORKDIR /app

# Installer uniquement les dépendances de production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copier le .output (dossier généré par Nuxt) depuis l'étape builder
COPY --from=builder /app/.output ./.output

# Exposer le port 3000 (Nuxt par défaut)
EXPOSE 3000

# Lancer le serveur Nuxt
CMD ["node", ".output/server/index.mjs"]
