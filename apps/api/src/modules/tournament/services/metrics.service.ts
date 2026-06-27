import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  private readonly counters: Record<string, number> = {
    match_start_total: 0,
    match_pause_total: 0,
    match_complete_total: 0,
    score_updates_total: 0,
    score_conflict_total: 0,
    gateway_emit_total: 0,
    overlay_reconnect_total: 0,
    worker_lease_expired_total: 0,
    snapshot_activation_total: 0,
    socket_recovery_total: 0,
    freeze_operations_blocked_total: 0,
    worker_retry_total: 0,
    freeze_active_total: 0,
    freeze_expired_total: 0,
    freeze_manual_unfreeze_total: 0,
  };

  private readonly gauges: Record<string, number> = {
    socket_clients_connected: 0,
    worker_queue_depth: 0,
  };

  private readonly histograms: Record<string, number[]> = {
    socket_latency_ms: [],
    standings_recalc_ms: [],
    snapshot_generation_ms: [],
    pubsub_delivery_ms: [],
    freeze_duration_ms: [],
    worker_job_duration_ms: [],
  };

  incrementCounter(name: keyof typeof this.counters): void {
    if (this.counters[name] !== undefined) {
      this.counters[name]++;
      this.logger.log(`[Metric Counter] ${name}: ${this.counters[name]}`);
    }
  }

  setGauge(name: keyof typeof this.gauges, value: number): void {
    if (this.gauges[name] !== undefined) {
      this.gauges[name] = value;
      this.logger.log(`[Metric Gauge] ${name}: ${this.gauges[name]}`);
    }
  }

  getGauge(name: keyof typeof this.gauges): number {
    return this.gauges[name] || 0;
  }

  recordHistogram(name: keyof typeof this.histograms, value: number): void {
    if (this.histograms[name] !== undefined) {
      this.histograms[name].push(value);
      if (this.histograms[name].length > 100) {
        this.histograms[name].shift();
      }
      this.logger.log(`[Metric Histogram] ${name} recorded: ${value}ms`);
    }
  }

  getMetricsDump() {
    return {
      counters: { ...this.counters },
      gauges: { ...this.gauges },
      histograms: Object.keys(this.histograms).reduce((acc, key) => {
        const vals = this.histograms[key];
        const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
        acc[key] = { count: vals.length, avg };
        return acc;
      }, {} as Record<string, any>),
    };
  }
}
