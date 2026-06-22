/**
 * Overview "By provider" tab — tenant-wide spend by source over a selectable
 * window, in two never-blended sections (invariant 2): inference (run) cost by
 * provider, and build cost by coding tool. Each has its own trend + ranked bars.
 */
import { useEffect, useState } from "react";
import { api, type ProviderSpend } from "../api";
import { money } from "../format";
import { TrendChart } from "./TrendChart";

const WINDOWS = ["month", "quarter", "year"] as const;
type Window = (typeof WINDOWS)[number];

const EMPTY: ProviderSpend = {
  window: "month",
  total: 0,
  by_provider: [],
  trend: [],
  build_total: 0,
  build_by_tool: [],
  build_trend: [],
};

/** "claude_code" -> "Claude Code". */
function prettyTool(tool: string): string {
  return tool
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

type Bar = { label: string; amount: number; pct: number };

function SpendBars({ rows }: { rows: Bar[] }) {
  return (
    <ul className="provider-bars">
      {rows.map((r) => (
        <li key={r.label} className="provider-bar-row">
          <div className="provider-bar-head">
            <span className="provider-bar-name">{r.label}</span>
            <span className="provider-bar-amt">
              {money(r.amount)} · {r.pct.toFixed(0)}%
            </span>
          </div>
          <div className="provider-bar-track">
            <div className="provider-bar-fill" style={{ width: `${Math.max(2, r.pct)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ProviderBreakdown() {
  const [window, setWindow] = useState<Window>("month");
  const [data, setData] = useState<ProviderSpend | null>(null);

  useEffect(() => {
    let active = true;
    api
      .providerSpend(window)
      .then((d) => active && setData(d))
      .catch(() => active && setData({ ...EMPTY, window }));
    return () => {
      active = false;
    };
  }, [window]);

  const nothing = data && data.by_provider.length === 0 && data.build_by_tool.length === 0;

  return (
    <section className="detail-section">
      <div className="section-head">
        <div>
          <h2>Spend by source</h2>
          <span className="section-sub muted">
            Inference (run) and build cost, shown separately — never blended.
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
      ) : nothing ? (
        <div className="empty-state">
          <p className="empty-title">No cost yet</p>
          <p className="muted">
            Connect sources on Cost sources and run a sync to see spend by provider and tool.
          </p>
        </div>
      ) : (
        <>
          <div className="provider-block">
            <h3 className="breakdown-subhead">Inference (run) cost by provider</h3>
            {data.by_provider.length === 0 ? (
              <p className="muted">No inference cost in this window.</p>
            ) : (
              <div className="inference-body">
                <div className="inference-col">
                  <span className="chart-title">Trend</span>
                  <TrendChart trend={data.trend} />
                </div>
                <div className="inference-col">
                  <span className="chart-title">By provider · {money(data.total)} total</span>
                  <SpendBars
                    rows={data.by_provider.map((p) => ({
                      label: p.provider,
                      amount: p.amount,
                      pct: p.pct,
                    }))}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="provider-block">
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
          </div>
        </>
      )}
    </section>
  );
}
