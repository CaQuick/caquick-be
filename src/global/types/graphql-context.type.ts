import type { Request, Response } from 'express';

export interface GraphqlContext {
  req: Request;
  res?: Response;
}
