/**
 * Overview "By developer" tab — build (make) cost attributed to each developer,
 * broken down by the coding tool they used, over the Overview's selected review
 * period. Build cost is the only cost tied to a person, so this view is build-only
 * (inference has no developer) — never blended (invariant 2). Rows with no
 * developer land in an Unattributed bucket so the parts reconcile to the total.
 */
import { useEffect, useState } from "react";
import { api, type ProviderSpend, type ReviewRange } from "../api";
import { money, prettyTool } from "../format";
import { SpendBars } from "./SpendBars";
import { TrendChart } from "./TrendChart";

export function DeveloperBreakdown({
  range,
  refreshKey = 0,
}: {
  range: ReviewRange;
  /** Bumped by the Overview's refresh control to re-pull this breakdown. */
  refreshKey?: number;
}) {
  const [data, setData] = useState<ProviderSpend | null>(null);

  useEffect(() => {
    let active = true;
    setData(null);
    api
      .providerSpend(range)
      .then((d) => active && setData(d))
      .catch(() => active && setData(null));
    return () => {
      active = false;
    };
  }, [range, refreshKey]);

  return (
    <>
      <div className="section-head breakdown-head">
        <div>
          <h2>Build cost by developer</h2>
          <span className="section-sub muted">
            Who spent what on AI coding tools — build (make) cost only, never blended with run cost.
          </span>
        </div>
      </div>

      {data === null ? (
        <p className="muted">Loading…</p>
      ) : data.build_by_developer.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">No build cost yet</p>
          <p className="muted">
            Import a coding-tool spend CSV or connect a seat source on Cost sources to see spend by
            developer.
          </p>
        </div>
      ) : (
        <section className="detail-section">
          <div className="inference-body">
            <div className="inference-col">
              <span className="chart-title">Trend</span>
              <TrendChart trend={data.build_trend} />
            </div>
            <div className="inference-col">
              <span className="chart-title">By developer · {money(data.build_total)} total</span>
              <SpendBars
                rows={data.build_by_developer.map((d) => ({
                  label: d.label,
                  amount: d.amount,
                  pct: d.pct,
                  models: d.by_tool.map((t) => ({
                    label: prettyTool(t.tool),
                    amount: t.amount,
                    pct: t.pct,
                  })),
                }))}
              />
            </div>
          </div>
        </section>
      )}
    </>
  );
}
