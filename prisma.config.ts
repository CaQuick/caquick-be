import 'dotenv/config';

import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 설정 파일.
 *
 * 7부터 datasource url·migrations 경로·seed 명령이 schema.prisma가 아니라 여기로 온다.
 * 환경변수도 자동 로드되지 않으므로 dotenv를 명시적으로 불러온다.
 */

// `env('DATABASE_URL')` 대신 조건부로 싣는다 — env()는 값이 없으면 **설정 로드 시점에**
// 던지는데, 그러면 DB가 필요 없는 `prisma generate`까지 .env 없는 환경(CI·새 clone)에서
// 실패한다. 접속이 실제로 필요한 migrate/db 명령은 url 부재를 Prisma가 알려주고,
// 런타임 클라이언트는 createExtendedPrismaClient가 별도로 fail-fast 한다.
const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node -r tsconfig-paths/register prisma/seed.ts',
  },
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
});
