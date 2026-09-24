/** 인자 파싱만 — spec이 Prisma 없이 검증할 수 있게 분리한다. */
export interface RequeueArgs {
  id?: bigint;
  eventId?: string;
  eventType?: string;
  all: boolean;
  /** 소비 DLQ 재처리 — PUBLISHED 행도 PENDING으로. --event-id와 함께만. */
  republish: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 필터 없이 전부 되돌리는 건 --all로만 — 실수로 DLQ 전체를 다시 태우지 않게. */
export function parseRequeueArgs(argv: string[]): RequeueArgs {
  const args: RequeueArgs = { all: false, republish: false };
  for (const raw of argv) {
    const [key, value] = raw.split('=', 2);
    if (key === '--all') args.all = true;
    else if (key === '--republish') args.republish = true;
    else if (key === '--id' && value) args.id = BigInt(value);
    else if (key === '--event-id' && value && UUID.test(value)) {
      args.eventId = value;
    } else if (key === '--event-type' && value) args.eventType = value;
    else throw new Error(`알 수 없는 인자: ${raw}`);
  }
  if (
    !args.all &&
    args.id === undefined &&
    args.eventId === undefined &&
    args.eventType === undefined
  ) {
    throw new Error(
      '--id=<n> 또는 --event-id=<uuid> 또는 --event-type=<type> 또는 --all 중 하나가 필요합니다',
    );
  }
  if (args.republish && args.eventId === undefined) {
    throw new Error('--republish는 --event-id=<uuid>와 함께만 쓸 수 있습니다');
  }
  return args;
}
