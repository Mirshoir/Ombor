Ombor Android/PWA + Supabase + Render

Funksiyalar:
- Kirim qilish
- Chiqim qilish
- Qoldiq va foyda hisobi
- CSV export

Stack:
- Frontend: PWA (index.html)
- Backend: Node.js HTTP server (server.js)
- Database: Supabase (Postgres)
- Deploy: Render

----------------------------------------
1) Supabase sozlash
----------------------------------------
1. Supabase project yarating.
2. Supabase SQL Editor ichida shu faylni ishga tushiring:
   supabase/schema.sql
3. Settings -> API dan quyidagilarni oling:
   - Project URL (SUPABASE_URL)
   - service_role key (SUPABASE_SERVICE_ROLE_KEY)

Muhim:
- service_role key faqat serverda bo‘ladi.
- Uni frontend yoki mobil ilovaga qo‘ymang.

----------------------------------------
2) Local run
----------------------------------------
1. .env.example dan nusxa qilib .env oching va qiymatlarni to‘ldiring:
   SUPABASE_URL=...
   SUPABASE_SERVICE_ROLE_KEY=...
   PORT=3000

2. Serverni ishga tushiring:
   node server.js

3. Brauzerda oching:
   http://localhost:3000

----------------------------------------
3) API endpointlar
----------------------------------------
- GET /api/health
- GET /api/state
- POST /api/in
- POST /api/out
- GET /api/export/csv
- DELETE /api/reset

----------------------------------------
4) Render deploy
----------------------------------------
Variant A (Blueprint):
1. GitHub repo ga push qiling.
2. Render -> New + -> Blueprint tanlang.
3. render.yaml ishlaydi, env vars ni kiriting:
   - SUPABASE_URL
   - SUPABASE_SERVICE_ROLE_KEY

Variant B (Manual Web Service):
1. Render -> New + -> Web Service.
2. Start Command: node server.js
3. Environment Variables:
   - SUPABASE_URL
   - SUPABASE_SERVICE_ROLE_KEY

Eslatma:
- Render `PORT` ni avtomatik beradi, server shu portni ishlatadi.
- Service Worker API so‘rovlarini cache qilmaydi.
