/** 기한 안에 끝나지 않으면 거부한다. 원 promise는 취소되지 않으므로 부수효과 없는 조회에만 쓴다. */
/** 호출자가 "느림"과 "오류"를 구분해야 할 때 instanceof로 가른다. */
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} ${ms}ms 초과`);
    this.name = 'TimeoutError';
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
