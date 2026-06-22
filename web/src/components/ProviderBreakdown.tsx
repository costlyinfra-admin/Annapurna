/**
 * Overview "By provider" tab — tenant-wide inference (run) spend grouped by
 * provider, with a trend over a selectable window. Run cost only; build cost is
 * tracked separately and never blended in (invariant 2).
 */
import { useEffect, useState } from "react";
import { api, type ProviderSpend } from "../api";
import { money } from "../format";
import { TrendChart } from "./TrendChart";

const WINDOWS = ["month", "quarter", "year"] as const;
type Window = (typeof WINDOWS)[number];

export function ProviderBreakdown() {
  const [window, setWindow] = useState<Window>("month");
  const [data, setData] = useState<ProviderSpend | null>(null);

  useEffect(() => {
    let active = true;
    api
      .providerSpend(window)
      .then((d) => active && setData(d))
      .catch(() => active && setData({ window, total: 0, by_provider: [], trend: [] }));
    return () => {
      active = false;
    };
  }, [window]);

  return (
    <section className="detail-section">
      <div className="section-head">
        <div>
          <h2>Inference spend by provider</h2>
          <span className="section-sub muted">
            Run cost only — build cost is tracked separately.
          </span>
        </div>
        <div className="window-filter" role="group" aria-label="Time window">
          {WINDOWS.map((w) => (
            <button key={w} className={w === window ? "active" : ""} onClick={() => setWindow(w)}>
              {w[0].toUpperCase() + w.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {data === null ? (
        <p className="muted">Loading…</p>
      ) : data.by_provider.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">No inference cost yet</p>
          <p className="muted">
            Connect a provider on Cost sources and run a sync to see spend here.
          </p>
        </div>
      ) : (
        <div className="inference-body">
          <div className="inference-col">
            <span className="chart-title">Trend</span>
            <TrendChart trend={data.trend} />
          </div>
          <div className="inference-col">
            <span className="chart-title">By provider · {money(data.total)} total</span>
            <ul className="provider-bars">
              {data.by_provider.map((p) => (
                <li key={p.provider} className="provider-bar-row">
                  <div className="provider-bar-head">
                    <span className="provider-bar-name">{p.provider}</span>
                    <span className="provider-bar-amt">
                      {money(p.amount)} · {p.pct.toFixed(0)}%
                    </span>
                  </div>
                  <div className="provider-bar-track">
                    <div
                      className="provider-bar-fill"
                      style={{ width: `${Math.max(2, p.pct)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
