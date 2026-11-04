import { ChannelType, EmbedBuilder, Events, PermissionFlagsBits, type Client, type Guild, type Message } from 'discord.js';
import type { Pool } from 'pg';

export type GameRoleOption = {
  id: string; name: string; description: string; emoji: string; emoji_key: string; role_id: string;
  channel_id: string | null; created_by_bot: boolean; ownership_confirmed: boolean;
  everyone_view_state: number | null; bot_view_state: number | null;
};
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
      role_id TEXT NOT NULL, channel_id TEXT, created_by_bot BOOLEAN NOT NULL DEFAULT FALSE,
      ownership_confirmed BOOLEAN NOT NULL DEFAULT TRUE,
      everyone_view_state SMALLINT, bot_view_state SMALLINT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(guild_id, emoji_key), UNIQUE(guild_id, name)
    )
  `);
  await pool.query('ALTER TABLE game_role_options ADD COLUMN IF NOT EXISTS channel_id TEXT');
  await pool.query('ALTER TABLE game_role_options ADD COLUMN IF NOT EXISTS created_by_bot BOOLEAN NOT NULL DEFAULT FALSE');
  await pool.query('ALTER TABLE game_role_options ADD COLUMN IF NOT EXISTS ownership_confirmed BOOLEAN NOT NULL DEFAULT FALSE');
  await pool.query('ALTER TABLE game_role_options ADD COLUMN IF NOT EXISTS everyone_view_state SMALLINT');
  await pool.query('ALTER TABLE game_role_options ADD COLUMN IF NOT EXISTS bot_view_state SMALLINT');
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
    pool.query<StoredOption>('SELECT id, name, description, emoji, emoji_key, role_id, channel_id, created_by_bot, ownership_confirmed, everyone_view_state, bot_view_state FROM game_role_options WHERE guild_id = $1 ORDER BY created_at, id', [guildId]),
  ]);
  return { config: config.rows[0] ?? null, games: games.rows };
}

type DesiredGame = {
  id?: string; name: string; description: string; emoji: string; channelId?: string; createChannel?: boolean;
  ownershipConfirmed?: boolean; createdByBot?: boolean;
  channel_id?: string | null; created_by_bot?: boolean; everyone_view_state?: number | null; bot_view_state?: number | null;
};
type RemovedGameOwnership = { id: string; ownershipConfirmed?: boolean; createdByBot?: boolean };
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

function viewState(channel: any, targetId: string): number {
  const overwrite = channel.permissionOverwrites.cache.get(targetId);
  if (!overwrite) return 0;
  if (overwrite.allow.has(PermissionFlagsBits.ViewChannel)) return 1;
  if (overwrite.deny.has(PermissionFlagsBits.ViewChannel)) return -1;
  return 0;
}

async function setViewState(channel: any, targetId: string, state: number): Promise<void> {
  await channel.permissionOverwrites.edit(targetId, {
    ViewChannel: state === 1 ? true : state === -1 ? false : null,
  }, 'Restauración de permisos de Roles de juegos');
}

function channelNameForGame(name: string, emojiDisplay: string): string {
  const custom = emojiDisplay.match(/^<a?:([A-Za-z0-9_]{2,32}):\d{17,20}>$/);
  const emojiLabel = custom?.[1] ?? emojiDisplay;
  const emojiPart = emojiLabel.toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\p{Extended_Pictographic}\p{Regional_Indicator}-]+/gu, '-')
    .replace(/-+/g, '-').replace(/^-|-$/g, '');
  const gamePart = name.toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `${emojiPart || 'game'}-${gamePart || 'juego'}`.slice(0, 100).replace(/-$/g, '');
}

async function applyGameChannelPrivacy(channel: any, guild: Guild, roleId: string, botMemberId: string): Promise<void> {
  await channel.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false }, 'Canal privado de un juego');
  await channel.permissionOverwrites.edit(roleId, { ViewChannel: true }, 'Acceso al canal para el rol de juego');
  await channel.permissionOverwrites.edit(botMemberId, { ViewChannel: true }, 'Permiso del bot para administrar el canal privado');
}

async function restoreGameChannel(guild: Guild, game: StoredOption): Promise<void> {
  if (!game.channel_id || game.created_by_bot) {
    if (game.created_by_bot && game.channel_id) await guild.channels.delete(game.channel_id, 'Canal creado para un juego eliminado');
    return;
  }
  // Older rows predate privacy snapshots; leave their user-selected channels untouched.
  if (game.everyone_view_state === null || game.bot_view_state === null) return;
  const channel = await guild.channels.fetch(game.channel_id);
  if (!channel || !('permissionOverwrites' in channel)) return;
  await channel.permissionOverwrites.delete(game.role_id, 'Retirada del acceso del juego eliminado');
  await setViewState(channel, guild.roles.everyone.id, game.everyone_view_state ?? 0);
  const botId = guild.client.user.id;
  await setViewState(channel, botId, game.bot_view_state ?? 0);
}

async function getTextChannel(guild: Guild, channelId: string): Promise<any> {
  const channel = await guild.channels.fetch(channelId);
  if (!channel?.isTextBased() || !('send' in channel)) throw new Error('Selecciona un canal de texto válido.');
  return channel;
}

export async function saveGameRoleConfig(pool: Pool, guild: Guild, input: { channelId: string; categoryId?: string; intro: string; outro: string; games: DesiredGame[]; removedGames?: RemovedGameOwnership[] }): Promise<{ messageId: string; games: number; warnings: string[] }> {
  if (input.games.length > 20) throw new Error('Puedes configurar hasta 20 juegos.');
  if (input.intro.length > 1500 || input.outro.length > 1500) throw new Error('Los textos de inicio y final admiten hasta 1500 caracteres cada uno.');
  const emojiSeen = new Set<string>(); const nameSeen = new Set<string>(); const ids = new Set<string>();
  const current = await readGameRoleConfig(pool, guild.id);
  if (current.config && current.config.channel_id !== input.channelId) throw new Error('El canal queda fijado después de crear el mensaje para conservar su ID.');
  await guild.emojis.fetch().catch(() => undefined);
  const oldById = new Map(current.games.map((game) => [game.id, game]));
  const channelIds = new Set<string>();
  const desired = input.games.map((game) => {
    const name = game.name.trim(); const description = game.description.trim(); const emoji = emojiParts(game.emoji);
    if (!name || name.length > 80 || description.length > 250) throw new Error('Cada juego necesita un nombre (máx. 80) y una descripción de hasta 250 caracteres.');
    if (emojiSeen.has(emoji.key) || nameSeen.has(name.toLocaleLowerCase())) throw new Error('Los nombres y emojis de los juegos deben ser únicos.');
    if (game.id && (!oldById.has(game.id) || ids.has(game.id))) throw new Error('Una de las entradas de juego no pertenece a esta configuración.');
    emojiSeen.add(emoji.key); nameSeen.add(name.toLocaleLowerCase()); if (game.id) ids.add(game.id);
    if (emoji.customId && !guild.emojis.cache.get(emoji.customId)?.available) throw new Error('Uno de los emojis personalizados no está disponible en este servidor.');
    const previous = game.id ? oldById.get(game.id) : undefined;
    const channelId = game.createChannel ? null : (game.channelId || previous?.channel_id || null);
    if (!game.createChannel && !/^\d{17,20}$/.test(channelId ?? '')) throw new Error(`Selecciona un canal para «${name}» o activa la creación automática.`);
    if (channelId && (channelIds.has(channelId) || channelId === input.channelId)) throw new Error('Cada juego necesita un canal privado distinto del mensaje central.');
    if (channelId) channelIds.add(channelId);
    const sameChannel = Boolean(previous && previous.channel_id === channelId);
    const ownershipConfirmed = game.createChannel === true || !sameChannel || previous?.ownership_confirmed === true || game.ownershipConfirmed === true;
    const createdByBot = game.createChannel === true || (sameChannel && (
      game.ownershipConfirmed === true ? game.createdByBot === true : previous?.created_by_bot === true
    ));
    return {
      id: game.id, name, description, emoji: emoji.display, emoji_key: emoji.key,
      role_id: previous?.role_id ?? '', channel_id: channelId, createChannel: game.createChannel === true,
      created_by_bot: createdByBot, ownership_confirmed: ownershipConfirmed,
      everyone_view_state: sameChannel ? previous?.everyone_view_state ?? 0 : null,
      bot_view_state: sameChannel ? previous?.bot_view_state ?? 0 : null,
      customId: emoji.customId,
    };
  });
  const removedOwnershipById = new Map<string, RemovedGameOwnership>();
  for (const removed of input.removedGames ?? []) {
    if (!oldById.has(removed.id) || ids.has(removed.id) || removedOwnershipById.has(removed.id)) throw new Error('La confirmación de propiedad pertenece a una entrada que no se está eliminando.');
    if (removed.ownershipConfirmed === true && typeof removed.createdByBot !== 'boolean') throw new Error('Indica si el canal antiguo lo creó el bot o ya existía.');
    removedOwnershipById.set(removed.id, removed);
  }
  gameEmbed(input.intro, input.outro, desired);
  const botMember = guild.members.me ?? await guild.members.fetchMe();
  if (!botMember.permissions.has('ManageRoles')) throw new Error('El bot necesita el permiso Gestionar roles.');
  const channel = await getTextChannel(guild, input.channelId);
  const removalNeedsChannelPermission = current.games.some((game) => {
    const removalOwnership = removedOwnershipById.get(game.id);
    return game.created_by_bot || game.everyone_view_state !== null || game.bot_view_state !== null ||
      (removalOwnership?.ownershipConfirmed === true && removalOwnership.createdByBot === true);
  });
  if (desired.length > 0 || removalNeedsChannelPermission) {
    if (!botMember.permissions.has('ManageChannels')) throw new Error('El bot necesita el permiso Gestionar canales para privatizar, restaurar o borrar canales de juegos.');
  }
  if (input.categoryId && desired.some((game) => game.createChannel)) {
    const category = await guild.channels.fetch(input.categoryId);
    if (!category || category.type !== ChannelType.GuildCategory) throw new Error('La categoría seleccionada no es válida en este servidor.');
  }
  const resolvedChannels = new Map<string, any>();
  for (const game of desired) if (!game.createChannel && game.channel_id) {
    const gameChannel = await guild.channels.fetch(game.channel_id);
    if (!gameChannel || !gameChannel.isTextBased() || !('messages' in gameChannel) || gameChannel.isThread()) throw new Error(`El canal de «${game.name}» no es un canal de texto válido.`);
    resolvedChannels.set(game.id ?? game.name, gameChannel);
    const previous = game.id ? oldById.get(game.id) : undefined;
    if (!previous || previous.channel_id !== game.channel_id || previous.everyone_view_state === null || previous.bot_view_state === null) {
      game.everyone_view_state = viewState(gameChannel, guild.roles.everyone.id);
      game.bot_view_state = viewState(gameChannel, botMember.id);
    }
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
  const createdChannels: string[] = [];
  const renamedChannels: Array<{ channel: any; name: string }> = [];
  const newlyPrivatized: Array<{ channel: any; roleId: string; everyoneState: number; botState: number }> = [];
  try {
    for (const game of desired) {
      // Create the role first so a new private channel can grant it access immediately.
      if (!game.role_id) {
        const role = await guild.roles.create({ name: game.name.slice(0, 100), reason: 'Rol creado para la sección Roles de juegos' });
        game.role_id = role.id; createdRoles.push(role.id);
      } else {
        const role = await guild.roles.fetch(game.role_id);
        if (!role?.editable) throw new Error(`El bot no puede gestionar el rol de «${game.name}».`);
        if (role.name !== game.name) {
          renamedRoles.push({ id: role.id, name: role.name });
          await role.setName(game.name.slice(0, 100), 'Nombre actualizado desde Roles de juegos');
        }
      }
      if (game.createChannel) {
        const channelName = channelNameForGame(game.name, game.emoji);
        const created = await guild.channels.create({
          name: channelName, type: ChannelType.GuildText,
          ...(input.categoryId ? { parent: input.categoryId } : {}),
          permissionOverwrites: [
            { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: game.role_id, allow: [PermissionFlagsBits.ViewChannel] },
            { id: botMember.id, allow: [PermissionFlagsBits.ViewChannel] },
          ],
          reason: 'Canal privado de juego creado desde Roles de juegos',
        });
        game.channel_id = created.id; game.created_by_bot = true;
        game.everyone_view_state = 0; game.bot_view_state = 0;
        createdChannels.push(created.id);
      } else if (game.channel_id) {
        const gameChannel = resolvedChannels.get(game.id ?? game.name);
        if (!gameChannel) throw new Error(`No se pudo cargar el canal vinculado a «${game.name}».`);
        if (game.created_by_bot && gameChannel.name !== channelNameForGame(game.name, game.emoji)) {
          renamedChannels.push({ channel: gameChannel, name: gameChannel.name });
          await gameChannel.setName(channelNameForGame(game.name, game.emoji), 'Nombre actualizado desde Roles de juegos');
        }
        if (!game.id || oldById.get(game.id)?.channel_id !== game.channel_id) {
          newlyPrivatized.push({ channel: gameChannel, roleId: game.role_id, everyoneState: game.everyone_view_state ?? 0, botState: game.bot_view_state ?? 0 });
        }
        await applyGameChannelPrivacy(gameChannel, guild, game.role_id, botMember.id);
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
      for (const game of desired) await db.query(`INSERT INTO game_role_options (id,guild_id,name,description,emoji,emoji_key,role_id,channel_id,created_by_bot,ownership_confirmed,everyone_view_state,bot_view_state) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [game.id ?? crypto.randomUUID(), guild.id, game.name, game.description, game.emoji, game.emoji_key, game.role_id, game.channel_id, game.created_by_bot ?? false, game.ownership_confirmed ?? false, game.everyone_view_state, game.bot_view_state]);
      await db.query('COMMIT');
      dbCommitted = true;
    } catch (error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }

    const nextById = new Map(desired.filter((game) => game.id).map((game) => [game.id!, game]));
    const removed = current.games.flatMap((old) => {
      const next = nextById.get(old.id);
      return !next || next.channel_id !== old.channel_id ? [{ game: old, deleteRole: !next }] : [];
    });
    const cleanupErrors: string[] = [];
    for (const item of removed) {
      const removalOwnership = removedOwnershipById.get(item.game.id);
      const ownership = removalOwnership?.ownershipConfirmed === true
        ? { ...item.game, created_by_bot: removalOwnership.createdByBot === true, ownership_confirmed: true }
        : item.game;
      try { await restoreGameChannel(guild, ownership); }
      catch (error) { cleanupErrors.push(`No se pudo restaurar/eliminar el canal ${item.game.channel_id}: ${error instanceof Error ? error.message : 'error de Discord'}`); }
      if (!ownership.ownership_confirmed && ownership.channel_id) cleanupErrors.push(`Se conservó el canal ${ownership.channel_id}: su propiedad sigue sin confirmar.`);
      if (item.deleteRole) {
        try { await guild.roles.delete(item.game.role_id, 'Juego eliminado desde Roles de juegos'); }
        catch (error) { cleanupErrors.push(`No se pudo borrar el rol ${item.game.role_id}: ${error instanceof Error ? error.message : 'error de Discord'}`); }
      }
    }
    return { messageId: message.id, games: desired.length, warnings: cleanupErrors };
  } catch (error) {
    if (!dbCommitted && changedMessage) {
      if (createdMessage) await changedMessage.delete().catch(() => undefined);
      else await changedMessage.edit({ embeds: [...originalEmbeds] }).catch(() => undefined);
      for (const emoji of addedReactions) await changedMessage.reactions.resolve(emoji)?.remove().catch(() => undefined);
      for (const emoji of removedReactions) await changedMessage.react(emoji).catch(() => undefined);
    }
    if (!dbCommitted) {
      for (const item of newlyPrivatized) {
        await item.channel.permissionOverwrites.delete(item.roleId).catch(() => undefined);
        await setViewState(item.channel, guild.roles.everyone.id, item.everyoneState).catch(() => undefined);
        await setViewState(item.channel, botMember.id, item.botState).catch(() => undefined);
      }
      for (const item of renamedChannels) await item.channel.setName(item.name, 'Reversión de configuración incompleta').catch(() => undefined);
      for (const channelId of createdChannels) await guild.channels.delete(channelId, 'Reversión de configuración de juego incompleta').catch(() => undefined);
      for (const roleId of createdRoles) await guild.roles.delete(roleId, 'Reversión de configuración incompleta').catch(() => undefined);
      for (const role of renamedRoles) {
        const target = await guild.roles.fetch(role.id).catch(() => null);
        if (target) await target.setName(role.name, 'Reversión de configuración incompleta').catch(() => undefined);
      }
    }
    throw error;
  }
}
