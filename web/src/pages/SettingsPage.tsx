/**
 * Settings — administrative organization settings only.
 *
 * Deliberately NOT a place to connect sources or manage app functionality:
 * providers live in Cost sources, feature discovery in Features, and the
 * signed-in identity / Sign out live in the global navigation. This page is just
 * the organization profile and privacy preferences, stored at the tenant level.
 */
import { useEffect, useState } from "react";
import { api, ApiError, type OrgSettings } from "../api";

const TIMEZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

const CUSTOMER_ID_OPTIONS: { value: OrgSettings["customer_id_storage"]; label: string }[] = [
  { value: "names", label: "Actual names" },
  { value: "aliases", label: "Aliases / anonymized" },
  { value: "hashed", label: "Hashed identifiers" },
];

const RETENTION_OPTIONS: { value: OrgSettings["data_retention"]; label: string }[] = [
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "1y", label: "1 year" },
  { value: "indefinite", label: "Keep indefinitely" },
];

export function SettingsPage() {
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orgSaved, setOrgSaved] = useState(false);
  const [privacySaved, setPrivacySaved] = useState(false);
  const [savingOrg, setSavingOrg] = useState(false);
  const [savingPrivacy, setSavingPrivacy] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then(setSettings)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load settings."));
  }, []);

  function patch(fields: Partial<OrgSettings>) {
    setSettings((s) => (s ? { ...s, ...fields } : s));
    setOrgSaved(false);
    setPrivacySaved(false);
  }

  async function save(
    fields: Partial<OrgSettings>,
    setSaving: (v: boolean) => void,
    setSaved: (v: boolean) => void,
  ) {
    setSaving(true);
    setError(null);
    try {
      setSettings(await api.updateSettings(fields));
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  if (error && !settings) {
    return (
      <div className="content">
        <div className="dash-head">
          <h1>Settings</h1>
        </div>
        <p className="error" role="alert">
          {error}
        </p>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="content">
        <div className="dash-head">
          <h1>Settings</h1>
        </div>
        <p className="muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="content settings-page">
      <div className="dash-head">
        <h1>Settings</h1>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section className="settings-card">
        <h2>Organization</h2>
        <div className="settings-field">
          <label htmlFor="org-name">Organization name</label>
          <input
            id="org-name"
            value={settings.org_name}
            onChange={(e) => patch({ org_name: e.target.value })}
          />
        </div>
        <div className="settings-field">
          <label htmlFor="org-tz">Time zone</label>
          <select
            id="org-tz"
            value={settings.timezone}
            onChange={(e) => patch({ timezone: e.target.value })}
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>
        <div className="settings-field">
          <label htmlFor="org-currency">Default currency</label>
          <select
            id="org-currency"
            value={settings.currency}
            onChange={(e) => patch({ currency: e.target.value })}
          >
            <option value="USD">USD</option>
          </select>
        </div>
        <div className="settings-actions">
          <button
            onClick={() =>
              save(
                {
                  org_name: settings.org_name,
                  timezone: settings.timezone,
                  currency: settings.currency,
                },
                setSavingOrg,
                setOrgSaved,
              )
            }
            disabled={savingOrg || !settings.org_name.trim()}
          >
            {savingOrg ? "Saving…" : "Save changes"}
          </button>
          {orgSaved && <span className="settings-saved">Saved ✓</span>}
        </div>
      </section>

      <section className="settings-card">
        <h2>Privacy &amp; data</h2>
        <p className="muted">Control what Annapurna stores about your traffic and customers.</p>
        <div className="settings-field">
          <label htmlFor="cust-id">Customer identifiers</label>
          <select
            id="cust-id"
            value={settings.customer_id_storage}
            onChange={(e) =>
              patch({ customer_id_storage: e.target.value as OrgSettings["customer_id_storage"] })
            }
          >
            {CUSTOMER_ID_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="settings-hint muted">
            How customer identifiers are stored once customer-level attribution ships.
          </span>
        </div>
        <div className="settings-field settings-field-inline">
          <label htmlFor="store-prompts">Store prompt content</label>
          <label className="toggle">
            <input
              id="store-prompts"
              type="checkbox"
              checked={settings.store_prompts}
              onChange={(e) => patch({ store_prompts: e.target.checked })}
            />
            <span>{settings.store_prompts ? "On" : "Off"}</span>
          </label>
          <span className="settings-hint muted">
            Annapurna stores no prompt text today; leaving this off keeps it that way.
          </span>
        </div>
        <div className="settings-field">
          <label htmlFor="retention">Data retention</label>
          <select
            id="retention"
            value={settings.data_retention}
            onChange={(e) =>
              patch({ data_retention: e.target.value as OrgSettings["data_retention"] })
            }
          >
            {RETENTION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="settings-actions">
          <button
            onClick={() =>
              save(
                {
                  customer_id_storage: settings.customer_id_storage,
                  store_prompts: settings.store_prompts,
                  data_retention: settings.data_retention,
                },
                setSavingPrivacy,
                setPrivacySaved,
              )
            }
            disabled={savingPrivacy}
          >
            {savingPrivacy ? "Saving…" : "Save changes"}
          </button>
          {privacySaved && <span className="settings-saved">Saved ✓</span>}
        </div>
      </section>
    </div>
  );
}
