import { timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { Client } from 'discord.js';
import type { Pool } from 'pg';
import { readSettings, saveSettings } from './settings.js';
import { cancelBirthdayTest, removeBirthdayRegistration, startBirthdayTest, updateBirthdayRegistration } from './birthdays.js';

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

    const authorizationMatch = /^\/api\/admin\/authorization\/(\d{17,20})$/.exec(url.pathname);
    if (request.method === 'GET' && authorizationMatch) {
      const guildId = process.env.DISCORD_GUILD_ID?.trim();
      if (!guildId) {
        sendJson(response, 503, { error: 'No está configurado el servidor principal del bot.' });
        return;
      }
      try {
        const guild = await client.guilds.fetch(guildId);
        const [member] = await Promise.all([
          guild.members.fetch(authorizationMatch[1]!).catch(() => null),
          guild.roles.fetch(),
        ]);
        const godRole = guild.roles.cache.find((role) => role.name.toLocaleLowerCase() === 'dios');
        sendJson(response, 200, { authorized: Boolean(member && godRole && member.roles.cache.has(godRole.id)) });
      } catch (error) {
        console.error('No se pudo verificar el rol Dios para el acceso web:', error);
        sendJson(response, 503, { error: 'No se pudo verificar el acceso en el servidor principal.' });
      }
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/admin/birthdays') {
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

        const birthdays = await Promise.all(result.rows.map(async (birthday) => {
          const guild = client.guilds.cache.get(birthday.guild_id);
          if (!guild) return { ...birthday, guild_name: birthday.guild_id, guild_icon: null, display_name: 'Servidor no disponible', username: null, avatar: null };
          const member = guild.members.cache.get(birthday.user_id)
            ?? await guild.members.fetch(birthday.user_id).catch(() => null);
          return {
            ...birthday,
            guild_name: guild.name,
            guild_icon: guild.iconURL({ size: 64 }),
            display_name: member?.displayName ?? 'Miembro no disponible',
            username: member?.user.username ?? null,
            avatar: member?.user.displayAvatarURL({ size: 64 }) ?? null,
          };
        }));
        sendJson(response, 200, { birthdays });
      } catch (error) {
        console.error('No se pudieron consultar los cumpleaños:', error);
        sendJson(response, 503, { error: 'No se pudieron consultar los cumpleaños registrados.' });
      }
      return;
    }

    const birthdayRegistrationMatch = /^\/api\/admin\/guilds\/(\d{17,20})\/birthdays\/(\d{17,20})$/.exec(url.pathname);
    if (birthdayRegistrationMatch && request.method === 'PUT') {
      try {
        const body = await readJson(request) as Record<string, unknown>;
        if (!Number.isInteger(body.day) || !Number.isInteger(body.month) ||
            typeof body.emoji !== 'string' || typeof body.roleName !== 'string' || typeof body.color !== 'string') {
          sendJson(response, 400, { error: 'Indica fecha, emoji, nombre del rol y color.' });
          return;
        }
        const guild = await client.guilds.fetch(birthdayRegistrationMatch[1]!);
        const updated = await updateBirthdayRegistration(guild, pool, birthdayRegistrationMatch[2]!, {
          day: body.day as number,
          month: body.month as number,
          emoji: body.emoji,
          roleName: body.roleName,
          color: body.color,
        });
        sendJson(response, updated ? 200 : 404, updated ? { ok: true } : { error: 'No se encontró ese registro de cumpleaños.' });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No se pudo modificar el registro.';
        console.error('No se pudo modificar el registro de cumpleaños:', error);
        sendJson(response, 400, { error: message });
      }
      return;
    }

    if (birthdayRegistrationMatch && request.method === 'DELETE') {
      try {
        const guild = await client.guilds.fetch(birthdayRegistrationMatch[1]!);
        const exists = await pool.query(
          'SELECT 1 FROM birthday_registrations WHERE guild_id = $1 AND user_id = $2',
          [guild.id, birthdayRegistrationMatch[2]!],
        );
        if (!exists.rowCount) {
          sendJson(response, 404, { error: 'No se encontró ese registro de cumpleaños.' });
          return;
        }
        await removeBirthdayRegistration(guild, pool, birthdayRegistrationMatch[2]!);
        sendJson(response, 200, { ok: true });
      } catch (error) {
        console.error('No se pudo eliminar el registro de cumpleaños:', error);
        sendJson(response, 500, { error: 'No se pudo eliminar el registro de cumpleaños.' });
      }
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
      const headerRequestId = request.headers['x-request-id'];
      const requestId = typeof headerRequestId === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(headerRequestId)
        ? headerRequestId
        : randomUUID();
      const startedAt = Date.now();
      console.info(`[birthday-test:${requestId}] api-start method=POST path=${url.pathname}`);
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
          color: typeof body.color === 'string' ? body.color : '#D3FF75',
          requestId,
        });
        console.info(`[birthday-test:${requestId}] api-complete status=201 duration_ms=${Date.now() - startedAt}`);
        sendJson(response, 201, test);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No se pudo iniciar la prueba.';
        console.error(`[birthday-test:${requestId}] api-failed status=400 duration_ms=${Date.now() - startedAt} message=${message}`, error);
        sendJson(response, 400, { error: message, requestId });
      }
      return;
    }

    const cancelTestMatch = /^\/api\/admin\/guilds\/(\d{17,20})\/birthday-tests\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (request.method === 'DELETE' && cancelTestMatch) {
      const headerRequestId = request.headers['x-request-id'];
      const requestId = typeof headerRequestId === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(headerRequestId)
        ? headerRequestId
        : randomUUID();
      const startedAt = Date.now();
      console.info(`[birthday-test:${requestId}] cancel-start guild=${cancelTestMatch[1]} test=${cancelTestMatch[2]}`);
      try {
        const guild = await client.guilds.fetch(cancelTestMatch[1]!);
        const cancelled = await cancelBirthdayTest(guild, pool, cancelTestMatch[2]!, requestId);
        console.info(`[birthday-test:${requestId}] cancel-complete cancelled=${cancelled} duration_ms=${Date.now() - startedAt}`);
        sendJson(response, cancelled ? 200 : 404, cancelled ? { ok: true } : { error: 'La prueba ya no está activa.' });
      } catch (error) {
        console.error(`[birthday-test:${requestId}] cancel-failed duration_ms=${Date.now() - startedAt}`, error);
        sendJson(response, 500, { error: 'No se pudieron revertir los cambios. Revisa los permisos del bot.', requestId });
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
