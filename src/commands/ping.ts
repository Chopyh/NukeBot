import { SlashCommandBuilder } from 'discord.js';
import type { Command } from './types.js';

export const ping: Command = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Comprueba si el bot está conectado.'),
  async execute(interaction) {
    await interaction.reply(`¡Pong! Latencia del WebSocket: ${interaction.client.ws.ping} ms.`);
  },
};
