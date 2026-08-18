import { RandomService } from '@/common/providers/random.service';

describe('RandomService', () => {
  let service: RandomService;

  beforeEach(() => {
    service = new RandomService();
  });

  it('random은 [0, 1) 범위 값을 반환한다', () => {
    for (let i = 0; i < 100; i += 1) {
      const value = service.random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('int는 [0, max) 정수를 반환한다', () => {
    for (let i = 0; i < 100; i += 1) {
      const value = service.int(5);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(5);
    }
  });

  describe('sample', () => {
    it('요청 개수만큼 중복 없이 추출한다', () => {
      const items = [1, 2, 3, 4, 5, 6, 7, 8, 9];

      const picked = service.sample(items, 4);

      expect(picked).toHaveLength(4);
      expect(new Set(picked).size).toBe(4);
      for (const value of picked) {
        expect(items).toContain(value);
      }
    });

    it('개수가 풀보다 크면 전량을 반환하고 원본을 변경하지 않는다', () => {
      const items = [1, 2, 3];

      const picked = service.sample(items, 10);

      expect([...picked].sort()).toEqual([1, 2, 3]);
      expect(items).toEqual([1, 2, 3]);
    });

    it('주입된 난수에 따라 결정적으로 추출한다', () => {
      // random()이 항상 0이면 앞에서부터 순서대로 뽑힌다
      jest.spyOn(service, 'random').mockReturnValue(0);

      expect(service.sample([10, 20, 30, 40], 2)).toEqual([10, 20]);
    });
  });
});
