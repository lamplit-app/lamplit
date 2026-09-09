import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { AccessibilityPanel } from './accessibility-panel';
import { SettingsStore } from '../../store/settings-store';
import { KEYS } from '../../store/documents';
import { STORAGE_BACKEND } from '../../store/storage';
import { InMemoryStorage } from '../../store/testing/in-memory-storage';

/**
 * The panel is two questions and both of them have an answer already — the
 * reader's own machine. What is asserted is that saying otherwise is written
 * down as a setting, because that is the whole of the panel: `applyUi` turns
 * it into an attribute and `styles.scss` has a block per state.
 */
describe('AccessibilityPanel', () => {
  let storage: InMemoryStorage;
  let fixture: ReturnType<typeof TestBed.createComponent<AccessibilityPanel>>;

  const settings = () => TestBed.inject(SettingsStore);
  const host = () => fixture.nativeElement as HTMLElement;

  function open(ui: Record<string, unknown> = {}): void {
    storage.write(KEYS.settings, {
      connection: { provider: 'nanogpt', baseUrl: 'https://x/v1', apiKey: '', model: 'm' },
      ui: { theme: 'light', ...ui },
    });
    fixture = TestBed.createComponent(AccessibilityPanel);
    fixture.detectChanges();
  }

  /** One of the two choices, reached by the name above the box. */
  function choice(label: string): HTMLSelectElement {
    const field = [...host().querySelectorAll('li-field')].find(
      (candidate) => candidate.querySelector('.li-field-label')?.textContent.trim() === label,
    );
    if (!field) throw new Error(`no field called ${label}`);
    return field.querySelector<HTMLSelectElement>('select')!;
  }

  function say(label: string, value: string): void {
    const select = choice(label);
    select.value = value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  /** What the folded panel says about itself. */
  function summary(): string {
    return host().querySelector('mat-panel-description')?.textContent.trim() ?? '';
  }

  beforeEach(() => {
    storage = new InMemoryStorage();
    TestBed.configureTestingModule({
      providers: [{ provide: STORAGE_BACKEND, useValue: storage }],
    });
  });

  it('offers three states for contrast and two for motion', () => {
    open();

    expect([...choice('Contrast').options].map((option) => option.value)).toEqual([
      'system',
      'high',
      'normal',
    ]);
    // No "always animate": see `MotionMode`, which is where the reason is.
    expect([...choice('Motion').options].map((option) => option.value)).toEqual([
      'system',
      'reduced',
    ]);
  });

  it('starts on the machine, and writes down whichever way it is overruled', () => {
    open();
    expect(choice('Contrast').value).toBe('system');
    expect(summary()).toBe('following your computer');

    say('Contrast', 'high');
    expect(settings().ui().contrast).toBe('high');
    expect(summary()).toBe('stronger contrast');

    say('Contrast', 'normal');
    expect(settings().ui().contrast).toBe('normal');

    say('Motion', 'reduced');
    expect(settings().ui().motion).toBe('reduced');
    expect(summary()).toBe('contrast as it ships, nothing moves');
  });

  it('shows what a settings file already says', () => {
    open({ contrast: 'high', motion: 'reduced' });

    expect(choice('Contrast').value).toBe('high');
    expect(choice('Motion').value).toBe('reduced');
  });
});
