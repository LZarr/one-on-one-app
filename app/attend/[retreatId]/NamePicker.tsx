"use client";
import { useState } from "react";

type Person = { id: string; name: string };

export default function NamePicker({
  people,
  action,
}: {
  people: Person[];
  action: (formData: FormData) => void;
}) {
  const [q, setQ] = useState("");
  const ql = q.toLowerCase();
  const filtered = people.filter((p) => p.name.toLowerCase().includes(ql));

  return (
    <div>
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search your name..."
        autoFocus
        className="w-full border border-stone-200 rounded-md px-3.5 py-2.5 text-sm bg-stone-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent-500/20 focus:border-accent-500 mb-3"
      />
      <div className="max-h-80 overflow-y-auto divide-y divide-stone-100 rounded-md border border-stone-200">
        {filtered.map((p) => (
          <form key={p.id} action={action}>
            <input type="hidden" name="userId" value={p.id} />
            <button
              type="submit"
              className="w-full text-left px-3.5 py-2.5 text-sm font-medium text-stone-800 hover:bg-accent-50 hover:text-accent-700"
            >
              {p.name}
            </button>
          </form>
        ))}
        {filtered.length === 0 && (
          <div className="px-3.5 py-4 text-sm text-stone-400 text-center">
            {people.length === 0 ? "No attendees have been added yet." : "No matching name."}
          </div>
        )}
      </div>
    </div>
  );
}
