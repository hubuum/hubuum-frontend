"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type LogoutButtonProps = {
  className?: string;
  label?: string;
};

export function LogoutButton({ className, label = "Sign out" }: LogoutButtonProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function signOut() {
    setIsPending(true);

    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include"
      });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <button className={className ?? "ghost"} type="button" onClick={signOut} disabled={isPending}>
      {isPending ? "Signing out..." : label}
    </button>
  );
}
