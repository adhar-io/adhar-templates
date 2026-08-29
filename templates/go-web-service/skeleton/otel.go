package main

import (
	"context"
	"log"
	"net/http"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// setupOTel wires OTLP trace + metric exporters. Endpoint, service name and
// resource attributes are read from the OTEL_* env vars set on the Rollout, so
// everything points at the Alloy collector out of the box.
func setupOTel(ctx context.Context) func(context.Context) error {
	res, _ := resource.New(ctx, resource.WithFromEnv(), resource.WithProcess(), resource.WithHost())

	traceExp, err := otlptracehttp.New(ctx)
	if err != nil {
		log.Printf("otel: trace exporter disabled: %v", err)
		return func(context.Context) error { return nil }
	}
	tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(traceExp), sdktrace.WithResource(res))
	otel.SetTracerProvider(tp)

	metricExp, err := otlpmetrichttp.New(ctx)
	if err != nil {
		log.Printf("otel: metric exporter disabled: %v", err)
		return tp.Shutdown
	}
	mp := sdkmetric.NewMeterProvider(
		sdkmetric.WithReader(sdkmetric.NewPeriodicReader(metricExp)),
		sdkmetric.WithResource(res),
	)
	otel.SetMeterProvider(mp)

	return func(c context.Context) error {
		_ = tp.Shutdown(c)
		return mp.Shutdown(c)
	}
}

// otelHandler adds server-side HTTP tracing + metrics to any handler.
func otelHandler(h http.Handler) http.Handler {
	return otelhttp.NewHandler(h, "http.server")
}
