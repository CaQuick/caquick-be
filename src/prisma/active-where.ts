/**
 * soft-delete extension은 "루트 READ 쿼리"에만 deleted_at: null을 자동 주입한다 — nested relation(include/select 내부)·
 * relation 필터(some/is 등)·mutation(updateMany 등)·raw SQL에는 닿지 않는다. 그 미커버 경로에서 인라인 리터럴 대신
 * 이 조각을 조합해 필터 누락·표기 흔들림을 한곳에서 통제한다. 루트 READ는 extension을 신뢰해 명시하지 않는다.
 */

export const activeWhere = { deleted_at: null } as const;

export const visibleWhere = { is_active: true, deleted_at: null } as const;
