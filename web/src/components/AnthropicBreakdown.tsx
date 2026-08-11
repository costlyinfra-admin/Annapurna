/**
 * Anthropic production-vs-unclassified breakdown, split by workspace + API key.
 *
 * Reads the reconciled cost rows (authoritative Cost Report dollars, labelled by
 * API-key environment) and shows what is production inference versus everything
 * else — never presenting unclassified spend as production. Purely read-only for
 * this milestone; manual re-classification comes later.
 */
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type AnthropicBreakdown as Breakdown } from "../api";
import { money } from "../format";

const ENV_LABEL: Record<string, string> = {
  production: "Production",
  development: "Development",
  internal: "Internal",
  unclassified: "Unclassified",
};

function envLabel(env: string): string {
  return ENV_LABEL[env] ?? env;
}

function envClass(env: string): string {
  return `env-badge env-${env}`;
}

export function AnthropicBreakdown({ version }: { version: number }) {
  const [data, setData] = useState<Breakdown | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.anthropicBreakdown());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load Anthropic breakdown.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, version]);

  if (error) {
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  }
  // Nothing ingested yet — stay quiet rather than showing an empty scaffold.
  if (!data || data.total <= 0) return null;

  const production = data.by_environment.production ?? 0;
  const other = data.total - production;

  return (
    <div className="anthropic-breakdown">
      <div className="env-summary">
        <div className="env-tile env-tile-prod">
          <span className="env-tile-label">Production inference</span>
          <span className="env-tile-amount">{money(production)}</span>
        </div>
        <div className="env-tile">
          <span className="env-tile-label">Other / unclassified Anthropic API</span>
          <span className="env-tile-amount">{money(other)}</span>
        </div>
        <div className="env-tile env-tile-total">
          <span className="env-tile-label">Total Anthropic API</span>
          <span className="env-tile-amount">{money(data.total)}</span>
        </div>
      </div>

      {data.by_workspace.length > 0 && (
        <div className="workspace-breakdown">
          <h4>By workspace</h4>
          <ul className="workspace-list">
            {data.by_workspace.map((ws) => (
              <li key={ws.workspace_id ?? "none"} className="workspace-row">
                <span className="workspace-name">
                  {ws.workspace_name ?? ws.workspace_id ?? "—"}
                </span>
                <span className="workspace-envs">
                  {Object.entries(ws.by_environment)
                    .sort((a, b) => b[1] - a[1])
                    .map(([env, amt]) => (
                      <span key={env} className="workspace-env">
                        <span className={envClass(env)}>{envLabel(env)}</span>
                        {money(amt)}
                      </span>
                    ))}
                </span>
                <span className="workspace-total">{money(ws.total)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="key-table-wrap">
        <h4>Workspaces &amp; API keys</h4>
        <table className="key-table">
          <thead>
            <tr>
              <th>Workspace</th>
              <th>API key</th>
              <th>Classification</th>
              <th className="num">Cost</th>
            </tr>
          </thead>
          <tbody>
            {data.keys.map((k, i) => (
              <tr key={`${k.workspace_id}-${k.api_key_id}-${i}`}>
                <td className="mono">{k.workspace_name ?? k.workspace_id ?? "—"}</td>
                <td className="mono">{k.api_key_name ?? "(no key detail)"}</td>
                <td>
                  <span className={envClass(k.environment)}>{envLabel(k.environment)}</span>
                </td>
                <td className="num">{money(k.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
