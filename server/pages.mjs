import { raw } from './http.mjs';


const shell = (title, body) => `<!doctype html><html lang="en-GB"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · JK Performance</title>
<style>
:root{color-scheme:dark}
body{margin:0;background:#000;color:#f2f2f2;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:680px;margin:0 auto;padding:48px 20px 80px}
.mark{display:inline-grid;place-items:center;width:56px;height:56px;border:1px solid #999;border-radius:12px;font-weight:600;font-size:22px}
h1{font-size:32px;margin:20px 0 4px;letter-spacing:-.01em}h2{font-size:18px;margin:32px 0 6px}
.eyebrow{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#888}
p,li{color:#c8c8c8}a{color:#fff}
.card{background:#121212;border:1px solid #222;border-radius:14px;padding:16px 18px;margin:12px 0}
footer{margin-top:48px;font-size:13px;color:#777}
</style></head><body><main><div class="mark">JK</div>${body}
<footer>JK Performance · <a href="/privacy">Privacy</a> · <a href="/support">Support</a></footer></main></body></html>`;

const html = (title, body) => raw(200, {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'public, max-age=300',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'",
  'x-content-type-options': 'nosniff',
}, shell(title, body));

const home = () => html('Coaching', `
<p class="eyebrow">Performance</p><h1>JK Performance</h1>
<p>Coaching, programming and accountability, in one iPhone app.</p>
<div class="card"><b>For clients</b><p>Your plan for the week, logging every set, daily habits and nutrition, a weekly check-in, progress and records, booking sessions, and messaging your coach.</p></div>
<div class="card"><b>For the coach</b><p>Programmes, each client's plan and adherence, the schedule, check-ins and the numbers of the business.</p></div>`);

const privacy = c => html('Privacy', `
<p class="eyebrow">Last updated 21 November 2026</p><h1>Privacy</h1>
<p>This explains what the JK Performance app stores about you, why, who can see it, and how to get it or delete it.</p>
<h2>Who we are</h2>
<p>JK Performance is a coaching service. The app's data is held on a server we run in the United Kingdom, reached through Cloudflare's network. Encrypted backups are kept on a second machine we run and with our backup storage provider. Contact: <a href="mailto:${c.supportEmail}">${c.supportEmail}</a>.</p>
<h2>What we store</h2>
<ul>
<li><b>Account:</b> your name and the email Apple shares when you Sign in with Apple (which may be a private relay address), and a random identifier from Apple. We never see your Apple password.</li>
<li><b>Training:</b> the plans your coach writes, the sets you log, your habits, food entries, weekly check-ins (including any pain or injury you mention), bookings and messages.</li>
<li><b>Progress:</b> body measurements you enter and progress photos you upload.</li>
<li><b>Apple Health (only if you connect it):</b> daily steps, sleep, resting heart rate, active energy, body weight and distance, and your workouts (type, time, duration, energy, distance and average heart rate). Wearables like WHOOP, Oura and Garmin reach us only through Apple Health.</li>
<li><b>Notifications (only if you turn them on):</b> a token from Apple that lets us send notifications to your phone. Notifications go through Apple's push service and show the sender's name and the start of a message.</li>
</ul>
<h2>Why, and the legal basis</h2>
<p>To provide the coaching you signed up for (contract). Health information, including injuries and Apple Health data, is special category data: we process it only with your explicit consent, which you give by entering it or by turning on Apple Health, and can withdraw at any time in the app.</p>
<h2>Who can see it</h2>
<p>You and your coach, with one exception: your Apple Health data is seen by your coach only if you choose to share it (Account › Apple Health), and stops being visible to them the moment you turn sharing off. You can also disconnect Apple Health there, which deletes everything synced from it. Progress photos are private to you and your coach. If you subscribe your calendar to the app's feed, that private link shows your sessions to whoever holds it; you can stop it in the app. Other members see only your first name, initial and distance on a challenge leaderboard you choose to join. We do not sell data, show adverts, or use third-party analytics or trackers in the app. Apple Health data is never used for advertising or shared with anyone else.</p>
<h2>How long we keep it</h2>
<p>For as long as you have an account. When you delete your account, everything is erased from the live system immediately, and we ask Apple to end the app's Sign in with Apple link; encrypted backups age out within 90 days.</p>
<h2>Your rights</h2>
<p>In the app, under Account: <b>Export my data</b> downloads everything we hold about you as a file; <b>Delete account</b> erases it. You can also ask us to correct anything, or contact us about any other right under UK GDPR. You may complain to the Information Commissioner's Office (ico.org.uk).</p>`);

const support = c => html('Support', `
<h1>Support</h1>
<p>Email <a href="mailto:${c.supportEmail}">${c.supportEmail}</a> and we'll reply within two working days.</p>
<div class="card"><b>Delete your account</b><p>In the app: Account → Delete account. It's immediate and can't be undone.</p></div>
<div class="card"><b>Get a copy of your data</b><p>In the app: Account → Export my data.</p></div>`);

export function pageRoutes(r) {
  r.add('GET', '/', home, { public: true });
  r.add('GET', '/privacy', (_req, ctx) => privacy(ctx.config), { public: true });
  r.add('GET', '/support', (_req, ctx) => support(ctx.config), { public: true });
  r.add('GET', '/health', () => ({ ok: true }), { public: true });
}
