# Frontend — Dashboard Conrad Grand Luxury Hotel

Dashboard d'administration de l'agent marketing (Surya), conçu pour être
hébergé sur **Vercel** en tant que site statique. Il consomme l'API du
backend (Coolify/Hetzner) via l'URL définie dans `config.js`.

## Déploiement sur Vercel

1. Poussez ce dossier dans le dépôt (ex. `git push`).
2. Sur [vercel.com](https://vercel.com) → **Add New Project** → importez le dépôt.
3. **Root Directory** : `frontend`
4. **Framework Preset** : `Other` (site statique, aucun build)
5. **Deploy** → vous obtenez `https://xxx.vercel.app`

## Configuration

- `config.js` contient l'URL du backend (`window.API_BASE`).
  ⚠️ Si l'URL du tunnel Cloudflare change, modifiez cette ligne et redéployez.
- Au premier chargement, ouvrez la modale de connexion (🔑) et saisissez :
  - **ADMIN_API_KEY** : la clé définie côté Coolify
  - **URL de l'API** : préremplie depuis `config.js`, modifiable à chaud
    (conservée dans le `localStorage` du navigateur)

## Notes

- Le backend a déjà le CORS ouvert (`origin: true`), aucune config serveur requise.
- La clé API n'est stockée que dans le navigateur (localStorage).
