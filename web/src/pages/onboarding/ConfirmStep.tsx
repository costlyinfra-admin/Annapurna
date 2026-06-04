/** Wizard Step 3 — confirm the feature list and go live. */
import { useEffect, useState } from "react";
import { api, ApiError } from "../../api";

export function ConfirmStep({ onFinish }: { onFinish: () => void }) {
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listFeatures("proposed")
      .then((f) => setCount(f.length))
      .catch(() => setCount(0));
  }, []);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await api.confirmOnboarding();
      onFinish();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not confirm. Try again.");
      setBusy(false);
    }
  }

  return (
    <div>
      <h2>Confirm &amp; go live</h2>
      <div className="empty-state">
        <p className="empty-title">
          {count === null ? "…" : `${count} feature${count === 1 ? "" : "s"} ready to confirm`}
        </p>
        <p className="muted">
          Confirming creates your feature list. Build cost and inference cost will appear per
          feature — always separately, each with a confidence level and an evidence trail.
        </p>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button onClick={confirm} disabled={busy || count === 0}>
        {busy ? "Confirming…" : "Confirm & go live"}
      </button>
    </div>
  );
}
