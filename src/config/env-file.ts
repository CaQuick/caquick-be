import { config as loadDotenv } from 'dotenv';

/**
 * .env를 process.env에 올린다. 이미 있는 값은 덮지 않는다(ConfigModule과 같은 규칙) — 컨테이너 env가 정본.
 * 파일이 없으면 조용히 지나간다(컨테이너는 .env 없이 env만 받는다).
 */
export function loadEnvFile(path?: string): void {
  loadDotenv({ path, override: false, quiet: true });
}
