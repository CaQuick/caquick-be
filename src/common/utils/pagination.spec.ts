import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  hasMoreByOffset,
  normalizeCursorInput,
  sliceCursorPage,
  sliceIdCursorPage,
  sliceOverfetched,
} from '@/common/utils/pagination';

describe('pagination utils', () => {
  describe('sliceOverfetched', () => {
    it('limit 초과분이 있으면 잘라내고 hasMore=true', () => {
      expect(sliceOverfetched([1, 2, 3], 2)).toEqual({
        items: [1, 2],
        hasMore: true,
      });
    });

    it('limit 이하면 그대로 반환하고 hasMore=false', () => {
      expect(sliceOverfetched([1, 2], 2)).toEqual({
        items: [1, 2],
        hasMore: false,
      });
      expect(sliceOverfetched([], 2)).toEqual({ items: [], hasMore: false });
    });

    it('음수 limit은 0으로 정규화한다(마지막 항목을 떨어뜨리지 않는다)', () => {
      expect(sliceOverfetched([1, 2, 3], -1)).toEqual({
        items: [],
        hasMore: true,
      });
    });
  });

  describe('sliceCursorPage', () => {
    const toCursor = (last: { id: bigint }) => last.id.toString();

    it('잔여가 있으면 페이지 마지막 행으로 다음 커서를 만든다', () => {
      const rows = [{ id: 1n }, { id: 2n }, { id: 3n }];
      expect(sliceCursorPage(rows, 2, toCursor)).toEqual({
        items: [{ id: 1n }, { id: 2n }],
        hasMore: true,
        nextCursor: '2',
      });
    });

    it('마지막 페이지면 nextCursor=null', () => {
      const rows = [{ id: 1n }];
      expect(sliceCursorPage(rows, 2, toCursor)).toEqual({
        items: [{ id: 1n }],
        hasMore: false,
        nextCursor: null,
      });
    });

    it('limit이 0 이하라 페이지가 비면 커서를 만들지 않는다(방어)', () => {
      expect(sliceCursorPage([{ id: 1n }], 0, toCursor)).toEqual({
        items: [],
        hasMore: true,
        nextCursor: null,
      });
    });
  });

  describe('hasMoreByOffset', () => {
    it('offset+limit이 totalCount 미만일 때만 true', () => {
      expect(hasMoreByOffset(0, 20, 21)).toBe(true);
      expect(hasMoreByOffset(0, 20, 20)).toBe(false);
      expect(hasMoreByOffset(20, 20, 21)).toBe(false);
    });

    it('음수 limit은 0으로 정규화한다(빈 목록에서 true가 되지 않는다)', () => {
      expect(hasMoreByOffset(0, -1, 0)).toBe(false);
    });
  });

  describe('normalizeCursorInput', () => {
    it('미설정이면 기본 limit 20, cursor undefined', () => {
      const r = normalizeCursorInput();
      expect(r.limit).toBe(20);
      expect(r.cursor).toBeUndefined();
    });

    it('limit 은 1~100 clamp', () => {
      expect(normalizeCursorInput({ limit: 0 }).limit).toBe(1);
      expect(normalizeCursorInput({ limit: 1000 }).limit).toBe(100);
      expect(normalizeCursorInput({ limit: 50 }).limit).toBe(50);
    });

    it('cursor 값 그대로 전달, null 이면 미포함', () => {
      const r = normalizeCursorInput({ cursor: 42n });
      expect(r.cursor).toBe(42n);
      expect(normalizeCursorInput({ cursor: null }).cursor).toBeUndefined();
    });

    it('limit null 이면 기본 20', () => {
      expect(normalizeCursorInput({ limit: null }).limit).toBe(20);
    });
  });

  describe('sliceIdCursorPage', () => {
    it('rows.length <= limit 이면 nextCursor null + items 그대로', () => {
      const rows = [{ id: 1n }, { id: 2n }];
      const r = sliceIdCursorPage(rows, 5);
      expect(r.items).toEqual(rows);
      expect(r.nextCursor).toBeNull();
    });

    it('rows.length > limit 이면 limit 만큼 자르고 마지막 id 를 nextCursor 로', () => {
      const rows = [{ id: 10n }, { id: 9n }, { id: 8n }];
      const r = sliceIdCursorPage(rows, 2);
      expect(r.items).toEqual([{ id: 10n }, { id: 9n }]);
      expect(r.nextCursor).toBe('9');
    });
  });

  /**
   * 커서 페이지 조립을 손수 구현하지 않는다 — 예전엔 seller-conversation 이
   * rows.length > limit / slice(0, limit) 를 직접 써서 방어(음수 limit 등)를 놓쳤다.
   * 랭킹 상위 N 절단(product-home·best-seller)은 커서가 없어 대상이 아니다.
   */
  describe('손수 구현 금지 경계', () => {
    const SRC_ROOT = resolve(__dirname, '..', '..');
    const SKIP_DIRS = new Set(['generated', 'node_modules']);
    const ALLOWED = ['common/utils/pagination.ts'];

    function tsFiles(dir: string): string[] {
      const out: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) out.push(...tsFiles(full));
        else if (entry.name.endsWith('.ts')) out.push(full);
      }
      return out;
    }

    const files = tsFiles(SRC_ROOT).filter(
      (f) => !f.endsWith('.spec.ts') && !ALLOWED.some((a) => f.endsWith(a)),
    );

    it('스캔 대상을 실제로 모았다 (0건 통과 방지)', () => {
      expect(files.length).toBeGreaterThan(100);
    });

    it('탐지기가 심어 둔 패턴을 잡는다 (반증 케이스)', () => {
      expect(
        /rows\.length > limit/.test('const hasMore = rows.length > limit;'),
      ).toBe(true);
    });

    it('rows.length > limit 를 직접 쓰는 곳이 없다', () => {
      const offenders = files.filter((f) =>
        /rows\.length > limit/.test(readFileSync(f, 'utf8')),
      );

      expect(offenders).toEqual([]);
    });
  });
});
