import { messageOf } from '@/common/errors';
import { MAX_PRODUCT_IMAGES } from '@/features/seller/constants/seller.constants';

/**
 * 카탈로그 메시지에 박힌 숫자와 실제 상한이 어긋나면 사용자에게 틀린 안내가 나간다.
 * 카탈로그는 common 이라 seller 상수를 import 할 수 없으므로(레이어 규칙),
 * 동기화는 이 테스트가 지킨다.
 */
describe('상품 이미지 상한 문구 동기화', () => {
  it('IMAGE_LIMIT_EXCEEDED 문구가 MAX_PRODUCT_IMAGES 를 담고 있다', () => {
    expect(messageOf('IMAGE_LIMIT_EXCEEDED')).toContain(
      MAX_PRODUCT_IMAGES.toString(),
    );
  });

  it('상한이 바뀌면 이 테스트가 먼저 깨진다 (반증 케이스)', () => {
    // 상한이 5가 아니게 되면 아래 단언이 깨지고, 카탈로그 문구를 함께 고치게 된다.
    expect(MAX_PRODUCT_IMAGES).toBe(5);
  });
});
