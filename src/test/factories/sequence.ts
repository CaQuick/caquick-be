/**
 * 팩토리 내부에서 유일한 순번을 생성한다.
 * 테스트 DB는 worker별로 격리되므로 단일 in-memory 카운터로 충분하다.
 */
let counter = 0;

export function nextSeq(): number {
  counter += 1;
  return counter;
}

export function resetSeq(): void {
  counter = 0;
}
