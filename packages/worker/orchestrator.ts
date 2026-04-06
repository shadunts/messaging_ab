import fs from 'fs';
import os from 'os';
import path from 'path';
import type { FormInput, PipelineStage } from '@ab-predictor/shared';
import {
  generateSeedDocument,
  generateSimulationPrompt,
} from '../web/lib/seed-doc-template';
import * as mf from './mirofish-client';
import { parseReport, generateComparison } from './report-parser';
import { sendResultsEmail, sendErrorEmail } from './email';
import { getJob, updateJob } from './db';

const MAX_RETRIES = 2;
const RETRY_BASE_MS = 5000;

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt);
        console.warn(
          `[retry] ${label} attempt ${attempt + 1} failed, retrying in ${delay}ms: ${lastError.message}`
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

async function setStage(jobId: string, stage: PipelineStage) {
  await updateJob(jobId, { currentStage: stage, status: 'processing' });
}

// Pipeline stages in order, used to determine where to resume
const STAGES: PipelineStage[] = [
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

function stageIndex(stage: string | null): number {
  if (!stage) return -1;
  return STAGES.indexOf(stage as PipelineStage);
}

export async function processJob(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  const input = job.formInput as FormInput;

  // Check what stage we can resume from based on saved MiroFish IDs
  const lastStage = stageIndex(job.currentStage as string);
  let projectIdA = job.projectId as string | undefined;
  let projectIdB = job.projectIdB as string | undefined;
  let graphIdA = job.graphId as string | undefined;
  let graphIdB = job.graphIdB as string | undefined;
  let simIdA = job.simulationIdA as string | undefined;
  let simIdB = job.simulationIdB as string | undefined;
  let reportIdA = job.reportIdA as string | undefined;
  let reportIdB = job.reportIdB as string | undefined;

  console.log(`[orchestrator] Job ${jobId}: resuming from stage ${job.currentStage ?? 'start'}`);

  try {
    // ─── Stage 1: Generate seed document + prompts ────────
    const seedDoc = generateSeedDocument(input);
    const simRequirementA = generateSimulationPrompt(
      input,
      input.headlineA,
      input.supportingCopyA || undefined,
      input.approachLabelA || 'Message A'
    );
    const simRequirementB = generateSimulationPrompt(
      input,
      input.headlineB,
      input.supportingCopyB || undefined,
      input.approachLabelB || 'Message B'
    );

    // ─── Stage 2: Create projects + build graphs ──────────
    // Each message gets its own project so MiroFish uses the
    // correct simulation_requirement for each simulation.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-pred-'));
    const seedFilePath = path.join(tmpDir, `${jobId}.md`);
    fs.writeFileSync(seedFilePath, seedDoc, 'utf-8');

    if (!projectIdA || !graphIdA) {
      await setStage(jobId, 'seed_doc_generation');

      const resultA = await withRetry('createProjectA', () =>
        mf.createProjectFromSeedDoc(
          seedFilePath,
          simRequirementA,
          `AB Test A: ${input.productName}`
        )
      );
      projectIdA = resultA.projectId;
      await updateJob(jobId, { projectId: projectIdA });

      await setStage(jobId, 'graph_building');
      const { taskId: buildTaskIdA } = await withRetry('startGraphBuildA', () =>
        mf.startGraphBuild(projectIdA!)
      );
      graphIdA = await withRetry('waitForGraphBuildA', () =>
        mf.waitForGraphBuild(buildTaskIdA)
      );
      await updateJob(jobId, { graphId: graphIdA });
    }

    if (!projectIdB || !graphIdB) {
      const resultB = await withRetry('createProjectB', () =>
        mf.createProjectFromSeedDoc(
          seedFilePath,
          simRequirementB,
          `AB Test B: ${input.productName}`
        )
      );
      projectIdB = resultB.projectId;
      await updateJob(jobId, { projectIdB });

      const { taskId: buildTaskIdB } = await withRetry('startGraphBuildB', () =>
        mf.startGraphBuild(projectIdB!)
      );
      graphIdB = await withRetry('waitForGraphBuildB', () =>
        mf.waitForGraphBuild(buildTaskIdB)
      );
      await updateJob(jobId, { graphIdB });
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });

    // ─── Stage 3: Simulation A ─────────────────────────────
    if (!simIdA || lastStage < stageIndex('simulation_a')) {
      await setStage(jobId, 'env_setup_a');

      if (!simIdA) {
        simIdA = await withRetry('createSimulationA', () =>
          mf.createSimulation(projectIdA!, {
            enableTwitter: true,
            enableReddit: false,
          })
        );
        await updateJob(jobId, { simulationIdA: simIdA });
      }

      const prepA = await withRetry('startPrepareA', () =>
        mf.startPrepare(simIdA!)
      );
      if (!prepA.alreadyPrepared) {
        await withRetry('waitForPrepareA', () =>
          mf.waitForPrepare(simIdA!, prepA.taskId)
        );
      }

      await setStage(jobId, 'simulation_a');
      try {
        await mf.startSimulation(simIdA, { platform: 'twitter', maxRounds: 8 });
      } catch {
        console.log('[orchestrator] startSimulation A may already be running, polling...');
      }
      await withRetry('waitForSimCompleteA', () =>
        mf.waitForSimulationComplete(simIdA!)
      );
    } else {
      console.log(`[orchestrator] Skipping simulation A — already completed (${simIdA})`);
    }

    // ─── Stage 4: Report A ─────────────────────────────────
    if (!reportIdA || lastStage < stageIndex('report_a')) {
      await setStage(jobId, 'report_a');
      const repA = await withRetry('startReportA', () =>
        mf.startReportGeneration(simIdA!)
      );
      reportIdA = repA.reportId;
      await updateJob(jobId, { reportIdA });
      if (!repA.alreadyGenerated) {
        await withRetry('waitForReportA', () =>
          mf.waitForReportComplete(simIdA!, repA.taskId)
        );
      }
    } else {
      console.log(`[orchestrator] Skipping report A — already generated (${reportIdA})`);
    }

    // ─── Stage 5: Simulation B (separate project) ──────────
    if (!simIdB || lastStage < stageIndex('simulation_b')) {
      await setStage(jobId, 'env_setup_b');

      if (!simIdB) {
        simIdB = await withRetry('createSimulationB', () =>
          mf.createSimulation(projectIdB!, {
            enableTwitter: true,
            enableReddit: false,
          })
        );
        await updateJob(jobId, { simulationIdB: simIdB });
      }

      const prepB = await withRetry('startPrepareB', () =>
        mf.startPrepare(simIdB!)
      );
      if (!prepB.alreadyPrepared) {
        await withRetry('waitForPrepareB', () =>
          mf.waitForPrepare(simIdB!, prepB.taskId)
        );
      }

      await setStage(jobId, 'simulation_b');
      try {
        await mf.startSimulation(simIdB, { platform: 'twitter', maxRounds: 8 });
      } catch {
        console.log('[orchestrator] startSimulation B may already be running, polling...');
      }
      await withRetry('waitForSimCompleteB', () =>
        mf.waitForSimulationComplete(simIdB!)
      );
    } else {
      console.log(`[orchestrator] Skipping simulation B — already completed (${simIdB})`);
    }

    // ─── Stage 6: Report B ─────────────────────────────────
    if (!reportIdB || lastStage < stageIndex('report_b')) {
      await setStage(jobId, 'report_b');
      const repB = await withRetry('startReportB', () =>
        mf.startReportGeneration(simIdB!)
      );
      reportIdB = repB.reportId;
      await updateJob(jobId, { reportIdB });
      if (!repB.alreadyGenerated) {
        await withRetry('waitForReportB', () =>
          mf.waitForReportComplete(simIdB!, repB.taskId)
        );
      }
    } else {
      console.log(`[orchestrator] Skipping report B — already generated (${reportIdB})`);
    }

    // ─── Stage 7: Parse and compare ────────────────────────
    await setStage(jobId, 'parsing_results');

    const reportDataA = await mf.getReport(reportIdA!);
    const reportDataB = await mf.getReport(reportIdB!);
    const actionsA = await mf.getActions(simIdA!, 500);
    const actionsB = await mf.getActions(simIdB!, 500);

    const actionsAStr = JSON.stringify(actionsA.actions);
    const actionsBStr = JSON.stringify(actionsB.actions);

    const resultsA = await withRetry('parseReportA', () =>
      parseReport(reportDataA.markdown_content, actionsAStr, input.headlineA, input.supportingCopyA || undefined)
    );
    const resultsB = await withRetry('parseReportB', () =>
      parseReport(reportDataB.markdown_content, actionsBStr, input.headlineB, input.supportingCopyB || undefined)
    );
    const comparison = await withRetry('generateComparison', () =>
      generateComparison(resultsA, resultsB, input)
    );

    // ─── Complete ──────────────────────────────────────────
    await updateJob(jobId, {
      resultsA,
      resultsB,
      comparison,
      status: 'completed',
      currentStage: 'complete',
      completedAt: new Date(),
    });

    // Send email
    try {
      await sendResultsEmail(job.email, jobId);
    } catch (emailErr) {
      console.error('Failed to send results email:', emailErr);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isRateLimit = /rate.?limit|429|too many requests/i.test(message);
    const currentJob = await getJob(jobId);

    if (isRateLimit) {
      // Mark as queued so the UI shows a "retrying" state, not a hard failure
      await updateJob(jobId, {
        status: 'queued',
        errorMessage: 'Rate limit hit — will retry automatically',
        errorStage: (currentJob?.currentStage as string) || 'unknown',
        currentStage: undefined as unknown as PipelineStage,
      });
      // Re-throw so BullMQ retries with backoff
      throw error;
    }

    await updateJob(jobId, {
      status: 'failed',
      errorMessage: message,
      errorStage: (currentJob?.currentStage as string) || 'unknown',
    });

    try {
      await sendErrorEmail(job.email, jobId);
    } catch (emailErr) {
      console.error('Failed to send error email:', emailErr);
    }
  }
}
