import {
  hasMoreByOffset,
  sliceCursorPage,
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
  });
});
