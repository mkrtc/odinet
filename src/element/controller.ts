import type { NetworkEntry } from "../network/model";
import type { ResponseContent } from "../network/source";
import { element } from "../ui/dom";
import { t } from "../ui/i18n";
import { resourceRelation, scanResponseData, type ElementRelation, type ScanResult } from "./relations";
import { collectElement, readElementSnapshot, type ElementSnapshot } from "./snapshot";

export class ElementRequestsController {
  private active = false;
  private snapshot: ElementSnapshot | null = null;
  private entries: readonly NetworkEntry[] = [];
  private relations = new Map<string, ElementRelation>();
  private dataMatches = new Map<string, ElementRelation>();
  private generation = 0;
  private abort = new AbortController();
  private scanning = false;
  private capturePending = false;
  private scanResult: ScanResult | null = null;
  private checked = 0;
  private error = false;
  private evidenceKey = "";
  private readonly label = element("code", "element-label");
  private readonly status = element("p", "element-status");
  private readonly explanation = element("p", "element-explanation", t("elementLimitations"));
  private readonly list = element("ul", "element-matches");
  private readonly onlyRelated = element("input");
  private readonly refresh = this.control("elementUseSelected", () => { void this.capture(); });
  private readonly scan = this.control("elementFindData", () => { void this.scanData(); });

  constructor(
    private readonly toggle: HTMLButtonElement,
    private readonly root: HTMLElement,
    private readonly onChange: () => void,
    private readonly onSelect: (id: string) => void,
    private readonly readContent: (id: string) => Promise<ResponseContent>,
    private readonly api = chrome.devtools,
  ) {
    toggle.textContent = t("elementRequests");
    toggle.setAttribute("aria-pressed", "false");
    toggle.setAttribute("aria-controls", root.id);
    toggle.addEventListener("click", () => this.setActive(!this.active));
    root.setAttribute("aria-label", t("elementRequests"));
    this.onlyRelated.type = "checkbox";
    this.onlyRelated.checked = true;
    this.onlyRelated.addEventListener("change", onChange);
    const only = element("label", "preserve-label");
    only.append(this.onlyRelated, document.createTextNode(t("elementOnlyRelated")));
    const close = this.control("elementClose", () => this.setActive(false));
    const toolbar = element("div", "element-toolbar");
    toolbar.append(this.label, this.refresh, this.scan, only, close);
    this.status.role = "status";
    this.list.setAttribute("aria-label", t("elementRelatedList"));
    root.append(toolbar, this.status, this.list, this.explanation);
    this.api.panels.elements.onSelectionChanged.addListener(this.selectionChanged);
    this.api.network.onNavigated.addListener(this.navigated);
  }

  private control(key: string, action: () => void): HTMLButtonElement {
    const button = element("button", "json-button", t(key));
    button.type = "button";
    button.addEventListener("click", action);
    return button;
  }

  private readonly selectionChanged = (): void => { if (this.active) void this.capture(); };
  private readonly navigated = (): void => { this.reset(); this.display(); this.onChange(); };

  private reset(): void {
    this.generation++;
    this.abort.abort();
    this.abort = new AbortController();
    this.snapshot = null;
    this.relations.clear();
    this.dataMatches.clear();
    this.scanning = this.capturePending = this.error = false;
    this.scanResult = null;
    this.checked = 0;
  }

  private setActive(active: boolean): void {
    this.active = active;
    this.toggle.setAttribute("aria-pressed", String(active));
    this.root.hidden = !active;
    if (active) void this.capture();
    else { this.reset(); this.onChange(); this.toggle.focus(); }
  }

  private async capture(): Promise<void> {
    this.reset();
    const generation = this.generation;
    this.capturePending = true;
    this.display(); this.onChange();
    try {
      const value = await this.evaluateSelected(this.abort.signal);
      if (generation !== this.generation) return;
      this.snapshot = readElementSnapshot(value);
      this.rebuild();
    } catch (error) {
      if (generation !== this.generation) return;
      this.error = true;
      console.error("Odinet: failed to inspect selected element", error);
    } finally {
      if (generation === this.generation) { this.capturePending = false; this.display(); this.onChange(); }
    }
  }

  private evaluateSelected(signal: AbortSignal): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error: Error | null, result?: unknown): void => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal.removeEventListener("abort", cancel);
        if (error) reject(error); else resolve(result);
      };
      const cancel = (): void => finish(new Error("Element inspection cancelled"));
      const timer = setTimeout(() => finish(new Error("Element inspection timed out")), 5000);
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) { cancel(); return; }
      try {
        this.api.inspectedWindow.eval(`(${collectElement.toString()})(typeof $0 === "undefined" ? null : $0)`, (result: unknown, exception) => {
          const error = chrome.runtime.lastError;
          finish(error || exception ? new Error(error?.message || "Selected element evaluation failed") : null, result);
        });
      } catch (error) { finish(error instanceof Error ? error : new Error("Selected element evaluation failed")); }
    });
  }

  updateEntries(entries: readonly NetworkEntry[]): void {
    if (entries === this.entries) return;
    if (!entries.length && this.scanning) {
      this.generation++;
      this.abort.abort(); this.abort = new AbortController();
      this.scanning = false; this.scanResult = null;
      this.dataMatches.clear();
    }
    this.entries = entries;
    this.rebuild();
    if (this.active) this.display();
  }

  private rebuild(): void {
    this.relations = new Map();
    if (!this.snapshot) return;
    const ids = new Set(this.entries.map((entry) => entry.id));
    for (const id of this.dataMatches.keys()) if (!ids.has(id)) this.dataMatches.delete(id);
    for (const entry of this.entries) {
      const relation = resourceRelation(this.snapshot, entry) ?? this.dataMatches.get(entry.id);
      if (relation) this.relations.set(entry.id, relation);
    }
  }

  get filtering(): boolean { return this.active && this.snapshot !== null && this.onlyRelated.checked; }

  includes(entry: NetworkEntry): boolean { return !this.filtering || this.relations.has(entry.id); }

  private async scanData(): Promise<void> {
    if (!this.snapshot || this.scanning) return;
    const snapshot = this.snapshot;
    const generation = this.generation;
    this.scanning = true; this.checked = 0; this.scanResult = null;
    this.display();
    try {
      const result = await scanResponseData(snapshot, this.entries, this.readContent, this.abort.signal, (checked) => {
        if (generation !== this.generation) return;
        this.checked = checked; this.updateStatus();
      });
      if (generation !== this.generation) return;
      this.dataMatches = result.matches;
      this.scanResult = result;
      this.rebuild();
    } catch (error) {
      if (generation !== this.generation) return;
      this.error = true;
      console.error("Odinet: failed to match element response data", error);
    } finally {
      if (generation === this.generation) { this.scanning = false; this.display(); this.onChange(); }
    }
  }

  private updateStatus(): void {
    const key = this.error ? "elementReadError" : this.capturePending ? "elementReading" : !this.snapshot ? "elementSelectHelp" : this.scanning ? "elementScanning" : "elementMatchCount";
    let text = t(key, [String(this.scanning ? this.checked : this.relations.size)]);
    if (this.scanResult && !this.scanning && !this.error) text = t("elementAnalysisComplete", [String(this.relations.size), String(this.scanResult.checked)]);
    if (this.snapshot?.limited || this.scanResult?.limited) text += ` ${t("elementScanLimited")}`;
    if (this.scanResult?.unavailable) text += ` ${t("elementUnavailable", String(this.scanResult.unavailable))}`;
    if (this.snapshot && !this.scanning && !this.scanResult && !this.snapshot.samples.length) text += ` ${t("elementNoSamples")}`;
    if (this.status.textContent !== text) this.status.textContent = text;
  }

  private display(): void {
    this.label.textContent = this.snapshot?.label ?? t("elementNoSelection");
    this.label.title = this.snapshot ? `${this.snapshot.label}\n${this.snapshot.pageUrl}` : "";
    this.refresh.disabled = this.capturePending;
    this.scan.disabled = !this.snapshot || !this.snapshot.samples.length || this.scanning;
    this.onlyRelated.disabled = !this.snapshot;
    this.updateStatus();
    const matches = this.entries.filter((entry) => this.relations.has(entry.id)).slice(0, 80);
    const key = JSON.stringify([this.relations.size, matches.map((entry) => [entry.id, entry.method, entry.name, entry.url, this.relations.get(entry.id)])]);
    if (key === this.evidenceKey) return;
    this.evidenceKey = key;
    this.list.replaceChildren();
    for (const entry of matches) {
      const relation = this.relations.get(entry.id);
      if (!relation) continue;
      const item = element("li");
      const button = this.control("elementOpenRequest", () => this.onSelect(entry.id));
      const method = element("span", "http-method", entry.method); method.dataset.method = entry.method;
      button.classList.add("element-request");
      button.replaceChildren(method, element("span", "element-request-name", entry.name), element("span", `element-relation element-relation-${relation.kind}`, t(relation.kind === "resource" ? "elementResource" : "elementDataMatch")));
      button.title = entry.url;
      button.setAttribute("aria-label", `${entry.method} ${entry.url}`);
      const evidence = relation.kind === "resource" ? `${t(`elementResource_${relation.resource.kind}`)}: ${relation.resource.url}` : `${relation.path}: ${relation.value}`;
      const description = element("div", "element-evidence", evidence);
      description.title = evidence;
      item.append(button, description); this.list.append(item);
    }
    if (this.relations.size > 80) this.list.append(element("li", "element-evidence", t("elementListLimited")));
  }

  dispose(): void {
    this.reset();
    this.api.panels.elements.onSelectionChanged.removeListener(this.selectionChanged);
    this.api.network.onNavigated.removeListener(this.navigated);
  }
}
