import { Injectable } from '@nestjs/common';

import type { LocationAccessPurpose } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma';

@Injectable()
export class LocationAccessLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async record(args: {
    accountId: bigint | null;
    purpose: LocationAccessPurpose;
    at: Date;
  }): Promise<void> {
    await this.prisma.locationAccessLog.create({
      data: {
        account_id: args.accountId,
        purpose: args.purpose,
        created_at: args.at,
      },
    });
  }

  async deleteCreatedBefore(cutoff: Date): Promise<number> {
    const { count } = await this.prisma.locationAccessLog.deleteMany({
      where: { created_at: { lt: cutoff } },
    });
    return count;
  }
}
