'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { StatusResponse, StageProgress } from '@ab-predictor/shared';

function StepIcon({ status }: { status: StageProgress['status'] }) {
  if (status === 'completed') {
    return (
      <div className="z-10 w-6 h-6 rounded-full bg-primary-container flex items-center justify-center border-2 border-primary">
        <span
          className="material-symbols-outlined text-[14px] text-white"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          check
        </span>
      </div>
    );
  }
  if (status === 'active') {
    return (
      <div className="z-10 w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center border-2 border-primary step-pulse">
        <div className="w-2 h-2 rounded-full bg-primary" />
      </div>
    );
  }
  if (status === 'failed') {
    return (
      <div className="z-10 w-6 h-6 rounded-full bg-error/20 flex items-center justify-center border-2 border-error">
        <span
          className="material-symbols-outlined text-[14px] text-error"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          close
        </span>
      </div>
    );
  }
  // pending
  return (
    <div className="z-10 w-6 h-6 rounded-full bg-surface-container flex items-center justify-center border-2 border-outline-variant" />
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function TimeLabel({
  status,
  elapsed,
}: {
  status: StageProgress['status'];
  elapsed: number;
}) {
  if (status === 'completed' || status === 'active') {
    return (
      <span
        className={`font-mono text-[11px] ${
          status === 'active' ? 'text-primary' : 'text-on-surface-variant'
        }`}
      >
        {formatDuration(elapsed)}
        {status === 'active' && '...'}
      </span>
    );
  }
  return null;
}

interface StageTiming {
  startedAt: number;
  frozenDuration: number | null;
}

export default function StatusTracker({
  jobId,
  email,
}: {
  jobId: string;
  email?: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<(StatusResponse & { errorMessage?: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const timingsRef = useRef<Record<string, StageTiming>>({});
  const prevStagesRef = useRef<StageProgress[] | null>(null);

  // Poll status every 3 seconds
  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/api/status/${jobId}`);
        if (!res.ok) {
          if (!cancelled) setError('Failed to fetch status');
          return;
        }
        const json: StatusResponse = await res.json();
        if (!cancelled) {
          setError(null);
          const now = Date.now();
          const prev = prevStagesRef.current;
          const timings = timingsRef.current;

          for (const stage of json.stageProgress) {
            const prevStage = prev?.find((s) => s.stage === stage.stage);
            const prevStatus = prevStage?.status;

            if (stage.status === 'active' && prevStatus !== 'active') {
              // Stage just became active — start its timer
              timings[stage.stage] = { startedAt: now, frozenDuration: null };
            } else if (
              prevStatus === 'active' &&
              stage.status !== 'active' &&
              timings[stage.stage]
            ) {
              // Stage was active, now completed/failed — freeze its duration
              timings[stage.stage].frozenDuration = Math.floor(
                (now - timings[stage.stage].startedAt) / 1000
              );
            }
          }

          prevStagesRef.current = json.stageProgress;
          setData(json);
          if (json.status === 'completed') {
            setTimeout(() => router.push(`/results/${jobId}`), 2000);
          }
        }
      } catch {
        if (!cancelled) setError('Network error');
      }
    }

    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [jobId, router]);

  // Tick every second to update active stage timer
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  if (error) {
    return (
      <div className="text-center py-20">
        <span className="material-symbols-outlined text-error text-4xl mb-4 block">
          cloud_off
        </span>
        <p className="text-error text-lg mb-2">{error}</p>
        <p className="text-on-surface-variant text-sm mb-6">
          We&apos;ll keep trying to reconnect automatically.
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-20">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    );
  }

  // Suppress unused variable warning — tick drives re-renders for the active timer
  void tick;

  const stages = data.stageProgress;
  const activeIndex = stages.findIndex((s) => s.status === 'active');
  const completedCount = stages.filter((s) => s.status === 'completed').length;
  const progressPct = Math.round((completedCount / stages.length) * 100);

  // Estimate remaining time
  const totalEstMinutes = 20;
  const remainingMin = Math.max(
    0,
    Math.round(totalEstMinutes * (1 - completedCount / stages.length))
  );

  const isRateLimit = data.errorMessage?.toLowerCase().includes('rate limit');
  const isRetrying = data.status === 'queued' && isRateLimit;

  const headingText =
    data.status === 'completed'
      ? 'Simulation complete!'
      : data.status === 'failed'
        ? 'Simulation failed'
        : isRetrying
          ? 'Waiting to retry...'
          : 'Your simulation is running';

  return (
    <>
      {/* Status Header */}
      <section className="w-full text-center mb-12">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-2 text-on-surface">
          {headingText}
        </h1>
        {isRetrying && (
          <p className="text-sm text-on-surface-variant mb-8">
            We hit a rate limit on a third-party service. Your simulation will
            automatically retry in a few minutes. We&apos;ll email your results
            when they&apos;re ready.
          </p>
        )}
        {data.status === 'processing' && (
          <p className="font-mono text-sm uppercase tracking-widest text-on-surface-variant mb-8">
            ~{remainingMin} min remaining
          </p>
        )}
        {data.status === 'completed' && (
          <p className="font-mono text-sm uppercase tracking-widest text-primary mb-8">
            Redirecting to results...
          </p>
        )}
        {data.status === 'failed' && (
          <p className="text-sm text-on-surface-variant mb-8">
            Something went wrong during the simulation. This can happen with complex market scenarios.
          </p>
        )}

        {/* Progress Bar */}
        <div className="relative w-full h-1 bg-surface-container rounded-full overflow-hidden">
          <div
            className="absolute top-0 left-0 h-full bg-gradient-to-r from-primary to-secondary progress-glow transition-all duration-700"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </section>

      {/* Vertical Timeline */}
      <section className="w-full space-y-0 relative">
        {stages.map((stage, i) => {
          const isLast = i === stages.length - 1;
          const isA = stage.label.includes('(A)');
          const isB = stage.label.includes('(B)');

          return (
            <div key={stage.stage} className="flex gap-6 pb-8 relative">
              <div className="flex flex-col items-center">
                <StepIcon status={stage.status} />
                {!isLast && (
                  <div
                    className={`w-[1px] h-full absolute top-6 left-3 ${
                      stage.status === 'completed'
                        ? 'bg-primary'
                        : 'border-l border-dashed border-outline-variant'
                    }`}
                  />
                )}
              </div>
              <div className="flex-1 pt-0.5">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    {(isA || isB) && stage.status !== 'pending' && (
                      <div
                        className={`w-1.5 h-1.5 rounded-full ${
                          isA ? 'bg-primary' : 'bg-secondary'
                        }`}
                      />
                    )}
                    <span
                      className={
                        stage.status === 'active'
                          ? 'text-primary font-bold'
                          : stage.status === 'completed'
                            ? 'text-on-surface font-medium'
                            : stage.status === 'failed'
                              ? 'text-error font-medium'
                              : 'text-on-surface-variant'
                      }
                    >
                      {stage.label}
                    </span>
                  </div>
                  <TimeLabel
                    status={stage.status}
                    elapsed={(() => {
                      const t = timingsRef.current[stage.stage];
                      if (!t) return 0;
                      if (t.frozenDuration !== null) return t.frozenDuration;
                      if (stage.status === 'active') {
                        return Math.floor((Date.now() - t.startedAt) / 1000);
                      }
                      return 0;
                    })()}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </section>

      {/* Footer Info */}
      <section className="w-full mt-16 flex flex-col items-center">
        {data.status === 'failed' ? (
          <a
            href="/"
            className="bg-on-surface text-background px-8 py-3 rounded-xl font-bold hover:opacity-90 transition-all flex items-center gap-2 mb-8"
          >
            Run another test
            <span className="material-symbols-outlined text-sm">arrow_forward</span>
          </a>
        ) : (
          <>
            <div className="w-full bg-surface-container-low p-6 rounded-xl text-center mb-6">
              <p className="text-on-surface text-sm">
                We&apos;ll email you at{' '}
                <span className="font-mono text-primary">{email ?? 'your email'}</span>{' '}
                when results are ready.
              </p>
            </div>
            <p className="text-on-surface-variant text-sm mb-8">
              You can safely close this tab.
            </p>
          </>
        )}
      </section>
    </>
  );
}
