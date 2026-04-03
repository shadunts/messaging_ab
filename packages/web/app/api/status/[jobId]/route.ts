export const dynamic = 'force-dynamic';
export const maxDuration = 30;

import { NextResponse } from 'next/server';
import { createClient } from '@libsql/client';
import {
  STAGE_LABELS,
  type PipelineStage,
  type StatusResponse,
  type StageProgress,
  type JobStatus,
} from '@ab-predictor/shared';

const PIPELINE_STAGES: PipelineStage[] = [
  'seed_doc_generation',
  'graph_building',
  'env_setup_a',
  'simulation_a',
  'report_a',
  'env_setup_b',
  'simulation_b',
  'report_b',
  'parsing_results',
  'complete',
];

function buildStageProgress(
  currentStage: string | null,
  jobStatus: string
): StageProgress[] {
  if (jobStatus === 'queued' || !currentStage) {
    return PIPELINE_STAGES.map((stage) => ({
      stage,
      label: STAGE_LABELS[stage],
      status: 'pending' as const,
    }));
  }

  const currentIndex = PIPELINE_STAGES.indexOf(currentStage as PipelineStage);

  return PIPELINE_STAGES.map((stage, i) => {
    let status: StageProgress['status'];
    if (jobStatus === 'failed' && stage === currentStage) {
      status = 'failed';
    } else if (jobStatus === 'completed' || i < currentIndex) {
      status = 'completed';
    } else if (i === currentIndex) {
      status = jobStatus === 'completed' ? 'completed' : 'active';
    } else {
      status = 'pending';
    }

    return {
      stage,
      label: STAGE_LABELS[stage],
      status,
    };
  });
}

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
      sql: `SELECT id, status, current_stage, created_at, error_message FROM jobs WHERE id = ?`,
      args: [jobId],
    });

    const row = result.rows[0];
    if (!row) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const status = row.status as string;
    const currentStage = row.current_stage as string | null;
    const createdAtMs = row.created_at as number;
    const createdAt = new Date(createdAtMs).toISOString();
    const estimatedCompletion = new Date(createdAtMs + 20 * 60 * 1000).toISOString();

    const response: StatusResponse & { errorMessage?: string } = {
      jobId: row.id as string,
      status: status as JobStatus,
      currentStage: (currentStage as PipelineStage) || null,
      createdAt,
      estimatedCompletion,
      stageProgress: buildStageProgress(currentStage, status),
    };

    if (row.error_message) {
      response.errorMessage = row.error_message as string;
    }

    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  } catch (err) {
    console.error('Status error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
