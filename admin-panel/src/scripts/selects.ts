import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Combobox, type ComboboxOption } from '../components/ui/combobox';

// Keep native form values/validation and the existing API actions as the source
// of truth. Catalogs can still be loaded, disabled or reset asynchronously.
export function installSearchableSelects() {
  const mounted = new Map<HTMLSelectElement, { root: Root; dispose(): void }>();
  function mount(select: HTMLSelectElement) {
    if (mounted.has(select) || select.multiple) return;
    const host = document.createElement('div');
    host.className = 'select-host';
    select.after(host);
    select.classList.add('select-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    const root = createRoot(host);
    const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!;
    const oldDescriptor = Object.getOwnPropertyDescriptor(select, 'value');
    let invalid = false;
    const label = select.getAttribute('aria-label') ?? select.labels?.[0]?.childNodes[0]?.textContent?.trim() ?? 'Seleccionar opción';
    const triggerId = select.id ? `${select.id}-trigger` : undefined;
    const labels = [...(select.labels ?? [])];
    const oldLabelFors = labels.map((item) => item.htmlFor);
    if (triggerId) labels.forEach((item) => { item.htmlFor = triggerId; });
    function render() {
      const options: ComboboxOption[] = [...select.options].map((option) => ({
        value: option.value, label: option.text, disabled: option.disabled || (option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled),
        group: option.parentElement instanceof HTMLOptGroupElement ? option.parentElement.label : undefined,
      }));
      root.render(createElement(Combobox, { options, value: select.value, disabled: select.disabled, label, triggerId, invalid, required: select.required,
        onValueChange(value) {
          select.value = value;
          invalid = false;
          select.dispatchEvent(new Event('input', { bubbles: true }));
          select.dispatchEvent(new Event('change', { bubbles: true }));
          render();
        },
      }));
    }
    Object.defineProperty(select, 'value', { configurable: true, get() { return descriptor.get!.call(this); }, set(value) { descriptor.set!.call(this, value); render(); } });
    const observer = new MutationObserver(render);
    observer.observe(select, { attributes: true, childList: true, subtree: true, characterData: true });
    const onInvalid = (event: Event) => {
      event.preventDefault();
      invalid = true;
      render();
      // Match native validation: focus the first invalid field in the form.
      if (!select.form || select.form.querySelector('input:invalid, select:invalid, textarea:invalid') === select) host.querySelector('button')?.focus();
    };
    const onReset = () => queueMicrotask(render);
    select.addEventListener('change', render);
    select.addEventListener('invalid', onInvalid);
    select.form?.addEventListener('reset', onReset);
    mounted.set(select, { root, dispose() {
      observer.disconnect();
      select.removeEventListener('change', render);
      select.removeEventListener('invalid', onInvalid);
      select.form?.removeEventListener('reset', onReset);
      delete (select as unknown as Record<string, unknown>).value;
      if (oldDescriptor) Object.defineProperty(select, 'value', oldDescriptor);
      labels.forEach((item, index) => { item.htmlFor = oldLabelFors[index] ?? ''; });
      root.unmount(); host.remove();
      select.classList.remove('select-native'); select.removeAttribute('aria-hidden'); select.removeAttribute('tabindex');
    } });
    render();
  }
  function scan() {
    for (const [select, entry] of mounted) if (!select.isConnected) { entry.dispose(); mounted.delete(select); }
    document.querySelectorAll<HTMLSelectElement>('select').forEach(mount);
  }
  const observer = new MutationObserver(scan);
  observer.observe(document.body, { childList: true, subtree: true });
  scan();
  return () => { observer.disconnect(); mounted.forEach((entry) => entry.dispose()); mounted.clear(); };
}
