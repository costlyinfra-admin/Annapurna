/**
 * Admin connectors — store connector configuration for a customer (encrypted at
 * rest via the existing utilities). Per-connector Test / Sync / Disconnect live on
 * the customer detail page, so this page is just the fast "add" path + an overview.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type AdminCustomer } from "../../api";

const ADDABLE = [
  { type: "anthropic", name: "Anthropic" },
  { type: "github", name: "GitHub" },
];

export function AdminConnectors() {
  const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const [tenant, setTenant] = useState("");
  const [type, setType] = useState("anthropic");
  const [secret, setSecret] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const load = () =>
    api.adminCustomers().then((rows) => {
      setCustomers(rows);
      setTenant((t) => t || rows[0]?.tenant_id || "");
    });
  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (!tenant || !secret.trim()) return;
    setSaving(true);
    setSaved(null);
    try {
      await api.adminSaveConnector(tenant, type, secret.trim(), label.trim() || undefined);
      setSecret("");
      setLabel("");
      setSaved("Connector saved (encrypted).");
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="content">
      <div className="dash-head">
        <h1>Connectors</h1>
      </div>
      <p className="muted">
        Store a connector for a customer. Test, sync and disconnect from the customer&apos;s detail
        page.
      </p>

      <section className="detail-section">
        <div className="section-head">
          <h2>Add connector</h2>
        </div>
        <div className="admin-add-connector">
          <select value={tenant} onChange={(e) => setTenant(e.target.value)} aria-label="Customer">
            {customers.map((c) => (
              <option key={c.tenant_id} value={c.tenant_id}>
                {c.company}
              </option>
            ))}
          </select>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            aria-label="Connector type"
          >
            {ADDABLE.map((c) => (
              <option key={c.type} value={c.type}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            type="password"
            placeholder="API key / token"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
          <input
            type="text"
            placeholder="Label (e.g. GitHub org)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button
            className="secondary"
            onClick={save}
            disabled={saving || !tenant || !secret.trim()}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
        {saved && <p className="section-sub opt-realized">{saved}</p>}
      </section>

      <section className="detail-section">
        <div className="section-head">
          <h2>Customer connectors</h2>
        </div>
        <table className="mini-table">
          <thead>
            <tr>
              <th>Company</th>
              <th>Connected providers</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.tenant_id}>
                <td>{c.company}</td>
                <td>{c.connected_providers.length ? c.connected_providers.join(", ") : "—"}</td>
                <td>
                  <Link to={`/admin/customers/${c.tenant_id}`} className="link">
                    Manage
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
