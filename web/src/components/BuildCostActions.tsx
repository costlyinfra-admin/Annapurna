/**
 * Build-cost data actions: every way to get per-developer coding-tool spend in.
 *
 * Precision ladder (most precise first): Copilot seats API (exact roster x
 * price), Cursor Admin API (actual usage dollars), SSO seats via Okta/Entra
 * (seats x price book), CSV import (universal fallback) — plus one-time
 * fine-tune/training cost. Shared by the dashboard's "Add cost data" panel and
 * the onboarding "Build cost sources" step.
 */
import { useEffect, useState } from "react";
import { api, ApiError, type SeatSource } from "../api";
import { money } from "../format";

export interface FeatureOption {
  feature_id: string;
  name: string;
}

export function BuildCostActions({
  period,
  features,
  onChanged,
}: {
  period?: string;
  features: FeatureOption[];
  onChanged: () => Promise<void>;
}) {
  const [csv, setCsv] = useState("");
  const [tool, setTool] = useState("cursor");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [copilotOwner, setCopilotOwner] = useState("");
  const [cursorKey, setCursorKey] = useState("");
  const [idp, setIdp] = useState("okta");
  const [oktaDomain, setOktaDomain] = useState("");
  const [oktaToken, setOktaToken] = useState("");
  const [entraTenant, setEntraTenant] = useState("");
  const [entraClientId, setEntraClientId] = useState("");
  const [entraSecret, setEntraSecret] = useState("");
  const [seatAppId, setSeatAppId] = useState("");
  const [seatTool, setSeatTool] = useState("cursor");
  const [seatPlan, setSeatPlan] = useState("business");
  const [seatSources, setSeatSources] = useState<SeatSource[]>([]);
  const [ftFeature, setFtFeature] = useState("");
  const [ftAmount, setFtAmount] = useState("");
  const [ftLabel, setFtLabel] = useState("");
  const monthParam = period?.slice(0, 7);

  useEffect(() => {
    api
      .listSeatSources()
      .then(setSeatSources)
      .catch(() => undefined);
  }, []);

  async function syncCopilot() {
    if (!copilotOwner.trim()) {
      setNote("Enter the GitHub organization to sync Copilot seats.");
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const r = await api.syncCopilotSeats(copilotOwner.trim(), monthParam);
      setNote(
        `Synced ${r.seats} Copilot ${r.plan} seats (${money(r.seat_price)}/seat) → ${money(r.total)} build cost.`,
      );
      await onChanged();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Copilot sync failed.");
    } finally {
      setBusy(false);
    }
  }

  async function syncCursor() {
    setBusy(true);
    setNote(null);
    try {
      if (cursorKey.trim()) {
        // A freshly-entered admin key replaces the stored credential first.
        await api.saveCredential("cursor", cursorKey.trim());
        setCursorKey("");
      }
      const r = await api.syncCursorSpend(monthParam);
      setNote(
        `Synced Cursor spend: ${r.spending_members} of ${r.members} members with usage → ${money(r.total)} build cost.`,
      );
      await onChanged();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Cursor sync failed.");
    } finally {
      setBusy(false);
    }
  }

  async function connectIdp() {
    let secret: string;
    if (idp === "okta") {
      if (!oktaDomain.trim() || !oktaToken.trim()) {
        setNote("Enter the Okta domain and an API token.");
        return;
      }
      secret = JSON.stringify({ domain: oktaDomain.trim(), token: oktaToken.trim() });
    } else {
      if (!entraTenant.trim() || !entraClientId.trim() || !entraSecret.trim()) {
        setNote("Enter the Entra tenant id, client id, and client secret.");
        return;
      }
      secret = JSON.stringify({
        tenant_id: entraTenant.trim(),
        client_id: entraClientId.trim(),
        client_secret: entraSecret.trim(),
      });
    }
    setBusy(true);
    setNote(null);
    try {
      await api.saveCredential(idp, secret);
      setOktaToken("");
      setEntraSecret("");
      setNote(`Connected ${idp}. Add app→tool mappings below, then sync.`);
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Could not connect identity provider.");
    } finally {
      setBusy(false);
    }
  }

  async function addSeatSource() {
    if (!seatAppId.trim()) {
      setNote("Enter the IdP application id to map.");
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      await api.registerSeatSource(idp, seatAppId.trim(), seatTool, seatTool, seatPlan.trim());
      setSeatAppId("");
      setSeatSources(await api.listSeatSources());
      setNote("Added seat mapping.");
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Could not add mapping.");
    } finally {
      setBusy(false);
    }
  }

  async function syncSeats() {
    setBusy(true);
    setNote(null);
    try {
      const r = await api.syncIdpSeats(monthParam);
      setNote(`Synced ${r.total_seats} SSO seats → ${money(r.total)} build cost.`);
      await onChanged();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Seat sync failed.");
    } finally {
      setBusy(false);
    }
  }

  async function importBuild() {
    setBusy(true);
    setNote(null);
    try {
      const r = await api.importBuildCost(csv, tool, monthParam);
      setCsv("");
      setNote(`Imported build cost (total ${r.total}).`);
      await onChanged();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  async function recordTraining() {
    const amount = parseFloat(ftAmount);
    if (!ftFeature || !ftLabel.trim() || Number.isNaN(amount)) {
      setNote("Pick a feature, and enter a run label and amount.");
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      await api.recordTrainingCost(ftFeature, amount, ftLabel.trim(), monthParam);
      setFtAmount("");
      setFtLabel("");
      setNote("Recorded fine-tuning run as build cost.");
      await onChanged();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Could not record training cost.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="data-action">
        <label>Sync GitHub Copilot seats (build cost — no CSV)</label>
        <span className="inline">
          <input
            placeholder="GitHub organization"
            value={copilotOwner}
            onChange={(e) => setCopilotOwner(e.target.value)}
          />
          <button onClick={syncCopilot} disabled={busy || !copilotOwner.trim()}>
            Sync seats
          </button>
        </span>
        <span className="muted">
          Pulls per-developer seat assignments from GitHub and allocates them to features
          automatically. Needs a token with Copilot billing admin access.
        </span>
      </div>
      <div className="data-action">
        <label>Sync Cursor spend (admin API — actual usage dollars)</label>
        <span className="inline">
          <input
            placeholder="Admin API key (kept from last sync if blank)"
            type="password"
            value={cursorKey}
            onChange={(e) => setCursorKey(e.target.value)}
          />
          <button onClick={syncCursor} disabled={busy}>
            Sync spend
          </button>
        </span>
        <span className="muted">
          Pulls each member's actual metered spend from Cursor's Admin API — more precise than the
          SSO seat estimate below, and replaces it for the period.
        </span>
      </div>
      <div className="data-action">
        <label>SSO seats (Cursor, Tabnine, Amazon Q, Gemini Code Assist…)</label>
        <span className="inline">
          <select value={idp} onChange={(e) => setIdp(e.target.value)}>
            <option value="okta">Okta</option>
            <option value="entra">Microsoft Entra ID</option>
          </select>
          {idp === "okta" ? (
            <>
              <input
                placeholder="Okta domain (acme.okta.com)"
                value={oktaDomain}
                onChange={(e) => setOktaDomain(e.target.value)}
              />
              <input
                placeholder="API token"
                type="password"
                value={oktaToken}
                onChange={(e) => setOktaToken(e.target.value)}
              />
            </>
          ) : (
            <>
              <input
                placeholder="Tenant id"
                value={entraTenant}
                onChange={(e) => setEntraTenant(e.target.value)}
              />
              <input
                placeholder="Client id"
                value={entraClientId}
                onChange={(e) => setEntraClientId(e.target.value)}
              />
              <input
                placeholder="Client secret"
                type="password"
                value={entraSecret}
                onChange={(e) => setEntraSecret(e.target.value)}
              />
            </>
          )}
          <button onClick={connectIdp} disabled={busy}>
            Connect
          </button>
        </span>
        <span className="inline">
          <input
            placeholder={idp === "okta" ? "Okta app id" : "Entra app (service principal) id"}
            value={seatAppId}
            onChange={(e) => setSeatAppId(e.target.value)}
          />
          <select value={seatTool} onChange={(e) => setSeatTool(e.target.value)}>
            <option value="cursor">Cursor</option>
            <option value="tabnine">Tabnine</option>
            <option value="amazon_q">Amazon Q</option>
            <option value="gemini_code_assist">Gemini Code Assist</option>
          </select>
          <input
            placeholder="plan"
            value={seatPlan}
            onChange={(e) => setSeatPlan(e.target.value)}
          />
          <button onClick={addSeatSource} disabled={busy}>
            Add mapping
          </button>
        </span>
        {seatSources.length > 0 && (
          <span className="inline pools-line">
            <span className="muted">
              {seatSources
                .map((s) => `${s.provider}: ${s.app_label || s.app_id} → ${s.tool}/${s.plan}`)
                .join("  ")}
            </span>
            <button onClick={syncSeats} disabled={busy}>
              Sync seats
            </button>
          </span>
        )}
      </div>
      <div className="data-action">
        <label>Import build cost (CSV: developer,tool,amount) — fallback</label>
        <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={3} />
        <span className="inline">
          <select value={tool} onChange={(e) => setTool(e.target.value)}>
            <option value="cursor">Cursor</option>
            <option value="claude_code">Claude Code</option>
            <option value="copilot">Copilot</option>
            <option value="codex">Codex</option>
          </select>
          <button onClick={importBuild} disabled={busy || !csv.trim()}>
            Import
          </button>
        </span>
      </div>
      <div className="data-action">
        <label>Fine-tune / training cost (one-time, counts as build)</label>
        <span className="inline">
          <select value={ftFeature} onChange={(e) => setFtFeature(e.target.value)}>
            <option value="">Select feature…</option>
            {features.map((f) => (
              <option key={f.feature_id} value={f.feature_id}>
                {f.name}
              </option>
            ))}
          </select>
          <input
            placeholder="Run label (e.g. Llama-3.1-70B tuning)"
            value={ftLabel}
            onChange={(e) => setFtLabel(e.target.value)}
          />
          <input
            placeholder="$ amount"
            inputMode="decimal"
            value={ftAmount}
            onChange={(e) => setFtAmount(e.target.value)}
          />
          <button onClick={recordTraining} disabled={busy}>
            Add training cost
          </button>
        </span>
      </div>
      {note && <p className="muted">{note}</p>}
    </>
  );
}
