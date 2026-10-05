/**
 * 판매자 태그 이름 규칙 — 검색어와 저장 이름이 같은 형태여야 매칭이 맞는다:
 * trim → 선행 '#' 전부 제거 → 연속 공백 1칸 → 소문자 → NFC. 길이는 호출자가 cleanRequiredText로 본다.
 */
export function normalizeTagName(raw: string): string | null {
  const name = raw
    .trim()
    .replace(/^#+/, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .normalize('NFC');
  return name.length === 0 ? null : name;
}
