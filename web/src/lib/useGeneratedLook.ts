/** React side of lib/generatedLook: the case's generated portrait for a case thread. */

import { useEffect, useState } from "react";
import { EMPTY_LOOK, subscribeGeneratedLook, type GeneratedLook } from "@/lib/generatedLook";
import { voiceApi } from "@/lib/voiceApi";

/** The generated look for `photoId` in the case thread `threadId` (EMPTY_LOOK without a thread). */
export function useGeneratedLook(photoId: string, threadId: string | null | undefined): GeneratedLook {
  const [look, setLook] = useState<GeneratedLook>(EMPTY_LOOK);
  useEffect(() => {
    if (!threadId || !photoId) return;
    const stop = subscribeGeneratedLook(threadId, photoId, setLook, { api: voiceApi });
    return () => {
      stop();
      setLook(EMPTY_LOOK);
    };
  }, [threadId, photoId]);
  return threadId ? look : EMPTY_LOOK;
}
