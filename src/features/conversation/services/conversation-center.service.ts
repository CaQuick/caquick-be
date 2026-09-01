import { Injectable, NotFoundException } from '@nestjs/common';

import { parseId } from '@/common/utils/id-parser';
import {
  buildTimestampIdCursor,
  parseIdCursor,
  parseTimestampIdCursor,
} from '@/common/utils/keyset-cursor';
import { sliceCursorPage } from '@/common/utils/pagination';
import { CONVERSATION_ERRORS } from '@/features/conversation/constants/conversation-error-messages';
import {
  DEFAULT_CONVERSATION_LIST_LIMIT,
  DEFAULT_CONVERSATION_MESSAGES_LIMIT,
} from '@/features/conversation/constants/conversation.constants';
import type { ConversationMessagesInput } from '@/features/conversation/dto/inputs/conversation-messages.input';
import type { MyConversationsInput } from '@/features/conversation/dto/inputs/my-conversations.input';
import { ConversationRepository } from '@/features/conversation/repositories/conversation.repository';
import { ConversationBaseService } from '@/features/conversation/services/conversation-base.service';
import { toLastMessagePreview } from '@/features/conversation/services/conversation-center-mappers.helper';
import { toConversationMessageOutput } from '@/features/conversation/services/conversation-inquiry-mappers.helper';
import type {
  ConversationMessageConnection,
  MyConversationConnection,
} from '@/features/conversation/types/conversation-output.type';

@Injectable()
export class ConversationCenterService extends ConversationBaseService {
  constructor(repo: ConversationRepository) {
    super(repo);
  }

  async myConversations(
    accountId: bigint,
    input?: MyConversationsInput,
  ): Promise<MyConversationConnection> {
    await this.requireActiveUser(accountId);

    const limit = input?.limit ?? DEFAULT_CONVERSATION_LIST_LIMIT;
    const cursor = input?.cursor
      ? parseTimestampIdCursor(input.cursor, CONVERSATION_ERRORS.INVALID_CURSOR)
      : undefined;

    const [rows, totalCount] = await Promise.all([
      this.repo.listConversationsByAccount({
        accountId,
        limit,
        cursor: cursor
          ? { lastMessageAt: cursor.timestamp, id: cursor.id }
          : undefined,
      }),
      this.repo.countConversationsByAccount(accountId),
    ]);

    // last_message_at desc 정렬과 결합된 커서 — 새 메시지 도착으로 대화가
    // 위로 떠오르면 다음 페이지에 다시 나타날 수 있다(목록 새로고침 전제).
    const page = sliceCursorPage(rows, limit, (last) =>
      // listConversationsByAccount가 last_message_at null을 제외하므로 항상 존재
      buildTimestampIdCursor(last.last_message_at!, last.id),
    );

    const extras = await this.repo.getConversationListExtras(
      page.items.map((row) => ({ id: row.id, last_read_at: row.last_read_at })),
    );
    const extraById = new Map(
      extras.map((e) => [e.conversationId.toString(), e]),
    );

    return {
      items: page.items.map((row) => {
        const extra = extraById.get(row.id.toString());
        return {
          id: row.id.toString(),
          storeId: row.store_id.toString(),
          storeName: row.store.store_name,
          storeProfileImageUrl: row.store.profile_image_url,
          lastMessagePreview: toLastMessagePreview(extra?.lastMessage ?? null),
          lastMessageAt: row.last_message_at!,
          unreadCount: extra?.unreadCount ?? 0,
        };
      }),
      totalCount,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }

  async conversationMessages(
    accountId: bigint,
    conversationIdRaw: string,
    input?: ConversationMessagesInput,
  ): Promise<ConversationMessageConnection> {
    await this.requireActiveUser(accountId);
    const conversationId = parseId(conversationIdRaw);

    const conversation = await this.repo.findConversationByIdAndAccount({
      conversationId,
      accountId,
    });
    if (!conversation) {
      throw new NotFoundException(CONVERSATION_ERRORS.CONVERSATION_NOT_FOUND);
    }

    const limit = input?.limit ?? DEFAULT_CONVERSATION_MESSAGES_LIMIT;
    // parseId는 음수만 거르므로 UNSIGNED BIGINT 상한 초과가 커넥터 오류로
    // 번진다 — 상한까지 검증하는 커서 전용 파서를 쓴다(리뷰 반영)
    const cursor = input?.cursor
      ? parseIdCursor(input.cursor, CONVERSATION_ERRORS.INVALID_CURSOR)
      : undefined;

    // 채팅 상세 진입/조회 = 읽음으로 간주 — 별도 mutation 없이 조회
    // 트랜잭션이 last_read_at을 갱신한다(의도적 쓰기 부수효과, 사용자 확정
    // 정책). 전송 경로와 같은 잠금·마커 정합은 repository가 담당한다.
    const { rows, totalCount } = await this.repo.listBuyerMessagesAndMarkRead({
      conversationId,
      limit,
      cursor,
    });

    const page = sliceCursorPage(rows, limit, (last) => last.id.toString());

    return {
      items: page.items.map(toConversationMessageOutput),
      totalCount,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }
}
