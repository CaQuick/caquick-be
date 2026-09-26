export enum LogContext {
  REST = 'REST',
  GRAPHQL = 'GraphQL',
  APP = 'App',
  CRON = 'Cron',
  SERVICE = 'Service',
  DEFAULT = 'Default',
}

interface BaseLogPayload {
  userId: number | null;

  requestId?: string;

  message?: string;

  context:
    | LogContext.APP
    | LogContext.REST
    | LogContext.GRAPHQL
    | LogContext.SERVICE
    | LogContext.CRON
    | LogContext.DEFAULT;

  processingTimeInMs?: number;
}

interface RequestPayload {
  method: string;
  path: string;
  clientIp: string;
  agent: string;
  query?: string;
  version?: string;
}

interface GraphqlRequestPayload {
  operationName?: string;

  fieldName: string;

  parentType?: string;

  path: string;

  clientIp: string;

  agent: string;
}

interface ResponsePayload {
  statusCode: number;
}

export interface RestTransactionLogPayload extends BaseLogPayload {
  request: RequestPayload;
  response: ResponsePayload;
  context: LogContext.APP | LogContext.REST;
}

/** GraphQL은 HTTP statusCode 개념이 직접적이지 않아서 response 필드를 생략한다. */
export interface GraphqlTransactionLogPayload extends BaseLogPayload {
  request: GraphqlRequestPayload;
  context: LogContext.GRAPHQL;
}

export interface BaseExceptionLogPayload extends BaseLogPayload {
  error: {
    statusCode?: number;
    message: string;
    stack?: string;
  };
}

export interface TransactionalRestExceptionLogPayload extends BaseExceptionLogPayload {
  request: RequestPayload;
  context: LogContext.REST | LogContext.APP;
}

export interface GraphqlExceptionLogPayload extends BaseExceptionLogPayload {
  request: GraphqlRequestPayload;
  context: LogContext.GRAPHQL;
}

export type TransactionLogPayload =
  RestTransactionLogPayload | GraphqlTransactionLogPayload | BaseLogPayload;

export type TransactionErrorPayload =
  | TransactionalRestExceptionLogPayload
  | GraphqlExceptionLogPayload
  | BaseExceptionLogPayload;
