/**
 * Onboarding wizard shell — four purpose-driven steps that mirror the product's
 * mental model: ① identify features (the spine, via GitHub + discovery),
 * ② build cost sources, ③ inference cost sources, ④ confirm & go live.
 * Every step is skippable; sources can always be added later from the dashboard.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { DEMO_EMAIL } from "../demo";
import { BuildStep } from "./onboarding/BuildStep";
import { ConfirmStep } from "./onboarding/ConfirmStep";
import { FeaturesStep } from "./onboarding/FeaturesStep";
import { InferenceStep } from "./onboarding/InferenceStep";

const STEPS = [
  "Identify features",
  "Build cost sources",
  "Inference cost sources",
  "Confirm & go live",
];

export function Onboarding() {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const isDemo = user?.email === DEMO_EMAIL;

  return (
    <div className="wizard">
      <header className="wizard-header">
        <span className="brand">Annapurna</span>
        <button className="link" onClick={() => logout().then(() => navigate("/login"))}>
          Sign out
        </button>
      </header>

      {isDemo && (
        <div className="demo-banner" role="status">
          <span>
            👋 You're viewing the <strong>demo</strong>. You don't need to connect sources or review
            features — the data is already loaded.
          </span>
          <button onClick={() => navigate("/dashboard")}>Skip to the demo dashboard →</button>
        </div>
      )}

      <ol className="stepper">
        {STEPS.map((label, i) => (
          <li
            key={label}
            className={i === step ? "active" : i < step ? "done" : ""}
            aria-current={i === step}
          >
            <span className="step-num">{i + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      <section className="wizard-body">
        {step === 0 && <FeaturesStep />}
        {step === 1 && <BuildStep />}
        {step === 2 && <InferenceStep />}
        {step === 3 && <ConfirmStep onFinish={() => navigate("/dashboard")} />}
      </section>

      <footer className="wizard-nav">
        <button
          className="secondary"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
        >
          Back
        </button>
        {step < STEPS.length - 1 ? (
          <button onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}>Next</button>
        ) : null}
      </footer>
    </div>
  );
}
