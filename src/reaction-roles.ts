import { Events, type Client, type MessageReaction, type PartialMessageReaction, type PartialUser, type User } from 'discord.js';
import type { Pool } from 'pg';

type ReactionRole = { guild_id: string; message_id: string; emoji_key: string; role_id: string };

export async function ensureReactionRoleTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reaction_roles (
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      emoji_key TEXT NOT NULL,
      emoji_display TEXT NOT NULL,
      role_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, message_id, emoji_key)
    )
  `);
}

function reactionEmojiKey(reaction: MessageReaction): string | null {
  return reaction.emoji.id ?? reaction.emoji.name;
}

async function updateReactionRole(pool: Pool, incomingReaction: MessageReaction | PartialMessageReaction, incomingUser: User | PartialUser, add: boolean): Promise<void> {
  const user = incomingUser.partial ? await incomingUser.fetch() : incomingUser;
  if (user.bot) return;
  const reaction = incomingReaction.partial ? await incomingReaction.fetch() : incomingReaction;
  const guild = reaction.message.guild;
  const emojiKey = reactionEmojiKey(reaction);
  if (!guild || !emojiKey) return;

  const result = await pool.query<ReactionRole>(
    `SELECT guild_id, message_id, emoji_key, role_id FROM reaction_roles
     WHERE guild_id = $1 AND message_id = $2 AND emoji_key = $3`,
    [guild.id, reaction.message.id, emojiKey],
  );
  const mapping = result.rows[0];
  if (!mapping) return;

  const member = await guild.members.fetch(user.id);
  const role = await guild.roles.fetch(mapping.role_id);
  if (!role || !role.editable) {
    console.warn(`No se puede gestionar el rol ${mapping.role_id} del servidor ${guild.id}.`);
    return;
  }
  if (add) await member.roles.add(role, 'Reaction role');
  else await member.roles.remove(role, 'Reaction role');
}

export function registerReactionRoleListeners(client: Client, pool: Pool): void {
  client.on(Events.MessageReactionAdd, (reaction, user) => {
    void updateReactionRole(pool, reaction, user, true).catch((error) => {
      console.error('No se pudo asignar el rol de reacción:', error);
    });
  });
  client.on(Events.MessageReactionRemove, (reaction, user) => {
    void updateReactionRole(pool, reaction, user, false).catch((error) => {
      console.error('No se pudo retirar el rol de reacción:', error);
    });
  });
}

