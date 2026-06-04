import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AuthForm } from "./AuthForm";

export function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();

  return (
    <AuthForm
      title="Create your account"
      submitLabel="Create account"
      onSubmit={async (email, password) => {
        await signup(email, password);
        navigate("/onboarding"); // new tenant -> straight into onboarding
      }}
      footer={{ prompt: "Already have an account?", linkLabel: "Sign in", to: "/login" }}
    />
  );
}
