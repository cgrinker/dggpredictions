import type { RequestContext } from '../context.js';

declare module 'express-serve-static-core' {
  interface Request {
    appContext?: RequestContext;
    correlationId?: string;
  }
}
