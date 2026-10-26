// Per-item view model bound by the ListView row template (NativeScript data binding). Created lazily for
// the rows the ListView requests; a value update touches only the bound labels of that item.

import { Observable } from '@nativescript/core';
import { groupText, itemLabel, OPTION_KEYS, optionText } from '../core/format';
import { Store } from '../core/store';

const KEYS = ['a', 'b', 'c'];

export class ItemVM extends Observable {
  readonly index: number;

  constructor(index: number, store: Store, labelWidth: number) {
    super();
    this.index = index;
    const id = `mb.row.${index}`;
    this.set('rowId', id);
    this.set('labelId', `${id}.label`);
    KEYS.forEach((k) => this.set(`${k}Id`, `${id}.opt.${k}`));
    this.set('label', itemLabel(index, labelWidth));
    this.set('group', groupText(store.group(index)));
    this.refreshValues(store);
    this.refreshSelection(store);
  }

  refreshValues(store: Store): void {
    for (let o = 0; o < OPTION_KEYS.length; o += 1) {
      this.set(`${KEYS[o]}Text`, optionText(o, store.value(this.index, o)));
    }
  }

  refreshSelection(store: Store): void {
    const selected = store.selected[this.index];
    for (let o = 0; o < OPTION_KEYS.length; o += 1) {
      this.set(`${KEYS[o]}Class`, selected === o ? 'opt sel' : 'opt');
      // Options are toggles: checked / unchecked ('selected' sets the view's selected flag, not its checked state).
      this.set(`${KEYS[o]}State`, selected === o ? 'checked' : 'unchecked');
    }
  }
}

/** Selection-screen entry. */
export class SelectionEntryVM extends Observable {
  constructor(
    readonly index: number,
    readonly option: number,
    text: string,
  ) {
    super();
    this.set('text', text);
  }
}
