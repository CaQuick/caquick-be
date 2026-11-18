/** 인자·키 가드만 — spec이 DB·키 없이 검증할 수 있게 분리한다. */
export function parseReencryptArgs(argv: string[]): { dryRun: boolean } {
  const unknown = argv.filter((arg) => arg !== '--dry-run');
  if (unknown.length > 0) {
    throw new Error(`알 수 없는 인자: ${unknown.join(' ')}`);
  }
  return { dryRun: argv.includes('--dry-run') };
}

/** 공개된 고정 개발 키로 다시 암호화하면 운영 계좌번호를 누구나 풀 수 있게 된다. */
export function assertRotatableConfig(config: {
  devKeyReason: string | null;
}): void {
  if (config.devKeyReason) {
    throw new Error(
      `고정 개발 키로는 재암호화하지 않습니다: ${config.devKeyReason}`,
    );
  }
}
