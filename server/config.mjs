/** Configuration from the environment, checked once at start-up. */
export function loadConfig(env = process.env) {
  const list = v => (v ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const code = (name, v) => {
    if (!v) return null;
    if (v.length < 12) throw new Error(`${name} must be at least 12 characters`);
    return v;
  };
  const config = {
    port: Number(env.PORT ?? 5670),
    host: env.HOST ?? '0.0.0.0',
    dataDir: env.DATA_DIR ?? './data',
    appleAudience: env.APPLE_AUDIENCE ?? 'com.jkperformance.app',
    coachEmails: list(env.COACH_EMAILS),
    primaryCoachEmail: env.PRIMARY_COACH_EMAIL?.trim().toLowerCase() || null,
    supportEmail: env.SUPPORT_EMAIL ?? '',
    // Where the server is reached from outside: calendar feed and desk links.
    publicUrl: env.PUBLIC_URL ?? 'https://jk.strangeramblings.com',
    // Testing: no plan required for services, and plans are picked without payment.
    gateServices: env.GATE_SERVICES === 'true',
    payments: env.PAYMENTS === 'on',
    demoCode: code('DEMO_CODE', env.DEMO_CODE),
    demoCoachCode: code('DEMO_COACH_CODE', env.DEMO_COACH_CODE),
    // One Apple key (.p8) signs push notifications and Sign in with Apple's
    // token calls. Without all three, push is off and revocation is skipped.
    apple: env.APPLE_KEY_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_FILE
      ? { keyId: env.APPLE_KEY_ID, teamId: env.APPLE_TEAM_ID, keyFile: env.APPLE_KEY_FILE }
      : null,
    // Android. Google sign-in: the OAuth client ids whose ID tokens we accept
    // (the web client the app asks Credential Manager for). Apple on the web:
    // the Services ID, with return URL <PUBLIC_URL>/api/auth/apple/callback.
    googleClientIds: (env.GOOGLE_CLIENT_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean),
    appleServicesId: env.APPLE_SERVICES_ID?.trim() || null,
    // Firebase Cloud Messaging service account JSON (Android push); off without it.
    fcmServiceAccountFile: env.FCM_SERVICE_ACCOUNT_FILE || null,
    // The APK download page is /android/<token>; without a token there is none.
    androidDownloadToken: code('ANDROID_DOWNLOAD_TOKEN', env.ANDROID_DOWNLOAD_TOKEN),
    // Tests swap this for a recorder; see apple.mjs.
    pushTransport: null,
    logRequests: env.LOG_REQUESTS === '1',
    fetchImpl: fetch,
    // The AI (docs/design/desk-v2.md 3.13): OpenRouter only with a key AND a model; otherwise the labelled stub.
    // No model id is hard-coded. Demo accounts always use the stub.
    ai: {
      key: env.OPENROUTER_API_KEY || null,
      model: env.AI_MODEL || null,
      audioModel: env.AI_AUDIO_MODEL || null,
      dailyCalls: Number(env.AI_DAILY_CALLS ?? 300),
      dailyAudioSeconds: Number(env.AI_DAILY_AUDIO_SECONDS ?? 7200),
      clientDailyNotes: Number(env.AI_CLIENT_DAILY_NOTES ?? 20),
      clientDailyAudioSeconds: Number(env.AI_CLIENT_DAILY_AUDIO_SECONDS ?? 1800),
      disabled: env.AI_DISABLED === '1',
      baseUrl: 'https://openrouter.ai/api/v1',
    },
    // Voice and letter recordings are re-encoded with ffmpeg (audio.mjs).
    ffmpegPath: env.FFMPEG_PATH || 'ffmpeg',
  };
  for (const k of ['dailyCalls', 'dailyAudioSeconds', 'clientDailyNotes', 'clientDailyAudioSeconds']) {
    if (!Number.isFinite(config.ai[k]) || config.ai[k] < 0) throw new Error(`AI_${k.replace(/[A-Z]/g, c => `_${c}`).toUpperCase()} must be a number`);
  }
  if (!config.supportEmail.includes('@')) throw new Error('SUPPORT_EMAIL is required (shown on /privacy and /support)');
  return config;
}
