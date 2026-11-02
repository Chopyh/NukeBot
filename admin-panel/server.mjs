import 'dotenv/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const port = Number(process.env.PORT ?? 3000);
const username = required('ADMIN_USERNAME');
const password = required('ADMIN_PASSWORD');
const botApiUrl = (process.env.BOT_API_URL ?? 'http://bot:3001').replace(/\/$/, '');
const botApiToken = required('ADMIN_API_TOKEN');
const databaseUrl = required('DATABASE_URL');
const pool = new pg.Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 5000 });
const staticRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const pagePath = path.join(staticRoot, 'index.html');
const defaults = { activityText: '', activityType: 'playing', presenceStatus: 'online' };

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta la variable ${name}.`);
  return value;
}

function equalSecret(candidate, expected) {
  const digest = (value) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(candidate), digest(expected));
}

function authorized(request) {
  const match = /^Basic\s+(.+)$/i.exec(request.headers.authorization ?? '');
  if (!match) return false;
  let decoded;
  try {
    decoded = Buffer.from(match[1], 'base64').toString('utf8');
  } catch {
    return false;
  }
  const colon = decoded.indexOf(':');
  if (colon < 0) return false;
  return equalSecret(decoded.slice(0, colon), username) && equalSecret(decoded.slice(colon + 1), password);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (request.method === 'GET' && url.pathname === '/health') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end('{"status":"ok"}');
    return;
  }

  if (!authorized(request)) {
    response.writeHead(401, {
      'www-authenticate': 'Basic realm="Administración del bot", charset="UTF-8"',
      'cache-control': 'no-store',
    }).end('Autenticación requerida');
    return;
  }

  if (request.method === 'GET' && url.pathname.startsWith('/_astro/')) {
    try {
      const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const assetPath = path.resolve(staticRoot, relativePath);
      const assetRoot = `${path.resolve(staticRoot, '_astro')}${path.sep}`;
      if (!assetPath.startsWith(assetRoot)) {
        response.writeHead(404).end('No encontrado');
        return;
      }
      const asset = await readFile(assetPath);
      const contentType = {
        '.css': 'text/css; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
      }[path.extname(assetPath)] ?? 'application/octet-stream';
      response.writeHead(200, {
        'content-type': contentType,
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      }).end(asset);
    } catch {
      response.writeHead(404).end('No encontrado');
    }
    return;
  }

  if (request.method === 'GET' && url.pathname === '/') {
    try {
      const page = await readFile(pagePath);
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:",
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'referrer-policy': 'no-referrer',
      }).end(page);
    } catch {
      response.writeHead(500).end('No se pudo cargar el panel');
    }
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/status') {
    try {
      const result = await fetch(`${botApiUrl}/api/admin/status`, {
        headers: { authorization: `Bearer ${botApiToken}` },
        signal: AbortSignal.timeout(4000),
      });
      const body = await result.json();
      response.writeHead(result.ok ? 200 : 502, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      }).end(JSON.stringify(result.ok ? body : { error: 'No se pudo consultar el bot.' }));
    } catch {
      response.writeHead(503, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      }).end(JSON.stringify({ status: 'offline', error: 'No hay conexión con el bot.' }));
    }
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/settings') {
    try {
      const result = await pool.query('SELECT settings, updated_at FROM bot_configuration WHERE id = 1');
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify(result.rows[0] ?? { settings: defaults, updated_at: null }));
    } catch {
      response.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ error: 'No se pudo conectar con PostgreSQL.' }));
    }
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/birthdays') {
    try {
      const result = await pool.query(`
        SELECT
          registration.guild_id,
          registration.user_id,
          registration.day,
          registration.month,
          registration.emoji,
          registration.role_name,
          active.ends_at
        FROM birthday_registrations AS registration
        LEFT JOIN LATERAL (
          SELECT event.ends_at
          FROM birthday_events AS event
          WHERE event.guild_id = registration.guild_id
            AND event.user_id = registration.user_id
            AND event.ends_at > NOW()
          ORDER BY event.ends_at DESC
          LIMIT 1
        ) AS active ON TRUE
        ORDER BY registration.month, registration.day, registration.guild_id, registration.user_id
      `);
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ birthdays: result.rows }));
    } catch (error) {
      console.error('No se pudieron consultar los cumpleaños:', error);
      response.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ error: 'No se pudieron consultar los cumpleaños registrados.' }));
    }
    return;
  }

  if (request.method === 'PUT' && url.pathname === '/api/settings') {
    try {
      const chunks = [];
      let length = 0;
      for await (const chunk of request) {
        length += chunk.length;
        if (length > 4096) {
          response.writeHead(413).end('Solicitud demasiado grande');
          return;
        }
        chunks.push(chunk);
      }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!input || typeof input !== 'object' || typeof input.activityText !== 'string' || input.activityText.length > 128 ||
          !['playing', 'listening', 'watching', 'competing'].includes(input.activityType) ||
          !['online', 'idle', 'dnd', 'invisible'].includes(input.presenceStatus)) {
        response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'Revisa los valores de la configuración.' }));
        return;
      }
      const settings = { activityText: input.activityText.trim(), activityType: input.activityType, presenceStatus: input.presenceStatus };
      const result = await pool.query(
        `INSERT INTO bot_configuration (id, settings, updated_at) VALUES (1, $1::jsonb, NOW())
         ON CONFLICT (id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW()
         RETURNING settings, updated_at`,
        [JSON.stringify(settings)],
      );
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify(result.rows[0]));
    } catch (error) {
      const invalidJson = error instanceof SyntaxError;
      response.writeHead(invalidJson ? 400 : 503, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: invalidJson ? 'El contenido no es JSON válido.' : 'No se pudo guardar la configuración en PostgreSQL.' }));
    }
    return;
  }

  response.writeHead(404).end('No encontrado');
});

await pool.query(`
  CREATE TABLE IF NOT EXISTS bot_configuration (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    settings JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`);
await pool.query(
  'INSERT INTO bot_configuration (id, settings) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING',
  [JSON.stringify(defaults)],
);
server.listen(port, '0.0.0.0', () => console.log(`Panel de administración escuchando en el puerto ${port}.`));
