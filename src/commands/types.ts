import type { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import type { Pool } from 'pg';

export interface Command {
  data: SlashCommandBuilder;
  execute(interaction: ChatInputCommandInteraction, context: { pool: Pool }): Promise<void>;
}
