import type { PubSub } from 'graphql-subscriptions';

/** in-memory PubSub 토픽 수신분을 모은다 — 발행 건수(0건 포함)를 단언하는 service spec용. 끝나면 stop(). */
export async function collectTopic(pubSub: PubSub, topic: string) {
  const received: unknown[] = [];
  const subId = await pubSub.subscribe(topic, (payload: unknown) => {
    received.push(payload);
  });
  return { received, stop: () => pubSub.unsubscribe(subId) };
}
