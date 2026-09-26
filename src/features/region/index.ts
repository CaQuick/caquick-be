// cross-feature 공개 API. 단일 구현 repo라 토큰/인터페이스 없이 구체 클래스로 주입(의도적).
export { RegionModule } from '@/features/region/region.module';
// 지역 FK를 잇는 쓰기(매장 생성·수정)가 같은 tx에서 지역 행을 잠글 때 쓴다 — 잠금 규칙은 region이 가진다.
export { lockUsableRegion } from '@/features/region/repositories/region-lock.helper';
