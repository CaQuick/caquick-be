/**
 * outbox 이벤트를 다시 PENDING으로 돌린다(P2 E6). 원인을 고친 뒤 사람이 돌린다.
 *   yarn outbox:requeue --event-type=order.status_changed      # 발행 FAILED
 *   yarn outbox:requeue --id=123
 *   yarn outbox:requeue --all
 *   yarn outbox:requeue --event-id=<uuid> --republish          # 소비 DLQ에 빠진 이벤트(PUBLISHED)를 다시 싣는다
 */
import '@/config/preload-env';

import { parseRequeueArgs } from './outbox-requeue-args';

import { OutboxRepository } from '@/features/outbox/repositories/outbox.repository';
import type { PrismaService } from '@/prisma';
import { createExtendedPrismaClient } from '@/prisma/prisma.service';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL이 필요합니다');
  const args = parseRequeueArgs(process.argv.slice(2));
  const prisma = createExtendedPrismaClient(databaseUrl);
  try {
    // 모델 write는 소유 feature의 repository만 — 스크립트도 예외가 아니다
    const count = await new OutboxRepository(prisma as PrismaService).requeue(
      { id: args.id, eventId: args.eventId, eventType: args.eventType },
      new Date(),
      { republish: args.republish },
    );
    process.stdout.write(`requeued ${count}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
}
