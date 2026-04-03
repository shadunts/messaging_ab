export const dynamic = 'force-dynamic';

import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { jobs } from '@/lib/schema';
import StatusTracker from '@/components/StatusTracker';

export default async function StatusPage({
  params,
}: {
  params: { jobId: string };
}) {
  const { jobId } = params;

  const job = await db.query.jobs.findFirst({
    where: eq(jobs.id, jobId),
    columns: { email: true },
  });

  if (!job) notFound();

  return (
    <>
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-[#131314] flex justify-between items-center w-full px-6 h-14">
        <div className="text-lg font-bold tracking-tighter text-primary">
          Messaging A/B
        </div>
        <div className="flex items-center gap-4">
          <button className="hover:bg-surface-container transition-colors duration-200 p-2 rounded-lg flex items-center justify-center">
            <span className="material-symbols-outlined text-on-surface-variant text-sm">
              help
            </span>
          </button>
        </div>
      </header>

      <main className="pt-24 pb-20 px-6 max-w-[600px] mx-auto flex flex-col items-center">
        <StatusTracker jobId={jobId} email={job.email} />
      </main>

      {/* Footer */}
      <footer className="border-t border-outline-variant/15 bg-[#131314] py-8 w-full mt-12">
        <div className="flex flex-col md:flex-row justify-between items-center px-12 max-w-7xl mx-auto w-full mono-label text-[10px] uppercase tracking-widest">
          <div className="text-on-surface-variant mb-4 md:mb-0">
            Built by{' '}
            <a
              href="https://www.linkedin.com/in/hayk-kocharyan/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Hayk Kocharyan
            </a>
          </div>
          <a
            href="https://github.com/666ghj/MiroFish"
            target="_blank"
            rel="noopener noreferrer"
            className="text-on-surface-variant hover:text-primary transition-all"
          >
            Powered by MiroFish
          </a>
        </div>
      </footer>

      {/* Ambient gradient decoration */}
      <div className="fixed top-0 right-0 w-[400px] h-full overflow-hidden pointer-events-none opacity-20 -z-10">
        <div className="absolute top-[20%] right-[-100px] w-full h-[600px] bg-gradient-to-br from-primary/10 via-transparent to-transparent blur-[120px]" />
        <div className="absolute bottom-[10%] right-[-100px] w-full h-[600px] bg-gradient-to-tr from-secondary/5 via-transparent to-transparent blur-[120px]" />
      </div>
    </>
  );
}
