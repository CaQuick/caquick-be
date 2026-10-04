// 반증: 집계 잡 확인용 — 되돌림. CI(GITHUB_ACTIONS=true)에서만 실패해 test 샤드·coverage-report·check가 빨간색이 되는지 본다
describe('반증: 집계 잡 확인용 — 되돌림', () => {
  it('CI에서는 일부러 실패한다', () => {
    expect(process.env.GITHUB_ACTIONS).toBeUndefined();
  });
});
