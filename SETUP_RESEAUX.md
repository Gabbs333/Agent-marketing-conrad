# 🔌 Connexion Facebook & TikTok

Guide pas-à-pas pour connecter l'agent aux réseaux sociaux. À tout moment, vérifiez l'état des connexions : **Dashboard → onglet Intégrations** ou `GET /api/integrations/status`.

> Après avoir écrit des tokens dans `.env`, **redémarrez l'agent** (`npm run dev`), puis passez `DEMO_MODE=false`.

## Facebook (page, Messenger, WhatsApp, Meta Ads)

### 1. Créer l'application Meta

1. Allez sur [developers.facebook.com](https://developers.facebook.com) → **Mes applications → Créer une application**.
2. Type : **Entreprise** (ou « Autre » → Entreprise). Nom : `Conrad Grand Luxury Hotel`.
3. Notez **l'ID de l'application** et le **secret** (`FB_APP_ID`, `FB_APP_SECRET`).

### 2. Obtenir le token de votre Page

**Option A — via l'agent (recommandé)** :
1. Récupérez un **User Access Token** court :
   [developers.facebook.com/tools/explorer](https://developers.facebook.com/tools/explorer) → sélectionnez votre app → **Generate Access Token** (permissions : `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `read_insights`).
2. Dashboard → **Intégrations → Connecter Facebook** : collez le token (et le Page ID si demandé), cochez « Écrire dans .env ».
3. L'agent échange le token en **longue durée**, liste vos pages, récupère le **Page Access Token** et l'écrit dans `.env` (`FB_PAGE_TOKEN`, `FB_PAGE_ID`). Redémarrez l'agent.

**Option B — manuellement** :
- Dans le Graph API Explorer, générez un token **de page** (sélectionnez votre page dans le menu) et collez-le directement dans `FB_PAGE_TOKEN` + `FB_PAGE_ID`.

### 3. Messenger (messages + liens m.me)

1. App Meta → **Produits → Messenger → Configurer** (ou Webhooks).
2. **Webhooks** : URL de rappel = `https://votre-domaine.com/api/messaging/webhook`, jeton de vérification = `WEBHOOK_VERIFY_TOKEN`.
3. Abonnez la page, puis souscrivez aux champs : `messages`, `messaging_referrals`, `messaging_optins`.
4. Le lien m.me de chaque campagne est généré par `GET /api/messaging/messenger-link/:campaignId`.

### 4. WhatsApp Business (nurturing WhatsApp)

1. [business.facebook.com](https://business.facebook.com) → ajoutez un **numéro WhatsApp Business** (ou créez-en un).
2. Numéro → **Paramètres de l'API** : notez l'**ID du numéro** (`WHATSAPP_PHONE_NUMBER_ID`) et générez un **token** (`WHATSAPP_ACCESS_TOKEN`).
3. **Créez les 3 templates** (Gestionnaire WhatsApp → Modèles de message) avec les variables `{{1}}` prénom, `{{2}}` hôtel, `{{3}}` offre :
   - `hotel_welcome` — « Bonjour {{1}} ! Merci pour votre intérêt pour {{2}}… »
   - `hotel_followup` — « {{1}}, votre séjour à {{2}} vous attend. {{3}}… »
   - `hotel_offer` — « Dernière chance {{1}} : {{3}} chez {{2}}… »
4. Webhook : même URL que Messenger, champ `messages`.

### 5. Meta Ads (optionnel)

1. [business.facebook.com](https://business.facebook.com) → **Compte publicitaire** : notez l'ID (`act_XXXX`, soit `META_AD_ACCOUNT_ID`).
2. Créez un **System User** admin du compte publicitaire → générez un token (`META_ACCESS_TOKEN`).

## TikTok (publication + Ads)

### 1. Créer l'application

1. [developers.tiktok.com](https://developers.tiktok.com) → **Create app**.
2. Notez **Client Key** (`TIKTOK_CLIENT_KEY`) et **Client Secret** (`TIKTOK_CLIENT_SECRET`).
3. Ajoutez les produits/scopes :
   - **Login Kit** → scope `user.info.basic`
   - **Content Posting API** → scope `video.publish`
4. Déclarez une **URI de redirection** (ex. `https://votre-domaine.com/callback`, ou `http://localhost:3000/callback` en dev).

### 2. Connecter le compte TikTok (OAuth)

1. Dashboard → **Intégrations → Connecter TikTok** : entrez l'URI de redirection, générez l'**URL d'autorisation** et ouvrez-la.
2. Autorisez l'application → TikTok redirige vers `votre-uri?code=XXXX…`.
3. Collez le code dans le formulaire, cochez « Écrire dans .env » → l'agent échange le code contre l'**access token** et l'écrit dans `.env`. Redémarrez l'agent.
4. ⚠️ La **Content Posting API exige une revue d'application** (Audience Test requis). En attendant la validation, testez en `DEMO_MODE=true`.

### 3. TikTok Ads (optionnel)

1. [business.tiktok.com](https://business.tiktok.com) → **Advertiser ID** (`TIKTOK_ADVERTISER_ID`).
2. App TikTok → **Marketing API (TikTok Business API)** → générez l'**Access Token** et notez l'**Identity ID** (`TIKTOK_IDENTITY_ID`).

## Vérification finale

```bash
# État de chaque intégration (configuré / valide)
curl http://localhost:3000/api/integrations/status | python3 -m json.tool

# Passer en réel
# .env → DEMO_MODE=false, puis redémarrer :
npm run dev
```

| Service | Variables .env |
|---|---|
| Facebook Page + Messenger | `FB_PAGE_ID`, `FB_PAGE_TOKEN`, `FB_APP_ID`, `FB_APP_SECRET`, `WEBHOOK_VERIFY_TOKEN` |
| WhatsApp Business | `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` |
| Meta Ads | `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID` |
| TikTok publication | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_ACCESS_TOKEN` |
| TikTok Ads | `TIKTOK_ADVERTISER_ID`, `TIKTOK_IDENTITY_ID` |
| OpenAI | `OPENAI_API_KEY` |
| Email | `SMTP_*` |
