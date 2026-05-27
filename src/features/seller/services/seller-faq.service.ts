import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditActionType, AuditTargetType } from '@prisma/client';

import { parseId } from '@/common/utils/id-parser';
import { cleanRequiredText } from '@/common/utils/text-cleaner';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { FAQ_TOPIC_NOT_FOUND } from '@/features/seller/constants/seller-error-messages';
import {
  MAX_FAQ_ANSWER_HTML_LENGTH,
  MAX_FAQ_TITLE_LENGTH,
} from '@/features/seller/constants/seller.constants';
import type { SellerCreateFaqTopicInput } from '@/features/seller/dto/inputs/seller-create-faq-topic.input';
import type { SellerUpdateFaqTopicInput } from '@/features/seller/dto/inputs/seller-update-faq-topic.input';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerBaseService } from '@/features/seller/services/seller-base.service';
import { toFaqTopicOutput } from '@/features/seller/services/seller-content-mappers.helper';
import type { ISellerFaqService } from '@/features/seller/services/seller-faq.service.interface';
import type { SellerFaqTopicOutput } from '@/features/seller/types/seller-output.type';

@Injectable()
export class SellerFaqService
  extends SellerBaseService
  implements ISellerFaqService
{
  constructor(
    repo: SellerRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
  ) {
    super(repo, auditLogs);
  }

  async sellerFaqTopics(accountId: bigint): Promise<SellerFaqTopicOutput[]> {
    const ctx = await this.requireSellerContext(accountId);
    const rows = await this.repo.listFaqTopics(ctx.storeId);
    return rows.map((row) => toFaqTopicOutput(row));
  }

  async sellerCreateFaqTopic(
    accountId: bigint,
    input: SellerCreateFaqTopicInput,
  ): Promise<SellerFaqTopicOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const row = await this.repo.createFaqTopic({
      storeId: ctx.storeId,
      title: cleanRequiredText(input.title, MAX_FAQ_TITLE_LENGTH),
      answerHtml: cleanRequiredText(
        input.answerHtml,
        MAX_FAQ_ANSWER_HTML_LENGTH,
      ),
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
    });

    await this.auditLogs.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.STORE,
      targetId: ctx.storeId,
      action: AuditActionType.CREATE,
      afterJson: {
        topicId: row.id.toString(),
      },
    });

    return toFaqTopicOutput(row);
  }

  async sellerUpdateFaqTopic(
    accountId: bigint,
    input: SellerUpdateFaqTopicInput,
  ): Promise<SellerFaqTopicOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const topicId = parseId(input.topicId);

    const current = await this.repo.findFaqTopicById({
      topicId,
      storeId: ctx.storeId,
    });
    if (!current) throw new NotFoundException(FAQ_TOPIC_NOT_FOUND);

    const row = await this.repo.updateFaqTopic({
      topicId,
      data: {
        ...(input.title !== undefined
          ? { title: cleanRequiredText(input.title, MAX_FAQ_TITLE_LENGTH) }
          : {}),
        ...(input.answerHtml !== undefined
          ? {
              answer_html: cleanRequiredText(
                input.answerHtml,
                MAX_FAQ_ANSWER_HTML_LENGTH,
              ),
            }
          : {}),
        ...(input.sortOrder !== undefined
          ? { sort_order: input.sortOrder }
          : {}),
        ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
      },
    });

    await this.auditLogs.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.STORE,
      targetId: ctx.storeId,
      action: AuditActionType.UPDATE,
      afterJson: {
        topicId: row.id.toString(),
      },
    });

    return toFaqTopicOutput(row);
  }

  async sellerDeleteFaqTopic(
    accountId: bigint,
    topicId: bigint,
  ): Promise<boolean> {
    const ctx = await this.requireSellerContext(accountId);
    const current = await this.repo.findFaqTopicById({
      topicId,
      storeId: ctx.storeId,
    });
    if (!current) throw new NotFoundException(FAQ_TOPIC_NOT_FOUND);

    await this.repo.softDeleteFaqTopic(topicId);
    await this.auditLogs.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.STORE,
      targetId: ctx.storeId,
      action: AuditActionType.DELETE,
      beforeJson: {
        topicId: current.id.toString(),
      },
    });

    return true;
  }
}
