import { useEffect, useState } from 'react'
import { resolveMedia } from './mediaStore'

/** Resolves a `media:<id>` marker (or legacy blob URL) to a loadable URL, reactively. */
export function useMediaUrl(src?: string | null): string {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let alive = true
    if (!src) { setUrl(''); return }
    if (src.startsWith('http') || src.startsWith('data:') || src.startsWith('./')) { setUrl(src); return }
    resolveMedia(src).then((u) => { if (alive) setUrl(u) })
    return () => { alive = false }
  }, [src])
  return url
}
