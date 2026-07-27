// Secure preview links — mint opaque, signed URLs from the server so shared
// links never expose raw ids/dates that could be altered to enumerate records.

type PreviewKind = 'task' | 'daily';

export async function getPreviewUrl(kind: PreviewKind, id?: string): Promise<string | null> {
    try {
        const res = await fetch('/api/preview/link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind, id }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return typeof data?.url === 'string' ? data.url : null;
    } catch {
        return null;
    }
}

/** Open a secure preview in a new tab (falls back to legacy URL if signing fails).
 *  Opens the tab synchronously to preserve the click gesture (avoids popup blockers),
 *  then redirects it once the signed URL is minted. */
export async function openPreview(kind: PreviewKind, opts: { id?: string; fallback: string }): Promise<void> {
    const win = window.open('', '_blank');
    const url = (await getPreviewUrl(kind, opts.id)) ?? opts.fallback;
    if (win) win.location.href = url;
    else window.open(url, '_blank'); // popup was blocked — retry directly
}
