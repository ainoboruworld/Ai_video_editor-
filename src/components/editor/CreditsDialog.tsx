'use client';

import { useMemo, useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { useEditorStore } from '@/state/editorStore';
import { Button, EmptyState, Modal } from '@/components/ui';

/**
 * Project credits. Every externally sourced asset keeps its provider, creator
 * and licence, and this dialog turns that into a copyable attribution block —
 * licensing information is surfaced, never hidden.
 */
export function CreditsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const assets = useEditorStore((state) => state.assets);
  const [copied, setCopied] = useState(false);

  const credited = useMemo(
    () => assets.filter((asset) => asset.credit && asset.credit.provider !== 'user'),
    [assets],
  );

  const text = useMemo(() => {
    if (credited.length === 0) return '';
    const lines = ['Media credits', ''];
    for (const asset of credited) {
      const credit = asset.credit!;
      lines.push(
        `${asset.kind === 'video' ? 'Video' : 'Image'}: ${credit.creator ?? 'Unknown'} — ${credit.providerLabel}${
          credit.sourceUrl ? ` (${credit.sourceUrl})` : ''
        }`,
      );
    }
    return lines.join('\n');
  }, [credited]);

  return (
    <Modal open={open} onClose={onClose} title="Project credits" description="Attribution for every stock asset in this project.">
      <div className="p-5">
        {credited.length === 0 ? (
          <EmptyState title="No third-party media yet" description="Stock clips you add will be credited here automatically." />
        ) : (
          <>
            <ul className="space-y-2">
              {credited.map((asset) => {
                const credit = asset.credit!;
                return (
                  <li key={asset.id} className="flex items-start gap-3 rounded-md border border-line bg-bg-2 p-2.5">
                    {asset.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={asset.thumbnailUrl} alt="" className="h-10 w-14 shrink-0 rounded object-cover" />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-ink-0">{credit.creator ?? asset.name}</p>
                      <p className="text-2xs text-ink-3">
                        {credit.providerLabel} · {credit.license}
                      </p>
                    </div>
                    {credit.sourceUrl ? (
                      <a
                        href={credit.sourceUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="shrink-0 text-ink-3 hover:text-ink-1"
                      >
                        <ExternalLink size={12} />
                      </a>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            <Button
              className="mt-4 w-full"
              icon={copied ? <Check size={13} /> : <Copy size={13} />}
              onClick={async () => {
                await navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              }}
            >
              {copied ? 'Copied' : 'Copy credits'}
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}
