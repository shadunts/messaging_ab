export const dynamic = 'force-dynamic';
export const maxDuration = 30;

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { jobs } from '@/lib/schema';
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

    const createdAt = job.createdAt.toISOString();
    const estimatedCompletion = new Date(
      job.createdAt.getTime() + 20 * 60 * 1000
    ).toISOString();

    const response: StatusResponse & { errorMessage?: string } = {
      jobId: job.id,
      status: job.status as JobStatus,
      currentStage: (job.currentStage as PipelineStage) || null,
      createdAt,
      estimatedCompletion,
      stageProgress: buildStageProgress(job.currentStage, job.status),
    };

    if (job.errorMessage) {
      response.errorMessage = job.errorMessage as string;
    }

    return NextResponse.json(response);
  } catch (err) {
    console.error('Status error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
