import 'dotenv/config';

import { defineConfig } from 'prisma/config';

// Prisma 7은 datasource url을 스키마가 아니라 이 파일에서 읽는다.
// env()는 로드 시점에 throw해 DATABASE_URL 없는 CI·clone 직후의 `prisma generate`까지 막으므로,
// 접속이 실제로 필요한 명령에서만 값이 쓰이도록 있을 때만 싣는다.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node -r tsconfig-paths/register prisma/seed.ts',
  },
  ...(process.env.DATABASE_URL
    ? { datasource: { url: process.env.DATABASE_URL } }
    : {}),
});
