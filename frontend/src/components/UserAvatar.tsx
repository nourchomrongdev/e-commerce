"use client";

import Image from "next/image";
import { useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

function avatarSource(value: string) {
  if (/^(https?:\/\/|data:|blob:)/i.test(value)) return value;
  const apiOrigin = new URL(apiUrl).origin;
  return new URL(value, `${apiOrigin}/`).toString();
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "U";
}

export default function UserAvatar({
  url,
  name,
  className = "h-9 w-9",
}: {
  url?: string | null;
  name: string;
  className?: string;
}) {
  const [failedSource, setFailedSource] = useState("");
  const source = url?.trim() || "";

  return (
    <span className={`relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-primary to-amber-500 font-bold text-white ${className}`}>
      <span aria-hidden="true">{initials(name)}</span>
      {source && failedSource !== source && (
        <Image
          src={avatarSource(source)}
          alt={`${name}'s profile photo`}
          fill
          unoptimized
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailedSource(source)}
        />
      )}
    </span>
  );
}
