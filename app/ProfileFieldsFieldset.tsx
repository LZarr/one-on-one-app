type Defaults = {
  pronouns?: string | null;
  school?: string | null;
  bio?: string | null;
  canHelpWith?: string | null;
  canBeHelpedWith?: string | null;
  keyCrux?: string | null;
  personalLink?: string | null;
};

const inputCls =
  "w-full border border-stone-200 rounded-md px-3.5 py-2.5 text-sm bg-stone-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent-500/20 focus:border-accent-500";
const labelCls = "block text-sm font-semibold text-stone-700 mb-1.5";

export default function ProfileFieldsFieldset({ defaults = {} }: { defaults?: Defaults }) {
  return (
    <>
      <div>
        <label className={labelCls}>Pronouns</label>
        <input name="pronouns" defaultValue={defaults.pronouns || ""} className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>School</label>
        <input name="school" defaultValue={defaults.school || ""} className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>Bio</label>
        <textarea name="bio" rows={3} defaultValue={defaults.bio || ""} className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>I can help others with…</label>
        <textarea name="canHelpWith" rows={2} defaultValue={defaults.canHelpWith || ""} className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>Other people can help me with…</label>
        <textarea name="canBeHelpedWith" rows={2} defaultValue={defaults.canBeHelpedWith || ""} className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>One of my key uncertainties/cruxes is…</label>
        <textarea name="keyCrux" rows={2} defaultValue={defaults.keyCrux || ""} className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>Personal link</label>
        <input name="personalLink" defaultValue={defaults.personalLink || ""} className={inputCls} />
      </div>
    </>
  );
}
