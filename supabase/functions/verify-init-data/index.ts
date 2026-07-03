// Supabase Edge Function: verify-init-data
//
// Validates a Telegram Mini App `initData` string server-side (per
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
// using the bot token, which never leaves this function. On success it returns a
// short-lived HMAC-signed proof of the telegram_user_id that the client attaches
// to every Supabase request; RLS policies re-verify that signature (see
// supabase/migrations/0001_init.sql). This is the only server-side logic the app
// needs — no separate auth/session service.

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const SIGNING_SECRET = Deno.env.get("APP_SIGNING_SECRET");

const MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60; // 24h
const PROOF_TTL_SECONDS = 24 * 60 * 60; // 24h

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function hmacSha256Hex(keyBytes: BufferSource, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyTelegramInitData(initData: string, botToken: string) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false as const, reason: "missing hash" };
  params.delete("hash");

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const secretKeyBytes = await crypto.subtle.sign(
    "HMAC",
    secretKey,
    new TextEncoder().encode(botToken),
  );

  const computedHash = await hmacSha256Hex(secretKeyBytes, dataCheckString);
  if (computedHash !== hash) {
    return { ok: false as const, reason: "bad signature" };
  }

  const authDate = Number(params.get("auth_date") ?? "0");
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!authDate || nowSeconds - authDate > MAX_INIT_DATA_AGE_SECONDS) {
    return { ok: false as const, reason: "stale init data" };
  }

  const userRaw = params.get("user");
  if (!userRaw) return { ok: false as const, reason: "missing user" };

  let user: { id: number; first_name?: string; username?: string };
  try {
    user = JSON.parse(userRaw);
  } catch {
    return { ok: false as const, reason: "malformed user" };
  }
  if (!user?.id) return { ok: false as const, reason: "missing user id" };

  return { ok: true as const, user };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method not allowed" }, 405);
  }
  if (!BOT_TOKEN || !SIGNING_SECRET) {
    return jsonResponse({ error: "server misconfigured" }, 500);
  }

  let initData: string | undefined;
  try {
    const body = await req.json();
    initData = body?.initData;
  } catch {
    return jsonResponse({ error: "invalid json body" }, 400);
  }
  if (!initData || typeof initData !== "string") {
    return jsonResponse({ error: "missing initData" }, 400);
  }

  const result = await verifyTelegramInitData(initData, BOT_TOKEN);
  if (!result.ok) {
    return jsonResponse({ error: result.reason }, 401);
  }

  const exp = Math.floor(Date.now() / 1000) + PROOF_TTL_SECONDS;
  const sig = await hmacSha256Hex(
    new TextEncoder().encode(SIGNING_SECRET),
    `${result.user.id}:${exp}`,
  );

  return jsonResponse({
    telegram_user_id: result.user.id,
    first_name: result.user.first_name ?? null,
    username: result.user.username ?? null,
    exp,
    sig,
  });
});
