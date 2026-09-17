/** cross-cutting 포트(외부 부수효과 어댑터)라 토큰 주입을 쓴다 — 프로덕션은 RedisPubSub, spec은 in-memory PubSub. */
export const PUB_SUB = Symbol('PUB_SUB');
