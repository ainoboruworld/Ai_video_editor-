import { EditorShell } from '@/components/editor/EditorShell';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ prompt?: string; duration?: string }>;
}

export default async function ProjectPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { prompt, duration } = await searchParams;
  const parsedDuration = duration ? Number(duration) : undefined;

  return (
    <EditorShell
      projectId={id}
      initialPrompt={prompt}
      initialDuration={Number.isFinite(parsedDuration) ? parsedDuration : undefined}
    />
  );
}
