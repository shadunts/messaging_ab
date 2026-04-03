export const dynamic = 'force-dynamic';
export const maxDuration = 30;

import { NextResponse } from 'next/server';
import { createClient } from '@libsql/client';
import type { ResultsResponse, FormInput, ParsedResults, ComparisonResult } from '@ab-predictor/shared';

function getTursoClient() {
  return createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
}

export async function GET(
  _request: Request,
  { params }: { params: { jobId: string } }
) {
  try {
    const { jobId } = params;
    const client = getTursoClient();

    const result = await client.execute({
      sql: `SELECT id, status, form_input, results_a, results_b, comparison FROM jobs WHERE id = ?`,
      args: [jobId],
    });

    const row = result.rows[0];
    if (!row) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    if (row.status !== 'completed' || !row.results_a || !row.results_b || !row.comparison) {
      return NextResponse.json(
        { error: 'Results not yet available', status: row.status },
        { status: 422, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const response: ResultsResponse = {
      jobId: row.id as string,
      formInput: JSON.parse(row.form_input as string) as FormInput,
      resultsA: JSON.parse(row.results_a as string) as ParsedResults,
      resultsB: JSON.parse(row.results_b as string) as ParsedResults,
      comparison: JSON.parse(row.comparison as string) as ComparisonResult,
    };

    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  } catch (err) {
    console.error('Results error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
