import { parseRequeueArgs } from './outbox-requeue-args';

describe('outbox-requeue 인자', () => {
  it('id·event-type·all을 읽는다', () => {
    expect(parseRequeueArgs(['--id=12'])).toEqual({
      id: BigInt(12),
      all: false,
      republish: false,
    });
    expect(parseRequeueArgs(['--event-type=order.status_changed'])).toEqual({
      eventType: 'order.status_changed',
      all: false,
      republish: false,
    });
    expect(parseRequeueArgs(['--all'])).toEqual({
      all: true,
      republish: false,
    });
  });

  // 반증 — 범위 없는 실행과 오타는 막는다
  it.each([[[]], [['--ids=1']], [['--id']]])('반증: %p 는 던진다', (argv) => {
    expect(() => parseRequeueArgs(argv)).toThrow();
  });
});

describe('parseRequeueArgs — --event-id·--republish', () => {
  const uuid = '0f8fad5b-d9cb-469f-a165-70867728950e';

  it('--event-id=<uuid>는 단독으로 쓸 수 있고, --republish는 --event-id와 함께만', () => {
    expect(parseRequeueArgs([`--event-id=${uuid}`])).toEqual({
      all: false,
      republish: false,
      eventId: uuid,
    });
    expect(parseRequeueArgs([`--event-id=${uuid}`, '--republish'])).toEqual({
      all: false,
      republish: true,
      eventId: uuid,
    });
  });

  it.each([
    [['--republish'], '--event-id'],
    [['--event-type=x', '--republish'], '--event-id'],
    [['--event-id=not-a-uuid'], '알 수 없는 인자'],
  ])('반증: %j → 거절(%s)', (argv, message) => {
    expect(() => parseRequeueArgs(argv)).toThrow(message);
  });
});
