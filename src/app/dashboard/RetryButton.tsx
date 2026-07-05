"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RetryButton({ actionId }: { actionId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function retry() {
    setLoading(true);
    try {
      await fetch("/api/actions/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: actionId }),
      });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button className="secondary" onClick={retry} disabled={loading}>
      {loading ? "Retrying…" : "Retry"}
    </button>
  );
}
