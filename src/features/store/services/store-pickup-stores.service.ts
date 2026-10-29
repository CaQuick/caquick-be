import { Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import { ClockService } from '@/common/providers/clock.service';
import { parseId } from '@/common/utils/id-parser';
import { kstDayDiff, parseKstDate } from '@/common/utils/kst-time';
import { hasMoreByOffset } from '@/common/utils/pagination';
import { DEFAULT_SEARCH_PAGE_LIMIT } from '@/features/store/constants/store-search.constants';
import { MAX_DAYS_AHEAD } from '@/features/store/constants/store-seller.constants';
import { DEFAULT_STORE_SORT } from '@/features/store/constants/store-sort.constants';
import type { PickupStoresInput } from '@/features/store/dto/inputs/pickup-stores.input';
import {
  StoreRepository,
  type RegionCenterRow,
} from '@/features/store/repositories/store.repository';
import { StoreCardService } from '@/features/store/services/store-card.service';
import { toCoordinate } from '@/features/store/services/store-detail-mappers.helper';
import { StoreListingService } from '@/features/store/services/store-listing.service';
import { StorePickupAvailabilityService } from '@/features/store/services/store-pickup-availability.service';
import type {
  MapBounds,
  PickupStoreConnection,
} from '@/features/store/types/store-pickup-stores-output.type';

const PICKUP_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function toRegionBounds(centers: RegionCenterRow[]): MapBounds | null {
  const points = centers.flatMap((center) => {
    const lat = toCoordinate(center.center_lat);
    const lng = toCoordinate(center.center_lng);
    return lat !== null && lng !== null ? [{ lat, lng }] : [];
  });
  if (points.length === 0) return null;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return {
    south: Math.min(...lats),
    west: Math.min(...lngs),
    north: Math.max(...lats),
    east: Math.max(...lngs),
  };
}

@Injectable()
export class StorePickupStoresService {
  constructor(
    private readonly repo: StoreRepository,
    private readonly availability: StorePickupAvailabilityService,
    private readonly listing: StoreListingService,
    private readonly cards: StoreCardService,
    private readonly clock: ClockService,
  ) {}

  async pickupStores(
    input: PickupStoresInput,
    accountId?: bigint,
  ): Promise<PickupStoreConnection> {
    const day = parseKstDate(input.date);
    if (!day) throw new DomainException('INVALID_DATE');
    const time = input.time ?? undefined;
    if (time !== undefined && !PICKUP_TIME_PATTERN.test(time)) {
      throw new DomainException('INVALID_TIME_VALUE');
    }
    const now = this.clock.now();
    const daysAhead = kstDayDiff(now, day);
    if (daysAhead < 0) throw new DomainException('PICKUP_DATE_PAST');

    const offset = input.offset ?? 0;
    const limit = input.limit ?? DEFAULT_SEARCH_PAGE_LIMIT;
    const regionIds = input.regionIds?.map((id) => parseId(id));
    const regionBounds = regionIds?.length
      ? toRegionBounds(await this.repo.findRegionCenters(regionIds))
      : null;
    // 예약 가능 기간 상한을 넘으면 어느 매장도 열리지 않는다
    if (daysAhead > MAX_DAYS_AHEAD) {
      return { items: [], totalCount: 0, hasMore: false, regionBounds };
    }

    const candidates = await this.repo.findActiveStoresForRanking(regionIds);
    const slotsByStore = await this.availability.openSlotsOn(
      candidates,
      day,
      now,
    );
    const matched = candidates.filter((candidate) => {
      const slots = slotsByStore.get(candidate.id);
      return (
        slots !== undefined &&
        (time === undefined ||
          slots.some((slot) => slot.available && slot.time === time))
      );
    });

    const { ordered, stats } = await this.listing.sortStores(
      matched,
      input.sort ?? DEFAULT_STORE_SORT,
      now,
    );
    const page = ordered.slice(offset, offset + limit);
    const cards = await this.cards.buildCards(page, accountId, { stats });

    return {
      items: cards.map((store, idx) => ({
        store,
        latitude: toCoordinate(page[idx].latitude),
        longitude: toCoordinate(page[idx].longitude),
      })),
      totalCount: matched.length,
      hasMore: hasMoreByOffset(offset, limit, matched.length),
      regionBounds,
    };
  }
}
