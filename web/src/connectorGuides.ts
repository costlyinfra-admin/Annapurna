/**
 * Per-connector setup instructions, shown inside a connector's Connect panel.
 * Each guide tells the user exactly where to get the credential this connector
 * needs and what we do with it (always read-only). Keyed by connector `type`;
 * connectors without an entry fall back to the generic paste-token form.
 *
 * The credential each one expects mirrors what the backend client actually uses
 * (see backend/annapurna/providers.py) — admin/cost keys, not standard keys.
 */
export type ConnectorGuide = {
  /** One line on what we read and the read-only assurance. */
  blurb: string;
  /** Ordered, plain-language steps to obtain the credential. */
  steps: string[];
  /** Placeholder for the input (shows the expected shape, e.g. a key prefix). */
  placeholder: string;
  /** Render a textarea instead of a single-line input (for JSON blobs). */
  multiline?: boolean;
  /** Optional deep link to the provider's credential page. */
  docUrl?: string;
};

export const CONNECTOR_GUIDES: Record<string, ConnectorGuide> = {
  github: {
    blurb: "Read-only. We read merged pull requests to discover features.",
    steps: [
      "Sign in to GitHub and open Settings → Developer settings → Personal access tokens.",
      "Generate a token with read-only repo access (fine-grained: Contents + Pull requests, Read-only).",
      "A token is optional for public organizations and required for private repos.",
      "Paste the token below.",
    ],
    placeholder: "ghp_… (optional for public orgs)",
    docUrl: "https://github.com/settings/tokens",
  },
  anthropic: {
    blurb: "Read-only. We call the organization Cost & Usage report only.",
    steps: [
      "Sign in to the Anthropic Console (console.anthropic.com) as an organization admin.",
      "Open Settings → Admin keys and create an Admin API key (starts with sk-ant-admin…).",
      "An Admin key is required — standard API keys cannot read organization cost.",
      "Paste the key below.",
    ],
    placeholder: "sk-ant-admin-…",
    docUrl: "https://console.anthropic.com/settings/admin-keys",
  },
  openai: {
    blurb: "Read-only. We call the organization Costs API only.",
    steps: [
      "Sign in to the OpenAI platform (platform.openai.com) as an organization owner.",
      "Open Settings → Organization → Admin keys and create an Admin key (starts with sk-admin-…).",
      "The Costs API requires an Admin key, not a standard secret key.",
      "Paste the key below.",
    ],
    placeholder: "sk-admin-…",
    docUrl: "https://platform.openai.com/settings/organization/admin-keys",
  },
  google: {
    blurb: "Read-only. Gemini spend lives in Google Cloud Billing, grouped by project.",
    steps: [
      "Grant a service account (or your user) the “Billing Account Viewer” role.",
      "Generate an OAuth access token with the cloud-billing.readonly scope — e.g. run `gcloud auth print-access-token`.",
      "Tokens are short-lived; use a service account for ongoing sync.",
      "Paste the access token below.",
    ],
    placeholder: "OAuth access token (ya29.…)",
    docUrl: "https://cloud.google.com/billing/docs/how-to/get-cost-data",
  },
  openrouter: {
    blurb: "Read-only. We read your monthly activity and usage.",
    steps: [
      "Sign in at openrouter.ai and open Keys.",
      "Create an API key (starts with sk-or-…).",
      "Paste the key below.",
    ],
    placeholder: "sk-or-…",
    docUrl: "https://openrouter.ai/keys",
  },
  together: {
    blurb: "Read-only. We read your monthly usage.",
    steps: [
      "Sign in to the Together dashboard (api.together.ai) and open Settings → API Keys.",
      "Copy your API key.",
      "Paste the key below.",
    ],
    placeholder: "Together API key",
    docUrl: "https://api.together.ai/settings/api-keys",
  },
  fireworks: {
    blurb: "Read-only. We read your monthly usage.",
    steps: [
      "Sign in at fireworks.ai and open Account → API Keys.",
      "Create or copy an API key.",
      "Paste the key below.",
    ],
    placeholder: "Fireworks API key",
    docUrl: "https://fireworks.ai/account/api-keys",
  },
  bedrock: {
    blurb:
      "Read-only. We read AWS Cost Explorer, filter to Amazon Bedrock, and split spend by a cost-allocation tag.",
    steps: [
      "Create an IAM user or role with the ce:GetCostAndUsage permission and generate an access key.",
      "Tag your Bedrock usage with a cost-allocation tag (e.g. “feature”) per feature, and activate it under Billing → Cost allocation tags.",
      "Paste the credentials below as JSON (this connector takes JSON, not a plain token).",
    ],
    placeholder:
      '{"access_key_id":"AKIA…","secret_access_key":"…","region":"us-east-1","tag":"feature"}',
    multiline: true,
    docUrl: "https://docs.aws.amazon.com/cost-management/latest/userguide/ce-api.html",
  },
};
