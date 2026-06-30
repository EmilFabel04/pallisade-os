import { signIn } from "@/auth";

export default function LoginPage() {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: "var(--color-canvas)" }}
    >
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/" });
        }}
        className="panel p-8 flex flex-col items-center gap-4 max-w-sm w-full"
      >
        <h1 className="text-[1.2rem] font-semibold text-[var(--color-ink)]">
          Pallisade OS
        </h1>
        <p className="text-[0.85rem] text-[var(--color-muted)] text-center">
          Private workspace — sign in to continue.
        </p>
        <button type="submit" className="btn btn-accent w-full justify-center">
          Sign in with Google
        </button>
      </form>
    </div>
  );
}
