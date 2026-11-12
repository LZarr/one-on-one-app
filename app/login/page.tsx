import { Suspense } from "react";
import LoginForm from "./LoginForm";
import HostCTA from "../HostCTA";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex flex-col bg-stone-50 text-stone-900">
      <main className="flex-1 flex flex-col items-center px-6 pt-10 pb-16 sm:pt-20">
        <Suspense>
          <LoginForm />
        </Suspense>
        <HostCTA />
      </main>
    </div>
  );
}
