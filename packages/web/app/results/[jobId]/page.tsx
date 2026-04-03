export const dynamic = 'force-dynamic';

import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { jobs } from '@/lib/schema';
import Dashboard from '@/components/results/Dashboard';
import type {
  ResultsResponse,
  FormInput,
  ParsedResults,
  ComparisonResult,
} from '@ab-predictor/shared';

export async function generateMetadata({
  params,
}: {
  params: { jobId: string };
}): Promise<Metadata> {
  const job = await db.query.jobs.findFirst({
    where: eq(jobs.id, params.jobId),
  });

  if (!job || job.status !== 'completed' || !job.comparison) {
    return { title: 'Results | Messaging A/B' };
  }

  const input = job.formInput as FormInput;
  const comparison = job.comparison as ComparisonResult;
  const winnerLabel =
    comparison.winner === 'tie'
      ? 'Too close to call'
      : `${comparison.winnerLabel || `Message ${comparison.winner}`} resonated more strongly`;

  const title = `${input.productName} — ${winnerLabel}`;
  const description = comparison.summary;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'article',
      siteName: 'Messaging A/B',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

export default async function ResultsPage({
  params,
}: {
  params: { jobId: string };
}) {
  const { jobId } = params;

  const job = await db.query.jobs.findFirst({
    where: eq(jobs.id, jobId),
  });

  if (!job || job.status !== 'completed' || !job.resultsA || !job.resultsB || !job.comparison) {
    notFound();
  }

  const data: ResultsResponse = {
    jobId: job.id,
    formInput: job.formInput as FormInput,
    resultsA: job.resultsA as ParsedResults,
    resultsB: job.resultsB as ParsedResults,
    comparison: job.comparison as ComparisonResult,
  };

  return (
    <>
      {/* Header */}
      <nav className="flex justify-between items-center w-full px-6 py-3 sticky top-0 z-50 bg-[#131314]">
        <div className="flex items-center gap-8">
          <a href="/" className="text-xl font-bold tracking-tighter text-primary">
            Messaging A/B
          </a>
        </div>
        <div className="flex items-center gap-4">
          <button className="p-2 hover:bg-surface-container rounded-full transition-all duration-200">
            <span className="material-symbols-outlined text-on-surface-variant">
              help
            </span>
          </button>
        </div>
      </nav>

      <main className="max-w-[1000px] mx-auto px-6 py-12">
        <Dashboard data={data} />
      </main>
    </>
  );
}
