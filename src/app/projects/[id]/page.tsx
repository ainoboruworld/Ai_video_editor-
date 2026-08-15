import { EditorShell } from '@/components/editor/EditorShell';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ProjectPage({ params }: PageProps) {
  const { id } = await params;
  return <EditorShell projectId={id} />;
}
