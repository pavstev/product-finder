import { isSpanContextValid, type Span, SpanStatusCode, trace } from '@opentelemetry/api';

export const INSTRUMENTATION_SCOPE = 'product-finder';

interface TraceFields {
  trace_id?: string;
  span_id?: string;
  trace_flags?: string;
}

/** The ids of the active span, or nothing. Names and format follow OpenTelemetry's own pino support. */
export function traceFields(): TraceFields {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext || !isSpanContextValid(spanContext)) {
    return {};
  }
  return {
    trace_id: spanContext.traceId,
    span_id: spanContext.spanId,
    trace_flags: `0${spanContext.traceFlags.toString(16)}`,
  };
}

/** Runs `work` in a new active span, so its pg spans have a parent. An error marks the span failed and is rethrown. */
export function inSpan<T>(name: string, work: (span: Span) => Promise<T>): Promise<T> {
  return trace.getTracer(INSTRUMENTATION_SCOPE).startActiveSpan(name, async (span) => {
    try {
      return await work(span);
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
