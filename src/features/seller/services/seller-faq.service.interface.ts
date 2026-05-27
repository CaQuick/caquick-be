import type { SellerCreateFaqTopicInput } from '@/features/seller/dto/inputs/seller-create-faq-topic.input';
import type { SellerUpdateFaqTopicInput } from '@/features/seller/dto/inputs/seller-update-faq-topic.input';
import type { SellerFaqTopicOutput } from '@/features/seller/types/seller-output.type';

export const SELLER_FAQ_SERVICE = Symbol('SELLER_FAQ_SERVICE');

/**
 * Seller FAQ 토픽 서비스 인터페이스.
 *
 * 단일 책임: 매장 FAQ 토픽 CRUD.
 */
export interface ISellerFaqService {
  sellerFaqTopics(accountId: bigint): Promise<SellerFaqTopicOutput[]>;

  sellerCreateFaqTopic(
    accountId: bigint,
    input: SellerCreateFaqTopicInput,
  ): Promise<SellerFaqTopicOutput>;

  sellerUpdateFaqTopic(
    accountId: bigint,
    input: SellerUpdateFaqTopicInput,
  ): Promise<SellerFaqTopicOutput>;

  sellerDeleteFaqTopic(accountId: bigint, topicId: bigint): Promise<boolean>;
}
