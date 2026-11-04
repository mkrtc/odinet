import { element } from "./dom";

export interface ContextMenuItem { label: string; disabled?: boolean; children?: ContextMenuItem[]; action?: () => void }
interface MenuLevel { node: HTMLElement; parent: HTMLButtonElement | null }

export class ContextMenu {
  private readonly levels: MenuLevel[] = [];
  private abort: AbortController | null = null;
  private trigger: HTMLElement | null = null;

  open(items: ContextMenuItem[], x: number, y: number, trigger: HTMLElement): void {
    this.close(false); this.trigger = trigger; this.abort = new AbortController();
    const root = this.create(items, 0, null);
    root.setAttribute("aria-label", items[0]?.label ?? "");
    this.position(root, x, y); this.focusFirst(root);
    const options = { capture: true, signal: this.abort.signal };
    window.addEventListener("pointerdown", (event) => {
      if (event.target instanceof Node && !this.levels.some((level) => level.node.contains(event.target as Node))) this.close(false);
    }, options);
    window.addEventListener("keydown", this.keydown, options);
    window.addEventListener("focusin", (event) => {
      if (event.target instanceof Node && !this.levels.some((level) => level.node.contains(event.target as Node))) this.close(false);
    }, options);
    window.addEventListener("blur", () => this.close(false), { signal: this.abort.signal });
    window.addEventListener("resize", () => this.close(), { signal: this.abort.signal });
  }

  private create(items: ContextMenuItem[], depth: number, parent: HTMLButtonElement | null): HTMLElement {
    const menu = element("div", "context-menu");
    menu.role = "menu";
    if (parent) menu.setAttribute("aria-label", parent.textContent ?? "");
    for (const item of items) {
      const button = element("button", "context-menu-item");
      button.type = "button"; button.role = "menuitem"; button.tabIndex = -1; button.disabled = Boolean(item.disabled);
      button.append(element("span", "context-menu-label", item.label));
      if (item.children) {
        button.setAttribute("aria-haspopup", "menu"); button.setAttribute("aria-expanded", "false");
        const arrow = element("span", "context-menu-arrow", "›"); arrow.setAttribute("aria-hidden", "true"); button.append(arrow);
      }
      const expand = (focus: boolean): void => {
        if (button.disabled) return;
        if (this.levels[depth + 1]?.parent === button) { if (focus) this.focusFirst(this.levels[depth + 1]!.node); return; }
        this.closeLevels(depth + 1);
        if (!item.children) return;
        const submenu = this.create(item.children, depth + 1, button);
        const bounds = button.getBoundingClientRect();
        const current = this.levels[depth];
        const preferLeft = current?.parent && current.node.getBoundingClientRect().left < current.parent.getBoundingClientRect().left;
        let left = preferLeft ? bounds.left - submenu.offsetWidth + 2 : bounds.right - 2;
        if (left + submenu.offsetWidth > innerWidth - 4) left = bounds.left - submenu.offsetWidth + 2;
        if (left < 4) left = bounds.right - 2;
        this.position(submenu, left, bounds.top - 4);
        button.setAttribute("aria-expanded", "true");
        if (focus) this.focusFirst(submenu);
      };
      button.addEventListener("pointerenter", () => { if (!button.disabled) { button.focus({ preventScroll: true }); expand(false); } });
      button.addEventListener("click", () => {
        if (item.children) expand(true);
        else { this.close(); item.action?.(); }
      });
      button.addEventListener("keydown", (event) => {
        if (event.key === "ArrowRight" && item.children) { event.preventDefault(); event.stopImmediatePropagation(); expand(true); }
      });
      menu.append(button);
    }
    menu.addEventListener("contextmenu", (event) => event.preventDefault());
    this.levels.push({ node: menu, parent }); document.body.append(menu);
    return menu;
  }

  private position(menu: HTMLElement, x: number, y: number): void {
    menu.style.left = `${Math.max(4, Math.min(x, innerWidth - menu.offsetWidth - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, innerHeight - menu.offsetHeight - 4))}px`;
  }
  private buttons(menu: HTMLElement): HTMLButtonElement[] { return [...menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")]; }
  private focusFirst(menu: HTMLElement): void { this.buttons(menu)[0]?.focus({ preventScroll: true }); }

  private readonly keydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); this.close(); return; }
    if (event.key === "Tab") { this.close(); return; }
    const depth = this.levels.findIndex((level) => level.node.contains(document.activeElement));
    const current = this.levels[depth];
    if (!current) return;
    if (event.key === "ArrowLeft" && depth > 0) {
      event.preventDefault(); event.stopImmediatePropagation(); this.closeLevels(depth); current.parent?.focus({ preventScroll: true }); return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const buttons = this.buttons(current.node);
    const index = buttons.findIndex((button) => button === document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    this.closeLevels(depth + 1); buttons[next]?.focus({ preventScroll: true }); buttons[next]?.scrollIntoView({ block: "nearest" });
  };

  private closeLevels(from: number): void {
    for (const level of this.levels.splice(from)) { level.node.remove(); level.parent?.setAttribute("aria-expanded", "false"); }
  }
  close(restoreFocus = true): void {
    this.abort?.abort(); this.abort = null; this.closeLevels(0);
    if (restoreFocus && this.trigger?.isConnected) this.trigger.focus({ preventScroll: true });
    this.trigger = null;
  }
}
