import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AuthForm } from "./AuthForm";

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

  return (
    <AuthForm
      title="Sign in"
      submitLabel="Sign in"
      onSubmit={async (email, password) => {
        await login(email, password);
        navigate("/");
      }}
      footer={{ prompt: "New to Annapurna?", linkLabel: "Create an account", to: "/signup" }}
    />
  );
}
