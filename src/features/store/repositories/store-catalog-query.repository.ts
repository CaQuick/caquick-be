import { Injectable } from '@nestjs/common';

import type {
  FaqTopicRow,
  FaqTopicSummaryRow,
  ICatalogQuery,
  InquiryStoreRow,
} from '@/features/store/repositories/store-catalog-query.repository.interface';
import { activeWhere, PrismaService, visibleWhere } from '@/prisma';

/** CatalogQuery 포트의 모놀리스 구현. 서비스로 분리되면 클라이언트 구현으로 바뀐다. */
@Injectable()
export class StoreCatalogQueryRepository implements ICatalogQuery {
  constructor(private readonly prisma: PrismaService) {}

  async findInquiryStore(storeId: bigint): Promise<InquiryStoreRow | null> {
    return this.prisma.store.findFirst({
      where: { id: storeId, ...visibleWhere },
      select: {
        id: true,
        store_name: true,
        profile_image_url: true,
        greeting_message: true,
        business_hours: {
          where: activeWhere,
          orderBy: { day_of_week: 'asc' },
          select: {
            day_of_week: true,
            is_closed: true,
            open_time: true,
            close_time: true,
          },
        },
      },
    });
  }

  async listActiveFaqTopics(storeId: bigint): Promise<FaqTopicSummaryRow[]> {
    return this.prisma.storeFaqTopic.findMany({
      where: { store_id: storeId, is_active: true },
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
      select: { id: true, title: true },
    });
  }

  async findActiveFaqTopic(args: {
    storeId: bigint;
    faqTopicId: bigint;
  }): Promise<FaqTopicRow | null> {
    return this.prisma.storeFaqTopic.findFirst({
      where: {
        id: args.faqTopicId,
        store_id: args.storeId,
        is_active: true,
      },
      select: { id: true, title: true, answer_html: true },
    });
  }
}
