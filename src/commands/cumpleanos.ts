import { SlashCommandBuilder } from 'discord.js';
import type { Command } from './types.js';
import { removeBirthdayRegistration, validateBirthdayColor, validateBirthdayEmoji } from '../birthdays.js';

export const cumple: Command = {
    data: new SlashCommandBuilder()
      .setName('cumple')
      .setDescription('Registra y administra tu cumpleaños.')
      .addSubcommand((subcommand) => subcommand
        .setName('registrar')
        .setDescription('Registra tu cumpleaños, emoji y nombre de rol.')
        .addIntegerOption((option) => option.setName('dia').setDescription('Día de tu cumpleaños').setMinValue(1).setMaxValue(31).setRequired(true))
        .addIntegerOption((option) => option.setName('mes').setDescription('Mes de tu cumpleaños').setMinValue(1).setMaxValue(12).setRequired(true))
        .addStringOption((option) => option.setName('emoji').setDescription('Emoji que quieres mostrar en los canales').setMaxLength(64).setRequired(true))
        .addStringOption((option) => option.setName('nombre_rol').setDescription('Nombre del rol temporal que recibirás').setMaxLength(100).setRequired(true))
        .addStringOption((option) => option.setName('color').setDescription('Color hexadecimal del rol, por ejemplo #D3FF75').setMaxLength(7).setRequired(true)))
      .addSubcommand((subcommand) => subcommand.setName('ver').setDescription('Consulta tu cumpleaños registrado.'))
      .addSubcommand((subcommand) => subcommand.setName('borrar').setDescription('Elimina tu cumpleaños registrado.')),
    async execute(interaction, { pool }) {
      if (!interaction.guildId) {
        await interaction.reply({ content: 'Este comando solo se puede usar dentro de un servidor.', ephemeral: true });
        return;
      }

      const subcommand = interaction.options.getSubcommand();
      const guildId = interaction.guildId;
      const userId = interaction.user.id;

      if (subcommand === 'registrar') {
        const day = interaction.options.getInteger('dia', true);
        const month = interaction.options.getInteger('mes', true);
        const emoji = interaction.options.getString('emoji', true).trim();
        const roleName = interaction.options.getString('nombre_rol', true).trim();
        const color = interaction.options.getString('color', true).trim().toUpperCase();
        const daysInMonth = new Date(Date.UTC(2024, month, 0)).getUTCDate();
        if (day > daysInMonth) {
          await interaction.reply({ content: 'La fecha indicada no existe. Para el 29 de febrero, elige día 29 y mes 2.', ephemeral: true });
          return;
        }
        if (!validateBirthdayEmoji(emoji)) {
          await interaction.reply({ content: 'Indica un único emoji Unicode o un emoji personalizado del servidor.', ephemeral: true });
          return;
        }
        if (!validateBirthdayColor(color)) {
          await interaction.reply({ content: 'El color debe tener formato hexadecimal #RRGGBB, por ejemplo #D3FF75.', ephemeral: true });
          return;
        }
        if (!roleName || /@everyone|@here/i.test(roleName)) {
          await interaction.reply({ content: 'El nombre del rol no puede estar vacío ni incluir menciones generales.', ephemeral: true });
          return;
        }

        await pool.query(
          `INSERT INTO birthday_registrations (guild_id, user_id, month, day, emoji, role_name, color)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (guild_id, user_id) DO UPDATE SET
             month = EXCLUDED.month, day = EXCLUDED.day, emoji = EXCLUDED.emoji,
             role_name = EXCLUDED.role_name, color = EXCLUDED.color`,
          [guildId, userId, month, day, emoji, roleName, color],
        );
        await interaction.reply({
          content: `Cumpleaños registrado para el ${day}/${month}. Usaré ${emoji} y crearé el rol **${roleName}** con color **${color}** durante 24 horas.`,
          ephemeral: true,
        });
        return;
      }

      if (subcommand === 'ver') {
        const result = await pool.query<{ day: number; month: number; emoji: string; role_name: string; color: string }>(
          'SELECT day, month, emoji, role_name, color FROM birthday_registrations WHERE guild_id = $1 AND user_id = $2',
          [guildId, userId],
        );
        const birthday = result.rows[0];
        await interaction.reply({
          content: birthday
            ? `Tienes registrado el ${birthday.day}/${birthday.month}, con ${birthday.emoji}, el rol **${birthday.role_name}** y el color **${birthday.color}**.`
            : 'Todavía no has registrado tu cumpleaños. Usa `/cumple registrar`.',
          ephemeral: true,
        });
        return;
      }

      if (interaction.guild) await removeBirthdayRegistration(interaction.guild, pool, userId);
      await interaction.reply({ content: 'Tu cumpleaños registrado se ha eliminado.', ephemeral: true });
    },
  };
