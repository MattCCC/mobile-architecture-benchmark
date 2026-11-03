import { AccessibilityRole, Button, Color, GridLayout, Label, ListView, StackLayout, View } from '@nativescript/core';
import type { ItemEventData } from '@nativescript/core';
import type { IslandModel } from '../../_island-rn-ui/src/model.ts';
import { fmt, itemLabel, labelWidth, optionText } from '../../_rn-shared/ui/src/domain/format.ts';
import { DrawProbe } from './draw-probe';
import { RenderCounter } from '../../_island-rn-ui/src/renderCounter.ts';
import * as bridge from './bridge';

const WHITE = new Color('#FFFFFF');
const ACCENT = new Color('#2F6FEB');
const TEXT = new Color('#1A1A1A');
const NEUTRAL = new Color('#E8EAED');

function place(grid: GridLayout, view: View, row = 0, col = 0): void {
  GridLayout.setRow(view, row);
  GridLayout.setColumn(view, col);
  grid.addChild(view);
}

class ItemRow extends GridLayout {
  private index = -1;
  private unsubscribe?: () => void;
  private readonly title = new Label();
  private readonly group = new Label();
  private readonly buttons: Button[] = [];
  private readonly probe = new DrawProbe(0xffffffff);

  constructor(private readonly model: IslandModel, private readonly counter: RenderCounter) {
    super();
    this.height = 72;
    this.columns = '*, auto, auto, auto';
    this.paddingLeft = 16;
    this.paddingRight = 16;
    this.backgroundColor = WHITE;
    const left = new StackLayout();
    left.verticalAlignment = 'middle';
    this.title.fontSize = 16;
    this.title.color = TEXT;
    this.title.on('tap', () => bridge.toHost(model.sid, JSON.stringify({ t: 'detail', sid: model.sid, i: this.index })));
    this.group.fontSize = 14;
    this.group.color = new Color('#5F6368');
    left.addChild(this.title);
    left.addChild(this.group);
    place(this, left);
    for (let o = 0; o < 3; o++) {
      const b = new Button();
      b.fontSize = 14;
      b.height = 36;
      b.minWidth = 48;
      b.paddingLeft = b.paddingRight = 8;
      b.marginLeft = 6;
      b.borderRadius = 4;
      b.textTransform = 'none';
      b.accessible = true;
      b.accessibilityRole = AccessibilityRole.Checkbox;
      b.on('tap', () => bridge.toHost(model.sid, JSON.stringify({ t: 'toggle', sid: model.sid, i: this.index, o })));
      this.buttons.push(b);
      place(this, b, 0, o + 1);
    }
    this.probe.onDrawn = () => bridge.probeDrawn('row', this.index, 'fui0');
    place(this, this.probe);
  }

  bindItem(index: number): void {
    this.unsubscribe?.();
    this.index = index;
    this.unsubscribe = this.model.rows[index].subscribe(() => this.render());
    this.render();
    this.probe.requestRedraw();
  }

  private render(): void {
    this.counter.rendered();
    const row = this.model.rows[this.index].get();
    this.accessibilityIdentifier = `mb.row.${this.index}`;
    this.title.text = itemLabel(this.index, labelWidth(this.model.itemCount));
    this.title.accessibilityIdentifier = `mb.row.${this.index}.label`;
    this.group.text = `Group ${row[0]}`;
    this.buttons.forEach((b, o) => {
      b.text = optionText(o, row[o + 1]);
      b.accessibilityIdentifier = `mb.row.${this.index}.opt.${['a', 'b', 'c'][o]}`;
      b.accessibilityState = row[4] === o ? 'checked' : 'unchecked';
      b.backgroundColor = row[4] === o ? ACCENT : NEUTRAL;
      b.color = row[4] === o ? WHITE : TEXT;
    });
  }

  release(): void { this.unsubscribe?.(); }
}

export class ListIsland {
  readonly root = new GridLayout();
  private readonly list = new ListView();
  private readonly rows = new Set<ItemRow>();
  private readonly unsubscribe: (() => void)[] = [];
  private lastAnchor = -1;

  constructor(private readonly model: IslandModel) {
    this.root.rows = '48, *';
    this.root.iosOverflowSafeArea = false;
    this.root.backgroundColor = WHITE;
    const summary = new GridLayout();
    summary.columns = 'auto, auto, auto, *';
    summary.paddingLeft = 16;
    summary.accessibilityIdentifier = 'mb.summary';
    const count = new Label();
    const total = new Label();
    const separator = new Label();
    separator.text = ' · ';
    [count, separator, total].forEach((l, i) => {
      l.fontSize = 14;
      l.color = TEXT;
      l.verticalAlignment = 'middle';
      place(summary, l, 0, i);
    });
    count.accessibilityIdentifier = 'mb.summary.count';
    total.accessibilityIdentifier = 'mb.summary.total';
    const summaryProbe = new DrawProbe(0xffffffff);
    summaryProbe.onDrawn = () => {
      const s = model.summary.get();
      bridge.probeDrawn('summary', s[2], `${s[2]}:${s[0]}`);
    };
    const renderSummary = (): void => {
      const s = model.summary.get();
      count.text = `Selected ${s[0]}`;
      total.text = `Total ${fmt(s[1])}`;
      summaryProbe.requestRedraw();
    };
    place(summary, summaryProbe);
    place(this.root, summary);
    this.unsubscribe.push(model.summary.subscribe(renderSummary));
    renderSummary();

    const lv = this.list;
    const counter = new RenderCounter((n) => bridge.toHost(model.sid, JSON.stringify({ t: 'rendered', sid: model.sid, n })));
    lv.accessibilityIdentifier = 'mb.list';
    lv.iosOverflowSafeArea = false;
    lv.rowHeight = 72;
    lv.items = Array.from({ length: model.itemCount }, (_, i) => i);
    lv.on(ListView.itemLoadingEvent, (event) => {
      const e = event as ItemEventData;
      const row = e.view instanceof ItemRow ? e.view : new ItemRow(model, counter);
      this.rows.add(row);
      row.bindItem(e.index);
      e.view = row;
    });
    lv.on(View.loadedEvent, () => {
      (lv as unknown as { updateEffectiveRowHeight(): void }).updateEffectiveRowHeight();
      if (__ANDROID__) {
        const native = lv.android as android.widget.ListView;
        native.setDivider(null);
        native.setDividerHeight(0);
        native.setSelector(new android.graphics.drawable.ColorDrawable(android.graphics.Color.TRANSPARENT));
      } else {
        const native = lv.ios as UITableView;
        native.separatorStyle = 0;
        native.allowsSelection = false;
      }
    });
    let pendingAnchor = model.anchor;
    lv.on(View.layoutChangedEvent, () => {
      const h = Math.floor(lv.getActualSize().height);
      if (h <= 0) { return; }
      bridge.probeDrawn('list', h, '');
      if (pendingAnchor > 0) {
        lv.scrollToIndex(pendingAnchor);
        pendingAnchor = 0;
      }
    });
    place(this.root, lv, 1);
    const rootProbe = new DrawProbe(0xffffffff);
    let drawnToken = '';
    rootProbe.onDrawn = () => {
      const token = model.token.get();
      if (token !== drawnToken) {
        drawnToken = token;
        bridge.probeDrawn('screen', 0, token);
      }
    };
    place(this.root, rootProbe);
    this.unsubscribe.push(model.token.subscribe(() => rootProbe.requestRedraw()));
  }

  drawn(): void {
    const i = __ANDROID__
      ? Math.max(0, (this.list.android as android.widget.ListView | undefined)?.getFirstVisiblePosition() ?? 0)
      : (this.list.ios as UITableView | undefined)?.indexPathsForVisibleRows?.firstObject?.row ?? 0;
    if (i !== this.lastAnchor) {
      this.lastAnchor = i;
      bridge.toHost(this.model.sid, JSON.stringify({ t: 'anchor', sid: this.model.sid, i }));
    }
  }

  dispose(): void {
    this.drawn();
    this.unsubscribe.forEach((u) => u());
    this.rows.forEach((row) => row.release());
  }
}
