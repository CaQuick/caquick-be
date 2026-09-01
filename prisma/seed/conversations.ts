/**
 * 시드 대화 + FAQ 칩 (figma notification-center 대화 탭·문의 채팅 재현).
 *
 * - storeA: 커스텀 인사말 + FAQ 5종(질문 칩) 등록.
 *   user1 대화 = 인사말 → 칩 질문("케이크 보관 방법") → HTML 자동응답.
 * - storeB: 인사말 미설정(기본 문구 사용 경로 검증).
 *   user1 대화 = 인사말 → 유저 자유 텍스트 → 판매자 답장 3건(안읽음 배지 재현,
 *   last_read_at은 유저 메시지 시점까지만).
 */
import type { PrismaClient } from '@prisma/client';

import type { SeededStores } from './stores';
import type { SeededUser } from './users';

export async function seedConversations(
  prisma: PrismaClient,
  ctx: { users: SeededUser[]; stores: SeededStores },
): Promise<void> {
  const user1 = ctx.users[0];
  if (!user1) throw new Error('seedUsers must run before seedConversations');
  const [storeA, storeB] = ctx.stores.stores;
  if (!storeA || !storeB) {
    throw new Error('seedStores must run before seedConversations');
  }

  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;

  // ── storeA: 커스텀 인사말 + FAQ 칩 ──
  await prisma.store.update({
    where: { id: storeA.id },
    data: {
      greeting_message:
        '안녕하세요! {nickname} 고객님.\n{storeName} 입니다 😄\n무엇을 도와드릴까요?',
    },
  });

  const faqRows = [
    { title: '날짜 변경', answer_html: '<p>픽업 1일 전까지 채팅으로 요청해 주시면 일정 확인 후 변경해 드려요.</p>' },
    {
      title: '케이크 보관 방법',
      answer_html:
        '<p>🎂 <strong>케이크 보관 방법</strong></p><ul><li>냉장보관시 최대 3일</li><li>생크림 케이크는 당일 드시는 걸 권장해요</li></ul>',
    },
    { title: '가게 위치 정보', answer_html: '<p>매장 상세의 찾아오는 길 안내를 확인해 주세요.</p>' },
    { title: '제일 많이 물어보는 질문', answer_html: '<p>레터링 문구는 주문 시 요청사항에 남겨 주시면 반영돼요.</p>' },
    { title: '예약 가능 일정', answer_html: '<p>캘린더에서 픽업 가능 날짜·시간대를 확인할 수 있어요.</p>' },
  ];
  const faqs = [] as { id: bigint; title: string; answer_html: string }[];
  for (const [i, row] of faqRows.entries()) {
    faqs.push(
      await prisma.storeFaqTopic.create({
        data: { store_id: storeA.id, sort_order: i + 1, ...row },
      }),
    );
  }

  // ── user1 ↔ storeA: 칩 문답 대화 ──
  const convA = await prisma.storeConversation.create({
    data: {
      account_id: user1.id,
      store_id: storeA.id,
      last_message_at: new Date(now - 1 * day),
      last_read_at: new Date(now - 1 * day),
    },
  });
  const keepFaq = faqs[1];
  await prisma.storeConversationMessage.createMany({
    data: [
      {
        conversation_id: convA.id,
        sender_type: 'STORE',
        body_format: 'TEXT',
        body_text:
          '안녕하세요! seedTester1 고객님.\n[SEED] 케이크샵 A 입니다 😄\n무엇을 도와드릴까요?',
        created_at: new Date(now - 1 * day - 2 * 60 * 1000),
      },
      {
        conversation_id: convA.id,
        sender_type: 'USER',
        sender_account_id: user1.id,
        body_format: 'TEXT',
        body_text: keepFaq?.title ?? '케이크 보관 방법',
        created_at: new Date(now - 1 * day - 60 * 1000),
      },
      {
        conversation_id: convA.id,
        sender_type: 'STORE',
        body_format: 'HTML',
        body_html: keepFaq?.answer_html ?? '<p>보관 안내</p>',
        created_at: new Date(now - 1 * day),
      },
    ],
  });

  // ── user1 ↔ storeB: 자유 문의 + 판매자 답장 3건(안읽음) ──
  const convB = await prisma.storeConversation.create({
    data: {
      account_id: user1.id,
      store_id: storeB.id,
      last_message_at: new Date(now - 5 * hour),
      // 유저가 마지막으로 읽은 시점 = 본인 메시지 직후 → 판매자 답장 3건 안읽음
      last_read_at: new Date(now - 8 * hour),
    },
  });
  await prisma.storeConversationMessage.createMany({
    data: [
      {
        conversation_id: convB.id,
        sender_type: 'STORE',
        body_format: 'TEXT',
        body_text:
          '안녕하세요! seedTester1 고객님.\n[SEED] 도넛샵 B 입니다 😄\n무엇을 도와드릴까요?',
        created_at: new Date(now - 9 * hour),
      },
      {
        conversation_id: convB.id,
        sender_type: 'USER',
        sender_account_id: user1.id,
        body_format: 'TEXT',
        body_text: '주문한 도넛 픽업 시간을 30분 늦출 수 있을까요?',
        created_at: new Date(now - 8 * hour),
      },
      {
        conversation_id: convB.id,
        sender_type: 'STORE',
        sender_account_id: storeB.seller_account_id,
        body_format: 'TEXT',
        body_text: '고객님이 말씀해 주신 문의사항에 대한 답변 드리겠습니다.',
        created_at: new Date(now - 7 * hour),
      },
      {
        conversation_id: convB.id,
        sender_type: 'STORE',
        sender_account_id: storeB.seller_account_id,
        body_format: 'TEXT',
        body_text: '네, 30분 늦은 픽업 가능합니다.',
        created_at: new Date(now - 6 * hour),
      },
      {
        conversation_id: convB.id,
        sender_type: 'STORE',
        sender_account_id: storeB.seller_account_id,
        body_format: 'TEXT',
        body_text: '방문 시 매장 카운터에서 주문번호를 말씀해 주세요.',
        created_at: new Date(now - 5 * hour),
      },
    ],
  });
}
