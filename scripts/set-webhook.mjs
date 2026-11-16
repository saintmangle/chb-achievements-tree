// Run only after deploying telegram-bot and configuring its matching secrets.
try { process.loadEnvFile(); } catch { /* Environment variables can be supplied directly. */ }
const {TELEGRAM_BOT_TOKEN,TELEGRAM_WEBHOOK_SECRET,VITE_SUPABASE_URL}=process.env;
if(!TELEGRAM_BOT_TOKEN||!TELEGRAM_WEBHOOK_SECRET||!VITE_SUPABASE_URL)throw new Error('Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and VITE_SUPABASE_URL in .env');
const url=new URL('/functions/v1/telegram-bot',VITE_SUPABASE_URL);
if(url.protocol!=='https:')throw new Error('HTTPS is required');
const response=await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:url.href,secret_token:TELEGRAM_WEBHOOK_SECRET,allowed_updates:['message'],drop_pending_updates:false})});
const result=await response.json();if(!result.ok)throw new Error(result.description||'Webhook setup failed');
console.log('Webhook enabled. Open the bot and send /start to test.');
