// cross-feature 공개 API. 단일 구현 repo라 토큰/인터페이스 없이 구체 클래스로 주입(의도적).
export { SearchModule } from '@/features/search/search.module';
// 인기 검색어 스냅샷 읽기(admin 대시보드). 산출(크론)은 search feature가 단일 소스.
export { SearchRepository } from '@/features/search/repositories/search.repository';
