export function CardInput({ id, label, value, onChange, className = '', registerCardPickerTarget }) {
  const handleFocus = () => {
    if (registerCardPickerTarget) {
      registerCardPickerTarget(id, (card) => onChange(card));
    }
  };

  return (
    <input
      type="text"
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={handleFocus}
      placeholder="e.g. As"
      maxLength={3}
      className={
        'rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none ' +
        (className || '')
      }
      data-card-label={label}
    />
  );
}
