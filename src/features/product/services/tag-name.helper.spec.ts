import { normalizeTagName } from '@/features/product/services/tag-name.helper';

describe('normalizeTagName', () => {
  it.each([
    ['앞뒤 공백 제거', ' 생일 케이크 ', '생일 케이크'],
    ['선행 # 1개 제거', '#생일', '생일'],
    ['선행 # 전부 제거', '##x', 'x'],
    ['# 뒤 공백도 제거', '# 생일', '생일'],
    ['연속 공백·탭 1칸', 'a\t\t b', 'a b'],
    ['소문자', 'CAKE', 'cake'],
    ['NFC 합성', 'café', 'café'],
    ['내부 #은 유지', '생일#케이크', '생일#케이크'],
    ['전부 적용', '  ##  Birthday   CAKE ', 'birthday cake'],
  ])('%s: %j → %j', (_label, raw, expected) => {
    expect(normalizeTagName(raw)).toBe(expected);
  });

  it.each([
    ['빈 문자열', ''],
    ['공백만', '   '],
    ['#만', '#'],
    ['#과 공백만', '## \t'],
  ])('%s(%j)이면 null', (_label, raw) => {
    expect(normalizeTagName(raw)).toBeNull();
  });
});
