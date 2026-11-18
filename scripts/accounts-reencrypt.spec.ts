import {
  assertRotatableConfig,
  parseReencryptArgs,
} from './accounts-reencrypt-args';

describe('accounts-reencrypt 인자', () => {
  it.each([
    [[], false],
    [['--dry-run'], true],
  ])('%j → dryRun %s', (argv, dryRun) => {
    expect(parseReencryptArgs(argv)).toEqual({ dryRun });
  });

  // 반증 — 오타가 dry-run 없는 실제 재암호화로 흘러가지 않는다
  it.each([
    [['--dryrun']],
    [['--dry-run=true']],
    [['--dry-run', '--all']],
    [['dry-run']],
  ])('반증: %j 는 던진다', (argv) => {
    expect(() => parseReencryptArgs(argv)).toThrow('알 수 없는 인자');
  });
});

describe('accounts-reencrypt 키 가드', () => {
  it('설정한 키(devKeyReason null)는 통과한다', () => {
    expect(() => assertRotatableConfig({ devKeyReason: null })).not.toThrow();
  });

  it.each([
    'ACCOUNT_ENCRYPTION_KEYS 미설정',
    'ACCOUNT_ENCRYPTION_KEYS 형식 오류(콜론 없음)',
  ])('반증: 개발 키로 대신한 설정(%s)은 던진다', (devKeyReason) => {
    expect(() => assertRotatableConfig({ devKeyReason })).toThrow(
      '고정 개발 키로는 재암호화하지 않습니다',
    );
  });
});
