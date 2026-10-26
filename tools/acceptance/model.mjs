// Reference model for black-box acceptance: the committed fixture plus the deterministic update stream of the fixture
// generator, so a driver can tell which values, totals, digests and Insights are correct at (or around) a sequence.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  OPTIONS_PER_ITEM, fmt, insightsText, loadProfiles, selectionSummary, sha256Hex, stateText, updateStream,
} from '../../fixtures/generator/lib.mjs';

export { fmt };

export function labelWidth(itemCount) {
  return Math.max(3, String(Math.max(0, itemCount - 1)).length);
}

export function itemLabel(index, itemCount) {
  return `Item ${String(index).padStart(labelWidth(itemCount), '0')}`;
}

export class ReferenceModel {
  constructor(repo, profileName) {
    const profile = Object.fromEntries(loadProfiles())[profileName];
    if (!profile) throw new Error(`unknown profile ${profileName}`);
    const fixture = JSON.parse(readFileSync(join(repo, 'fixtures/v1', `${profileName}.json`), 'utf8'));
    this.name = profileName;
    this.profile = profile;
    this.golden = JSON.parse(readFileSync(join(repo, 'fixtures/v1/golden.json'), 'utf8')).profiles[profileName];
    this.items = fixture.items.length;
    this.groups = fixture.items.map((it) => it.g);
    this.initial = fixture.items.map((it) => [...it.v]);
    this.selection = fixture.selection.map((s) => ({ i: s.i, o: s.o }));
    this.rate = profile.updateRatePerSecond;
    this.updates = [null];
    this.stream = updateStream(profile, { items: fixture.items });
  }

  update(seq) {
    while (this.updates.length <= seq) this.updates.push(this.stream.next().value);
    return this.updates[seq];
  }

  valuesAt(seq) {
    const values = this.initial.map((v) => [...v]);
    for (let s = 1; s <= seq; s += 1) {
      const u = this.update(s);
      values[u.i] = [...u.v];
    }
    return values;
  }

  /** Every value the item's option had at some seq in [lo, hi]. */
  valueSet(item, option, lo, hi) {
    const out = new Set([this.valuesAt(lo)[item][option]]);
    for (let s = lo + 1; s <= hi; s += 1) {
      const u = this.update(s);
      if (u.i === item) out.add(u.v[option]);
    }
    return out;
  }

  /** Each seq in [lo, hi] with its values (one replay). */
  *walk(lo, hi) {
    const values = this.valuesAt(lo);
    yield [lo, values];
    for (let s = lo + 1; s <= hi; s += 1) {
      const u = this.update(s);
      values[u.i] = [...u.v];
      yield [s, values];
    }
  }

  totalTexts(selection, lo, hi) {
    const out = new Set();
    for (const [, values] of this.walk(lo, hi)) out.add(selectionSummary(values, selection).totalText);
    return out;
  }

  stateDigest(seq, selection) {
    const sorted = [...selection].sort((a, b) => a.i - b.i);
    return sha256Hex(stateText(this.name, seq, this.valuesAt(seq), sorted));
  }

  /** Top 5 by option A ([item, valueA]) and option-B buckets at every seq in [lo, hi]. */
  *insights(lo, hi) {
    for (const [seq, values] of this.walk(lo, hi)) {
      const text = insightsText(seq, values);
      const top = /^top=(.*)$/m.exec(text)[1].split(',').map((e) => e.split(':').map(Number));
      const buckets = /^buckets=(.*)$/m.exec(text)[1].split(',').map(Number);
      yield { seq, top, buckets };
    }
  }
}

export const OPTION_KEYS = ['a', 'b', 'c'].slice(0, OPTIONS_PER_ITEM);
