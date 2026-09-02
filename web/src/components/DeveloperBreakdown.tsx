/**
 * Overview "By Developer" tab — build (make) cost attributed to each developer,
 * broken down by the coding tool they used, over the Overview's selected review
 * period. Build cost is the only cost tied to a person, so this view is build-only
 * (inference has no developer) — never blended (invariant 2). Rows with no
 * developer land in an Unattributed bucket so the parts reconcile to the total.
 */
import { useEffect, useState } from "react";
import { api, type ProviderSpend, type ReviewRange } from "../api";
import { compact, money, num, prettyTool, unitMoney } from "../format";
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

      {data && data.developer_activity.length > 0 && (
        <section className="detail-section">
          <h3 className="breakdown-subhead">Engineering activity</h3>
          <p className="section-sub muted">
            What each developer shipped over the same period, from the merged-PR evidence behind
            every build-cost attribution. This is <strong>activity, not performance</strong> — it
            counts what was shipped, not how hard or how valuable it was, and a large PR is not a
            better one. Read it next to the spend above, never as a ranking of people.
          </p>
          <table className="features-table">
            <thead>
              <tr>
                <th>Developer</th>
                <th className="num">PRs</th>
                <th className="num">Features</th>
                <th className="num">Commits</th>
                <th className="num">Files</th>
                <th className="num">Lines</th>
                <th className="num">Build cost</th>
                <th className="num">Cost / PR</th>
              </tr>
            </thead>
            <tbody>
              {data.developer_activity.map((d) => (
                <tr key={d.handle}>
                  <td>{d.label}</td>
                  <td className="num">{num(d.prs)}</td>
                  <td className="num" title="Distinct features their merged PRs touched">
                    {num(d.features)}
                  </td>
                  <td className="num">{num(d.commits)}</td>
                  <td className="num">{num(d.files_changed)}</td>
                  <td className="num">
                    <LineCounts added={d.additions} removed={d.deletions} />
                  </td>
                  <td className="num">{money(d.build_cost)}</td>
                  <td className="num" title="AI coding-tool spend divided by PRs merged">
                    {unitMoney(d.cost_per_pr)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

/** Lines added / removed. Unknown for PRs discovered before line counts were
 *  recorded — shown as an em dash rather than as a misleading zero. */
function LineCounts({ added, removed }: { added: number | null; removed: number | null }) {
  if (added === null && removed === null) return <>—</>;
  return (
    <span title={`${num(added)} added, ${num(removed)} removed`}>
      +{compact(added)} <span className="muted">/</span> −{compact(removed)}
    </span>
  );
}
