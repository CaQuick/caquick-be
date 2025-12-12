/**
 * 로그 레벨 정의.
 */
export enum LogLevel {
  LOG = 'log',
  ERROR = 'error',
  WARN = 'warn',
  DEBUG = 'debug',
  VERBOSE = 'verbose',
  FATAL = 'fatal',
}

/**
 * 로그 컨텍스트.
 */
export enum LogContext {
  REST = 'REST',
  GRAPHQL = 'GraphQL',
  APP = 'App',
  CRON = 'Cron',
  SERVICE = 'Service',
  DEFAULT = 'Default',
}

/**
 * 모든 로그 페이로드가 공통으로 갖는 베이스 속성.
 */
interface BaseLogPayload {
  /**
   * 연관된 사용자 ID (없으면 null).
   */
  userId: number | null;

  /**
   * 요청 상관관계 ID (requestId).
   */
  requestId?: string;

  /**
   * 단순 메시지 로그에 사용할 선택적 메시지.
   */
  message?: string;

  /**
   * 로그 컨텍스트(REST, GRAPHQL, APP 등).
   */
  context:
    | LogContext.APP
    | LogContext.REST
    | LogContext.GRAPHQL
    | LogContext.SERVICE
    | LogContext.CRON
    | LogContext.DEFAULT;

  /**
   * 처리 시간(ms) 측정을 위한 필드.
   */
  processingTimeInMs?: number;
}

/**
 * REST HTTP 요청 정보를 표현하는 페이로드.
 */
interface RequestPayload {
  method: string;
  path: string;
  clientIp: string;
  agent: string;
  query?: string;
  version?: string;
}

/**
 * GraphQL 요청 정보를 표현하는 페이로드.
 */
interface GraphqlRequestPayload {
  /**
   * GraphQL operation 이름 (쿼리/뮤테이션 이름).
   */
  operationName?: string;

  /**
   * 실제 Resolver 필드 이름.
   */
  fieldName: string;

  /**
   * 상위 타입 이름(Query, Mutation 등).
   */
  parentType?: string;

  /**
   * Resolver 경로(필드 체인).
   */
  path: string;

  /**
   * 클라이언트 IP.
   */
  clientIp: string;

  /**
   * User-Agent 문자열.
   */
  agent: string;
}

/**
 * REST 응답 정보를 표현하는 페이로드.
 */
interface ResponsePayload {
  statusCode: number;
}

/**
 * REST 트랜잭션(요청/응답) 로그 페이로드.
 */
export interface RestTransactionLogPayload extends BaseLogPayload {
  request: RequestPayload;
  response: ResponsePayload;
  context: LogContext.APP | LogContext.REST;
}

/**
 * GraphQL 트랜잭션(요청) 로그 페이로드.
 * - GraphQL은 HTTP statusCode 개념이 직접적이지 않아서 response 필드를 생략한다.
 */
export interface GraphqlTransactionLogPayload extends BaseLogPayload {
  request: GraphqlRequestPayload;
  context: LogContext.GRAPHQL;
}

/**
 * 예외 로그의 공통 베이스 페이로드.
 */
export interface BaseExceptionLogPayload extends BaseLogPayload {
  error: {
    statusCode?: number;
    message: string;
    stack?: string;
  };
}

/**
 * REST 예외 로그 페이로드.
 */
export interface TransactionalRestExceptionLogPayload extends BaseExceptionLogPayload {
  request: RequestPayload;
  context: LogContext.REST | LogContext.APP;
}

/**
 * GraphQL 예외 로그 페이로드.
 */
export interface GraphqlExceptionLogPayload extends BaseExceptionLogPayload {
  request: GraphqlRequestPayload;
  context: LogContext.GRAPHQL;
}

/**
 * 일반 트랜잭션 로그에서 사용 가능한 페이로드 유니언 타입.
 */
export type TransactionLogPayload =
  | RestTransactionLogPayload
  | GraphqlTransactionLogPayload
  | BaseLogPayload;

/**
 * 에러 로그에서 사용 가능한 페이로드 유니언 타입.
 */
export type TransactionErrorPayload =
  | TransactionalRestExceptionLogPayload
  | GraphqlExceptionLogPayload
  | BaseExceptionLogPayload;
