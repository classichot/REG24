"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Reg24LandingPage } from "@/components/Reg24LandingPage";

export default function LandingRoutePage() {
  const router = useRouter();
  return (
    <Reg24LandingPage
      defaultLang="en"
      defaultVariant="v3-paper"
      onOpenWorkspace={() => {
        router.push("/");
      }}
    />
  );
}
