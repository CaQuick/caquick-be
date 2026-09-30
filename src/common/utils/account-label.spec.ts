import { formatAccountLabel } from './account-label';

describe('formatAccountLabel', () => {
  it.each([
    ['이찬우', 'chanwoo7', '이찬우(chanwoo7)'],
    ['이찬우', null, '이찬우'],
    [null, 'chanwoo7', 'chanwoo7'],
    ['  ', 'chanwoo7', 'chanwoo7'],
    ['이찬우', '', '이찬우'],
    [null, null, null],
    [undefined, undefined, null],
  ])('이름 %p · 아이디 %p → %p', (name, username, expected) => {
    expect(formatAccountLabel(name, username)).toBe(expected);
  });
});
