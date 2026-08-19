/**
 * Overview "By provider" tab — tenant-wide spend by source over the Overview's
 * selected review period, in two never-blended sections (invariant 2): inference
 * (run) cost by provider, and build cost by coding tool. Each has a trend + bars.
 */
import { useEffect, useState } from "react";
import { api, type ProviderSpend, type ReviewRange } from "../api";
import { money, prettyTool } from "../format";
import { ClassificationTrendChart } from "./ClassificationTrendChart";
import { SpendBars } from "./SpendBars";
import { TrendChart } from "./TrendChart";

const EMPTY: ProviderSpend = {
  start: "",
  end: "",
  total: 0,
  by_provider: [],
  trend: [],
  build_total: 0,
  build_by_tool: [],
  build_by_developer: [],
  build_trend: [],
  customer_total: 0,
  by_customer: [],
};

export function ProviderBreakdown({ range }: { range: ReviewRange }) {
  const [data, setData] = useState<ProviderSpend | null>(null);

  useEffect(() => {
    let active = true;
    setData(null);
    api
      .providerSpend(range)
      .then((d) => active && setData(d))
      .catch(() => active && setData(EMPTY));
    return () => {
      active = false;
    };
  }, [range]);

  const nothing = data && data.by_provider.length === 0 && data.build_by_tool.length === 0;

  return (
    <>
      <div className="section-head breakdown-head">
        <div>
          <h2>Spend by source</h2>
          <span className="section-sub muted">
            Inference (run) and build cost, shown separately — never blended.
          </span>
        </div>
      </div>

      {data === null ? (
        <p className="muted">Loading…</p>
      ) : nothing ? (
        <div className="empty-state">
          <p className="empty-title">No cost yet</p>
          <p className="muted">
            Connect sources on Cost sources and run a sync to see spend by provider and tool.
          </p>
        </div>
      ) : (
        <>
          <section className="detail-section">
            <h3 className="breakdown-subhead">Inference (run) cost by provider</h3>
            {data.by_provider.length === 0 ? (
              <p className="muted">No inference cost in this window.</p>
            ) : (
              <div className="inference-body">
                <div className="inference-col">
                  <span className="chart-title">Trend · by classification</span>
                  <ClassificationTrendChart trend={data.trend} />
                </div>
                <div className="inference-col">
                  <span className="chart-title">By provider · {money(data.total)} total</span>
                  <SpendBars
                    rows={data.by_provider.map((p) => ({
                      label: p.provider,
                      amount: p.amount,
                      pct: p.pct,
                      models: p.by_model.map((m) => ({
                        label: m.model,
                        amount: m.amount,
                        pct: m.pct,
                      })),
                    }))}
                  />
                </div>
              </div>
            )}
          </section>

          <section className="detail-section">
            <h3 className="breakdown-subhead">Build cost by tool</h3>
            {data.build_by_tool.length === 0 ? (
              <p className="muted">No build cost in this window.</p>
            ) : (
              <div className="inference-body">
                <div className="inference-col">
                  <span className="chart-title">Trend</span>
                  <TrendChart trend={data.build_trend} />
                </div>
                <div className="inference-col">
                  <span className="chart-title">By tool · {money(data.build_total)} total</span>
                  <SpendBars
                    rows={data.build_by_tool.map((t) => ({
                      label: prettyTool(t.tool),
                      amount: t.amount,
                      pct: t.pct,
                    }))}
                  />
                </div>
              </div>
            )}
          </section>

          {/* Only when the metering SDK has tagged customers (metadata.customer_id). */}
          {data.by_customer.length > 0 && (
            <section className="detail-section">
              <h3 className="breakdown-subhead">Inference cost by customer</h3>
              <p className="section-sub muted">
                From metered (SDK) calls tagged with a customer — your top spenders.
              </p>
              <SpendBars
                rows={data.by_customer.map((c) => ({
                  label: c.customer_id,
                  amount: c.amount,
                  pct: c.pct,
                }))}
              />
            </section>
          )}
        </>
      )}
    </>
  );
}
