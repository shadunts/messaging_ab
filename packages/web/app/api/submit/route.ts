export const dynamic = 'force-dynamic';
export const maxDuration = 30;

import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { db } from '@/lib/db';
import { jobs } from '@/lib/schema';
import { enqueueJob } from '@/lib/queue';
import { CATEGORY_OPTIONS, COMPANY_SIZE_OPTIONS, type FormInput } from '@ab-predictor/shared';

function validateInput(body: unknown): { valid: true; data: FormInput } | { valid: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Invalid request body' };
  }

  const f = body as Record<string, unknown>;

  // Required strings with length constraints
  const checks: { field: string; min?: number; max: number; label: string }[] = [
    { field: 'productName', max: 100, label: 'Product name' },
    { field: 'productDescription', min: 20, max: 500, label: 'Product description' },
    { field: 'targetAudience', min: 20, max: 300, label: 'Target audience' },
    { field: 'competitors', min: 5, max: 300, label: 'Competitors' },
    { field: 'headlineA', min: 5, max: 100, label: 'Headline A' },
    { field: 'headlineB', min: 5, max: 100, label: 'Headline B' },
  ];

  for (const { field, min, max, label } of checks) {
    const val = f[field];
    if (typeof val !== 'string' || !val.trim()) {
      return { valid: false, error: `${label} is required` };
    }
    if (min && val.length < min) {
      return { valid: false, error: `${label} must be at least ${min} characters` };
    }
    if (val.length > max) {
      return { valid: false, error: `${label} must be at most ${max} characters` };
    }
  }

  // Required enums
  if (!CATEGORY_OPTIONS.includes(f.productCategory as typeof CATEGORY_OPTIONS[number])) {
    return { valid: false, error: 'Invalid product category' };
  }
  if (!COMPANY_SIZE_OPTIONS.includes(f.companySize as typeof COMPANY_SIZE_OPTIONS[number])) {
    return { valid: false, error: 'Invalid company size' };
  }

  // Email
  if (typeof f.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) {
    return { valid: false, error: 'Valid email is required' };
  }

  // Optional field length checks
  if (f.pricingModel && typeof f.pricingModel === 'string' && f.pricingModel.length > 150) {
    return { valid: false, error: 'Pricing model must be at most 150 characters' };
  }
  if (f.supportingCopyA && typeof f.supportingCopyA === 'string' && f.supportingCopyA.length > 500) {
    return { valid: false, error: 'Supporting copy A must be at most 500 characters' };
  }
  if (f.supportingCopyB && typeof f.supportingCopyB === 'string' && f.supportingCopyB.length > 500) {
    return { valid: false, error: 'Supporting copy B must be at most 500 characters' };
  }
  if (f.approachLabelA && typeof f.approachLabelA === 'string' && f.approachLabelA.length > 50) {
    return { valid: false, error: 'Approach label A must be at most 50 characters' };
  }
  if (f.approachLabelB && typeof f.approachLabelB === 'string' && f.approachLabelB.length > 50) {
    return { valid: false, error: 'Approach label B must be at most 50 characters' };
  }
  if (f.name && typeof f.name === 'string' && f.name.length > 100) {
    return { valid: false, error: 'Name must be at most 100 characters' };
  }

  return {
    valid: true,
    data: {
      productName: (f.productName as string).trim(),
      productDescription: (f.productDescription as string).trim(),
      productCategory: f.productCategory as string,
      targetAudience: (f.targetAudience as string).trim(),
      companySize: f.companySize as string,
      competitors: (f.competitors as string).trim(),
      pricingModel: ((f.pricingModel as string) || '').trim() || undefined,
      headlineA: (f.headlineA as string).trim(),
      supportingCopyA: ((f.supportingCopyA as string) || '').trim() || undefined,
      approachLabelA: ((f.approachLabelA as string) || '').trim() || undefined,
      headlineB: (f.headlineB as string).trim(),
      supportingCopyB: ((f.supportingCopyB as string) || '').trim() || undefined,
      approachLabelB: ((f.approachLabelB as string) || '').trim() || undefined,
      email: (f.email as string).trim().toLowerCase(),
      name: ((f.name as string) || '').trim() || undefined,
    },
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = validateInput(body);

    if (!result.valid) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    const jobId = nanoid(12);
    const now = new Date();

    await db.insert(jobs).values({
      id: jobId,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      email: result.data.email,
      name: result.data.name ?? null,
      formInput: result.data,
      currentStage: null,
    });

    // Enqueue to BullMQ — non-blocking, job is already persisted in DB
    try {
      await enqueueJob(jobId);
    } catch (queueErr) {
      console.warn('Failed to enqueue job (Redis may be down):', queueErr);
      // Job is in DB with status 'queued' — worker can pick it up later
    }

    return NextResponse.json({ jobId });
  } catch (err) {
    console.error('Submit error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
