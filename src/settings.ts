import { Pool } from 'pg';
import type { Client } from 'discord.js';

export type BotSettings = {
  activityText: string;
  activityType: 'playing' | 'listening' | 'watching' | 'competing';
  presenceStatus: 'online' | 'idle' | 'dnd' | 'invisible';
};

export const defaultSettings: BotSettings = {
  activityText: '',
  activityType: 'playing',
  presenceStatus: 'online',
};

const activityTypes = ['playing', 'listening', 'watching', 'competing'] as const;
const presenceStatuses = ['online', 'idle', 'dnd', 'invisible'] as const;
const activityTypeMap = { playing: 0, listening: 2, watching: 3, competing: 5 } as const;

export function validateSettings(value: unknown): BotSettings {
  if (!value || typeof value !== 'object') throw new Error('La configuración enviada no es válida.');
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.activityText !== 'string' || candidate.activityText.length > 128) {
    throw new Error('La actividad debe tener entre 0 y 128 caracteres.');
  }
  if (!activityTypes.includes(candidate.activityType as BotSettings['activityType'])) {
    throw new Error('El tipo de actividad no es válido.');
  }
  if (!presenceStatuses.includes(candidate.presenceStatus as BotSettings['presenceStatus'])) {
    throw new Error('El estado de presencia no es válido.');
  }
  return {
    activityText: candidate.activityText.trim(),
    activityType: candidate.activityType as BotSettings['activityType'],
    presenceStatus: candidate.presenceStatus as BotSettings['presenceStatus'],
  };
}

export function createSettingsPool(): Pool {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error('Falta DATABASE_URL para conectar con PostgreSQL.');
  return new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000 });
}

export async function ensureSettingsTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_configuration (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      settings JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    'INSERT INTO bot_configuration (id, settings) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING',
    [JSON.stringify(defaultSettings)],
  );
}

export async function readSettings(pool: Pool): Promise<BotSettings> {
  const result = await pool.query<{ settings: unknown }>('SELECT settings FROM bot_configuration WHERE id = 1');
  return validateSettings(result.rows[0]?.settings ?? defaultSettings);
}

export async function saveSettings(pool: Pool, input: unknown): Promise<BotSettings> {
  const settings = validateSettings(input);
  await pool.query(
    `INSERT INTO bot_configuration (id, settings, updated_at) VALUES (1, $1::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW()`,
    [JSON.stringify(settings)],
  );
  return settings;
}

export function applySettings(client: Client, settings: BotSettings): void {
  if (!client.isReady()) return;
  client.user.setPresence({
    status: settings.presenceStatus,
    activities: settings.activityText
      ? [{ name: settings.activityText, type: activityTypeMap[settings.activityType] }]
      : [],
  });
}
