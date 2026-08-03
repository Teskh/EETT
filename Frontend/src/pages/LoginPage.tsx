import { FormEvent, useState } from "react";

import { toAppPath } from "../lib/basePath";

// Microsoft is the only sign-in method for regular users. The reserved
// sysadmin account retains a local-password escape hatch.
const PASSWORD_LOGIN_ENABLED = false;

const MICROSOFT_LOGIN_URL = "/api/auth/microsoft/login";

type LoginPageProps = {
  onLogin: (username: string, password: string) => Promise<void>;
  loading: boolean;
  error: string | null;
};

function readAuthErrorFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const value = params.get("auth_error");
  return value && value.trim() ? value : null;
}

export function LoginPage({ onLogin, loading, error }: LoginPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // The reserved "sysadmin" account is the sole exception to Microsoft-only login.
  const [adminMode, setAdminMode] = useState(false);
  const displayError = error ?? readAuthErrorFromUrl();
  const showCredentials = PASSWORD_LOGIN_ENABLED || adminMode;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onLogin(username, password);
  }

  function handleMicrosoftLogin() {
    window.location.href = toAppPath(MICROSOFT_LOGIN_URL);
  }

  function openAdminMode() {
    setAdminMode(true);
    setUsername((current) => current || "sysadmin");
  }

  return (
    <div className="min-h-[100dvh] bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 flex items-center justify-center px-6">
      <div className="ambient-glow" />
      <form className="liquid-glass w-full max-w-md rounded-3xl p-8 border border-black/10 dark:border-white/10 flex flex-col gap-5" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <p className="text-[11px] font-mono uppercase tracking-[0.25em] text-zinc-500">Acceso Interno</p>
          <h1 className="text-3xl font-bold tracking-tight">Ingreso a EETT</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Ingresa con tu cuenta Microsoft de Grupo Patagual.</p>
        </div>

        {showCredentials ? (
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
        ) : null}

        {displayError ? (
          <div className="rounded-xl border border-red-200 dark:border-red-500/20 bg-red-100 dark:bg-red-500/10 px-4 py-3 text-sm text-red-800 dark:text-red-200">{displayError}</div>
        ) : null}

        {showCredentials ? (
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-3 bg-accent-500 hover:bg-accent-400 disabled:opacity-60 text-zinc-950 border border-transparent rounded-xl text-sm font-bold transition-all"
          >
            {loading ? "Iniciando sesión..." : "Iniciar sesión"}
          </button>
        ) : null}

        <button
          type="button"
          disabled={loading}
          onClick={handleMicrosoftLogin}
          className={
            showCredentials
              ? "px-4 py-3 border border-black/10 dark:border-white/10 bg-white/70 dark:bg-white/5 hover:bg-white dark:hover:bg-white/10 disabled:opacity-60 text-zinc-800 dark:text-zinc-100 rounded-xl text-sm font-bold transition-all"
              : "px-4 py-3 bg-accent-500 hover:bg-accent-400 disabled:opacity-60 text-zinc-950 border border-transparent rounded-xl text-sm font-bold transition-all"
          }
        >
          Iniciar sesión con Microsoft
        </button>

        {!PASSWORD_LOGIN_ENABLED && !adminMode ? (
          <button
            type="button"
            onClick={openAdminMode}
            className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 underline underline-offset-4 transition-colors self-center"
          >
            Acceso administrador
          </button>
        ) : null}
      </form>
    </div>
  );
}
