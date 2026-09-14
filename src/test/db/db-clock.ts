import type { PrismaClient } from '@/generated/prisma/client';

/**
 * DB 서버의 현재 시각(밀리초 정밀도).
 *
 * 왜 필요한가: 대화 메시지 순서·읽음 마커 판정은 앱 호스트 시계가 아니라 DB `NOW(3)`을
 * 단일 시계로 쓴다(여러 인스턴스 간 시계 스큐를 피하려는 의도적 설계). 그래서 테스트가
 * `Date.now()`로 "미래/과거" 데이터를 심으면 **호스트와 DB 시계가 일치할 때만** 성립한다.
 *
 * 컨테이너 시계는 실제로 드리프트한다(개발 머신에서 4초 앞선 사례). 여유가 초 단위인
 * 픽스처는 이 함수로 기준 시각을 잡는다. 시간·일 단위 여유가 있는 픽스처는 무관하다.
 */
export async function dbNow(prisma: PrismaClient): Promise<Date> {
  const rows = await prisma.$queryRaw<{ now: Date }[]>`SELECT NOW(3) AS now`;
  const now = rows[0]?.now;
  if (!(now instanceof Date)) {
    throw new Error('DB 시각을 읽지 못했습니다 (SELECT NOW(3))');
  }
  return now;
}
