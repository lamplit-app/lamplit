import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { AccessibilityPanel } from './accessibility-panel';
import { AdvancedPanel } from './advanced-panel';
import { ColoursPanel } from './colours-panel';
import { ReadingPanel } from './reading-panel';

/**
 * Everything about how the story looks to you, and nothing about what is sent.
 *
 * Reading is what the top bar's menu used to hold, unchanged and open on
 * arrival. Colours and Advanced are folded away, because the first is a long
 * grid nobody needs on the way to the text size and the second is where the
 * options that come with a warning live.
 *
 * The sheet and nothing else. Each panel is a component of its own, holding
 * its own controls, its own styles and the handful of store calls it needs —
 * because the four share nothing but the accordion they sit in, and while they
 * were one file that file was the only one in the app whose size was not
 * explained by what it did. `features/model/` is the same arrangement: a thin
 * sheet around the two forms.
 *
 * The panels register with the accordion through the injector rather than by
 * being queried for, so a panel drawn inside a child component is as much a
 * part of it as one written here would be.
 */
@Component({
  selector: 'li-preferences-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatExpansionModule,
    ReadingPanel,
    AccessibilityPanel,
    ColoursPanel,
    AdvancedPanel,
  ],
  template: `
    <h2 mat-dialog-title>Preferences</h2>

    <mat-dialog-content>
      <mat-accordion multi>
        <li-reading-panel />
        <li-accessibility-panel />
        <li-colours-panel />
        <li-advanced-panel />
      </mat-accordion>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton="filled" mat-dialog-close>Done</button>
    </mat-dialog-actions>
  `,
})
export class PreferencesDialog {}
