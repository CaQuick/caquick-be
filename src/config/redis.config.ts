import { registerAs } from '@nestjs/config';

/**
 * Redis 설정 타입 (GraphQL subscription PubSub용)
 */
export interface RedisConfig {
  url: string;
}

/**
 * Redis 설정.
 * DATABASE_URL과 달리 미설정 시 로컬 docker-compose 기본값으로 폴백한다 —
 * 현재 배포 인프라가 꺼져 있고 FE도 로컬 백엔드로 테스트하는 개발 단계라,
 * 필수 강제보다 로컬 DX(compose up 후 바로 동작)를 우선한다.
 */
export default registerAs('redis', (): RedisConfig => {
  return {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  };
});
