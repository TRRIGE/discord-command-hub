"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Polls the server component every `seconds` to keep the log "live". */
export default function AutoRefresh({ seconds = 5 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
