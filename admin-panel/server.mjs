import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const port = Number(process.env.PORT ?? 3000);
const discordClientId = required('DISCORD_CLIENT_ID');
const discordClientSecret = required('DISCORD_CLIENT_SECRET');
const discordRedirectUri = required('DISCORD_REDIRECT_URI');
const botApiUrl = (process.env.BOT_API_URL ?? 'http://bot:3001').replace(/\/$/, '');
const botApiToken = required('ADMIN_API_TOKEN');
const databaseUrl = required('DATABASE_URL');
const pool = new pg.Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 5000 });
const staticRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const pagePath = path.join(staticRoot, 'index.html');
const loginPagePath = path.join(staticRoot, 'login', 'index.html');
const defaults = { activityText: '', activityType: 'playing', presenceStatus: 'online' };
const sessionDurationMs = 12 * 60 * 60 * 1000;
const sessions = new Map();
const oauthStates = new Map();

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta la variable ${name}.`);
  return value;
}

function cookieToken(request) {
  return cookieValue(request, 'nuke_admin_session');
}

function cookieValue(request, name) {
  const cookieHeader = request.headers.cookie ?? '';
  for (const cookie of cookieHeader.split(';')) {
    const [key, ...value] = cookie.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}

function getSession(request) {
  const token = cookieToken(request);
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + sessionDurationMs;
  return session;
}

async function authorized(request) {
  const session = getSession(request);
  if (!session) return false;
  if (Date.now() - session.authorizationCheckedAt < 5 * 60 * 1000) return true;
  let stillAuthorized = false;
  try {
    stillAuthorized = await isGodMember(session.user.id);
  } catch (error) {
    console.error('No se pudo renovar la autorización del panel:', error);
  }
  if (!stillAuthorized) {
    sessions.delete(cookieToken(request));
    return false;
  }
  session.authorizationCheckedAt = Date.now();
  return true;
}

function setSessionCookie(request, response, token) {
  const secure = request.socket.encrypted || request.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  response.setHeader('set-cookie', `nuke_admin_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionDurationMs / 1000}${secure}`);
}

function clearSessionCookie(request, response) {
  const secure = request.socket.encrypted || request.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  response.setHeader('set-cookie', `nuke_admin_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

function redirect(response, location) {
  response.writeHead(302, { location, 'cache-control': 'no-store' }).end();
}

async function isGodMember(userId) {
  const result = await fetch(`${botApiUrl}/api/admin/authorization/${encodeURIComponent(userId)}`, {
    headers: { authorization: `Bearer ${botApiToken}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!result.ok) return false;
  const body = await result.json();
  return body.authorized === true;
}

async function readJson(request, maxBytes = 4096) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maxBytes) throw new RangeError('Solicitud demasiado grande.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (request.method === 'GET' && url.pathname === '/health') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end('{"status":"ok"}');
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/session') {
    const session = getSession(request);
    sendJson(response, 200, { authenticated: Boolean(session), user: session?.user ?? null });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/auth/discord') {
    const state = randomBytes(32).toString('base64url');
    for (const [pendingState, expiresAt] of oauthStates) {
      if (expiresAt <= Date.now()) oauthStates.delete(pendingState);
    }
    oauthStates.set(state, Date.now() + 10 * 60 * 1000);
    const secure = request.socket.encrypted || request.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    response.setHeader('set-cookie', `nuke_oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/auth/discord/callback; Max-Age=600${secure}`);
    const authorizeUrl = new URL('https://discord.com/oauth2/authorize');
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', discordClientId);
    authorizeUrl.searchParams.set('scope', 'identify');
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('redirect_uri', discordRedirectUri);
    redirect(response, authorizeUrl.toString());
    return;
  }

  if (request.method === 'GET' && url.pathname === '/auth/discord/callback') {
    try {
      const state = url.searchParams.get('state') ?? '';
      const stateExpiresAt = oauthStates.get(state);
      oauthStates.delete(state);
      if (!stateExpiresAt || stateExpiresAt <= Date.now() || cookieValue(request, 'nuke_oauth_state') !== state ||
          (url.searchParams.has('iss') && url.searchParams.get('iss') !== 'https://discord.com')) {
        redirect(response, '/login?error=invalid_oauth');
        return;
      }

      const code = url.searchParams.get('code');
      if (!code || url.searchParams.has('error')) {
        redirect(response, '/login?error=discord_denied');
        return;
      }

      const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: discordClientId,
          client_secret: discordClientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: discordRedirectUri,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!tokenResponse.ok) throw new Error('Discord rechazó el intercambio de código OAuth.');
      const tokenData = await tokenResponse.json();
      const identityResponse = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { authorization: 'Bearer ' + tokenData.access_token },
        signal: AbortSignal.timeout(8000),
      });
      if (!identityResponse.ok) throw new Error('No se pudo consultar la cuenta de Discord.');
      const user = await identityResponse.json();
      if (!/^\d{17,20}$/.test(user.id) || !(await isGodMember(user.id))) {
        redirect(response, '/login?error=forbidden');
        return;
      }

      const token = randomBytes(32).toString('base64url');
      sessions.set(token, {
        expiresAt: Date.now() + sessionDurationMs,
        authorizationCheckedAt: Date.now(),
        user: { id: user.id, username: user.username, globalName: user.global_name ?? user.username, avatar: user.avatar },
      });
      setSessionCookie(request, response, token);
      redirect(response, '/');
    } catch (error) {
      console.error('No se pudo completar el inicio de sesión de Discord:', error);
      redirect(response, '/login?error=oauth');
    }
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/logout') {
    const token = cookieToken(request);
    if (token) sessions.delete(token);
    clearSessionCookie(request, response);
    sendJson(response, 200, { ok: true });
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

  if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/login')) {
    const loggedIn = await authorized(request);
    if (url.pathname === '/' && !loggedIn) {
      response.writeHead(302, { location: '/login', 'cache-control': 'no-store' }).end();
      return;
    }
    if (url.pathname === '/login' && loggedIn) {
      response.writeHead(302, { location: '/', 'cache-control': 'no-store' }).end();
      return;
    }
    try {
      const page = await readFile(url.pathname === '/login' ? loginPagePath : pagePath);
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: https://cdn.discordapp.com",
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'referrer-policy': 'no-referrer',
      }).end(page);
    } catch {
      response.writeHead(500).end('No se pudo cargar el panel');
    }
    return;
  }

  if (!(await authorized(request))) {
    if (url.pathname.startsWith('/api/')) sendJson(response, 401, { error: 'Inicia sesión para continuar.' });
    else response.writeHead(302, { location: '/login', 'cache-control': 'no-store' }).end();
    return;
  }

  const botProxyPath = url.pathname.startsWith('/api/bot/') ? url.pathname.slice('/api/bot'.length) : '';
  const allowedBotRoute = botProxyPath === '/guilds'
    || botProxyPath === '/birthdays'
    || /^\/guilds\/\d{17,20}\/birthdays\/\d{17,20}$/.test(botProxyPath)
    || /^\/guilds\/\d{17,20}\/members$/.test(botProxyPath)
    || botProxyPath === '/birthday-tests'
    || /^\/guilds\/\d{17,20}\/birthday-tests\/[0-9a-f-]{36}$/i.test(botProxyPath);
  if (allowedBotRoute) {
    const requestId = randomBytes(12).toString('hex');
    const startedAt = Date.now();
    try {
      // DELETE routes such as birthday-test cancellation intentionally have no body.
      // Parsing an empty request stream with readJson throws "Unexpected end of JSON input".
      const method = request.method ?? 'GET';
      const body = ['GET', 'HEAD', 'DELETE'].includes(method) ? undefined : JSON.stringify(await readJson(request));
      const upstreamUrl = `${botApiUrl}/api/admin${botProxyPath}${url.search}`;
      const upstream = await fetch(upstreamUrl, {
        method,
        headers: {
          authorization: `Bearer ${botApiToken}`,
          'x-request-id': requestId,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body } : {}),
        signal: AbortSignal.timeout(120000),
      });
      const content = await upstream.text();
      const durationMs = Date.now() - startedAt;
      if (upstream.ok) console.info(`[admin-proxy:${requestId}] ${method} ${botProxyPath} status=${upstream.status} duration_ms=${durationMs}`);
      else console.error(`[admin-proxy:${requestId}] ${method} ${botProxyPath} status=${upstream.status} duration_ms=${durationMs} response=${content.slice(0, 1000)}`);
      response.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
        'x-request-id': requestId,
        'cache-control': 'no-store',
      }).end(content);
    } catch (error) {
      const status = error instanceof RangeError ? 413 : 503;
      const message = error instanceof Error ? error.message : 'No hay conexión con el bot.';
      console.error(`[admin-proxy:${requestId}] ${request.method} ${botProxyPath} failed duration_ms=${Date.now() - startedAt} message=${message}`, error);
      sendJson(response, status, { error: message, requestId });
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
          registration.color,
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
