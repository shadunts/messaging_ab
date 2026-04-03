export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { createClient } from '@libsql/client';
import type { Metadata } from 'next';
import Dashboard from '@/components/results/Dashboard';
import type {
  ResultsResponse,
  FormInput,
  ParsedResults,
  ComparisonResult,
} from '@ab-predictor/shared';

function getTursoClient() {
  return createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
}

async function getJob(jobId: string) {
  const client = getTursoClient();
  const result = await client.execute({
    sql: `SELECT * FROM jobs WHERE id = ?`,
    args: [jobId],
  });
  return result.rows[0] ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: { jobId: string };
}): Promise<Metadata> {
  const job = await getJob(params.jobId);

  if (!job || job.status !== 'completed' || !job.comparison) {
    return { title: 'Results | Messaging A/B' };
  }

  const input = JSON.parse(job.form_input as string) as FormInput;
  const comparison = JSON.parse(job.comparison as string) as ComparisonResult;
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
  const job = await getJob(jobId);

  if (!job || job.status !== 'completed' || !job.results_a || !job.results_b || !job.comparison) {
    notFound();
  }

  const data: ResultsResponse = {
    jobId: job.id as string,
    formInput: JSON.parse(job.form_input as string) as FormInput,
    resultsA: JSON.parse(job.results_a as string) as ParsedResults,
    resultsB: JSON.parse(job.results_b as string) as ParsedResults,
    comparison: JSON.parse(job.comparison as string) as ComparisonResult,
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
