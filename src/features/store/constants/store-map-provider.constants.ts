/** 매장 지도 링크 제공자. 매장 생성(판매자 계정 생성 tx)과 관리자 매장 수정이 같은 값을 쓴다. */
export const STORE_MAP_PROVIDERS = ['NAVER', 'KAKAO', 'NONE'] as const;
export type StoreMapProviderValue = (typeof STORE_MAP_PROVIDERS)[number];
