import { timingSafeEqual, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { Client } from 'discord.js';
import type { Pool } from 'pg';
import { readSettings, saveSettings } from './settings.js';

function safeEqual(left: string, right: string): boolean {
  return timingSafeEqual(createHash('sha256').update(left).digest(), createHash('sha256').update(right).digest());
}

export function startAdminApi(client: Client, pool: Pool): void {
  const token = process.env.ADMIN_API_TOKEN?.trim();
  if (!token) throw new Error('Falta ADMIN_API_TOKEN para proteger la API interna del panel.');

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/health') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (!safeEqual(request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '', token)) {
      response.writeHead(401, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'No autorizado' }));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/admin/status') {
      const readyClient = client.isReady() ? client : null;
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(JSON.stringify({
        status: readyClient ? 'online' : 'starting',
        botName: readyClient?.user.tag ?? null,
        guilds: readyClient?.guilds.cache.size ?? 0,
        uptimeSeconds: Math.floor(process.uptime()),
      }));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/admin/settings') {
      void readSettings(pool).then((settings) => {
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        response.end(JSON.stringify(settings));
      }).catch((error) => {
        console.error('No se pudo leer la configuración:', error);
        response.writeHead(500).end();
      });
      return;
    }

    if (request.method === 'PUT' && url.pathname === '/api/admin/settings') {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        body += chunk;
        if (body.length > 4096) request.destroy();
      });
      request.on('end', () => {
        try {
          const settings = saveSettings(pool, JSON.parse(body));
          void settings.then((saved) => {
            response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            response.end(JSON.stringify(saved));
          }).catch((error) => {
            const message = error instanceof Error ? error.message : 'No se pudo guardar la configuración.';
            response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
            response.end(JSON.stringify({ error: message }));
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Solicitud no válida.';
          response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: message }));
        }
      });
      return;
    }

    response.writeHead(404).end();
  });

  const port = Number(process.env.BOT_API_PORT ?? 3001);
  server.listen(port, '0.0.0.0', () => console.log(`API interna del panel escuchando en el puerto ${port}.`));
  server.on('error', (error) => console.error('Error en la API interna del panel:', error));

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => server.close());
  }
}
