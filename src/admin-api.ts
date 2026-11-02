import { timingSafeEqual, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { Client } from 'discord.js';
import type { Pool } from 'pg';
import { readSettings, saveSettings } from './settings.js';
import { cancelBirthdayTest, startBirthdayTest } from './birthdays.js';

function safeEqual(left: string, right: string): boolean {
  return timingSafeEqual(createHash('sha256').update(left).digest(), createHash('sha256').update(right).digest());
}

function sendJson(response: import('node:http').ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function readJson(request: import('node:http').IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 4096) throw new Error('La solicitud es demasiado grande.');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

export function startAdminApi(client: Client, pool: Pool): void {
  const token = process.env.ADMIN_API_TOKEN?.trim();
  if (!token) throw new Error('Falta ADMIN_API_TOKEN para proteger la API interna del panel.');

  const server = createServer(async (request, response) => {
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

    if (request.method === 'GET' && url.pathname === '/api/admin/guilds') {
      sendJson(response, 200, client.guilds.cache.map((guild) => ({
        id: guild.id,
        name: guild.name,
        memberCount: guild.memberCount,
      })));
      return;
    }

    const membersMatch = /^\/api\/admin\/guilds\/(\d{17,20})\/members$/.exec(url.pathname);
    if (request.method === 'GET' && membersMatch) {
      const query = url.searchParams.get('q')?.trim() ?? '';
      if (query.length < 2) {
        sendJson(response, 400, { error: 'Escribe al menos dos caracteres para buscar miembros.' });
        return;
      }
      try {
        const guild = await client.guilds.fetch(membersMatch[1]!);
        const members = await guild.members.search({ query, limit: 25, cache: false });
        sendJson(response, 200, members.map((member) => ({
          id: member.id,
          username: member.user.username,
          displayName: member.displayName,
          nickname: member.nickname,
          avatar: member.user.displayAvatarURL({ size: 64 }),
        })));
      } catch (error) {
        console.error('No se pudieron buscar miembros del servidor:', error);
        sendJson(response, 502, { error: 'No se pudieron buscar miembros. Revisa que Server Members Intent esté habilitado.' });
      }
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/admin/birthday-tests') {
      try {
        const result = await pool.query(
          `SELECT test_id, guild_id, user_id, emoji, role_name, ends_at
           FROM birthday_test_events WHERE ends_at > NOW() ORDER BY ends_at`,
        );
        sendJson(response, 200, result.rows);
      } catch (error) {
        console.error('No se pudieron leer las pruebas de cumpleaños activas:', error);
        sendJson(response, 503, { error: 'No se pudieron consultar las pruebas activas.' });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/birthday-tests') {
      try {
        const body = await readJson(request) as Record<string, unknown>;
        if (typeof body.guildId !== 'string' || !/^\d{17,20}$/.test(body.guildId) ||
            typeof body.userId !== 'string' || !/^\d{17,20}$/.test(body.userId) ||
            typeof body.emoji !== 'string' || typeof body.roleName !== 'string') {
          sendJson(response, 400, { error: 'Selecciona un servidor y un miembro, e indica emoji y nombre de rol.' });
          return;
        }
        const guild = await client.guilds.fetch(body.guildId);
        const test = await startBirthdayTest(guild, pool, {
          userId: body.userId,
          emoji: body.emoji,
          roleName: body.roleName,
        });
        sendJson(response, 201, test);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No se pudo iniciar la prueba.';
        console.error('No se pudo iniciar la prueba de cumpleaños:', error);
        sendJson(response, 400, { error: message });
      }
      return;
    }

    const cancelTestMatch = /^\/api\/admin\/guilds\/(\d{17,20})\/birthday-tests\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (request.method === 'DELETE' && cancelTestMatch) {
      try {
        const guild = await client.guilds.fetch(cancelTestMatch[1]!);
        const cancelled = await cancelBirthdayTest(guild, pool, cancelTestMatch[2]!);
        sendJson(response, cancelled ? 200 : 404, cancelled ? { ok: true } : { error: 'La prueba ya no está activa.' });
      } catch (error) {
        console.error('No se pudo cancelar la prueba de cumpleaños:', error);
        sendJson(response, 500, { error: 'No se pudieron revertir los cambios. Revisa los permisos del bot.' });
      }
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
