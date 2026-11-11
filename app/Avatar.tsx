"use client";
import { useState } from "react";

const AVATAR_COLORS = [
  "bg-accent-500",
  "bg-emerald-600",
  "bg-amber-600",
  "bg-rose-600",
  "bg-stone-600",
  "bg-cyan-600",
  "bg-orange-600",
  "bg-violet-600",
];

function getAvatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function Avatar({
  name,
  userId,
  size = 36,
}: {
  name: string;
  userId?: string | null;
  size?: number;
}) {
  const [errored, setErrored] = useState(false);

  if (userId && !errored) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/users/${userId}/photo`}
        alt={name}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setErrored(true)}
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className={`rounded-full ${getAvatarColor(name)} flex items-center justify-center text-white font-bold shrink-0`}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {getInitials(name)}
    </div>
  );
}
