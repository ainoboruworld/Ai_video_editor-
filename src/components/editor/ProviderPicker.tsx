'use client';

import { useEditorStore } from '@/state/editorStore';
import { Select } from '@/components/ui';
import type { AiProviderName } from '@/types';

/**
 * Lets the user pick which AI provider handles a task.
 *
 * Providers differ in what they are good at and how much free allowance they
 * have, so the choice is worth exposing rather than burying in an env var:
 * a user can spend Groq's generous tier on the heavy jobs and keep a smaller
 * quota for something else.
 */
export function ProviderPicker({
  value,
  onChange,
  className,
}: {
  value: AiProviderName | 'auto';
  onChange: (value: AiProviderName | 'auto') => void;
  className?: string;
}) {
  const capabilities = useEditorStore((state) => state.capabilities);
  const catalog = capabilities?.ai.catalog ?? [];
  const configured = catalog.filter((entry) => entry.configured);

  // With one provider (or none) there is no choice to make.
  if (configured.length <= 1) return null;

  return (
    <Select
      value={value}
      onChange={(event) => onChange(event.target.value as AiProviderName | 'auto')}
      className={className}
      title="Which AI provider handles this"
    >
      <option value="auto">Auto ({capabilities?.ai.active})</option>
      {configured.map((entry) => (
        <option key={entry.name} value={entry.name}>
          {entry.label}
        </option>
      ))}
    </Select>
  );
}
