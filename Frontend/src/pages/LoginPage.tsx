import { FormEvent, useState } from "react";

type LoginPageProps = {
  onLogin: (username: string, password: string) => Promise<void>;
  loading: boolean;
  error: string | null;
};

export function LoginPage({ onLogin, loading, error }: LoginPageProps) {
  const [username, setUsername] = useState("sysadmin");
  const [password, setPassword] = useState("adminpass");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onLogin(username, password);
  }

  return (
    <div className="min-h-[100dvh] bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 flex items-center justify-center px-6">
      <div className="ambient-glow" />
      <form className="liquid-glass w-full max-w-md rounded-3xl p-8 border border-black/10 dark:border-white/10 flex flex-col gap-5" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <p className="text-[11px] font-mono uppercase tracking-[0.25em] text-zinc-500">Acceso Interno</p>
          <h1 className="text-3xl font-bold tracking-tight">Ingreso a Spec Sheets</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            La autenticación interna mínima está habilitada. La cuenta inicial cargada es <span className="font-mono">sysadmin</span> con contraseña{" "}
            <span className="font-mono">adminpass</span>.
          </p>
        </div>

        <div className="space-y-3">
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            placeholder="Usuario"
            className="w-full bg-black/5 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-xl p-3 text-sm focus:outline-none focus:border-accent-500/50 transition-colors"
          />
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            placeholder="Contraseña"
            className="w-full bg-black/5 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-xl p-3 text-sm focus:outline-none focus:border-accent-500/50 transition-colors"
          />
        </div>

        {error ? (
          <div className="rounded-xl border border-red-200 dark:border-red-500/20 bg-red-100 dark:bg-red-500/10 px-4 py-3 text-sm text-red-800 dark:text-red-200">{error}</div>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className="px-4 py-3 bg-accent-500 hover:bg-accent-400 disabled:opacity-60 text-zinc-950 border border-transparent rounded-xl text-sm font-bold transition-all"
        >
          {loading ? "Iniciando sesión..." : "Iniciar sesión"}
        </button>
      </form>
    </div>
  );
}
