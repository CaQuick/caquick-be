import { TimeoutError, withTimeout } from '@/common/utils/with-timeout';

export const EXPO_PUSH_SEND_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_PUSH_RECEIPTS_URL =
  'https://exp.host/--/api/v2/push/getReceipts';
/** Expo Push Service 요청당 상한 — 배치 분할은 호출자 책임이고 어댑터는 넘기면 던진다. */
export const EXPO_PUSH_SEND_LIMIT = 100;
export const EXPO_PUSH_RECEIPT_LIMIT = 1_000;

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
  channelId: string;
}

export interface ExpoPushFailure {
  status: 'error';
  message: string;
  /** error가 Expo 오류 코드(DeviceNotRegistered 등) */
  details?: { error?: string };
}
export type ExpoPushTicket = { status: 'ok'; id: string } | ExpoPushFailure;
export type ExpoPushReceipt = { status: 'ok' } | ExpoPushFailure;

export interface ExpoPushRequestOptions {
  accessToken: string | null;
  timeoutMs: number;
}

/** 전송 계약 — 소비자·스케줄러는 이 형태만 알고, 테스트는 가짜를 넣는다. */
export interface ExpoPushTransport {
  send(
    messages: ExpoPushMessage[],
    options: ExpoPushRequestOptions,
  ): Promise<ExpoPushTicket[]>;
  getReceipts(
    ticketIds: string[],
    options: ExpoPushRequestOptions,
  ): Promise<Record<string, ExpoPushReceipt>>;
}

export const EXPO_PUSH_TRANSPORT = Symbol('EXPO_PUSH_TRANSPORT');

export class ExpoPushHttpError extends Error {
  constructor(
    readonly status: number,
    label: string,
  ) {
    super(`${label} HTTP ${status}`);
    this.name = 'ExpoPushHttpError';
  }
}

/** 401·403 — 액세스 토큰 폐기·오설정. 재시도로 풀리지 않으므로 호출자가 경보를 낸다. */
export class ExpoPushAuthError extends ExpoPushHttpError {
  constructor(status: number, label: string) {
    super(status, label);
    this.name = 'ExpoPushAuthError';
  }
}

export type ExpoPushFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export function createExpoPushTransport(
  fetchFn: ExpoPushFetch = (url, init) => fetch(url, init),
): ExpoPushTransport {
  async function post(
    url: string,
    body: unknown,
    options: ExpoPushRequestOptions,
    label: string,
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/json',
    };
    if (options.accessToken)
      headers.authorization = `Bearer ${options.accessToken}`;
    // 기한은 헤더가 아니라 바디(JSON)까지 덮고, 넘기면 진행 중인 POST를 끊는다 — 재시도와 겹쳐 중복 발송되지 않게
    const controller = new AbortController();
    try {
      return await withTimeout(
        read(url, headers, body, controller.signal, label),
        options.timeoutMs,
        label,
      );
    } catch (error) {
      if (error instanceof TimeoutError) controller.abort();
      throw error;
    }
  }

  async function read(
    url: string,
    headers: Record<string, string>,
    body: unknown,
    signal: AbortSignal,
    label: string,
  ): Promise<unknown> {
    const response = await fetchFn(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
    if (response.status === 401 || response.status === 403)
      throw new ExpoPushAuthError(response.status, label);
    if (!response.ok) throw new ExpoPushHttpError(response.status, label);
    const json = (await response.json()) as {
      data?: unknown;
      errors?: unknown;
    };
    // 요청 전체 거절은 200에 errors로 온다(PUSH_TOO_MANY_EXPERIENCE_IDS 등)
    if (json.errors !== undefined)
      throw new Error(`${label} 거절: ${JSON.stringify(json.errors)}`);
    return json.data;
  }

  return {
    async send(messages, options) {
      if (messages.length > EXPO_PUSH_SEND_LIMIT) {
        throw new Error(
          `Expo 푸시 전송은 한 번에 ${EXPO_PUSH_SEND_LIMIT}개까지: ${messages.length}`,
        );
      }
      const label = 'Expo 푸시 전송';
      const data = await post(EXPO_PUSH_SEND_URL, messages, options, label);
      // ticket은 요청 순서대로 온다 — 수가 다르면 디바이스 매핑을 믿을 수 없다
      if (!Array.isArray(data) || data.length !== messages.length)
        throw new Error(`${label} 응답 형식 오류`);
      return data as ExpoPushTicket[];
    },
    async getReceipts(ticketIds, options) {
      if (ticketIds.length > EXPO_PUSH_RECEIPT_LIMIT) {
        throw new Error(
          `Expo 푸시 영수증 조회는 한 번에 ${EXPO_PUSH_RECEIPT_LIMIT}개까지: ${ticketIds.length}`,
        );
      }
      const label = 'Expo 푸시 영수증 조회';
      const data = await post(
        EXPO_PUSH_RECEIPTS_URL,
        { ids: ticketIds },
        options,
        label,
      );
      if (typeof data !== 'object' || data === null || Array.isArray(data))
        throw new Error(`${label} 응답 형식 오류`);
      return data as Record<string, ExpoPushReceipt>;
    },
  };
}

export const expoPushTransport = createExpoPushTransport();
