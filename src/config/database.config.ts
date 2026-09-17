import { registerAs } from '@nestjs/config';

export interface DatabaseConfig {
  url: string;
}

export default registerAs('database', (): DatabaseConfig => {
  const url = process.env.DATABASE_URL ?? '';

  if (!url) {
    throw new Error('DATABASE_URL must be set');
  }

  return {
    url,
  };
});
