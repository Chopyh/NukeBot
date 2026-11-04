import { timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { ChannelType, EmbedBuilder, type Client } from 'discord.js';
import type { Pool } from 'pg';
import { readSettings, saveSettings } from './settings.js';
import { cancelBirthdayTest, removeBirthdayRegistration, startBirthdayTest, updateBirthdayRegistration } from './birthdays.js';
import { readGameRoleConfig, saveGameRoleConfig } from './game-roles.js';

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
    if (length > 16384) throw new Error('La solicitud es demasiado grande.');
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

    const reactionRoleGuildMatch = /^\/api\/admin\/guilds\/(\d{17,20})\/roles$/.exec(url.pathname);
    if (request.method === 'GET' && reactionRoleGuildMatch) {
      try {
        const guild = await client.guilds.fetch(reactionRoleGuildMatch[1]!);
        const botMember = guild.members.me ?? await guild.members.fetchMe();
        const roles = await guild.roles.fetch();
        sendJson(response, 200, roles
          .filter((role) => role.id !== guild.id && !role.managed && role.position < botMember.roles.highest.position)
          .sort((left, right) => right.position - left.position)
          .map((role) => ({ id: role.id, name: role.name, position: role.position })));
      } catch (error) {
        console.error('No se pudieron consultar los roles del servidor:', error);
        sendJson(response, 503, { error: 'No se pudieron cargar los roles de ese servidor.' });
      }
      return;
    }

    const reactionRoleChannelsMatch = /^\/api\/admin\/guilds\/(\d{17,20})\/channels$/.exec(url.pathname);
    if (request.method === 'GET' && reactionRoleChannelsMatch) {
      try {
        const guild = await client.guilds.fetch(reactionRoleChannelsMatch[1]!);
        const channels = await guild.channels.fetch();
        sendJson(response, 200, channels
          .filter((channel) => channel?.isTextBased() && 'messages' in channel && !channel.isThread())
          .map((channel) => ({ id: channel!.id, name: channel!.name }))
          .sort((left, right) => left.name.localeCompare(right.name)));
      } catch (error) {
        console.error('No se pudieron consultar los canales del servidor:', error);
        sendJson(response, 503, { error: 'No se pudieron cargar los canales de ese servidor.' });
      }
      return;
    }

    const gameRoleCategoriesMatch = /^\/api\/admin\/guilds\/(\d{17,20})\/categories$/.exec(url.pathname);
    if (request.method === 'GET' && gameRoleCategoriesMatch) {
      try {
        const guild = await client.guilds.fetch(gameRoleCategoriesMatch[1]!);
        const channels = await guild.channels.fetch();
        sendJson(response, 200, channels
          .filter((channel) => channel?.type === 4)
          .map((channel) => ({ id: channel!.id, name: channel!.name }))
          .sort((left, right) => left.name.localeCompare(right.name)));
      } catch (error) {
        console.error('No se pudieron consultar las categorías del servidor:', error);
        sendJson(response, 503, { error: 'No se pudieron cargar las categorías de ese servidor.' });
      }
      return;
    }

    const reactionRoleEmojisMatch = /^\/api\/admin\/guilds\/(\d{17,20})\/emojis$/.exec(url.pathname);
    if (request.method === 'GET' && reactionRoleEmojisMatch) {
      try {
        const guild = await client.guilds.fetch(reactionRoleEmojisMatch[1]!);
        sendJson(response, 200, guild.emojis.cache
          .filter((emoji) => emoji.available)
          .map((emoji) => ({ id: emoji.id, name: emoji.name, animated: emoji.animated }))
          .sort((left, right) => (left.name ?? '').localeCompare(right.name ?? '')));
      } catch (error) {
        console.error('No se pudieron consultar los emojis del servidor:', error);
        sendJson(response, 503, { error: 'No se pudieron cargar los emojis de ese servidor.' });
      }
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/admin/reaction-roles') {
      try {
        const result = await pool.query(`
          SELECT guild_id, channel_id, message_id, emoji_key, emoji_display, role_id
          FROM reaction_roles ORDER BY created_at DESC
        `);
        sendJson(response, 200, result.rows.map((mapping) => {
          const guild = client.guilds.cache.get(mapping.guild_id);
          return {
            ...mapping,
            guild_name: guild?.name ?? 'Servidor no disponible',
            role_name: guild?.roles.cache.get(mapping.role_id)?.name ?? mapping.role_id,
          };
        }));
      } catch (error) {
        console.error('No se pudieron consultar las asociaciones de roles por reacción:', error);
        sendJson(response, 503, { error: 'No se pudieron consultar las asociaciones.' });
      }
      return;
    }

    const gameRoleGuildMatch = /^\/api\/admin\/game-roles\/(\d{17,20})$/.exec(url.pathname);
    const gameRoleChannelCatalogMatch = /^\/api\/admin\/game-roles\/(\d{17,20})\/channels$/.exec(url.pathname);
    if (gameRoleChannelCatalogMatch && request.method === 'GET') {
      try {
        const guild = await client.guilds.fetch(gameRoleChannelCatalogMatch[1]!);
        const channels = await guild.channels.fetch();
        const text = channels.filter((channel) => channel && [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type))
          .map((channel) => ({ id: channel!.id, name: channel!.name, type: 'text' as const }))
          .sort((left, right) => left.name.localeCompare(right.name, 'es'));
        const voice = channels.filter((channel) => channel && [ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type))
          .map((channel) => ({ id: channel!.id, name: channel!.name, type: 'voice' as const }))
          .sort((left, right) => left.name.localeCompare(right.name, 'es'));
        sendJson(response, 200, { text, voice });
      } catch (error) {
        console.error('No se pudieron consultar los canales de roles de juegos:', error);
        sendJson(response, 503, { error: 'No se pudieron cargar los canales del servidor.' });
      }
      return;
    }

    if (gameRoleGuildMatch && request.method === 'GET') {
      try {
        sendJson(response, 200, await readGameRoleConfig(pool, gameRoleGuildMatch[1]!));
      } catch (error) {
        console.error('No se pudo consultar la configuración de roles de juegos:', error);
        sendJson(response, 503, { error: 'No se pudo consultar la configuración de roles de juegos.' });
      }
      return;
    }

    if (gameRoleGuildMatch && request.method === 'PUT') {
      try {
        const body = await readJson(request) as Record<string, unknown>;
        const validId = (value: unknown): value is string => typeof value === 'string' && /^\d{17,20}$/.test(value);
        if (!validId(body.channelId) || (body.categoryId !== undefined && body.categoryId !== '' && !validId(body.categoryId)) || typeof body.intro !== 'string' || typeof body.outro !== 'string' ||
            !Array.isArray(body.games) || body.games.length > 20 || (body.removedGames !== undefined && (!Array.isArray(body.removedGames) || body.removedGames.length > 20))) {
          sendJson(response, 400, { error: 'Completa canal, textos y una lista válida de juegos (hasta 20).' });
          return;
        }
        const guild = await client.guilds.fetch(gameRoleGuildMatch[1]!);
        const games = body.games.map((value) => {
          if (!value || typeof value !== 'object') throw new Error('Una de las entradas de juego no es válida.');
          const game = value as Record<string, unknown>;
          if ((game.id !== undefined && typeof game.id !== 'string') || (game.channelId !== undefined && typeof game.channelId !== 'string') ||
              (game.ownershipConfirmed !== undefined && typeof game.ownershipConfirmed !== 'boolean') ||
              (game.createdByBot !== undefined && typeof game.createdByBot !== 'boolean') ||
              (game.createChannel !== undefined && typeof game.createChannel !== 'boolean') || typeof game.name !== 'string' ||
              typeof game.description !== 'string' || typeof game.emoji !== 'string') throw new Error('Cada juego necesita nombre, descripción, emoji y canal.');
          return {
            id: game.id as string | undefined, name: game.name, description: game.description, emoji: game.emoji,
            channelId: game.channelId as string | undefined, createChannel: game.createChannel as boolean | undefined,
            ownershipConfirmed: game.ownershipConfirmed as boolean | undefined, createdByBot: game.createdByBot as boolean | undefined,
          };
        });
        const removedGames = (body.removedGames ?? []).map((value) => {
          if (!value || typeof value !== 'object') throw new Error('Una confirmación de canal antiguo no es válida.');
          const removed = value as Record<string, unknown>;
          if (!validId(removed.id) || (removed.ownershipConfirmed !== undefined && typeof removed.ownershipConfirmed !== 'boolean') ||
              (removed.createdByBot !== undefined && typeof removed.createdByBot !== 'boolean')) throw new Error('La confirmación de canal antiguo no es válida.');
          return { id: removed.id, ownershipConfirmed: removed.ownershipConfirmed as boolean | undefined, createdByBot: removed.createdByBot as boolean | undefined };
        });
        const result = await saveGameRoleConfig(pool, guild, { channelId: body.channelId, categoryId: body.categoryId as string | undefined, intro: body.intro, outro: body.outro, games, removedGames });
        sendJson(response, 200, { ok: true, ...result });
      } catch (error) {
        console.error('No se pudo guardar la configuración de roles de juegos:', error);
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'No se pudo guardar la configuración.' });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/reaction-roles') {
      try {
        const body = await readJson(request) as Record<string, unknown>;
        const validId = (value: unknown): value is string => typeof value === 'string' && /^\d{17,20}$/.test(value);
        if (!validId(body.guildId) || !validId(body.channelId) || typeof body.title !== 'string' ||
            typeof body.description !== 'string' || body.title.length > 256 || body.description.length > 4096 ||
            typeof body.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(body.color) ||
            !Array.isArray(body.options) || body.options.length < 1 || body.options.length > 20) {
          sendJson(response, 400, { error: 'Completa servidor, canal, mensaje y al menos una opción de rol.' });
          return;
        }
        const guild = await client.guilds.fetch(body.guildId);
        const options: { roleId: string; roleName: string; emoji: string; emojiKey: string }[] = [];
        const emojiIds = new Set<string>();
        for (const item of body.options) {
          if (!item || typeof item !== 'object') throw new Error('Una de las opciones de rol no es válida.');
          const option = item as Record<string, unknown>;
          if (!validId(option.roleId) || typeof option.emoji !== 'string' || option.emoji.length > 64) {
            throw new Error('Cada opción necesita un rol y un emoji válido.');
          }
          const emojiInput = option.emoji.trim();
          const customEmoji = emojiInput.match(/^<(a?):([A-Za-z0-9_]{2,32}):(\d{17,20})>$/);
          const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(emojiInput)];
          const unicodeEmoji = /\p{Extended_Pictographic}/u.test(emojiInput) || /\p{Regional_Indicator}{2}/u.test(emojiInput);
          if (!customEmoji && !(unicodeEmoji && graphemes.length === 1 && [...emojiInput].length <= 16)) {
            throw new Error('Indica un único emoji Unicode o personalizado válido en cada opción.');
          }
          const emojiKey = customEmoji?.[3] ?? emojiInput;
          if (emojiIds.has(emojiKey)) throw new Error('Cada opción debe usar un emoji distinto.');
          emojiIds.add(emojiKey);
          if (customEmoji) {
            const serverEmoji = guild.emojis.cache.get(customEmoji[3]!);
            if (!serverEmoji?.available) throw new Error('Uno de los emojis personalizados no está disponible en este servidor.');
          }
          const role = await guild.roles.fetch(option.roleId);
          if (!role || role.managed || !role.editable) {
            throw new Error('El bot no puede gestionar uno de los roles. Comprueba la jerarquía y los permisos.');
          }
          options.push({ roleId: role.id, roleName: role.name, emoji: emojiInput, emojiKey });
        }
        const channel = await guild.channels.fetch(body.channelId);
        if (!channel?.isTextBased() || !('send' in channel)) throw new Error('El canal indicado no es un canal de texto válido.');
        const optionDescriptions = options.map((option) => `${option.emoji} — **${option.roleName}**`).join('\n');
        const description = `${body.description.trim() || 'Reacciona con el emoji correspondiente para obtener el rol.'}\n\n${optionDescriptions}`;
        if (description.length > 4096) throw new Error('El texto y las opciones superan el límite de 4096 caracteres del mensaje.');
        const embed = new EmbedBuilder().setColor(Number.parseInt(body.color.slice(1), 16)).setDescription(description);
        if (body.title.trim()) embed.setTitle(body.title.trim());
        const message = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
        try {
          for (const option of options) await message.react(option.emoji);
          const db = await pool.connect();
          try {
            await db.query('BEGIN');
            for (const option of options) {
              await db.query(
                `INSERT INTO reaction_roles (guild_id, channel_id, message_id, emoji_key, emoji_display, role_id)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [guild.id, channel.id, message.id, option.emojiKey, option.emoji, option.roleId],
              );
            }
            await db.query('COMMIT');
          } catch (error) {
            await db.query('ROLLBACK');
            throw error;
          } finally {
            db.release();
          }
        } catch (error) {
          await message.delete().catch(() => null);
          throw error;
        }
        sendJson(response, 201, { ok: true, messageId: message.id, options: options.length });
      } catch (error) {
        console.error('No se pudo guardar la asociación de roles por reacción:', error);
        const message = error instanceof Error ? error.message : 'No se pudo guardar la asociación.';
        sendJson(response, 400, { error: message });
      }
      return;
    }

    const reactionRoleMatch = /^\/api\/admin\/reaction-roles\/(\d{17,20})\/(\d{17,20})$/.exec(url.pathname);
    if (request.method === 'DELETE' && reactionRoleMatch) {
      const emojiInput = url.searchParams.get('emoji')?.trim() ?? '';
      const customEmoji = emojiInput.match(/^<(a?):([A-Za-z0-9_]{2,32}):(\d{17,20})>$/);
      const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(emojiInput)];
      const unicodeEmoji = /\p{Extended_Pictographic}/u.test(emojiInput) || /\p{Regional_Indicator}{2}/u.test(emojiInput);
      if (!customEmoji && !(unicodeEmoji && graphemes.length === 1 && [...emojiInput].length <= 16)) {
        sendJson(response, 400, { error: 'Indica un emoji válido para eliminar la asociación.' });
        return;
      }
      const emojiKey = customEmoji?.[3] ?? emojiInput;
      const result = await pool.query(
        'DELETE FROM reaction_roles WHERE guild_id = $1 AND message_id = $2 AND emoji_key = $3',
        [reactionRoleMatch[1], reactionRoleMatch[2], emojiKey],
      );
      sendJson(response, result.rowCount ? 200 : 404, result.rowCount ? { ok: true } : { error: 'No se encontró esa asociación.' });
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
