export function createSelect(className = ''): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = ['admin-select', className].filter(Boolean).join(' ');
  return select;
}
