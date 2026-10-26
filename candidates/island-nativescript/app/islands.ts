// Detail and Insights islands (design §8.1, §8.7, §8.10; decision 38) built with NativeScript core views. Content,
// texts, element ids and styles follow the shared RN island UI (candidates/_island-rn-ui); the protocol parser and
// view model are that package's pure TypeScript modules. The native host owns all data and sends the state.

import { Button, Color, CoreTypes, Label, StackLayout, View } from '@nativescript/core';
import { IslandRegistry } from '../../_island-rn-ui/src/model.ts';
import type { IslandModel } from '../../_island-rn-ui/src/model.ts';
import { fmt, itemLabel, labelWidth, optionText } from '../../_rn-shared/ui/src/domain/format.ts';
import * as bridge from './bridge';

const TEXT = new Color('#111111');
const MUTED = new Color('#5F6368');
const NEUTRAL = new Color('#E6E8EB');
const BORDER = new Color('#E0E0E0');
const WHITE = new Color('#FFFFFF');
const DIGEST = new Color('#E4E4E4');
const EASING = CoreTypes.AnimationCurve.cubicBezier(0.42, 0, 0.58, 1);
const VALUE_IDS = ['a', 'b', 'c'];
/** Route index of the island screens in the probe numbering of the shared RN UI. */
const DETAIL_ROUTE_INDEX = 2;
const INSIGHTS_ROUTE_INDEX = 3;

function text(value: string, size: number, color: Color, id?: string): Label {
  const l = new Label();
  l.text = value;
  l.fontSize = size;
  l.color = color;
  if (id !== undefined) {
    l.accessibilityIdentifier = id;
  }
  return l;
}

/** One mounted island: its core view tree plus the draw probes of its tokens. */
abstract class Island {
  readonly root = new StackLayout();
  private drawnScreenToken: string | null = null;
  private readonly unsubscribe: Array<() => void> = [];

  protected constructor(
    protected readonly model: IslandModel,
    private readonly routeIndex: number,
    rootId: string,
  ) {
    this.root.backgroundColor = WHITE;
    this.root.padding = 16;
    this.root.accessibilityIdentifier = rootId;
    this.unsubscribe.push(model.token.subscribe(() => bridge.requestDraw(this.root)));
  }

  protected watch(unsubscribe: () => void): void {
    this.unsubscribe.push(unsubscribe);
  }

  /** Called after each frame that drew this island: reports tokens drawn for the first time. */
  drawn(): void {
    const token = this.model.token.get();
    if (token !== this.drawnScreenToken) {
      this.drawnScreenToken = token;
      bridge.probeDrawn('screen', this.routeIndex, token);
    }
  }

  dispose(): void {
    for (const u of this.unsubscribe) {
      u();
    }
  }
}

class DetailIsland extends Island {
  private readonly values: Label[];
  private readonly toggleButton: Button;
  private readonly panel: StackLayout;
  private shown = false;
  private animating = false;

  constructor(model: IslandModel) {
    super(model, DETAIL_ROUTE_INDEX, 'mb.screen.detail');
    const name = itemLabel(model.index, labelWidth(model.itemCount));
    const title = text(name, 20, TEXT);
    title.fontWeight = '600';
    this.root.addChild(title);
    const group = text(`Group ${model.group}`, 14, MUTED);
    group.marginBottom = 12;
    this.root.addChild(group);
    this.values = VALUE_IDS.map((id, o) => {
      const l = text(optionText(o, model.values.get()[o]), 16, TEXT, `mb.detail.values.${id}`);
      l.marginTop = 4;
      l.marginBottom = 4;
      this.root.addChild(l);
      return l;
    });
    this.watch(
      model.values.subscribe(() => {
        const v = model.values.get();
        this.values.forEach((l, o) => {
          l.text = optionText(o, v[o]);
        });
      }),
    );
    const b = new Button();
    b.text = 'Show details';
    b.fontSize = 14;
    b.color = TEXT;
    b.backgroundColor = NEUTRAL;
    b.borderRadius = 4;
    b.height = 40;
    b.marginTop = 16;
    b.paddingLeft = 16;
    b.paddingRight = 16;
    b.horizontalAlignment = 'left';
    b.textTransform = 'none';
    b.accessibilityIdentifier = 'mb.detail.panel.toggle';
    b.accessible = true;
    b.on(Button.tapEvent, () => this.toggle());
    this.toggleButton = b;
    this.root.addChild(b);
    const panel = new StackLayout();
    panel.accessibilityIdentifier = 'mb.detail.panel';
    panel.marginTop = 16;
    panel.height = 160;
    panel.padding = 16;
    panel.borderRadius = 4;
    panel.borderWidth = 1;
    panel.borderColor = BORDER;
    panel.backgroundColor = WHITE;
    panel.visibility = 'collapse';
    panel.addChild(text(`Details for ${name}`, 14, TEXT));
    panel.addChild(text(`Group ${model.group}`, 14, TEXT));
    this.panel = panel;
    this.root.addChild(panel);
  }

  /** Show: translateY +240 -> 0 and opacity 0 -> 1, 300 ms, cubic-bezier(0.42, 0, 0.58, 1); hide reverses. */
  private toggle(): void {
    if (this.animating) {
      return;
    }
    this.animating = true;
    const show = !this.shown;
    this.shown = show;
    const dir = show ? 'show' : 'hide';
    this.toggleButton.text = show ? 'Hide details' : 'Show details';
    const panel = this.panel;
    if (show) {
      panel.translateY = 240;
      panel.opacity = 0;
      panel.visibility = 'visible';
    }
    bridge.mark('anim.start', `dir=${dir}`);
    const finish = (): void => {
      this.animating = false;
      if (!show) {
        panel.visibility = 'collapse';
      }
      bridge.mark('anim.end', `dir=${dir}`);
    };
    panel
      .animate({ translate: { x: 0, y: show ? 0 : 240 }, opacity: show ? 1 : 0, duration: 300, curve: EASING })
      .then(finish, finish);
  }
}

class InsightsIsland extends Island {
  private readonly top: StackLayout;
  private readonly buckets: Label;
  private readonly digest: Label;
  private readyDrawn = false;

  constructor(model: IslandModel) {
    super(model, INSIGHTS_ROUTE_INDEX, 'mb.screen.insights');
    this.root.addChild(heading('Top 5 by Option A'));
    this.top = new StackLayout();
    this.top.accessibilityIdentifier = 'mb.insights.top';
    this.root.addChild(this.top);
    this.root.addChild(heading('Option B distribution'));
    this.buckets = line('', 'mb.insights.buckets');
    this.root.addChild(this.buckets);
    const source = text(`Source: ${model.source}`, 14, MUTED, 'mb.insights.source');
    source.marginTop = 16;
    this.root.addChild(source);
    this.digest = text(model.insightsDigest.get(), 8, DIGEST, 'mb.insights.digest');
    this.digest.marginTop = 8;
    this.root.addChild(this.digest);
    this.render();
    this.watch(model.subscribeValues(() => this.render()));
    this.watch(
      model.insightsDigest.subscribe(() => {
        this.digest.text = model.insightsDigest.get();
      }),
    );
  }

  private render(): void {
    const snap = this.model.insightsSnapshot();
    const width = labelWidth(this.model.itemCount);
    this.top.removeChildren();
    for (const [i, a] of snap.top) {
      this.top.addChild(line(`${itemLabel(i, width)} — ${fmt(a)}`));
    }
    this.buckets.text = snap.buckets.join(' · ');
  }

  override drawn(): void {
    super.drawn();
    if (!this.readyDrawn) {
      this.readyDrawn = true;
      bridge.probeDrawn('insights', 0, `ready:${this.model.version}:${this.model.openSeq}`);
    }
  }
}

function heading(value: string): Label {
  const l = text(value, 16, TEXT);
  l.fontWeight = '600';
  l.marginTop = 8;
  l.marginBottom = 4;
  return l;
}

function line(value: string, id?: string): Label {
  const l = text(value, 14, TEXT, id);
  l.marginTop = 2;
  l.marginBottom = 2;
  return l;
}

const registry = new IslandRegistry({ mark: bridge.mark });
const islands = new Map<number, Island>();

bridge.start({
  create(sid: number, initJson: string): View | null {
    const model = registry.adopt(initJson);
    if (model === null || model.sid !== sid) {
      return null;
    }
    const island = model.kind === 'detail' ? new DetailIsland(model) : new InsightsIsland(model);
    islands.set(sid, island);
    bridge.onEachDraw(island.root, () => island.drawn());
    // The host registers the island when this call returns, so `ready` (answered with `snap`) goes out after it.
    setTimeout(() => bridge.toHost(sid, JSON.stringify({ t: 'ready', sid })), 0);
    return island.root;
  },
  send(json: string): void {
    registry.dispatch(json);
  },
  release(sid: number): void {
    const island = islands.get(sid);
    islands.delete(sid);
    registry.remove(sid);
    if (island !== undefined) {
      island.dispose();
      bridge.unmount(island.root);
    }
  },
});
