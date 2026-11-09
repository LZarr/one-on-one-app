"use client";
import { useState } from "react";
import ProfileFieldsFieldset from "../../../ProfileFieldsFieldset";
import SubmitButton from "../../SubmitButton";

type Defaults = {
  name: string;
  pronouns?: string | null;
  school?: string | null;
  bio?: string | null;
  canHelpWith?: string | null;
  canBeHelpedWith?: string | null;
  keyCrux?: string | null;
  personalLink?: string | null;
};

export default function EditAttendeeButton({
  action,
  defaults,
}: {
  action: (formData: FormData) => void;
  defaults: Defaults;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-stone-500 font-medium border border-stone-200 rounded-md px-2 py-1 hover:bg-stone-50"
      >
        Edit
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-lg border border-stone-200 shadow-lg w-full max-w-md mx-4 max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-stone-100 flex items-center justify-between">
              <h3 className="text-base font-bold text-stone-900">Edit profile</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-stone-400 hover:text-stone-700 text-2xl leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-stone-100"
                aria-label="Close"
              >
                &times;
              </button>
            </div>
            <form action={action} className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-stone-700 mb-1.5">Name</label>
                <input
                  name="name"
                  defaultValue={defaults.name}
                  required
                  className="w-full border border-stone-200 rounded-md px-3.5 py-2.5 text-sm bg-stone-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent-500/20 focus:border-accent-500"
                />
              </div>
              <ProfileFieldsFieldset defaults={defaults} />
              <div className="flex gap-2.5 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="px-4 py-2 text-sm font-medium border border-stone-200 rounded-md hover:bg-stone-50 text-stone-600"
                >
                  Cancel
                </button>
                <SubmitButton
                  className="bg-accent-500 text-white rounded-md px-4 py-2 text-sm font-semibold hover:bg-accent-600 disabled:opacity-60"
                  pendingChildren="Saving…"
                >
                  Save
                </SubmitButton>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
