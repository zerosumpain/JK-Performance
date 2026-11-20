/**
 * The smallest router that does the job: `route('GET', '/api/workouts/:id', handler)`.
 * Handlers get `(req, ctx)` where ctx = { params, query, body, user, db, ... }
 * and return a value (sent as JSON) or a `raw(...)` response.
 */
export function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

export const raw = (status, headers, body) => ({ __raw: true, status, headers, body });

export function createRouter() {
  const routes = [];
  const add = (method, pattern, handler, opts = {}) => {
    const keys = [];
    const regex = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    routes.push({ method, regex, keys, handler, opts });
  };
  const match = (method, path) => {
    let pathMatched = false;
    for (const r of routes) {
      const m = r.regex.exec(path);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      return { route: r, params };
    }
    return pathMatched ? 'method' : null;
  };
  return { add, match };
}

export async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) fail(413, 'Request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

// MARK: - Input checks. Each returns the clean value or throws a 400.

export const str = (value, name, { max = 200, min = 1, optional = false } = {}) => {
  if (value === undefined || value === null) {
    if (optional) return null;
    fail(400, `${name} is required`);
  }
  if (typeof value !== 'string') fail(400, `${name} must be text`);
  const v = value.trim();
  if (v.length < min || v.length > max) fail(400, `${name} must be ${min}–${max} characters`);
  return v;
};

export const num = (value, name, { min = -Infinity, max = Infinity, optional = false, int = false } = {}) => {
  if (value === undefined || value === null) {
    if (optional) return null;
    fail(400, `${name} is required`);
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(400, `${name} must be a number from ${min} to ${max}`);
  if (int && !Number.isInteger(value)) fail(400, `${name} must be a whole number`);
  return value;
};

export const day = (value, name, { optional = false } = {}) => {
  if (value === undefined || value === null || value === '') {
    if (optional) return null;
    fail(400, `${name} is required`);
  }
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(value) || Number.isNaN(Date.parse(value + 'T00:00:00Z'))) fail(400, `${name} must be YYYY-MM-DD`);
  return value;
};

export const instant = (value, name) => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value) || Number.isNaN(Date.parse(value))) fail(400, `${name} must be an ISO 8601 time`);
  return new Date(value).toISOString();
};

export const oneOf = (value, name, options) => {
  if (!options.includes(value)) fail(400, `${name} must be one of ${options.join(', ')}`);
  return value;
};

export const clock = (value, name, { optional = false } = {}) => {
  if (value === undefined || value === null || value === '') {
    if (optional) return null;
    fail(400, `${name} is required`);
  }
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) fail(400, `${name} must be HH:MM`);
  return value;
};
