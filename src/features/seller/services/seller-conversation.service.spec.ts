import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { ConversationRepository } from '@/features/conversation';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerConversationService } from '@/features/seller/services/seller-conversation.service';

const SELLER_CONTEXT = {
  id: BigInt(1),
  account_type: 'SELLER',
  status: 'ACTIVE',
  store: { id: BigInt(100) },
};

describe('SellerConversationService', () => {
  let service: SellerConversationService;
  let repo: jest.Mocked<SellerRepository>;
  let conversationRepo: jest.Mocked<ConversationRepository>;

  beforeEach(async () => {
    repo = {
      findSellerAccountContext: jest.fn(),
      createAuditLog: jest.fn(),
    } as unknown as jest.Mocked<SellerRepository>;
    conversationRepo = {
      listConversationsByStore: jest.fn(),
      findConversationByIdAndStore: jest.fn(),
      listConversationMessages: jest.fn(),
      createSellerConversationMessage: jest.fn(),
    } as unknown as jest.Mocked<ConversationRepository>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SellerConversationService,
        {
          provide: SellerRepository,
          useValue: repo,
        },
        {
          provide: ConversationRepository,
          useValue: conversationRepo,
        },
      ],
    }).compile();

    service = module.get<SellerConversationService>(SellerConversationService);
  });

  describe('sellerConversationMessages', () => {
    it('정상 조회 시 메시지 목록과 nextCursor를 반환해야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      conversationRepo.findConversationByIdAndStore.mockResolvedValue({
        id: BigInt(10),
      } as never);
      conversationRepo.listConversationMessages.mockResolvedValue([
        {
          id: BigInt(1),
          conversation_id: BigInt(10),
          sender_type: 'STORE',
          sender_account_id: BigInt(1),
          body_format: 'TEXT',
          body_text: '안녕하세요',
          body_html: null,
          created_at: new Date('2026-01-01T00:00:00Z'),
        },
      ] as never);

      const result = await service.sellerConversationMessages(
        BigInt(1),
        BigInt(10),
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('1');
      expect(result.items[0].bodyText).toBe('안녕하세요');
    });

    it('대화가 존재하지 않으면 NotFoundException을 던져야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      conversationRepo.findConversationByIdAndStore.mockResolvedValue(null);

      await expect(
        service.sellerConversationMessages(BigInt(1), BigInt(999)),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('sellerSendConversationMessage', () => {
    it('정상 전송 시 메시지를 생성하고 반환해야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      conversationRepo.findConversationByIdAndStore.mockResolvedValue({
        id: BigInt(10),
      } as never);
      conversationRepo.createSellerConversationMessage.mockResolvedValue({
        id: BigInt(77),
        conversation_id: BigInt(10),
        sender_type: 'STORE',
        sender_account_id: BigInt(1),
        body_format: 'TEXT',
        body_text: '테스트 메시지',
        body_html: null,
        created_at: new Date('2026-01-01T00:00:00Z'),
      } as never);
      repo.createAuditLog.mockResolvedValue(undefined as never);

      const result = await service.sellerSendConversationMessage(BigInt(1), {
        conversationId: '10',
        bodyFormat: 'TEXT',
        bodyText: '테스트 메시지',
        bodyHtml: null,
      });

      expect(result.id).toBe('77');
      expect(result.bodyText).toBe('테스트 메시지');
      expect(conversationRepo.createSellerConversationMessage).toHaveBeenCalled();
      expect(repo.createAuditLog).toHaveBeenCalled();
    });

    it('대화가 존재하지 않으면 NotFoundException을 던져야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      conversationRepo.findConversationByIdAndStore.mockResolvedValue(null);

      await expect(
        service.sellerSendConversationMessage(BigInt(1), {
          conversationId: '999',
          bodyFormat: 'TEXT',
          bodyText: '안녕하세요',
          bodyHtml: null,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('bodyFormat이 TEXT인데 bodyText가 없으면 BadRequestException을 던져야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      conversationRepo.findConversationByIdAndStore.mockResolvedValue({
        id: BigInt(10),
      } as never);

      await expect(
        service.sellerSendConversationMessage(BigInt(1), {
          conversationId: '10',
          bodyFormat: 'TEXT',
          bodyText: null,
          bodyHtml: null,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('bodyFormat이 HTML인데 bodyHtml이 없으면 BadRequestException을 던져야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      conversationRepo.findConversationByIdAndStore.mockResolvedValue({
        id: BigInt(10),
      } as never);

      await expect(
        service.sellerSendConversationMessage(BigInt(1), {
          conversationId: '10',
          bodyFormat: 'HTML',
          bodyText: null,
          bodyHtml: null,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('유효하지 않은 bodyFormat이면 BadRequestException을 던져야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      conversationRepo.findConversationByIdAndStore.mockResolvedValue({
        id: BigInt(10),
      } as never);

      await expect(
        service.sellerSendConversationMessage(BigInt(1), {
          conversationId: '10',
          bodyFormat: 'INVALID' as never,
          bodyText: '테스트',
          bodyHtml: null,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
