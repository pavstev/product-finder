import { STATUS_CODES } from 'node:http';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  type LoggerService,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request, Response } from 'express';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

// Seconds a client should wait before it retries a request that hit a busy database.
export const RETRY_AFTER_SECONDS = 5;

// A 503 that a probe route expects. The route logs the state change itself, so the filter logs nothing.
// Otherwise a probe every few seconds would write an error with a stack each time.
export class ProbeUnavailableException extends ServiceUnavailableException {}

/** RFC 9457 problem details. `errors` lists the validation messages of a 400. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  errors?: string[];
}

interface Answer {
  status: number;
  detail: string;
  errors?: string[];
  /** Send Retry-After. */
  retry?: boolean;
}

const BUSY: Answer = {
  status: HttpStatus.SERVICE_UNAVAILABLE,
  detail: 'The database is busy. Please try again in a few seconds.',
  retry: true,
};

// The fields the filter reads from Prisma's PrismaClientKnownRequestError.
interface PrismaKnownRequestError extends Error {
  name: 'PrismaClientKnownRequestError';
  code: string;
  meta?: Record<string, unknown>;
}

const PRISMA_ERROR_CODE = /^P\d{4}$/;

// Recognised by its shape, not by instanceof, so this file needs no Prisma import.
function isPrismaKnownRequestError(error: unknown): error is PrismaKnownRequestError {
  if (!(error instanceof Error) || error.name !== 'PrismaClientKnownRequestError') {
    return false;
  }
  const { code, meta } = error as { code?: unknown; meta?: unknown };
  return (
    typeof code === 'string' &&
    PRISMA_ERROR_CODE.test(code) &&
    (meta === undefined || (typeof meta === 'object' && meta !== null))
  );
}

// Prisma errors the client can act on. Every other Prisma error is a 500.
const PRISMA_ANSWERS: Record<string, Answer> = {
  // A record the operation needs does not exist.
  P2025: { status: HttpStatus.NOT_FOUND, detail: 'The requested record does not exist.' },
  // Write conflict or deadlock. A retry usually works.
  P2034: BUSY,
  // Transaction API error: the transaction timed out or could not start in time (maxWait).
  P2028: BUSY,
  // The connection failed or was closed (P1001, P1008, P1017, P2037). Any query can get these.
  P1001: BUSY,
  P1008: BUSY,
  P1017: BUSY,
  P2037: BUSY,
};

// pg and pg-pool errors that Prisma hands on as a plain Error with no code, so only the message tells them apart.
// pool-error-shape.spec.ts in the server lib pins the texts.
const POOL_ERROR_MESSAGES: ReadonlySet<string> = new Set([
  // pg-pool: every connection was in use for connectionTimeoutMillis.
  'timeout exceeded when trying to connect',
  // pg: a new connection did not sign in within connectionTimeoutMillis.
  'Connection terminated due to connection timeout',
  // pg: no answer within query_timeout (API_QUERY_TIMEOUT_MS).
  'Query read timeout',
  // pg: the connection broke during the query.
  'Connection terminated unexpectedly',
]);

function isPoolError(error: unknown): boolean {
  return error instanceof Error && POOL_ERROR_MESSAGES.has(error.message);
}

// Prisma reports these as P2039 or P2010, so match the SQLSTATE.
// 55P03 lock_not_available: waited longer than lock_timeout. 57014 query_canceled: ran longer than statement_timeout.
const BUSY_SQL_STATES: ReadonlySet<unknown> = new Set(['55P03', '57014']);

// @prisma/adapter-pg keeps the SQLSTATE in meta.driverAdapterError.cause.
function sqlStateOf(error: PrismaKnownRequestError): unknown {
  const adapterError = error.meta?.driverAdapterError as { cause?: { originalCode?: unknown } } | undefined;
  return adapterError?.cause?.originalCode;
}

function prismaAnswer(error: PrismaKnownRequestError): Answer | undefined {
  return PRISMA_ANSWERS[error.code] ?? (BUSY_SQL_STATES.has(sqlStateOf(error)) ? BUSY : undefined);
}

// An "http-errors" error, as body-parser and Express throw it (for example PayloadTooLargeError).
interface HttpError extends Error {
  status: number;
  statusCode: number;
  /** False when the message must not reach the client. */
  expose: boolean;
}

// Nest 11 hands these to filters as they are, not as an HttpException.
function isClientHttpError(error: unknown): error is HttpError {
  if (!(error instanceof Error)) {
    return false;
  }
  const { status, statusCode, expose } = error as Partial<HttpError>;
  return (
    typeof expose === 'boolean' &&
    typeof statusCode === 'number' &&
    status === statusCode &&
    statusCode >= 400 &&
    statusCode < 500
  );
}

// The message of a body-parser failure holds the start of the body, which can be a review text.
// So the log line uses a fixed text. The client still gets the message.
function isBodyParseError(error: unknown): boolean {
  return isClientHttpError(error) && (error as { type?: unknown }).type === 'entity.parse.failed';
}

const INTERNAL_ERROR: Answer = {
  status: HttpStatus.INTERNAL_SERVER_ERROR,
  detail: 'Something went wrong on our side. Please try again later.',
};

type ProblemLogger = Pick<LoggerService, 'error' | 'log'>;

/** Global filter: every error is an RFC 9457 problem. An unknown error is a generic 500, its detail only logged. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(private readonly logger: ProblemLogger = new Logger('ProblemDetails')) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const answer = this.answer(exception);
    this.record(exception, answer, request, response);
    if (response.headersSent) {
      // Too late for a problem body.
      response.end();
      return;
    }
    const problem: ProblemDetails = {
      type: 'about:blank',
      title: STATUS_CODES[answer.status] ?? 'Error',
      status: answer.status,
      detail: answer.detail,
      instance: pathOf(request),
      ...(answer.errors ? { errors: answer.errors } : {}),
    };
    if (answer.retry) {
      response.setHeader('Retry-After', String(RETRY_AFTER_SECONDS));
    }
    // A route can set ETag before it fails (notModified does). No cache may keep an error.
    response.removeHeader('ETag');
    response.setHeader('Cache-Control', 'no-store');
    response.status(answer.status);
    // Set before json(), which then keeps it and adds the charset.
    response.setHeader('Content-Type', PROBLEM_CONTENT_TYPE);
    response.json(problem);
  }

  private answer(exception: unknown): Answer {
    if (exception instanceof HttpException) {
      return fromHttpException(exception);
    }
    if (isClientHttpError(exception)) {
      const status = exception.statusCode;
      return { status, detail: exception.expose ? exception.message : (STATUS_CODES[status] ?? 'Error') };
    }
    if (isPrismaKnownRequestError(exception)) {
      const known = prismaAnswer(exception);
      if (known) {
        return known;
      }
    }
    if (isPoolError(exception)) {
      return BUSY;
    }
    return INTERNAL_ERROR;
  }

  private record(exception: unknown, answer: Answer, request: Request, response: Response): void {
    if (exception instanceof ProbeUnavailableException) {
      return;
    }
    if (answer.status >= (HttpStatus.INTERNAL_SERVER_ERROR as number)) {
      this.logger.error(
        exception instanceof Error ? exception.message : String(exception),
        stackOf(exception),
      );
      return;
    }
    const id = response.getHeader('x-request-id');
    const detail = isBodyParseError(exception) ? 'Malformed JSON body' : answer.detail;
    this.logger.log(
      `${answer.status} ${request.method} ${pathOf(request)}: ${detail}${id ? ` (request ${String(id)})` : ''}`,
    );
  }
}

// A validation error carries a list of messages.
function fromHttpException(exception: HttpException): Answer {
  const status = exception.getStatus();
  const body = exception.getResponse();
  if (typeof body === 'string') {
    return { status, detail: body };
  }
  const message = (body as { message?: unknown }).message;
  if (Array.isArray(message) && message.length > 0 && message.every((item) => typeof item === 'string')) {
    return { status, detail: message.join('; '), errors: message };
  }
  if (typeof message === 'string' && message.length > 0) {
    return { status, detail: message };
  }
  return { status, detail: STATUS_CODES[status] ?? 'Error' };
}

function pathOf(request: Request): string {
  return (request.originalUrl || request.url || '').split('?')[0];
}

function stackOf(exception: unknown): string | undefined {
  return exception instanceof Error ? exception.stack : undefined;
}
