/**
 * 계좌번호 키 회전: ACCOUNT_ENCRYPTION_KEYS 맨 앞에 새 키를 넣고 배포한 뒤 돌린다. 대상 수를 먼저 찍는다.
 *   yarn accounts:reencrypt --dry-run   # 대상 수만
 *   yarn accounts:reencrypt             # 첫 키가 아닌 키로 암호화된 계좌번호를 첫 키로 다시 암호화
 * 대상이 0이 된 뒤에야 옛 키를 env에서 뺀다(infra/runbook.md).
 */
import '@/config/preload-env';

import {
  assertRotatableConfig,
  parseReencryptArgs,
} from './accounts-reencrypt-args';

import { readAccountCryptoConfig } from '@/config/account-crypto.config';
import { AccountNumberReencryptRepository } from '@/features/order/repositories/account-number-reencrypt.repository';
import { AccountCipher } from '@/global/crypto/account-cipher.service';
import type { PrismaService } from '@/prisma';
import { createExtendedPrismaClient } from '@/prisma/prisma.service';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL이 필요합니다');
  const { dryRun } = parseReencryptArgs(process.argv.slice(2));
  const config = readAccountCryptoConfig();
  assertRotatableConfig(config);
  const cipher = new AccountCipher(config);
  const prisma = createExtendedPrismaClient(databaseUrl);
  try {
    // 모델 write는 소유 feature의 repository만 — 스크립트도 예외가 아니다
    const repo = new AccountNumberReencryptRepository(
      prisma as PrismaService,
      cipher,
    );
    const stale = await repo.countStale();
    process.stdout.write(
      `primary key ${cipher.primaryKeyId}, 대상 ${JSON.stringify(stale)}\n`,
    );
    if (dryRun) return;
    const done = await repo.reencryptStale();
    process.stdout.write(`재암호화 ${JSON.stringify(done)}\n`);
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
