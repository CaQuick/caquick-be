import { TimeoutError } from '@/common/utils/with-timeout';
import {
  createExpoPushTransport,
  EXPO_PUSH_RECEIPTS_URL,
  EXPO_PUSH_SEND_URL,
  ExpoPushAuthError,
  ExpoPushHttpError,
  type ExpoPushMessage,
  expoPushTransport,
} from '@/global/expo-push/expo-push.transport';

const OPTIONS = { accessToken: 'tok', timeoutMs: 1_000 };

function message(seq: number): ExpoPushMessage {
  return {
    to: `ExponentPushToken[dev-${seq}]`,
    title: '새 주문',
    body: `본문 ${seq}`,
    data: { kind: 'ORDER_SUBMITTED', orderId: String(seq) },
    channelId: 'default',
  };
}

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('expoPushTransport', () => {
  const fetchFn = jest.fn<Promise<Response>, [string, RequestInit]>();
  const transport = createExpoPushTransport(fetchFn);

  beforeEach(() => fetchFn.mockReset());

  describe('send', () => {
    it('send 엔드포인트에 메시지 배열을 JSON으로 POST하고 ticket 배열을 돌려준다', async () => {
      const messages = [message(1), message(2)];
      const tickets = [
        { status: 'ok', id: 't-1' },
        {
          status: 'error',
          message: 'gone',
          details: { error: 'DeviceNotRegistered' },
        },
      ];
      fetchFn.mockResolvedValue(reply({ data: tickets }));

      await expect(transport.send(messages, OPTIONS)).resolves.toEqual(tickets);

      const [url, init] = fetchFn.mock.calls[0];
      expect(url).toBe(EXPO_PUSH_SEND_URL);
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: 'Bearer tok',
      });
      expect(JSON.parse(init.body as string)).toEqual(messages);
    });

    it('액세스 토큰이 없으면 Authorization 헤더를 붙이지 않는다', async () => {
      fetchFn.mockResolvedValue(reply({ data: [{ status: 'ok', id: 't' }] }));

      await transport.send([message(1)], { ...OPTIONS, accessToken: null });

      expect(fetchFn.mock.calls[0][1].headers).not.toHaveProperty(
        'authorization',
      );
    });

    it('반증: 101개는 요청 없이 던진다(100개는 보낸다)', async () => {
      const hundred = Array.from({ length: 100 }, (_, i) => message(i));
      fetchFn.mockResolvedValue(
        reply({ data: hundred.map((_, i) => ({ status: 'ok', id: `t${i}` })) }),
      );
      await expect(transport.send(hundred, OPTIONS)).resolves.toHaveLength(100);

      await expect(
        transport.send([...hundred, message(100)], OPTIONS),
      ).rejects.toThrow('100개까지: 101');
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it.each([400, 429, 500, 503])(
      '비 2xx(%i)는 상태 코드를 담은 ExpoPushHttpError',
      async (status) => {
        fetchFn.mockResolvedValue(reply({ errors: [] }, status));

        const error = await transport
          .send([message(1)], OPTIONS)
          .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ExpoPushHttpError);
        expect(error).not.toBeInstanceOf(ExpoPushAuthError);
        expect((error as ExpoPushHttpError).status).toBe(status);
        expect((error as Error).message).toBe(`Expo 푸시 전송 HTTP ${status}`);
      },
    );

    it.each([401, 403])('%i은 ExpoPushAuthError', async (status) => {
      fetchFn.mockResolvedValue(reply({}, status));

      const error = await transport
        .send([message(1)], OPTIONS)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ExpoPushAuthError);
      expect((error as ExpoPushHttpError).status).toBe(status);
    });

    it('기한 안에 응답이 없으면 TimeoutError', async () => {
      fetchFn.mockReturnValue(new Promise<Response>(() => undefined));

      await expect(
        transport.send([message(1)], { ...OPTIONS, timeoutMs: 10 }),
      ).rejects.toBeInstanceOf(TimeoutError);
    });

    it('200이어도 errors가 있으면 요청 전체 거절로 던진다', async () => {
      fetchFn.mockResolvedValue(
        reply({ errors: [{ code: 'PUSH_TOO_MANY_EXPERIENCE_IDS' }] }),
      );

      await expect(transport.send([message(1)], OPTIONS)).rejects.toThrow(
        'PUSH_TOO_MANY_EXPERIENCE_IDS',
      );
    });

    it.each([
      ['data 없음', {}],
      ['배열 아님', { data: { status: 'ok' } }],
      ['수 불일치', { data: [{ status: 'ok', id: 't' }] }],
    ])('반증: %s 응답은 형식 오류로 던진다', async (_label, body) => {
      fetchFn.mockResolvedValue(reply(body));

      await expect(
        transport.send([message(1), message(2)], OPTIONS),
      ).rejects.toThrow('응답 형식 오류');
    });
  });

  describe('getReceipts', () => {
    it('getReceipts 엔드포인트에 ids를 POST하고 ticket id → 영수증 맵을 돌려준다', async () => {
      const receipts = {
        't-1': { status: 'ok' },
        't-2': {
          status: 'error',
          message: 'x',
          details: { error: 'MessageTooBig' },
        },
      };
      fetchFn.mockResolvedValue(reply({ data: receipts }));

      await expect(
        transport.getReceipts(['t-1', 't-2'], OPTIONS),
      ).resolves.toEqual(receipts);

      const [url, init] = fetchFn.mock.calls[0];
      expect(url).toBe(EXPO_PUSH_RECEIPTS_URL);
      expect(JSON.parse(init.body as string)).toEqual({ ids: ['t-1', 't-2'] });
      expect(init.headers).toMatchObject({ authorization: 'Bearer tok' });
    });

    it('반증: 1001개는 요청 없이 던진다', async () => {
      const ids = Array.from({ length: 1_001 }, (_, i) => `t${i}`);

      await expect(transport.getReceipts(ids, OPTIONS)).rejects.toThrow(
        '1000개까지: 1001',
      );
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('401은 ExpoPushAuthError', async () => {
      fetchFn.mockResolvedValue(reply({}, 401));

      await expect(
        transport.getReceipts(['t'], OPTIONS),
      ).rejects.toBeInstanceOf(ExpoPushAuthError);
    });

    it.each([
      ['data 없음', {}],
      ['배열', { data: [] }],
    ])('반증: %s 응답은 형식 오류로 던진다', async (_label, body) => {
      fetchFn.mockResolvedValue(reply(body));

      await expect(transport.getReceipts(['t'], OPTIONS)).rejects.toThrow(
        '응답 형식 오류',
      );
    });
  });

  it('기본 구현은 전역 fetch를 쓴다', async () => {
    const spy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(reply({ data: { t: { status: 'ok' } } }));
    try {
      await expect(
        expoPushTransport.getReceipts(['t'], OPTIONS),
      ).resolves.toEqual({ t: { status: 'ok' } });
      expect(spy).toHaveBeenCalledWith(
        EXPO_PUSH_RECEIPTS_URL,
        expect.objectContaining({ method: 'POST' }),
      );
    } finally {
      spy.mockRestore();
    }
  });
});
