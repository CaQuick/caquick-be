import { closeSync, mkdirSync, openSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 부팅 실패 경보는 AlertService(프로세스 메모리 억제)를 못 쓴다 — 프로세스가 매번 새로 뜬다.
 * 감독자(PM2·compose)가 여러 프로세스를 동시에 재시작하므로 "읽고-검사하고-쓰기"로는 모두 통과한다.
 * 대신 창(bucket)마다 파일 1개를 O_EXCL로 만들어 **먼저 만든 프로세스만** 보낸다 — 원자적이라 경쟁이 없다.
 * 파일을 못 만드는 환경(권한 등)이면 보내는 쪽으로 기운다(경보 누락보다 중복이 낫다).
 */
export function defaultBootAlertStateDir(): string {
  return join(tmpdir(), 'caquick-boot-alert');
}

export function shouldSendBootAlert(
  nowMs: number,
  windowMs: number,
  stateDir: string = defaultBootAlertStateDir(),
): boolean {
  const bucket = Math.floor(nowMs / windowMs);
  const claimPath = join(stateDir, `window-${bucket}`);
  try {
    mkdirSync(stateDir, { recursive: true });
  } catch {
    return true;
  }
  try {
    closeSync(openSync(claimPath, 'wx'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    return true;
  }
  // 이긴 쪽이 직전 창의 표식을 치운다 — 파일이 창 수만큼 쌓이지 않게
  try {
    unlinkSync(join(stateDir, `window-${bucket - 1}`));
  } catch {
    // 없으면 그만
  }
  return true;
}
