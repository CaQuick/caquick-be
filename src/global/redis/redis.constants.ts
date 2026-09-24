/** 일반 명령(GET/SET)용 ioredis 클라이언트. subscription용 커넥션(PubSubModule)과 분리한다 — SUBSCRIBE 중 커넥션은 일반 명령을 못 쓴다. */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
