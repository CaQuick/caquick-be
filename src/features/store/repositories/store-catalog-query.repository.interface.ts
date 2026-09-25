import type {
  Store,
  StoreBusinessHour,
  StoreFaqTopic,
} from '@/generated/prisma/client';

/**
 * conversation feature가 catalog 서비스에 묻는 읽기 포트.
 * 문의 화면 컨텍스트·FAQ는 매장 도메인 데이터라 store가 구현하고, P4에서 서비스 클라이언트로 교체된다.
 */
export const CATALOG_QUERY = Symbol('CATALOG_QUERY');

export type InquiryStoreRow = Pick<
  Store,
  'id' | 'store_name' | 'profile_image_url' | 'greeting_message'
> & {
  business_hours: Pick<
    StoreBusinessHour,
    'day_of_week' | 'is_closed' | 'open_time' | 'close_time'
  >[];
};

export type FaqTopicSummaryRow = Pick<StoreFaqTopic, 'id' | 'title'>;
export type FaqTopicRow = Pick<StoreFaqTopic, 'id' | 'title' | 'answer_html'>;

export interface ICatalogQuery {
  /** 노출 가능한(활성·미삭제) 매장만 — 문의 진입 화면의 매장 컨텍스트. */
  findInquiryStore(storeId: bigint): Promise<InquiryStoreRow | null>;
  listActiveFaqTopics(storeId: bigint): Promise<FaqTopicSummaryRow[]>;
  findActiveFaqTopic(args: {
    storeId: bigint;
    faqTopicId: bigint;
  }): Promise<FaqTopicRow | null>;
}
