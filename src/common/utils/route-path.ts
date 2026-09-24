/**
 * 경로 비교용 정규화. Express 기본 라우팅은 대소문자·끝 슬래시를 무시하고 같은 핸들러로 보내므로,
 * 봉투 제외·프로브 판정·worker 허용 목록도 같은 기준으로 비교해야 응답과 판정이 어긋나지 않는다.
 */
export function normalizeRoutePath(path: string): string {
  return path.replace(/\/+$/, '').toLowerCase() || '/';
}
