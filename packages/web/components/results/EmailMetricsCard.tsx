'use client';

import type { EmailEngagement } from '@ab-predictor/shared';

function PctCard({
  label,
  pct,
  color,
}: {
  label: string;
  pct: number;
  color: 'primary' | 'secondary';
}) {
  const barColor = color === 'primary' ? 'bg-primary' : 'bg-secondary';
  const textColor = color === 'primary' ? 'text-primary' : 'text-secondary';

  return (
    <div className="bg-surface-container p-5 rounded-xl">
      <span className="font-mono text-[10px] text-on-surface-variant uppercase tracking-widest block mb-3">
        {label}
      </span>
      <div className={`text-2xl font-bold ${textColor} mb-2`}>
        {pct}%
      </div>
      <div className="w-full h-1.5 bg-outline-variant/20 rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} rounded-full transition-all duration-500`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

export default function EmailMetricsCard({
  emailEngagementA,
  emailEngagementB,
  labelA,
  labelB,
  totalAgents,
}: {
  emailEngagementA?: EmailEngagement;
  emailEngagementB?: EmailEngagement;
  labelA: string;
  labelB: string;
  totalAgents?: number;
}) {
  if (!emailEngagementA || !emailEngagementB) return null;

  const total = totalAgents || 25;
  const openPctA = Math.round((emailEngagementA.opens / total) * 100);
  const openPctB = Math.round((emailEngagementB.opens / total) * 100);
  const clickPctA = Math.round((emailEngagementA.clicks / total) * 100);
  const clickPctB = Math.round((emailEngagementB.clicks / total) * 100);

  return (
    <section className="mb-16">
      <h2 className="text-xl font-bold tracking-tight mb-2">
        Predicted Email Performance
      </h2>
      <p className="text-sm text-on-surface-variant mb-8">
        Inferred from simulation — predicted open and click-through rates if each message were sent as a cold email.
      </p>
      <div className="grid md:grid-cols-2 gap-6">
        {/* Message A */}
        <div>
          <div className="text-sm font-semibold text-primary mb-3">{labelA}</div>
          <div className="grid grid-cols-2 gap-3">
            <PctCard label="Open Rate" pct={openPctA} color="primary" />
            <PctCard label="Click-Through" pct={clickPctA} color="primary" />
          </div>
        </div>
        {/* Message B */}
        <div>
          <div className="text-sm font-semibold text-secondary mb-3">{labelB}</div>
          <div className="grid grid-cols-2 gap-3">
            <PctCard label="Open Rate" pct={openPctB} color="secondary" />
            <PctCard label="Click-Through" pct={clickPctB} color="secondary" />
          </div>
        </div>
      </div>
    </section>
  );
}
