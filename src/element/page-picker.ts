import { collectElement, type ElementSnapshot } from "./snapshot";

export class PageElementPicker {
  private hovered: Element | null = null;
  private selected: Element | null = null;
  private overlay: HTMLDivElement | null = null;
  private box: HTMLDivElement | null = null;
  private label: HTMLDivElement | null = null;
  private frame: number | null = null;
  private listeners: AbortController | null = null;

  constructor(
    private readonly onPick: (snapshot: ElementSnapshot | null) => void,
    private readonly onCancel: () => void,
    private readonly onError: (error: unknown) => void,
    private readonly hint: string,
  ) {}

  setEnabled(enabled: boolean): void {
    if (!enabled) { this.pause(); return; }
    if (this.listeners) return;
    this.listeners = new AbortController();
    const options = { capture: true, passive: false, signal: this.listeners.signal };
    window.addEventListener("pointermove", this.move, options);
    window.addEventListener("pointerout", this.leave, options);
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu"]) window.addEventListener(type, this.intercept, options);
    window.addEventListener("keydown", this.keydown, options);
    window.addEventListener("scroll", this.schedule, { capture: true, passive: true, signal: this.listeners.signal });
    window.addEventListener("resize", this.schedule, { passive: true, signal: this.listeners.signal });
  }

  private target(event: Event): Element | null {
    const node = event.composedPath().find((item): item is Element => item instanceof Element);
    return node && node !== this.overlay && node.isConnected ? node : null;
  }

  private readonly move = (event: PointerEvent): void => { this.hovered = this.target(event); this.schedule(); };
  private readonly leave = (event: PointerEvent): void => {
    if (!event.relatedTarget) { this.hovered = null; this.schedule(); }
  };
  private readonly intercept = (event: Event): void => {
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.type !== "click" || !(event instanceof MouseEvent) || event.button !== 0) return;
    const node = this.target(event);
    if (!node) return;
    this.selected = node;
    this.hovered = node;
    this.schedule();
    this.refresh();
  };
  private readonly keydown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault(); event.stopImmediatePropagation();
    this.pause(); this.onCancel();
  };
  private readonly schedule = (): void => {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      try { this.highlight(); } catch (error) { this.pause(); this.onError(error); }
    });
  };

  private mount(): void {
    if (this.overlay?.isConnected) return;
    const host = document.createElement("div");
    host.setAttribute("data-odinet-picker", "");
    host.setAttribute("aria-hidden", "true");
    // Preserve the browser's top-layer painting state while resetting page styles.
    for (const [name, value] of Object.entries({ all: "revert", position: "fixed", inset: "0", margin: "0", padding: "0", border: "0", width: "100vw", height: "100vh", background: "transparent", "pointer-events": "none", "z-index": "2147483647" })) host.style.setProperty(name, value, "important");
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = ":host{pointer-events:none} .box{position:fixed;box-sizing:border-box;border:2px solid oklch(76% .12 255);background:oklch(76% .12 255 / .13);pointer-events:none}.label{position:fixed;box-sizing:border-box;max-width:calc(100vw - 16px);padding:5px 8px;border-radius:3px;background:oklch(25% .018 260);color:oklch(95% .006 260);font:12px/1.4 system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}";
    this.box = document.createElement("div"); this.box.className = "box";
    this.label = document.createElement("div"); this.label.className = "label";
    shadow.append(style, this.box, this.label);
    document.documentElement.append(host);
    this.overlay = host;
    // Use the top layer when available, including pages with open dialogs.
    try { host.popover = "manual"; host.showPopover(); } catch { /* Fixed positioning remains available on older browsers. */ }
  }

  private highlight(): void {
    if (!this.hovered?.isConnected) { this.overlay?.style.setProperty("display", "none", "important"); return; }
    this.mount();
    if (!this.overlay || !this.box || !this.label) return;
    const bounds = this.hovered.getBoundingClientRect();
    const left = Math.max(0, Math.min(innerWidth, bounds.left));
    const top = Math.max(0, Math.min(innerHeight, bounds.top));
    const right = Math.max(left, Math.min(innerWidth, bounds.right));
    const bottom = Math.max(top, Math.min(innerHeight, bounds.bottom));
    this.overlay.style.setProperty("display", "block", "important");
    Object.assign(this.box.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
    const id = this.hovered.id ? `#${this.hovered.id.slice(0, 80)}` : "";
    this.label.textContent = `${this.hovered.localName}${id} · ${this.hint}`;
    this.label.style.left = `${Math.max(8, Math.min(left, innerWidth - this.label.offsetWidth - 8))}px`;
    this.label.style.top = `${top >= 36 ? top - 32 : Math.min(innerHeight - 32, bottom + 4)}px`;
  }

  refresh(): void {
    try { this.onPick(collectElement(this.selected)); }
    catch (error) { this.onError(error); }
  }

  forget(): void { this.selected = null; }

  private pause(): void {
    this.listeners?.abort(); this.listeners = null;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null; this.hovered = null;
    this.overlay?.remove(); this.overlay = this.box = this.label = null;
  }

  dispose(): void { this.pause(); this.forget(); }
}
