import { Suspense } from "react";
import LoginForm from "./LoginForm";
import HostCTA from "../HostCTA";

export default function LoginPage() {
  return (
    <div className="min-h-dvh flex flex-col bg-stone-50 text-stone-900">
      <main className="flex-1 flex flex-col items-center justify-center focus-within:justify-start px-6 py-16 focus-within:pt-16 sm:focus-within:pt-24">
        <Suspense>
          <LoginForm />
        </Suspense>
        <HostCTA />
      </main>
    </div>
  );
}
