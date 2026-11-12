// The OpenTelemetry SDK setup. otel.ts loads this file only when OTEL_EXPORTER_OTLP_ENDPOINT is set,
// so a start without the endpoint loads none of these packages.
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ExpressInstrumentation, ExpressLayerType } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK, type NodeSDKConfiguration } from '@opentelemetry/sdk-node';
import { isHealthCheck } from './health-path.js';

// Traces and metrics go over OTLP/HTTP to OTEL_EXPORTER_OTLP_ENDPOINT, which the exporters read themselves.
// Logs are not exported. Only four instrumentations, so there are no fs or dns spans.
// Outgoing HTTP is off because the only calls are the OTLP exports. pg spans need a parent,
// so the readiness probe query makes no trace.
function otelConfiguration(serviceName: string): Partial<NodeSDKConfiguration> {
  return {
    serviceName,
    traceExporter: new OTLPTraceExporter(),
    metricReaders: [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter() })],
    logRecordProcessors: [],
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (request) => isHealthCheck(request.url),
        disableOutgoingRequestInstrumentation: true,
      }),
      new ExpressInstrumentation({ ignoreLayersType: [ExpressLayerType.MIDDLEWARE] }),
      new NestInstrumentation(),
      new PgInstrumentation({ requireParentSpan: true }),
    ],
  };
}

export function createNodeSdk(serviceName: string): NodeSDK {
  return new NodeSDK(otelConfiguration(serviceName));
}
