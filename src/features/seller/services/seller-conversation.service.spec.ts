import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { ConversationRepository } from '../../conversation';
import { SellerRepository } from '../repositories/seller.repository';

import { SellerConversationService } from './seller-conversation.service';

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
    it('대화가 존재하지 않으면 NotFoundException을 던져야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      conversationRepo.findConversationByIdAndStore.mockResolvedValue(null);

      await expect(
        service.sellerConversationMessages(BigInt(1), BigInt(999)),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('sellerSendConversationMessage', () => {
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
          bodyFormat: 'INVALID',
          bodyText: '테스트',
          bodyHtml: null,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
