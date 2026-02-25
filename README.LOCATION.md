Localisation en temps réel — configuration

Variables d'environnement attendues (fichier `.env` à la racine du projet):

- `REDIS_URL` : chaîne de connexion Redis (ex: `redis://:password@host:6379/0`). Le serveur Nuxt lit simplement la clé `attributions:<lineNumber>` via Redis.
- `NUXT_PUBLIC_LOCATE_WS_URL` : URL publique du serveur WebSocket (socket.io) que le client doit joindre, ex: `https://server.tld`.

Protocole WebSocket attendu (côté serveur externe):
- Le client émet `join` avec le nom de room `bus:<busID>` pour s'abonner.
- Le client peut émettre `leave` pour quitter la room.
- Le serveur envoie des événements `location` contenant un objet `{ busID, lat, lng, heading?, speed?, ts? }` dans la room correspondante.

Notes:
- Le frontend (Nuxt) ne tient pas de socket server; il indique seulement au navigateur comment se connecter au serveur WS externe.
- L'API `/api/attributions` renvoie un mapping `{ lineNumber: [busID, ...] }` lu depuis Redis.
