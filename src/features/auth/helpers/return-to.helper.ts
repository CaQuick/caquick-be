/**
 * 로그인 뒤 돌아갈 주소. 접두 비교는 `https://caquick.site.evil.com`·`https://caquick.site@evil.com`을 통과시키므로
 * URL로 파싱해 오리진이 정확히 같을 때만 허용하고, 아니면 기본 프론트 주소로 보낸다.
 */
export function resolveReturnTo(
  raw: string | undefined,
  fallback: string,
  allowed: readonly string[],
): string {
  const url = parseHttpUrl(raw?.trim() ?? '');
  if (!url) return fallback;

  const origins = [fallback, ...allowed].map((u) => parseHttpUrl(u)?.origin);
  return origins.includes(url.origin) ? url.href : fallback;
}

function parseHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}
