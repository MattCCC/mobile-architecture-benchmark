// Screens of the reference application (design §8.1, §8.2, §8.7, §8.12), built in code with NativeScript
// core views. Each screen root carries a draw probe whose token drives the `screen`, `resume` and
// `restore` markers (§6.2).

import {
  Button,
  CoreTypes,
  EventData,
  GridLayout,
  Label,
  ListView,
  NavigatedData,
  Page,
  StackLayout,
  View,
} from '@nativescript/core';
import { fmt, itemLabel, optionText, selectionButtonText, selectionEntryText, summaryCountText, summaryTotalText } from '../core/format';
import { computeInsights, insightsDigest } from '../core/digest';
import { ROW_HEIGHT, TokenProbe } from '../core/fui-gate';
import { DrawProbe } from '../platform/draw-probe';
import * as native from '../platform/native';
import { ItemVM, SelectionEntryVM } from './item-vm';
import type { Emission, Session } from './session';

const WHITE = 0xffffffff;
const SUMMARY_BG = 0xfff2f2f2;
const OPTION_KEYS_LOWER = ['a', 'b', 'c'];

function label(text: string, className: string, id?: string): Label {
  const l = new Label();
  l.text = text;
  l.className = className;
  if (id !== undefined) {
    l.accessibilityIdentifier = id;
  }
  return l;
}

function button(text: string, className: string, id: string, onTap: () => void): Button {
  const b = new Button();
  b.text = text;
  b.className = className;
  b.accessibilityIdentifier = id;
  b.accessible = true;
  b.on(Button.tapEvent, onTap);
  return b;
}

/**
 * Re-applies ListView.rowHeight once the native view exists. The property is coerced to "auto" while there is no
 * native view, and only the Android implementation re-coerces it when the native view is created; without this
 * call the iOS table keeps automatic row heights.
 */
function applyRowHeight(lv: ListView): void {
  (lv as unknown as { updateEffectiveRowHeight(): void }).updateEffectiveRowHeight();
}

function place(grid: GridLayout, view: View, row: number, col = 0): View {
  GridLayout.setRow(view, row);
  GridLayout.setColumn(view, col);
  grid.addChild(view);
  return view;
}

export abstract class Screen {
  readonly page = new Page();
  readonly rootProbe = new DrawProbe(WHITE);
  readonly rootToken = new TokenProbe<Emission>();
  abstract readonly route: string;

  protected constructor(protected readonly s: Session) {
    this.page.className = 'page';
    this.rootProbe.onDrawn = () => this.s.rootProbeDrawn(this);
    this.page.on(Page.navigatingToEvent, (args: EventData) => {
      this.s.screenNavigatingTo(this, (args as NavigatedData).isBackNavigation);
    });
    this.page.on(Page.navigatedToEvent, (args: EventData) => {
      this.s.screenNavigatedTo(this, (args as NavigatedData).isBackNavigation);
    });
    this.page.on(Page.navigatingFromEvent, (args: EventData) => {
      this.s.screenNavigatingFrom(this, (args as NavigatedData).isBackNavigation);
    });
  }

  /** Sets a probe token; the marker is emitted from the probe's next draw. */
  setToken(token: string, emission: Emission): void {
    if (this.rootToken.set(token, emission)) {
      this.rootProbe.requestRedraw();
    }
  }
}

export class ListScreen extends Screen {
  readonly route = 'list';
  readonly listView = new ListView();
  readonly summaryProbe = new DrawProbe(SUMMARY_BG);
  readonly summaryToken = new TokenProbe<Emission>();
  readonly selectionButton: Button;
  readonly countLabel: Label;
  readonly totalLabel: Label;
  readonly statusLabel: Label;
  readonly digestLabel: Label;
  /** Scroll anchor to apply before the first frame (restoration). */
  pendingAnchor = -1;
  private laidOut = false;

  constructor(s: Session) {
    super(s);
    const store = s.store;
    this.page.actionBarHidden = true;

    const root = new GridLayout();
    root.rows = '56, 32, 48, *';
    root.accessibilityIdentifier = 'mb.screen.list';
    // iOS: keep every band inside the safe area (no content under the home indicator, design §8.2).
    root.iosOverflowSafeArea = false;
    place(root, this.rootProbe, 0);

    const header = new GridLayout();
    header.columns = '*, auto, auto';
    header.className = 'header';
    place(header, label('Items', 'title'), 0, 0);
    this.selectionButton = button(selectionButtonText(store.selectionCount), 'nav-btn', 'mb.nav.selection', () =>
      s.openSelection(),
    );
    place(header, this.selectionButton, 0, 1);
    place(header, button('Insights', 'nav-btn', 'mb.nav.insights', () => s.openInsights()), 0, 2);
    place(root, header, 0);

    const status = new GridLayout();
    status.columns = 'auto, *, auto';
    status.className = 'status-row';
    this.statusLabel = label('Connecting', 'status-chip', 'mb.stream.status');
    place(status, this.statusLabel, 0, 0);
    this.digestLabel = label('', 'digest', 'mb.state.digest');
    place(status, this.digestLabel, 0, 2);
    place(root, status, 1);

    const summary = new GridLayout();
    summary.columns = 'auto, auto, auto, *';
    summary.className = 'summary';
    summary.accessibilityIdentifier = 'mb.summary';
    place(summary, this.summaryProbe, 0, 0);
    this.countLabel = label(summaryCountText(store.selectionCount), 'summary-text', 'mb.summary.count');
    place(summary, this.countLabel, 0, 0);
    place(summary, label(' \u00b7 ', 'summary-text'), 0, 1);
    this.totalLabel = label(summaryTotalText(store.selectionTotal), 'summary-text', 'mb.summary.total');
    place(summary, this.totalLabel, 0, 2);
    place(root, summary, 2);
    this.summaryProbe.onDrawn = () => s.summaryProbeDrawn();

    const lv = this.listView;
    lv.accessibilityIdentifier = 'mb.list';
    // ListView is a ContainerView, which extends beyond the iOS safe area by default; keep it inside (design §8.2).
    lv.iosOverflowSafeArea = false;
    lv.rowHeight = ROW_HEIGHT;
    lv.items = { length: store.itemCount, getItem: (i: number) => s.vm(i) };
    lv.itemTemplate = () => this.createRow();
    lv.on(ListView.itemLoadingEvent, () => {
      s.store.counters.rows += 1;
    });
    lv.on(View.loadedEvent, () => {
      applyRowHeight(lv);
      native.configureListView(lv);
      if (__ANDROID__ && this.pendingAnchor >= 0) {
        // Android ListView.setSelection before the first layout positions the row at the top.
        lv.scrollToIndex(this.pendingAnchor);
        this.pendingAnchor = -1;
      }
    });
    lv.on(View.layoutChangedEvent, () => {
      if (this.laidOut) {
        return;
      }
      this.laidOut = true;
      const size = lv.getActualSize();
      if (size) {
        s.listLaidOut(size.height);
      }
      if (this.pendingAnchor >= 0) {
        // iOS: the table has rows only after its first layout; scroll before the first commit.
        lv.scrollToIndex(this.pendingAnchor);
        this.pendingAnchor = -1;
      }
    });
    place(root, lv, 3);
    this.page.content = root;
  }

  private createRow(): View {
    const s = this.s;
    const row = new GridLayout();
    row.columns = '*, auto, auto, auto';
    row.className = 'row';
    row.bind({ sourceProperty: 'rowId', targetProperty: 'accessibilityIdentifier' });

    const probe = new DrawProbe(WHITE);
    probe.onDrawn = () => {
      const vm = row.bindingContext as ItemVM | undefined;
      if (vm) {
        s.rowProbeDrawn(vm.index);
      }
    };
    place(row, probe, 0, 0);

    const left = new StackLayout();
    left.verticalAlignment = 'middle';
    const title = new Label();
    title.className = 'row-label';
    title.bind({ sourceProperty: 'label', targetProperty: 'text' });
    title.bind({ sourceProperty: 'labelId', targetProperty: 'accessibilityIdentifier' });
    title.on('tap', () => {
      const vm = row.bindingContext as ItemVM | undefined;
      if (vm) {
        s.openDetail(vm.index);
      }
    });
    const group = new Label();
    group.className = 'row-group';
    group.bind({ sourceProperty: 'group', targetProperty: 'text' });
    left.addChild(title);
    left.addChild(group);
    place(row, left, 0, 0);

    OPTION_KEYS_LOWER.forEach((k, o) => {
      const b = new Button();
      b.accessible = true;
      b.bind({ sourceProperty: `${k}Text`, targetProperty: 'text' });
      b.bind({ sourceProperty: `${k}Class`, targetProperty: 'className' });
      b.bind({ sourceProperty: `${k}Id`, targetProperty: 'accessibilityIdentifier' });
      b.bind({ sourceProperty: `${k}State`, targetProperty: 'accessibilityState' });
      b.on(Button.tapEvent, () => {
        const vm = row.bindingContext as ItemVM | undefined;
        if (vm) {
          s.toggle(vm.index, o);
        }
      });
      place(row, b, 0, o + 1);
    });
    return row;
  }

  updateSummary(): void {
    const store = this.s.store;
    this.countLabel.text = summaryCountText(store.selectionCount);
    this.totalLabel.text = summaryTotalText(store.selectionTotal);
    this.selectionButton.text = selectionButtonText(store.selectionCount);
  }
}

export class SelectionScreen extends Screen {
  readonly route = 'selection';
  private readonly entries = new Map<number, SelectionEntryVM>();
  private readonly totalLabel: Label;

  constructor(s: Session) {
    super(s);
    this.page.actionBar.title = 'Selection';
    const store = s.store;
    const root = new GridLayout();
    root.rows = '*, 48';
    root.accessibilityIdentifier = 'mb.screen.selection';
    root.iosOverflowSafeArea = false;
    place(root, this.rootProbe, 0);
    const items = store.selectionList().map(([i, o]) => {
      const vm = new SelectionEntryVM(i, o, selectionEntryText(itemLabel(i, s.labelWidth), o, store.value(i, o)));
      this.entries.set(i, vm);
      return vm;
    });
    const lv = new ListView();
    lv.rowHeight = 48;
    lv.iosOverflowSafeArea = false;
    lv.items = items;
    lv.itemTemplate = () => {
      const l = new Label();
      l.className = 'sel-entry';
      l.bind({ sourceProperty: 'text', targetProperty: 'text' });
      return l;
    };
    lv.on(View.loadedEvent, () => {
      applyRowHeight(lv);
      native.configureListView(lv);
    });
    place(root, lv, 0);
    this.totalLabel = label(summaryTotalText(store.selectionTotal), 'sel-total');
    place(root, this.totalLabel, 1);
    this.page.content = root;
  }

  itemValues(i: number): void {
    const vm = this.entries.get(i);
    if (vm) {
      const s = this.s;
      vm.set('text', selectionEntryText(itemLabel(i, s.labelWidth), vm.option, s.store.value(i, vm.option)));
    }
  }

  updateTotal(): void {
    this.totalLabel.text = summaryTotalText(this.s.store.selectionTotal);
  }
}

export class DetailScreen extends Screen {
  readonly route: string;
  private readonly values: Label[];
  private readonly panel: GridLayout;
  private readonly toggleButton: Button;
  private shown = false;
  private animating = false;

  constructor(
    s: Session,
    readonly index: number,
  ) {
    super(s);
    this.route = `detail/${index}`;
    const store = s.store;
    const name = itemLabel(index, s.labelWidth);
    this.page.actionBar.title = name;
    const root = new GridLayout();
    root.rows = 'auto, auto, auto, auto, *';
    root.className = 'detail';
    root.accessibilityIdentifier = 'mb.screen.detail';
    place(root, this.rootProbe, 0);
    place(root, label(name, 'detail-title'), 0);
    place(root, label(`Group ${store.group(index)}`, 'detail-group'), 1);
    const valueRow = new StackLayout();
    valueRow.orientation = 'horizontal';
    this.values = OPTION_KEYS_LOWER.map((k, o) => {
      const l = label(optionText(o, store.value(index, o)), 'detail-value', `mb.detail.values.${k}`);
      valueRow.addChild(l);
      return l;
    });
    place(root, valueRow, 2);
    this.toggleButton = button('Show details', 'toggle-btn', 'mb.detail.panel.toggle', () => this.toggle());
    place(root, this.toggleButton, 3);
    this.panel = new GridLayout();
    this.panel.rows = 'auto, auto';
    this.panel.className = 'panel';
    this.panel.accessibilityIdentifier = 'mb.detail.panel';
    this.panel.visibility = 'collapse';
    place(this.panel, label(`Details for ${name}`, 'panel-title'), 0);
    place(this.panel, label('Options A, B and C update live.', 'panel-text'), 1);
    place(root, this.panel, 4);
    this.page.content = root;
  }

  itemValues(): void {
    const store = this.s.store;
    this.values.forEach((l, o) => {
      l.text = optionText(o, store.value(this.index, o));
    });
  }

  /** Show: translateY +240 -> 0 and opacity 0 -> 1, 300 ms, cubic-bezier(0.42, 0, 0.58, 1); hide reverses (§8.7). */
  private toggle(): void {
    if (this.animating) {
      return;
    }
    this.animating = true;
    const show = !this.shown;
    const dir = show ? 'show' : 'hide';
    const panel = this.panel;
    if (show) {
      panel.translateY = 240;
      panel.opacity = 0;
      panel.visibility = 'visible';
    }
    this.s.bench.mark('anim.start', `dir=${dir}`);
    panel
      .animate({
        translate: { x: 0, y: show ? 0 : 240 },
        opacity: show ? 1 : 0,
        duration: 300,
        curve: CoreTypes.AnimationCurve.cubicBezier(0.42, 0, 0.58, 1),
      })
      .then(
        () => this.finishAnimation(show),
        () => this.finishAnimation(show),
      );
  }

  private finishAnimation(show: boolean): void {
    this.shown = show;
    this.animating = false;
    if (!show) {
      this.panel.visibility = 'collapse';
    }
    this.toggleButton.text = show ? 'Hide details' : 'Show details';
    this.s.bench.mark('anim.end', `dir=${show ? 'show' : 'hide'}`);
  }
}

export class InsightsScreen extends Screen {
  readonly route = 'insights';
  readonly contentProbe = new DrawProbe(WHITE);
  private readonly topLabel: Label;
  private readonly bucketsLabel: Label;
  private readonly digestLabel: Label;
  private ready = false;

  constructor(s: Session) {
    super(s);
    this.page.actionBar.title = 'Insights';
    const root = new StackLayout();
    root.className = 'insights';
    root.accessibilityIdentifier = 'mb.screen.insights';
    root.addChild(this.rootProbe);
    root.addChild(label('Top 5 by option A', 'section'));
    this.topLabel = label('', 'insights-text', 'mb.insights.top');
    this.topLabel.textWrap = true;
    root.addChild(this.topLabel);
    root.addChild(label('Option B distribution', 'section'));
    this.bucketsLabel = label('', 'insights-text', 'mb.insights.buckets');
    root.addChild(this.bucketsLabel);
    root.addChild(label('Source: embedded', 'insights-source', 'mb.insights.source'));
    this.digestLabel = label('', 'digest', 'mb.insights.digest');
    root.addChild(this.digestLabel);
    root.addChild(this.contentProbe);
    this.contentProbe.onDrawn = () => {
      if (!this.ready) {
        this.ready = true;
        s.bench.mark('remote.ready', 'v=1');
      }
    };
    this.refresh();
    this.page.content = root;
  }

  /** Recomputes the Insights snapshot and its digest (on open and at checkpoints). */
  refresh(): void {
    const store = this.s.store;
    const insights = computeInsights(store);
    this.topLabel.text = insights.top.map((e) => `${itemLabel(e.i, this.s.labelWidth)} \u00b7 A ${fmt(e.a)}`).join('\n');
    this.bucketsLabel.text = insights.buckets.join(', ');
    this.digestLabel.text = insightsDigest(store.lastSeq, insights).slice(0, 12);
  }
}

export class ErrorScreen extends Screen {
  readonly route = 'error';

  constructor(s: Session, code: string) {
    super(s);
    this.page.actionBarHidden = true;
    const root = new StackLayout();
    root.className = 'error';
    root.accessibilityIdentifier = 'mb.screen.error';
    root.addChild(this.rootProbe);
    const line = new StackLayout();
    line.orientation = 'horizontal';
    line.addChild(label('Error: ', 'error-text'));
    line.addChild(label(code, 'error-text', 'mb.error.code'));
    root.addChild(line);
    this.page.content = root;
  }
}
