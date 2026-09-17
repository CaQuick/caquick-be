import {
  hasMoreByOffset,
  normalizeCursorInput,
  sliceCursorPage,
  sliceIdCursorPage,
  sliceOverfetched,
  toCursorConnection,
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

  describe('normalizeCursorInput — 0n 커서', () => {
    it('cursor 0n은 유효한 값으로 싣는다(truthy 검사로 버리지 않는다)', () => {
      expect(normalizeCursorInput({ cursor: 0n }).cursor).toBe(0n);
    });
  });

  describe('toCursorConnection', () => {
    it('페이지·건수·매핑을 Connection 모양으로 합친다', () => {
      const page = sliceIdCursorPage([{ id: 3n }, { id: 2n }, { id: 1n }], 2);
      expect(toCursorConnection(page, 7, (r) => r.id.toString())).toEqual({
        items: ['3', '2'],
        nextCursor: '2',
        hasMore: true,
        totalCount: 7,
      });
    });
  });
});
