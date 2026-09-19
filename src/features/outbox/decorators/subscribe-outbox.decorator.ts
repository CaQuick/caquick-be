import { SetMetadata } from '@nestjs/common';

import { OUTBOX_CONSUMER_EVENTS } from '@/features/outbox/constants/outbox.constants';

/**
 * 소비자 provider에 붙여 구독할 event_type을 선언한다. 소비자 모듈이 OutboxModule을 import하지 않아도
 * 디스패처가 DiscoveryService로 찾으므로 feature 간 순환이 생기지 않는다.
 */
export const SubscribeOutbox = (
  ...eventTypes: [string, ...string[]]
): ClassDecorator => SetMetadata(OUTBOX_CONSUMER_EVENTS, eventTypes);
