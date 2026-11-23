import { createServer } from 'node:http';
import { accountRoutes } from './account.mjs';
import { androidRoutes } from './android.mjs';
import { autoflowRoutes } from './autoflows.mjs';
import { sessionUser } from './auth.mjs';
import { bookingRoutes } from './bookings.mjs';
import { coachRoutes } from './coach.mjs';
import { dailyRoutes } from './daily.mjs';
import { formRoutes } from './forms.mjs';
import { healthRoutes } from './health.mjs';
import { createRouter, readBody, sendJson } from './http.mjs';
import { goalRoutes } from './goals.mjs';
import { needsRoutes } from './needs.mjs';
import { timelineRoutes } from './timeline.mjs';
import { todayRoutes } from './today.mjs';
import { mediaRoutes } from './media.mjs';
import { messageRoutes } from './messages.mjs';
import { planRoutes } from './plans.mjs';
import { pageRoutes } from './pages.mjs';
import { parRoutes } from './par.mjs';
import { progressRoutes } from './progress.mjs';
import { pushRoutes } from './push.mjs';
import { calendarRoutes } from './calendar.mjs';
import { deskRoutes } from './desk.mjs';
import { reportRoutes } from './reports.mjs';
import { settingsRoutes } from './settings.mjs';
import { trainingRoutes } from './training.mjs';

const JSON_LIMIT = 1024 * 1024;

export function createApp(db, config) {
  const router = createRouter();
  for (const add of [pageRoutes, accountRoutes, trainingRoutes, dailyRoutes, healthRoutes, messageRoutes, bookingRoutes, progressRoutes, coachRoutes, reportRoutes, calendarRoutes, deskRoutes, pushRoutes, formRoutes, autoflowRoutes, androidRoutes, planRoutes, settingsRoutes, mediaRoutes, goalRoutes, todayRoutes, timelineRoutes, needsRoutes, parRoutes]) add(router);

  return createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url, 'http://local');
    try {
      const found = router.match(req.method, url.pathname);
      if (found === 'method') return sendJson(res, 405, { error: 'Method not allowed' });
      if (!found) return sendJson(res, 404, { error: 'Not found' });
      const { route, params } = found;
      const user = sessionUser(db, req);
      if (!route.opts.public && !user) return sendJson(res, 401, { error: 'Sign in again' });
      const ctx = { db, config, user, params, query: Object.fromEntries(url.searchParams), body: {}, rawBody: null };
      if (!['GET', 'HEAD', 'DELETE'].includes(req.method)) {
        if (route.opts.rawBody) {
          ctx.rawBody = await readBody(req, route.opts.rawBody);
        } else {
          const buf = await readBody(req, JSON_LIMIT);
          if (buf.length) {
            try { ctx.body = JSON.parse(buf.toString('utf8')); } catch { return sendJson(res, 400, { error: 'Body is not valid JSON' }); }
            if (typeof ctx.body !== 'object' || ctx.body === null || Array.isArray(ctx.body)) return sendJson(res, 400, { error: 'Body must be a JSON object' });
          }
        }
      }
      const out = await route.handler(req, ctx);
      if (out?.__raw) {
        res.writeHead(out.status, out.headers);
        if (typeof out.body?.pipe === 'function') {
          // A file stream (media): end the response if the file goes away mid-read.
          out.body.on('error', () => res.destroy());
          out.body.pipe(res);
        } else res.end(out.body);
      } else {
        sendJson(res, 200, out ?? { ok: true });
      }
    } catch (error) {
      const status = error.status ?? 500;
      if (status >= 500) console.error(`${req.method} ${url.pathname}`, error);
      if (!res.headersSent) sendJson(res, status, { error: status >= 500 ? 'Something went wrong on our side' : error.message });
      else res.end();
    } finally {
      if (config.logRequests) console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
    }
  });
}
