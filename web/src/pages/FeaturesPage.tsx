/** Features — connect GitHub, discover from PRs, and curate the feature list. */
import { FeaturesStep } from "./onboarding/FeaturesStep";

export function FeaturesPage() {
  return (
    <div className="content">
      <div className="dash-head">
        <h1>Features</h1>
      </div>
      <FeaturesStep />
    </div>
  );
}
