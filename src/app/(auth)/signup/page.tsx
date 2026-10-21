import { AuthForm } from "@/components/auth-form";
import { signUp } from "@/app/actions/auth";

export default function SignupPage() {
  return (
    <AuthForm
      title="Create your workspace"
      action={signUp}
      submit="Create workspace"
      fields={[
        { name: "name", label: "Your name", autoComplete: "name" },
        { name: "email", label: "Work email", type: "email", autoComplete: "email" },
        { name: "password", label: "Password (10+ characters)", type: "password", autoComplete: "new-password" },
        { name: "organization", label: "Organization name" },
      ]}
      footer={{ text: "Already have an account?", href: "/login", link: "Sign in" }}
    />
  );
}
