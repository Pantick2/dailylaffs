# Deploy Daily Laffs + Domain + Facebook/Instagram

## Recommended architecture (for serious traffic)

- Cloud Run for API/server
- Cloud Storage for generated meme images and JSON metadata
- Cloudflare (optional) for extra CDN/WAF

This project now supports online storage directly via Google Cloud Storage.

## 0) Google Cloud setup (Cloud Run + Cloud Storage)

1. Create/select a GCP project.
2. Enable APIs:
   - Cloud Run API
   - Cloud Build API
   - Artifact Registry API
   - Cloud Storage API
3. Create a bucket (example: daily-laffs-assets).
4. Make bucket objects readable if you want direct public image URLs:
   - grant role Storage Object Viewer to allUsers on the bucket, or
   - use signed URLs (advanced).
5. Set environment variables in Cloud Run:
   - USE_GCS_STORAGE=true
   - GCS_BUCKET_NAME=daily-laffs-assets
   - GCS_PUBLIC_BASE_URL=https://storage.googleapis.com/daily-laffs-assets (optional)
   - SITE_URL=https://your-domain.com
   - OPENAI_API_KEY=...
   - + social vars (optional)

Notes:
- If USE_GCS_STORAGE=true, the app stores:
  - images in memes/*.png
  - metadata in data/memes-data.json
- If USE_GCS_STORAGE=false, fallback is local disk.

## 1) Deploy rapid pe Render

1. Urca proiectul pe GitHub.
2. In Render, apasa New + > Web Service.
3. Conecteaza repository-ul.
4. Setari service:
   - Runtime: Node
   - Build Command: npm install
   - Start Command: npm start
   - Auto-Deploy: On
5. Adauga variabilele de mediu din .env.example in Render > Environment.
6. Deploy.

Important:
- Varianta legacy (disk local) poate pierde date la restart.
- Varianta recomandata este USE_GCS_STORAGE=true.

## 1B) Deploy pe Cloud Run (recommended)

Deploy din Cloud Shell:

```bash
gcloud run deploy daily-laffs \
   --source . \
   --region europe-west1 \
   --allow-unauthenticated \
   --set-env-vars "USE_GCS_STORAGE=true,GCS_BUCKET_NAME=YOUR_BUCKET,SITE_URL=https://YOUR_DOMAIN"
```

Adauga apoi secretul OPENAI_API_KEY din Secret Manager sau direct ca env var in Cloud Run.

## 2) Legare domeniu

Exemplu: domeniu.ro

1. In Render > service > Settings > Custom Domains, adauga domeniul:
   - domeniu.ro
   - www.domeniu.ro
2. In panoul DNS al registrarului:
   - pentru www: CNAME catre target-ul dat de Render
   - pentru root (@): A/ALIAS/ANAME conform instructiunilor Render
3. Asteapta propagarea DNS (de obicei 5-60 minute, uneori mai mult).
4. Verifica SSL (Render emite automat certificatul).
5. Seteaza SITE_URL la domeniul final, de exemplu:
   - https://domeniu.ro

## 3) Facebook auto-post

Aplicatia are deja postare automata pe Facebook daca setezi:
- FACEBOOK_PAGE_ID
- FACEBOOK_PAGE_ACCESS_TOKEN

Pasii:
1. Creeaza Meta App pe developers.facebook.com.
2. Adauga produsul Facebook Login si/sau Graph API.
3. Obtine Page Access Token (long-lived) cu permisiunile necesare pentru publicare pe pagina.
4. Pune token-ul si page id in variabilele de mediu.
5. Genereaza un meme nou din API/UI si verifica postarea.

## 4) Instagram auto-post

Aplicatia publica automat pe Instagram Business/Creator daca setezi:
- INSTAGRAM_IG_USER_ID
- INSTAGRAM_ACCESS_TOKEN

Conditii:
- Cont Instagram Business/Creator.
- Contul Instagram trebuie legat la o Facebook Page.
- Token-ul trebuie sa aiba scope-uri pentru Instagram Graph publish.

Flux API folosit in cod:
1. POST /{ig-user-id}/media cu image_url + caption
2. POST /{ig-user-id}/media_publish cu creation_id

## 5) Verificari dupa deploy

1. Deschide:
   - /
   - /meme.html
   - /rss.xml
2. Ruleaza un test de generare meme (buton sau POST /api/generate-and-post).
3. Verifica logurile Render pentru erori OpenAI/Facebook/Instagram.
4. Testeaza un link de tip /m/{slug} in Facebook Sharing Debugger pentru preview corect.

## 6) Checklist scurt

- [ ] SITE_URL este domeniul real (https)
- [ ] OPENAI_API_KEY setat
- [ ] Facebook vars setate (optional)
- [ ] Instagram vars setate (optional)
- [ ] DNS + SSL active
