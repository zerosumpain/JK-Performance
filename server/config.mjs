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
    // Tests swap this for a recorder; see apple.mjs.
    pushTransport: null,
    logRequests: env.LOG_REQUESTS === '1',
    fetchImpl: fetch,
  };
  if (!config.supportEmail.includes('@')) throw new Error('SUPPORT_EMAIL is required (shown on /privacy and /support)');
  return config;
}
