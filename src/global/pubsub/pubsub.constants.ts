/**
 * PubSub 주입 토큰. cross-cutting 포트(외부 부수효과 어댑터)라 토큰 주입을
 * 사용한다 — 프로덕션은 RedisPubSub, spec은 in-memory PubSub로 대체된다.
 */
export const PUB_SUB = Symbol('PUB_SUB');
