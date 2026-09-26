import { loadEnvFile } from '@/config/env-file';

// ConfigModule보다 먼저 env를 읽는 곳(역할 선택·로거 라벨)이 있어 main.ts의 첫 import로 .env를 올린다.
loadEnvFile(process.env.DOTENV_PATH);

export {};
