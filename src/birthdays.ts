import {
  ChannelType,
  Events,
  PermissionFlagsBits,
  type ColorResolvable,
  type Client,
  type Guild,
  type GuildBasedChannel,
  type Role,
} from 'discord.js';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

type Birthday = {
  guild_id: string;
  user_id: string;
  month: number;
  day: number;
  emoji: string;
  role_name: string;
  color: string;
  role_id: string | null;
};

const timezone = process.env.BIRTHDAY_TIMEZONE?.trim() || 'Europe/Madrid';
const todayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: timezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export async function ensureBirthdayTables(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS birthday_registrations (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      month SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
      day SMALLINT NOT NULL CHECK (day BETWEEN 1 AND 31),
      emoji TEXT NOT NULL,
      role_name VARCHAR(100) NOT NULL,
      color VARCHAR(7) NOT NULL DEFAULT '#D3FF75',
      role_id TEXT,
      PRIMARY KEY (guild_id, user_id)
    )
  `);
  await pool.query("ALTER TABLE birthday_registrations ADD COLUMN IF NOT EXISTS color VARCHAR(7) NOT NULL DEFAULT '#D3FF75'");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS birthday_events (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      birthday_date DATE NOT NULL,
      emoji TEXT NOT NULL,
      role_id TEXT NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (guild_id, user_id, birthday_date)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS birthday_channel_backups (
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      original_name TEXT NOT NULL,
      PRIMARY KEY (guild_id, channel_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS birthday_test_events (
      test_id UUID PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      role_name VARCHAR(100) NOT NULL,
      role_id TEXT NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL
    )
  `);
}

export function validateBirthdayEmoji(emoji: string): boolean {
  if (/^<a?:[A-Za-z0-9_]{2,32}:\d{17,20}>$/.test(emoji)) return true;
  const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(emoji)];
  return segments.length === 1 && /\p{Extended_Pictographic}/u.test(emoji);
}

export function validateBirthdayColor(color: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(color);
}

export async function activateDueBirthdays(client: Client, pool: Pool): Promise<void> {
  if (!client.isReady()) return;
  const parts = todayFormatter.formatToParts(new Date());
  const part = (type: 'year' | 'month' | 'day') => parts.find((entry) => entry.type === type)?.value;
  const year = part('year');
  const month = part('month');
  const day = part('day');
  if (!year || !month || !day) throw new Error(`No se pudo obtener la fecha en ${timezone}.`);
  const today = `${year}-${month}-${day}`;

  const due = await pool.query<Birthday>(
    `SELECT * FROM birthday_registrations
     WHERE (month = $1 AND day = $2)
        OR ($1 = 2 AND $2 = 28 AND $3 = FALSE AND month = 2 AND day = 29)`,
    [Number(month), Number(day), Number(year) % 4 !== 0 || (Number(year) % 100 === 0 && Number(year) % 400 !== 0)],
  );
  for (const birthday of due.rows) {
    const guild = client.guilds.cache.get(birthday.guild_id);
    if (!guild) continue;
    await activateBirthday(guild, birthday, today, pool);
  }

  const expired = await pool.query<{ guild_id: string; user_id: string; birthday_date: string; role_id: string }>(
    `DELETE FROM birthday_events WHERE ends_at <= NOW()
     RETURNING guild_id, user_id, birthday_date::text, role_id`,
  );
  for (const event of expired.rows) {
    const guild = client.guilds.cache.get(event.guild_id);
    if (guild) await finishBirthday(guild, event, pool);
  }

  const expiredTests = await pool.query<{ test_id: string; guild_id: string; user_id: string; role_id: string }>(
    `SELECT test_id, guild_id, user_id, role_id FROM birthday_test_events WHERE ends_at <= NOW()`,
  );
  for (const event of expiredTests.rows) {
    const guild = client.guilds.cache.get(event.guild_id);
    if (guild) {
      await cleanupBirthdayTest(guild, pool, event).catch((error) => {
        console.error(`No se pudo limpiar la prueba de cumpleaños ${event.test_id}:`, error);
      });
    }
  }

  for (const guild of client.guilds.cache.values()) {
    const active = await pool.query(
      `SELECT 1 FROM birthday_events WHERE guild_id = $1
       UNION ALL SELECT 1 FROM birthday_test_events WHERE guild_id = $1 LIMIT 1`,
      [guild.id],
    );
    if (active.rowCount) await refreshBirthdayChannelNames(guild, pool);
  }
}

export async function startBirthdayTest(
  guild: Guild,
  pool: Pool,
  input: { userId: string; emoji: string; roleName: string; color?: string; requestId?: string },
): Promise<{ test_id: string; guild_id: string; user_id: string; emoji: string; role_name: string; role_id: string; ends_at: Date }> {
  const requestId = input.requestId || randomUUID();
  const emoji = input.emoji.trim();
  const roleName = input.roleName.trim();
  const color = input.color?.trim() || '#D3FF75';
  if (!validateBirthdayEmoji(emoji)) throw new Error('Indica un único emoji válido para la prueba.');
  if (!validateBirthdayColor(color)) throw new Error('Indica un color hexadecimal válido, por ejemplo #D3FF75.');
  if (!roleName || roleName.length > 100 || /@everyone|@here/i.test(roleName)) {
    throw new Error('El nombre del rol de prueba no es válido.');
  }
  console.info(`[birthday-test:${requestId}] start guild=${guild.id} user=${input.userId}`);
  const member = await timedBirthdayTestStep(requestId, 'fetch-member', () => guild.members.fetch(input.userId));
  const role = await timedBirthdayTestStep(requestId, 'create-role', () => guild.roles.create({
    name: roleName,
    color: color as ColorResolvable,
    permissions: [PermissionFlagsBits.MuteMembers, PermissionFlagsBits.DeafenMembers, PermissionFlagsBits.MoveMembers],
    reason: `Prueba de cumpleaños solicitada desde el panel para ${member.user.tag}`,
  }));
  try {
    await timedBirthdayTestStep(requestId, 'position-role', () => positionBirthdayRole(guild, role, member.user.tag));
    await timedBirthdayTestStep(requestId, 'assign-role', () => member.roles.add(role, 'Prueba temporal de cumpleaños desde el panel'));
    const testId = randomUUID();
    const endsAt = new Date(Date.now() + 10 * 60 * 1000);
    const result = await timedBirthdayTestStep(requestId, 'save-test-event', () => pool.query<{ test_id: string; guild_id: string; user_id: string; emoji: string; role_name: string; role_id: string; ends_at: Date }>(
        `INSERT INTO birthday_test_events (test_id, guild_id, user_id, emoji, role_name, role_id, ends_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING test_id, guild_id, user_id, emoji, role_name, role_id, ends_at`,
        [testId, guild.id, member.id, emoji, roleName, role.id, endsAt],
      ));
    await timedBirthdayTestStep(requestId, 'rename-channels', () => refreshBirthdayChannelNames(guild, pool, requestId));
    console.info(`[birthday-test:${requestId}] complete test=${testId} role=${role.id}`);
    return result.rows[0]!;
  } catch (error) {
    console.error(`[birthday-test:${requestId}] failed guild=${guild.id} user=${member.id} role=${role.id}`, error);
    await role.delete('Se revirtió una prueba de cumpleaños incompleta').then(
      () => console.info(`[birthday-test:${requestId}] rollback-role-deleted role=${role.id}`),
      (cleanupError) => console.error(`[birthday-test:${requestId}] rollback-role-delete-failed role=${role.id}`, cleanupError),
    );
    throw error;
  }
}

async function timedBirthdayTestStep<T>(requestId: string, step: string, action: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  console.info(`[birthday-test:${requestId}] step=${step} started`);
  try {
    const result = await action();
    console.info(`[birthday-test:${requestId}] step=${step} completed duration_ms=${Date.now() - startedAt}`);
    return result;
  } catch (error) {
    console.error(`[birthday-test:${requestId}] step=${step} failed duration_ms=${Date.now() - startedAt}`, error);
    throw error;
  }
}

export async function cancelBirthdayTest(guild: Guild, pool: Pool, testId: string, requestId: string = randomUUID()): Promise<boolean> {
  const result = await timedBirthdayTestStep(requestId, 'cancel-load-event', () => pool.query<{ test_id: string; guild_id: string; user_id: string; role_id: string }>(
    'SELECT test_id, guild_id, user_id, role_id FROM birthday_test_events WHERE test_id = $1 AND guild_id = $2',
    [testId, guild.id],
  ));
  const event = result.rows[0];
  if (!event) return false;
  await cleanupBirthdayTest(guild, pool, event, requestId);
  return true;
}

async function cleanupBirthdayTest(
  guild: Guild,
  pool: Pool,
  event: { test_id: string; guild_id: string; user_id: string; role_id: string },
  requestId?: string,
): Promise<void> {
  const doStep = <T>(step: string, action: () => Promise<T>) => requestId
    ? timedBirthdayTestStep(requestId, step, action)
    : action();
  const role = await doStep('cancel-fetch-role', () => guild.roles.fetch(event.role_id).catch(() => null));
  if (role) await doStep('cancel-delete-role', () => role.delete('Fin de la prueba temporal de cumpleaños'));
  await doStep('cancel-delete-event', () => pool.query('DELETE FROM birthday_test_events WHERE test_id = $1', [event.test_id]));
  await doStep('cancel-restore-channels', () => refreshBirthdayChannelNames(guild, pool, requestId));
}

async function positionBirthdayRole(guild: Guild, role: Role, reason: string): Promise<void> {
  const godRole = guild.roles.cache.find((candidate) => candidate.name.toLocaleLowerCase() === 'dios');
  const botMember = guild.members.me ?? await guild.members.fetchMe();
  const highestPositionBotCanManage = Math.max(1, botMember.roles.highest.position - 1);
  const position = godRole
    ? Math.min(Math.max(1, godRole.position - 1), highestPositionBotCanManage)
    : highestPositionBotCanManage;
  await role.setPosition(position, { reason });
}

async function activateBirthday(guild: Guild, birthday: Birthday, date: string, pool: Pool): Promise<void> {
  const existing = await pool.query(
    'SELECT 1 FROM birthday_events WHERE guild_id = $1 AND user_id = $2 AND birthday_date = $3',
    [birthday.guild_id, birthday.user_id, date],
  );
  if (existing.rowCount) return;

  const member = await guild.members.fetch(birthday.user_id).catch(() => null);
  if (!member) return;

  let role: Role | undefined = birthday.role_id
    ? guild.roles.cache.get(birthday.role_id) ?? await guild.roles.fetch(birthday.role_id).catch(() => null) ?? undefined
    : undefined;
  if (!role) {
    role = await guild.roles.create({
      name: birthday.role_name,
      color: birthday.color as ColorResolvable,
      permissions: [PermissionFlagsBits.MuteMembers, PermissionFlagsBits.DeafenMembers, PermissionFlagsBits.MoveMembers],
      reason: `Rol temporal de cumpleaños para ${member.user.tag}`,
    });
    await pool.query(
      'UPDATE birthday_registrations SET role_id = $3 WHERE guild_id = $1 AND user_id = $2',
      [birthday.guild_id, birthday.user_id, role.id],
    );
  }
  if (role.name !== birthday.role_name) {
    await role.setName(birthday.role_name, `Nombre elegido por ${member.user.tag} para su rol de cumpleaños`);
  }
  if (role.hexColor.toUpperCase() !== birthday.color.toUpperCase()) {
    await role.setColor(birthday.color as ColorResolvable, `Color elegido por ${member.user.tag} para su rol de cumpleaños`);
  }

  await positionBirthdayRole(guild, role, `Prioridad del rol temporal de cumpleaños para ${member.user.tag}`);

  await member.roles.add(role, 'Cumpleaños: rol temporal de voz');
  const endsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO birthday_events (guild_id, user_id, birthday_date, emoji, role_id, ends_at)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
    [birthday.guild_id, birthday.user_id, date, birthday.emoji, role.id, endsAt],
  );
  await refreshBirthdayChannelNames(guild, pool);
}

async function finishBirthday(
  guild: Guild,
  event: { guild_id: string; user_id: string; birthday_date: string; role_id: string },
  pool: Pool,
): Promise<void> {
  const role = guild.roles.cache.get(event.role_id);
  if (role) await role.delete('Fin de las 24 horas del rol temporal de cumpleaños').catch((error) => {
    console.error(`No se pudo eliminar el rol de cumpleaños ${role.id}:`, error);
  });
  await pool.query(
    'UPDATE birthday_registrations SET role_id = NULL WHERE guild_id = $1 AND user_id = $2 AND role_id = $3',
    [event.guild_id, event.user_id, event.role_id],
  );
  await refreshBirthdayChannelNames(guild, pool);
}

export async function removeBirthdayRegistration(guild: Guild, pool: Pool, userId: string): Promise<void> {
  const events = await pool.query<{ role_id: string }>(
    'DELETE FROM birthday_events WHERE guild_id = $1 AND user_id = $2 RETURNING role_id',
    [guild.id, userId],
  );
  await pool.query('DELETE FROM birthday_registrations WHERE guild_id = $1 AND user_id = $2', [guild.id, userId]);
  for (const event of events.rows) {
    const role = await guild.roles.fetch(event.role_id).catch(() => null);
    if (role) await role.delete('El usuario eliminó su registro de cumpleaños').catch((error) => {
      console.error(`No se pudo eliminar el rol de cumpleaños ${role.id}:`, error);
    });
  }
  await refreshBirthdayChannelNames(guild, pool);
}

export async function updateBirthdayRegistration(
  guild: Guild,
  pool: Pool,
  userId: string,
  input: { day: number; month: number; emoji: string; roleName: string; color: string },
): Promise<boolean> {
  const emoji = input.emoji.trim();
  const roleName = input.roleName.trim();
  const color = input.color.trim().toUpperCase();
  const daysInMonth = new Date(Date.UTC(2024, input.month, 0)).getUTCDate();
  if (!Number.isInteger(input.month) || input.month < 1 || input.month > 12 ||
      !Number.isInteger(input.day) || input.day < 1 || input.day > daysInMonth) {
    throw new Error('La fecha indicada no existe.');
  }
  if (!validateBirthdayEmoji(emoji)) throw new Error('Indica un único emoji Unicode o personalizado válido.');
  if (!roleName || roleName.length > 100 || /@everyone|@here/i.test(roleName)) throw new Error('El nombre del rol no es válido.');
  if (!validateBirthdayColor(color)) throw new Error('Indica un color hexadecimal válido, por ejemplo #D3FF75.');

  const result = await pool.query(
    `UPDATE birthday_registrations
     SET day = $3, month = $4, emoji = $5, role_name = $6, color = $7
     WHERE guild_id = $1 AND user_id = $2`,
    [guild.id, userId, input.day, input.month, emoji, roleName, color],
  );
  if (!result.rowCount) return false;

  const active = await pool.query<{ role_id: string }>(
    `SELECT role_id FROM birthday_events
     WHERE guild_id = $1 AND user_id = $2 AND ends_at > NOW()`,
    [guild.id, userId],
  );
  for (const event of active.rows) {
    const role = await guild.roles.fetch(event.role_id).catch(() => null);
    if (!role) continue;
    if (role.name !== roleName) await role.setName(roleName, 'Actualización del registro de cumpleaños desde el panel');
    if (role.hexColor.toUpperCase() !== color) await role.setColor(color as ColorResolvable, 'Actualización del color desde el panel');
  }
  if (active.rowCount) {
    await pool.query(
      'UPDATE birthday_events SET emoji = $3 WHERE guild_id = $1 AND user_id = $2 AND ends_at > NOW()',
      [guild.id, userId, emoji],
    );
    await refreshBirthdayChannelNames(guild, pool);
  }
  return true;
}

async function refreshBirthdayChannelNames(guild: Guild, pool: Pool, diagnosticId?: string): Promise<void> {
  const active = await pool.query<{ emoji: string }>(
    `SELECT emoji FROM birthday_events WHERE guild_id = $1
     UNION SELECT emoji FROM birthday_test_events WHERE guild_id = $1`,
    [guild.id],
  );
  const emojis = [...new Set(active.rows.map((row) => row.emoji))];
  const channels = await guild.channels.fetch();
  const eligibleChannels = channels.filter(isRenamableChannel);
  let renamed = 0;
  let failed = 0;
  if (diagnosticId) console.info(`[birthday-test:${diagnosticId}] channels eligible=${eligibleChannels.size} active_emojis=${emojis.length}`);

  if (emojis.length) {
    for (const possibleChannel of eligibleChannels.values()) {
      if (!isRenamableChannel(possibleChannel)) continue;
      const channel = possibleChannel;
      const backup = await pool.query<{ original_name: string }>(
        'SELECT original_name FROM birthday_channel_backups WHERE guild_id = $1 AND channel_id = $2',
        [guild.id, channel.id],
      );
      const originalName = backup.rows[0]?.original_name ?? channel.name;
      if (!backup.rowCount) {
        await pool.query(
          'INSERT INTO birthday_channel_backups (guild_id, channel_id, original_name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [guild.id, channel.id, originalName],
        );
      }
      const desiredName = `${emojis.join(' ')} - ${originalName}`.slice(0, 100);
      if (channel.name !== desiredName) {
        try {
          await channel.setName(desiredName, 'Decoración temporal por cumpleaños');
          renamed += 1;
        } catch (error) {
          failed += 1;
          console.error(`No se pudo renombrar el canal ${channel.id}:`, error);
          if (diagnosticId) console.error(`[birthday-test:${diagnosticId}] channel-rename-failed channel=${channel.id} current=${channel.name} desired=${desiredName}`, error);
        }
        if (diagnosticId && (renamed + failed) % 10 === 0) {
          console.info(`[birthday-test:${diagnosticId}] channel-progress processed=${renamed + failed}/${eligibleChannels.size} renamed=${renamed} failed=${failed}`);
        }
      }
    }
    if (diagnosticId) console.info(`[birthday-test:${diagnosticId}] channel-summary renamed=${renamed} failed=${failed} eligible=${eligibleChannels.size}`);
    return;
  }

  const backups = await pool.query<{ channel_id: string; original_name: string }>(
    'DELETE FROM birthday_channel_backups WHERE guild_id = $1 RETURNING channel_id, original_name',
    [guild.id],
  );
  for (const backup of backups.rows) {
    const channel = await guild.channels.fetch(backup.channel_id).catch(() => null);
    if (channel && isRenamableChannel(channel) && channel.name !== backup.original_name) {
      await channel.setName(backup.original_name, 'Restauración tras el cumpleaños').catch((error) => {
        console.error(`No se pudo restaurar el canal ${channel.id}:`, error);
      });
    }
  }
}

function isRenamableChannel(channel: GuildBasedChannel | null | undefined): channel is GuildBasedChannel & { name: string; setName(name: string, reason?: string): Promise<unknown> } {
  return channel?.type === ChannelType.GuildText
    || channel?.type === ChannelType.GuildAnnouncement
    || channel?.type === ChannelType.GuildVoice
    || channel?.type === ChannelType.GuildStageVoice;
}

export function startBirthdayScheduler(client: Client, pool: Pool): void {
  const run = () => void activateDueBirthdays(client, pool).catch((error) => {
    console.error('No se pudo procesar la automatización de cumpleaños:', error);
  });
  client.once(Events.ClientReady, run);
  const timer = setInterval(run, 60_000);
  timer.unref();
}
