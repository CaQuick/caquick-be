import { registerAs } from '@nestjs/config';

export interface RedisConfig {
  url: string;
}

/**
 * DATABASE_URL과 달리 미설정 시 로컬 docker-compose 기본값으로 폴백한다 — 배포 인프라가 꺼져 있고
 * FE도 로컬 백엔드로 테스트하는 개발 단계라 필수 강제보다 로컬 DX를 우선한다.
 */
export default registerAs('redis', (): RedisConfig => {
  return {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  };
});
