# Ачивки в реальной жизни

Telegram Mini App: процедурно нарисованное пиксельное дерево достижений. 14 фиксированных ветвей (155 достижений из `src/data/achievements_data.json`), корни — пользовательские достижения. Прогресс и корни хранятся в Supabase, привязаны к Telegram user id, подтверждённому через `initData`.

## Стек

- Frontend: React + TypeScript + Vite, дерево рисуется на `<canvas>` без картинок (см. `src/tree/`), деплой на GitHub Pages.
- Backend: Supabase — Postgres (RLS) + Edge Function `verify-init-data`, которая проверяет подпись Telegram `initData` (см. `supabase/`).

## Локальный запуск

```bash
npm install
npm run dev
```

Требует `.env` в корне (см. `.env` — не коммитится, значения только локальные) с `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`. Вне Telegram-клиента приложение покажет экран «открой через Telegram» — это ожидаемо, `initData` там пустой.

## Разовая настройка Supabase (сделать один раз через Supabase Dashboard / CLI)

1. **SQL-миграция.** Выполнить `supabase/migrations/0001_init.sql` в SQL Editor проекта (или `supabase db push`, если используешь Supabase CLI и `supabase link`).
2. **Секрет для HMAC-подписи.** В `.env` уже сгенерирован `APP_SIGNING_SECRET` — вставь то же самое значение в таблицу `app_secrets` (см. комментарий в самой миграции):
   ```sql
   insert into app_secrets (key, value) values ('app_signing_secret', '<значение APP_SIGNING_SECRET из .env>')
   on conflict (key) do update set value = excluded.value;
   ```
3. **Секреты Edge Function.** Через Supabase CLI (или Dashboard → Edge Functions → Secrets):
   ```bash
   supabase secrets set TELEGRAM_BOT_TOKEN=... APP_SIGNING_SECRET=...
   ```
   (значения — из `.env`).
4. **Деплой функции:**
   ```bash
   supabase functions deploy verify-init-data
   ```

## Деплой на GitHub Pages

Пуш в `main` триггерит `.github/workflows/deploy.yml`. Нужно один раз:

1. В настройках репозитория → **Settings → Pages** → Source: **GitHub Actions**.
2. В **Settings → Secrets and variables → Actions** добавить два секрета (значения из `.env`, они не секретные по своей природе, но так их проще ротировать):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

После первого успешного деплоя сайт будет на `https://saintmangle.github.io/chb-achievements-tree/`.

## Настройка бота в @BotFather (после деплоя)

1. `/mybots` → выбрать бота → **Bot Settings → Menu Button** → указать URL задеплоенного сайта.
2. Либо `/newapp`, если нужен полноценный Mini App с отдельной карточкой — тоже указать тот же URL.
3. Если `TELEGRAM_BOT_TOKEN` когда-либо попадёт в публичный коммит — сразу перевыпустить через `/token` в `/mybots`.
