import {
  ChannelType,
  Events,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildBasedChannel,
  type Role,
} from 'discord.js';
import type { Pool } from 'pg';

type Birthday = {
  guild_id: string;
  user_id: string;
  month: number;
  day: number;
  emoji: string;
  role_name: string;
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
      role_id TEXT,
      PRIMARY KEY (guild_id, user_id)
    )
  `);
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
}

export function validateBirthdayEmoji(emoji: string): boolean {
  if (/^<a?:[A-Za-z0-9_]{2,32}:\d{17,20}>$/.test(emoji)) return true;
  const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(emoji)];
  return segments.length === 1 && /\p{Extended_Pictographic}/u.test(emoji);
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

  for (const guild of client.guilds.cache.values()) {
    const active = await pool.query('SELECT 1 FROM birthday_events WHERE guild_id = $1 LIMIT 1', [guild.id]);
    if (active.rowCount) await refreshBirthdayChannelNames(guild, pool);
  }
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

  const godRole = guild.roles.cache.find((candidate) => candidate.name.toLocaleLowerCase() === 'dios');
  const botMember = guild.members.me ?? await guild.members.fetchMe();
  const highestPositionBotCanManage = Math.max(1, botMember.roles.highest.position - 1);
  const position = godRole
    ? Math.min(Math.max(1, godRole.position - 1), highestPositionBotCanManage)
    : highestPositionBotCanManage;
  await role.setPosition(position, { reason: `Prioridad del rol temporal de cumpleaños para ${member.user.tag}` });

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

async function refreshBirthdayChannelNames(guild: Guild, pool: Pool): Promise<void> {
  const active = await pool.query<{ emoji: string }>(
    'SELECT emoji FROM birthday_events WHERE guild_id = $1 ORDER BY user_id',
    [guild.id],
  );
  const emojis = [...new Set(active.rows.map((row) => row.emoji))];
  const channels = await guild.channels.fetch();
  const eligibleChannels = channels.filter(isRenamableChannel);

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
        await channel.setName(desiredName, 'Decoración temporal por cumpleaños').catch((error) => {
          console.error(`No se pudo renombrar el canal ${channel.id}:`, error);
        });
      }
    }
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
