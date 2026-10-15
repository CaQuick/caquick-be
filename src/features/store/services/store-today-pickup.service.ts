import { Injectable } from '@nestjs/common';

import { ClockService } from '@/common/providers/clock.service';
import { parseId } from '@/common/utils/id-parser';
import { hasMoreByOffset } from '@/common/utils/pagination';
import { DEFAULT_POPULAR_STORES_LIMIT } from '@/features/store/constants/store-ranking.constants';
import type { TodayPickupStoresInput } from '@/features/store/dto/inputs/today-pickup-stores.input';
import { StoreCardService } from '@/features/store/services/store-card.service';
import { StoreListingService } from '@/features/store/services/store-listing.service';
import { StorePickupAvailabilityService } from '@/features/store/services/store-pickup-availability.service';
import type { TodayPickupStoreConnection } from '@/features/store/types/store-today-pickup-output.type';

@Injectable()
export class StoreTodayPickupService {
  constructor(
    private readonly availability: StorePickupAvailabilityService,
    private readonly listingService: StoreListingService,
    private readonly cards: StoreCardService,
    private readonly clock: ClockService,
  ) {}

  /** 오늘 예약 가능 슬롯이 1개 이상인 매장만 노출한다. */
  async todayPickupStores(
    input?: TodayPickupStoresInput,
    accountId?: bigint,
  ): Promise<TodayPickupStoreConnection> {
    const offset = input?.offset ?? 0;
    const limit = input?.limit ?? DEFAULT_POPULAR_STORES_LIMIT;
    const regionIds = input?.regionIds?.map((id) => parseId(id));

    const asOf = this.clock.now();
    const scored = await this.listingService.rankActiveStores(regionIds, asOf);
    const slotsByStore = await this.availability.openSlotsOn(
      scored.map((entry) => entry.candidate),
      asOf,
      asOf,
    );
    const open = scored.flatMap((entry) => {
      const slots = slotsByStore.get(entry.candidate.id);
      return slots ? [{ entry, slots }] : [];
    });

    const totalCount = open.length;
    const page = open.slice(offset, offset + limit);
    const cards = await this.cards.buildCards(
      page.map(({ entry }) => entry.candidate),
      accountId,
      {
        stats: new Map(
          page.map(({ entry }) => [entry.candidate.id, entry.metrics]),
        ),
      },
    );
    const items = cards.map((store, idx) => ({
      store,
      slots: page[idx].slots,
    }));

    return {
      items,
      totalCount,
      hasMore: hasMoreByOffset(offset, limit, totalCount),
      asOf,
    };
  }
}
