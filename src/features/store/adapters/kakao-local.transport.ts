/** 카카오 로컬 API 전송 함수 계약 — 서비스는 이 형태만 알고, 테스트는 가짜 응답을 넣는다. */
export type KakaoLocalTransport = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export const KAKAO_LOCAL_TRANSPORT = Symbol('KAKAO_LOCAL_TRANSPORT');

export const fetchKakaoLocal: KakaoLocalTransport = (url, init) =>
  fetch(url, init);
