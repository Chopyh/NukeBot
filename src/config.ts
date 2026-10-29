import 'dotenv/config';

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta ${name}. Copia .env.example a .env y completa su valor.`);
  return value;
}

export function requiredId(name: string): string {
  const value = requiredEnv(name);
  if (!/^\d{17,20}$/.test(value)) throw new Error(`${name} debe ser un ID de Discord válido.`);
  return value;
}
