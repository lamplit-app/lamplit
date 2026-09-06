import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { MAT_SLIDE_TOGGLE_DEFAULT_OPTIONS } from '@angular/material/slide-toggle';
import { BuildInfoStore } from './store/build-info';
import { Persistence } from './store/persistence';
import { STORAGE_BACKEND } from './store/storage';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: STORAGE_BACKEND, useExisting: Persistence },
    // No tick inside the switch. Material draws one as an `<svg>` in the
    // template, so this is the only way to be rid of it — a rule could hide it
    // but the paths would still be built for every switch on every sheet. The
    // knob says which way the switch is set by where it is and how big it is;
    // a mark inside a 16px circle is a mark nobody reads.
    { provide: MAT_SLIDE_TOGGLE_DEFAULT_OPTIONS, useValue: { hideIcon: true } },
    // Every document the session will read, fetched once, before anything can
    // ask for one. The app renders a failure screen rather than starting if
    // this does not come back — there is nothing to show without it.
    provideAppInitializer(() => inject(Persistence).load()),
    // Which build is answering, and whether an older one wrote these
    // documents. Deliberately not awaited: the app is perfectly usable without
    // knowing its own build number, so nothing waits on this one request.
    provideAppInitializer(() => {
      void inject(BuildInfoStore).load();
    }),
  ],
};
