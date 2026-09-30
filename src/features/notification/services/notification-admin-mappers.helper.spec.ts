import {
  broadcastStatus,
  toIdList,
} from '@/features/notification/services/notification-admin-mappers.helper';

const REQUESTED = new Date('2026-10-01T09:00:00.000Z');
const at = (ms: number) => new Date(REQUESTED.getTime() + ms);
const MINUTE = 60_000;

describe('broadcastStatus', () => {
  it.each([
    ['완료 기록 있음(요청 직후)', 'COMPLETED', at(1_000), at(1_000)],
    ['완료 기록 있음(30분 뒤 조회)', 'COMPLETED', at(1_000), at(60 * MINUTE)],
    ['미완료·요청 직후', 'IN_PROGRESS', null, at(0)],
    ['미완료·30분 1ms 전', 'IN_PROGRESS', null, at(30 * MINUTE - 1)],
    ['미완료·정확히 30분', 'DELAYED', null, at(30 * MINUTE)],
    ['미완료·하루 뒤', 'DELAYED', null, at(24 * 60 * MINUTE)],
    ['미완료·시계가 요청보다 이른 시각', 'IN_PROGRESS', null, at(-1_000)],
  ])('%s → %s', (_label, expected, completedAt, now) => {
    expect(broadcastStatus(completedAt, REQUESTED, now)).toBe(expected);
  });
});

describe('toIdList', () => {
  it.each([
    ['ID 배열', ['1', '2'], ['1', '2']],
    ['빈 배열', [], []],
    ['null(ALL_USERS 대상)', null, []],
    ['문자열 아닌 원소는 버림', ['1', 2, null], ['1']],
    ['배열이 아님', { ids: ['1'] }, []],
  ])('%s', (_label, value, expected) => {
    expect(toIdList(value)).toEqual(expected);
  });
});
