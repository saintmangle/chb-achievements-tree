# Deploy card saving

Deploy the function before merging the client changes:

```sh
supabase functions deploy save-achievement-card --project-ref akjclyufpvcmanyipumx --no-verify-jwt
```

The function verifies the existing APP_SIGNING_SECRET proof itself. It uses existing TELEGRAM_BOT_TOKEN and APP_SIGNING_SECRET secrets; never put these in the client.

Verify an unsigned request returns 401, then use a real authenticated miniapp session to save a card to that same user's bot chat. Confirm exactly one photo, no caption, and the UI shows “Сохранено в чат” only after Telegram confirms success. Verify an unstarted/blocked bot yields an error, repeated taps while pending send once, and iOS/Desktop both work. Do not blindly retry a timed-out send: check the chat first.

Frontend CI does not type-check or deploy Deno functions. Function deployment and end-to-end verification remain required.
