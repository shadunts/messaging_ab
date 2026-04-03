export const dynamic = 'force-dynamic';
export const maxDuration = 30;

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { jobs } from '@/lib/schema';
import type { ResultsResponse, FormInput, ParsedResults, ComparisonResult } from '@ab-predictor/shared';

export async function GET(
  _request: Request,
  { params }: { params: { jobId: string } }
) {
  try {
    const { jobId } = params;

    const job = await db.query.jobs.findFirst({
      where: eq(jobs.id, jobId),
    });

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    if (job.status !== 'completed' || !job.resultsA || !job.resultsB || !job.comparison) {
      return NextResponse.json(
        { error: 'Results not yet available', status: job.status },
        { status: 422 }
      );
    }

    const response: ResultsResponse = {
      jobId: job.id,
      formInput: job.formInput as FormInput,
      resultsA: job.resultsA as ParsedResults,
      resultsB: job.resultsB as ParsedResults,
      comparison: job.comparison as ComparisonResult,
    };

    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  } catch (err) {
    console.error('Results error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
