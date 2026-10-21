import { AuthForm } from "@/components/auth-form";
import { signIn } from "@/app/actions/auth";

export default function LoginPage() {
  return (
    <AuthForm
      title="Sign in to OpsLens"
      action={signIn}
      submit="Sign in"
      fields={[
        { name: "email", label: "Email", type: "email", autoComplete: "email" },
        { name: "password", label: "Password", type: "password", autoComplete: "current-password" },
      ]}
      footer={{ text: "New here?", href: "/signup", link: "Create a workspace" }}
    />
  );
}
