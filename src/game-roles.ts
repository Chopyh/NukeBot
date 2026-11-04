import { ChannelType, EmbedBuilder, Events, type Client, type Guild, type Message } from 'discord.js';
import type { Pool } from 'pg';

export type GameRoleOption = { id: string; name: string; description: string; emoji: string; emoji_key: string; role_id: string; channel_id: string | null };
type StoredOption = GameRoleOption;
type StoredConfig = { guild_id: string; channel_id: string; message_id: string | null; intro: string; outro: string };

export async function ensureGameRoleTables(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_role_configs (
      guild_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, message_id TEXT,
      intro TEXT NOT NULL DEFAULT '', outro TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS game_role_options (
      id TEXT PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES game_role_configs(guild_id) ON DELETE CASCADE,
      name TEXT NOT NULL, description TEXT NOT NULL, emoji TEXT NOT NULL, emoji_key TEXT NOT NULL,
      role_id TEXT NOT NULL, channel_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(guild_id, emoji_key), UNIQUE(guild_id, name)
    )
  `);
  await pool.query('ALTER TABLE game_role_options ADD COLUMN IF NOT EXISTS channel_id TEXT');
}

function keyForReaction(reaction: { emoji: { id: string | null; name: string | null } }): string | null {
  return reaction.emoji.id ?? reaction.emoji.name;
}

async function applyGameRole(pool: Pool, reaction: any, user: any, add: boolean): Promise<void> {
  const resolvedUser = user.partial ? await user.fetch() : user;
  if (resolvedUser.bot) return;
  const resolvedReaction = reaction.partial ? await reaction.fetch() : reaction;
  const guild = resolvedReaction.message.guild;
  const emojiKey = keyForReaction(resolvedReaction);
  if (!guild || !emojiKey) return;
  const result = await pool.query<{ role_id: string }>(
    `SELECT game.role_id FROM game_role_options AS game
     JOIN game_role_configs AS config ON config.guild_id = game.guild_id
     WHERE game.guild_id = $1 AND game.emoji_key = $2 AND config.message_id = $3`,
    [guild.id, emojiKey, resolvedReaction.message.id],
  );
  const roleId = result.rows[0]?.role_id;
  if (!roleId) return;
  const [member, role] = await Promise.all([guild.members.fetch(resolvedUser.id), guild.roles.fetch(roleId)]);
  if (!role?.editable) return;
  if (add) await member.roles.add(role, 'Game role reaction');
  else await member.roles.remove(role, 'Game role reaction');
}

export function registerGameRoleListeners(client: Client, pool: Pool): void {
  client.on(Events.MessageReactionAdd, (reaction, user) => {
    void applyGameRole(pool, reaction, user, true).catch((error) => console.error('No se pudo asignar el rol de juego:', error));
  });
  client.on(Events.MessageReactionRemove, (reaction, user) => {
    void applyGameRole(pool, reaction, user, false).catch((error) => console.error('No se pudo retirar el rol de juego:', error));
  });
}

export async function readGameRoleConfig(pool: Pool, guildId: string): Promise<{ config: StoredConfig | null; games: StoredOption[] }> {
  const [config, games] = await Promise.all([
    pool.query<StoredConfig>('SELECT guild_id, channel_id, message_id, intro, outro FROM game_role_configs WHERE guild_id = $1', [guildId]),
    pool.query<StoredOption>('SELECT id, name, description, emoji, emoji_key, role_id, channel_id FROM game_role_options WHERE guild_id = $1 ORDER BY created_at, id', [guildId]),
  ]);
  return { config: config.rows[0] ?? null, games: games.rows };
}

type DesiredGame = { id?: string; name: string; description: string; emoji: string; channelId?: string; createChannel?: boolean };
function emojiParts(input: string): { display: string; key: string; customId?: string } {
  const display = input.trim();
  const custom = display.match(/^<(a?):([A-Za-z0-9_]{2,32}):(\d{17,20})>$/);
  const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(display)];
  const unicode = /\p{Extended_Pictographic}/u.test(display) || /\p{Regional_Indicator}{2}/u.test(display);
  if (!custom && !(unicode && segments.length === 1 && [...display].length <= 16)) throw new Error('Cada juego necesita un único emoji Unicode o personalizado válido.');
  return { display, key: custom?.[3] ?? display, ...(custom ? { customId: custom[3] } : {}) };
}

function gameEmbed(intro: string, outro: string, games: Array<DesiredGame & { emoji: string; channel_id?: string | null }>): EmbedBuilder {
  const lines = games.map((game) => `${game.emoji} **${game.name}**${game.description ? `\n${game.description}` : ''}${game.channel_id ? `\nCanal: <#${game.channel_id}>` : ''}`);
  const description = [intro.trim(), ...lines, outro.trim()].filter(Boolean).join('\n\n') || 'Roles de juegos';
  if (description.length > 4096) throw new Error('El mensaje supera el límite de 4096 caracteres de Discord.');
  return new EmbedBuilder().setColor(0x5865f2).setDescription(description);
}

async function getTextChannel(guild: Guild, channelId: string): Promise<any> {
  const channel = await guild.channels.fetch(channelId);
  if (!channel?.isTextBased() || !('send' in channel)) throw new Error('Selecciona un canal de texto válido.');
  return channel;
}

export async function saveGameRoleConfig(pool: Pool, guild: Guild, input: { channelId: string; categoryId?: string; intro: string; outro: string; games: DesiredGame[] }): Promise<{ messageId: string; games: number }> {
  if (input.games.length > 20) throw new Error('Puedes configurar hasta 20 juegos.');
  if (input.intro.length > 1500 || input.outro.length > 1500) throw new Error('Los textos de inicio y final admiten hasta 1500 caracteres cada uno.');
  const emojiSeen = new Set<string>(); const nameSeen = new Set<string>(); const ids = new Set<string>();
  const current = await readGameRoleConfig(pool, guild.id);
  if (current.config && current.config.channel_id !== input.channelId) throw new Error('El canal queda fijado después de crear el mensaje para conservar su ID.');
  await guild.emojis.fetch().catch(() => undefined);
  const oldById = new Map(current.games.map((game) => [game.id, game]));
  const desired = input.games.map((game) => {
    const name = game.name.trim(); const description = game.description.trim(); const emoji = emojiParts(game.emoji);
    if (!name || name.length > 80 || description.length > 250) throw new Error('Cada juego necesita un nombre (máx. 80) y una descripción de hasta 250 caracteres.');
    if (emojiSeen.has(emoji.key) || nameSeen.has(name.toLocaleLowerCase())) throw new Error('Los nombres y emojis de los juegos deben ser únicos.');
    if (game.id && (!oldById.has(game.id) || ids.has(game.id))) throw new Error('Una de las entradas de juego no pertenece a esta configuración.');
    emojiSeen.add(emoji.key); nameSeen.add(name.toLocaleLowerCase()); if (game.id) ids.add(game.id);
    if (emoji.customId && !guild.emojis.cache.get(emoji.customId)?.available) throw new Error('Uno de los emojis personalizados no está disponible en este servidor.');
    if (!game.createChannel && !/^\d{17,20}$/.test(game.channelId ?? oldById.get(game.id ?? '')?.channel_id ?? '')) throw new Error(`Selecciona un canal para «${name}» o activa la creación automática.`);
    return { id: game.id, name, description, emoji: emoji.display, emoji_key: emoji.key, role_id: game.id ? oldById.get(game.id)!.role_id : '', channel_id: game.channelId ?? oldById.get(game.id ?? '')?.channel_id ?? null, createChannel: game.createChannel === true, customId: emoji.customId };
  });
  gameEmbed(input.intro, input.outro, desired);
  const botMember = guild.members.me ?? await guild.members.fetchMe();
  if (!botMember.permissions.has('ManageRoles')) throw new Error('El bot necesita el permiso Gestionar roles.');
  const channel = await getTextChannel(guild, input.channelId);
  if (desired.some((game) => game.createChannel)) {
    if (!botMember.permissions.has('ManageChannels')) throw new Error('El bot necesita el permiso Gestionar canales para crear canales de juegos.');
    if (input.categoryId) {
      const category = await guild.channels.fetch(input.categoryId);
      if (!category || category.type !== ChannelType.GuildCategory) throw new Error('La categoría seleccionada no es válida en este servidor.');
    }
  }
  for (const game of desired) if (!game.createChannel && game.channel_id) {
    const gameChannel = await guild.channels.fetch(game.channel_id);
    if (!gameChannel || !gameChannel.isTextBased() || !('messages' in gameChannel) || gameChannel.isThread()) throw new Error(`El canal de «${game.name}» no es un canal de texto válido.`);
  }
  const desiredRoleIds = new Set(desired.flatMap((game) => game.role_id ? [game.role_id] : []));
  for (const old of current.games) if (!desiredRoleIds.has(old.role_id)) {
    const role = await guild.roles.fetch(old.role_id);
    if (!role?.editable) throw new Error(`El bot no puede borrar el rol de «${old.name}». Comprueba permisos y jerarquía.`);
  }
  const createdRoles: string[] = [];
  const renamedRoles: Array<{ id: string; name: string }> = [];
  const addedReactions: string[] = [];
  let changedMessage: Message | null = null;
  let originalEmbeds: Message['embeds'] = [];
  let createdMessage = false;
  let dbCommitted = false;
  const removedReactions: string[] = [];
  try {
    for (const game of desired) {
      if (game.createChannel) {
        const slug = game.name.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 90) || 'juego';
        const created = await guild.channels.create({ name: `juego-${slug}`.slice(0, 100), type: ChannelType.GuildText, ...(input.categoryId ? { parent: input.categoryId } : {}), reason: 'Canal de juego creado desde Roles de juegos' });
        game.channel_id = created.id;
      }
      if (!game.role_id) {
        const role = await guild.roles.create({ name: `Juego: ${game.name}`.slice(0, 100), reason: 'Rol creado para la sección Roles de juegos' });
        game.role_id = role.id; createdRoles.push(role.id);
      } else {
        const role = await guild.roles.fetch(game.role_id);
        if (!role?.editable) throw new Error(`El bot no puede gestionar el rol de «${game.name}».`);
        if (role.name !== `Juego: ${game.name}`) {
          renamedRoles.push({ id: role.id, name: role.name });
          await role.setName(`Juego: ${game.name}`.slice(0, 100), 'Nombre actualizado desde Roles de juegos');
        }
      }
    }

    let message: Message;
    if (current.config?.message_id) {
      const oldChannel = await getTextChannel(guild, current.config.channel_id);
      message = await oldChannel.messages.fetch(current.config.message_id);
      changedMessage = message; originalEmbeds = message.embeds;
      await message.edit({ embeds: [gameEmbed(input.intro, input.outro, desired)], allowedMentions: { parse: [] } });
    } else {
      message = await channel.send({ embeds: [gameEmbed(input.intro, input.outro, desired)], allowedMentions: { parse: [] } });
      changedMessage = message; createdMessage = true;
    }
    for (const game of desired) if (!current.games.some((old) => old.emoji_key === game.emoji_key)) {
      await message.react(game.emoji); addedReactions.push(game.emoji_key);
    }
    const retainedEmoji = new Set(desired.map((game) => game.emoji_key));
    for (const old of current.games) if (!retainedEmoji.has(old.emoji_key)) {
      await message.reactions.resolve(old.emoji_key)?.remove(); removedReactions.push(old.emoji);
    }

    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query(`INSERT INTO game_role_configs (guild_id, channel_id, message_id, intro, outro) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (guild_id) DO UPDATE SET channel_id=EXCLUDED.channel_id, message_id=EXCLUDED.message_id, intro=EXCLUDED.intro, outro=EXCLUDED.outro, updated_at=NOW()`,
      [guild.id, input.channelId, message.id, input.intro.trim(), input.outro.trim()]);
      await db.query('DELETE FROM game_role_options WHERE guild_id=$1', [guild.id]);
      for (const game of desired) await db.query(`INSERT INTO game_role_options (id,guild_id,name,description,emoji,emoji_key,role_id,channel_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [game.id ?? crypto.randomUUID(), guild.id, game.name, game.description, game.emoji, game.emoji_key, game.role_id, game.channel_id]);
      await db.query('COMMIT');
      dbCommitted = true;
    } catch (error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }

    const keepRoles = new Set(desired.map((game) => game.role_id));
    for (const old of current.games) if (!keepRoles.has(old.role_id)) await guild.roles.delete(old.role_id, 'Juego eliminado desde Roles de juegos').catch((error) => console.error(`No se pudo borrar el rol ${old.role_id}:`, error));
    return { messageId: message.id, games: desired.length };
  } catch (error) {
    if (!dbCommitted && changedMessage) {
      if (createdMessage) await changedMessage.delete().catch(() => undefined);
      else await changedMessage.edit({ embeds: [...originalEmbeds] }).catch(() => undefined);
      for (const emoji of addedReactions) await changedMessage.reactions.resolve(emoji)?.remove().catch(() => undefined);
      for (const emoji of removedReactions) await changedMessage.react(emoji).catch(() => undefined);
    }
    if (!dbCommitted) {
      for (const roleId of createdRoles) await guild.roles.delete(roleId, 'Reversión de configuración incompleta').catch(() => undefined);
      for (const role of renamedRoles) {
        const target = await guild.roles.fetch(role.id).catch(() => null);
        if (target) await target.setName(role.name, 'Reversión de configuración incompleta').catch(() => undefined);
      }
    }
    throw error;
  }
}
