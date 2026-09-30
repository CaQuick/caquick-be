/** 관리자 화면의 계정 표시 라벨 — `이름(아이디)`, 한쪽만 있으면 그 값, 둘 다 없으면 null. */
export function formatAccountLabel(
  name: string | null | undefined,
  username: string | null | undefined,
): string | null {
  const n = name?.trim() || null;
  const u = username?.trim() || null;
  if (n && u) return `${n}(${u})`;
  return n ?? u;
}
